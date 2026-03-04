/**
 * Evaluates ${{ expression }} syntax in workflow YAML values.
 * Supports contexts: github, inputs, env, secrets, OrbitCI
 * Supports functions: format, join, toJSON, fromJSON, contains, startsWith, endsWith
 */

export interface ExpressionContext {
  github: {
    sha: string
    ref: string
    ref_name: string
    repository: string
    actor: string
    event_name: string
    workspace: string
    [key: string]: unknown // Allow nested properties like event.release.*
  }
  inputs: Record<string, string>
  env: Record<string, string>
  secrets: Record<string, string>
  OrbitCI: {
    run_id: string
    timestamp: string
    workspace: string
  }
  steps: Record<string, { outputs: Record<string, string>; outcome: string }>
  needs: Record<string, { outputs: Record<string, string>; result: string }>
  /** Current job status for success()/failure()/cancelled() functions */
  job?: { status: 'success' | 'failure' | 'cancelled' }
}

export function evaluateExpression(template: string, ctx: ExpressionContext): string {
  return template.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expr) => {
    try {
      return String(evalExpr(expr.trim(), ctx))
    } catch {
      return ''
    }
  })
}

export function evaluateCondition(condition: string, ctx: ExpressionContext): boolean {
  const resolved = evaluateExpression(condition, ctx)
  if (resolved === 'true') return true
  if (resolved === 'false') return false
  // Try to evaluate as expression directly
  try {
    const result = evalExpr(condition, ctx)
    if (typeof result === 'boolean') return result
    return Boolean(result)
  } catch {
    return false
  }
}

function evalExpr(expr: string, ctx: ExpressionContext): unknown {
  // Try function calls first
  const funcMatch = expr.match(/^(\w+)\((.*)\)$/)
  if (funcMatch) {
    const [, funcName, argsStr] = funcMatch
    return callBuiltinFunc(funcName, argsStr, ctx)
  }

  // Property access: github.sha, inputs.version, etc.
  if (expr.includes('.')) {
    return resolvePropertyPath(expr, ctx)
  }

  // String literal
  if (
    (expr.startsWith("'") && expr.endsWith("'")) ||
    (expr.startsWith('"') && expr.endsWith('"'))
  ) {
    return expr.slice(1, -1)
  }

  // Boolean / null
  if (expr === 'true') return true
  if (expr === 'false') return false
  if (expr === 'null' || expr === '') return null

  // Number
  if (!isNaN(Number(expr))) return Number(expr)

  // Logical operators (lowest precedence, checked first)
  for (const op of ['&&', '||']) {
    const parts = splitOnOperator(expr, op)
    if (parts) {
      const [left, right] = parts
      const l = evalExpr(left.trim(), ctx)
      const r = evalExpr(right.trim(), ctx)
      if (op === '&&') return Boolean(l) && Boolean(r)
      if (op === '||') return Boolean(l) || Boolean(r)
    }
  }

  // Negation operator
  if (expr.startsWith('!')) {
    const inner = expr.slice(1).trim()
    return !evalExpr(inner, ctx)
  }

  // Comparison operators
  for (const op of ['!=', '==', '>=', '<=', '>', '<']) {
    const parts = splitOnOperator(expr, op)
    if (parts) {
      const [left, right] = parts
      const l = evalExpr(left.trim(), ctx)
      const r = evalExpr(right.trim(), ctx)
      switch (op) {
        case '==': return l == r
        case '!=': return l != r
        case '>': return (l as number) > (r as number)
        case '<': return (l as number) < (r as number)
        case '>=': return (l as number) >= (r as number)
        case '<=': return (l as number) <= (r as number)
      }
    }
  }

  // env variable shorthand
  const envVal = ctx.env[expr]
  if (envVal !== undefined) return envVal

  return ''
}

function splitOnOperator(expr: string, op: string): [string, string] | null {
  const idx = expr.indexOf(op)
  if (idx === -1) return null
  return [expr.slice(0, idx), expr.slice(idx + op.length)]
}

function resolvePropertyPath(path: string, ctx: ExpressionContext): unknown {
  const parts = path.split('.')
  let current: unknown = ctx
  for (const part of parts) {
    if (current === null || current === undefined) return ''
    if (typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[part]
  }
  return current ?? ''
}

function callBuiltinFunc(name: string, argsStr: string, ctx: ExpressionContext): unknown {
  const args = splitArgs(argsStr).map((a) => evalExpr(a.trim(), ctx))

  switch (name) {
    case 'format': {
      const [template, ...vals] = args
      let result = String(template)
      vals.forEach((v, i) => { result = result.replace(`{${i}}`, String(v)) })
      return result
    }
    case 'join': {
      const [arr, sep] = args
      if (Array.isArray(arr)) return arr.join(String(sep ?? ','))
      return String(arr)
    }
    case 'toJSON':
      return JSON.stringify(args[0])
    case 'fromJSON': {
      try { return JSON.parse(String(args[0])) } catch { return null }
    }
    case 'contains': {
      const [haystack, needle] = args.map(String)
      return haystack.includes(needle)
    }
    case 'startsWith': {
      const [str, prefix] = args.map(String)
      return str.startsWith(prefix)
    }
    case 'endsWith': {
      const [str, suffix] = args.map(String)
      return str.endsWith(suffix)
    }
    case 'success': {
      const jobStatus = ctx.job?.status ?? 'success'
      return jobStatus === 'success'
    }
    case 'failure': {
      const jobStatus = ctx.job?.status ?? 'success'
      return jobStatus === 'failure'
    }
    case 'always': return true
    case 'cancelled': {
      const jobStatus = ctx.job?.status ?? 'success'
      return jobStatus === 'cancelled'
    }
    default:
      return ''
  }
}

function splitArgs(argsStr: string): string[] {
  const args: string[] = []
  let depth = 0
  let current = ''
  let inString = false
  let stringChar = ''

  for (const ch of argsStr) {
    if (inString) {
      current += ch
      if (ch === stringChar) inString = false
    } else if (ch === "'" || ch === '"') {
      inString = true
      stringChar = ch
      current += ch
    } else if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) args.push(current.trim())
  return args
}

export function resolveEnv(
  envDefs: Record<string, string> | undefined,
  ctx: ExpressionContext
): Record<string, string> {
  if (!envDefs) return {}
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(envDefs)) {
    result[key] = evaluateExpression(String(val), ctx)
  }
  return result
}
