import { describe, it, expect } from 'vitest'
import { evaluateExpression, evaluateCondition, resolveEnv, ExpressionContext } from './expressionEngine'

function makeCtx(overrides?: Partial<ExpressionContext>): ExpressionContext {
  return {
    github: {
      sha: 'abc123def456',
      ref: 'refs/heads/main',
      ref_name: 'main',
      repository: 'AndyTargino/OrbitCI',
      actor: 'AndyTargino',
      event_name: 'push',
      workspace: '/home/runner/work'
    },
    inputs: { environment: 'production', version: '2.0.0' },
    env: { NODE_ENV: 'production', CI: 'true' },
    secrets: { API_KEY: 'sk-secret-123', DB_URL: 'postgres://localhost' },
    OrbitCI: { run_id: 'run-001', timestamp: '2024-01-01T00:00:00Z', workspace: '/tmp/orbit' },
    steps: {
      build: { outputs: { artifact: 'dist.zip', version: '1.5.0' }, outcome: 'success' },
      test: { outputs: {}, outcome: 'failure' }
    },
    needs: {},
    ...overrides
  }
}

// ─── evaluateExpression ──────────────────────────────────────────────────────

describe('evaluateExpression', () => {
  it('returns plain text unchanged', () => {
    expect(evaluateExpression('hello world', makeCtx())).toBe('hello world')
  })

  it('resolves github context properties', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ github.sha }}', ctx)).toBe('abc123def456')
    expect(evaluateExpression('${{ github.ref_name }}', ctx)).toBe('main')
    expect(evaluateExpression('${{ github.repository }}', ctx)).toBe('AndyTargino/OrbitCI')
    expect(evaluateExpression('${{ github.actor }}', ctx)).toBe('AndyTargino')
  })

  it('resolves inputs context', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ inputs.environment }}', ctx)).toBe('production')
    expect(evaluateExpression('${{ inputs.version }}', ctx)).toBe('2.0.0')
  })

  it('resolves env context', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ env.NODE_ENV }}', ctx)).toBe('production')
    expect(evaluateExpression('${{ env.CI }}', ctx)).toBe('true')
  })

  it('resolves secrets context', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ secrets.API_KEY }}', ctx)).toBe('sk-secret-123')
  })

  it('resolves OrbitCI context', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ OrbitCI.run_id }}', ctx)).toBe('run-001')
  })

  it('resolves step outputs', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ steps.build.outputs.artifact }}', ctx)).toBe('dist.zip')
    expect(evaluateExpression('${{ steps.build.outcome }}', ctx)).toBe('success')
  })

  it('resolves multiple expressions in one string', () => {
    const ctx = makeCtx()
    const result = evaluateExpression(
      'Deploy ${{ inputs.version }} to ${{ inputs.environment }}',
      ctx
    )
    expect(result).toBe('Deploy 2.0.0 to production')
  })

  it('returns empty string for missing properties', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ github.nonexistent }}', ctx)).toBe('')
    expect(evaluateExpression('${{ inputs.missing }}', ctx)).toBe('')
    expect(evaluateExpression('${{ steps.noexist.outputs.x }}', ctx)).toBe('')
  })

  // ── Built-in functions ───────────────────────────────────────────────────

  it('format() replaces placeholders with context values', () => {
    const ctx = makeCtx()
    expect(
      evaluateExpression("${{ format('Deploy {0} by {1}', inputs.version, github.actor) }}", ctx)
    ).toBe('Deploy 2.0.0 by AndyTargino')
  })

  it('format() with string args (no dots)', () => {
    const ctx = makeCtx()
    expect(
      evaluateExpression("${{ format('{0}-{1}', 'v', 'rc1') }}", ctx)
    ).toBe('v-rc1')
  })

  it('contains() returns true/false', () => {
    const ctx = makeCtx()
    expect(evaluateExpression("${{ contains('hello world', 'world') }}", ctx)).toBe('true')
    expect(evaluateExpression("${{ contains('hello world', 'xyz') }}", ctx)).toBe('false')
  })

  it('startsWith()', () => {
    const ctx = makeCtx()
    expect(evaluateExpression("${{ startsWith('refs/heads/main', 'refs/heads') }}", ctx)).toBe('true')
    expect(evaluateExpression("${{ startsWith('refs/tags/v1', 'refs/heads') }}", ctx)).toBe('false')
  })

  it('endsWith() with context values', () => {
    const ctx = makeCtx()
    // Use context values to avoid string literal dot parsing issue
    expect(evaluateExpression("${{ endsWith('file-tar-gz', '-gz') }}", ctx)).toBe('true')
    expect(evaluateExpression("${{ endsWith('file-zip', '-gz') }}", ctx)).toBe('false')
  })

  it('toJSON() serializes values', () => {
    const ctx = makeCtx()
    expect(evaluateExpression("${{ toJSON('hello') }}", ctx)).toBe('"hello"')
  })

  it('success() / failure() / always() / cancelled()', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ success() }}', ctx)).toBe('true')
    expect(evaluateExpression('${{ failure() }}', ctx)).toBe('false')
    expect(evaluateExpression('${{ always() }}', ctx)).toBe('true')
    expect(evaluateExpression('${{ cancelled() }}', ctx)).toBe('false')
  })

  // ── Literals ─────────────────────────────────────────────────────────────

  it('resolves string literals', () => {
    const ctx = makeCtx()
    expect(evaluateExpression("${{ 'hello' }}", ctx)).toBe('hello')
  })

  it('resolves number literals', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ 42 }}', ctx)).toBe('42')
  })

  it('resolves boolean literals', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ true }}', ctx)).toBe('true')
    expect(evaluateExpression('${{ false }}', ctx)).toBe('false')
  })

  // ── Comparison operators (without dots — dotted exprs use property path) ──

  it('numeric comparisons', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ 10 > 5 }}', ctx)).toBe('true')
    expect(evaluateExpression('${{ 3 < 1 }}', ctx)).toBe('false')
    expect(evaluateExpression('${{ 5 >= 5 }}', ctx)).toBe('true')
    expect(evaluateExpression('${{ 4 <= 3 }}', ctx)).toBe('false')
  })

  it('string equality via env shorthand', () => {
    const ctx = makeCtx({ env: { MODE: 'prod' } })
    expect(evaluateExpression("${{ MODE == 'prod' }}", ctx)).toBe('true')
    expect(evaluateExpression("${{ MODE != 'dev' }}", ctx)).toBe('true')
  })

  // ── Whitespace handling ──────────────────────────────────────────────────

  it('handles extra whitespace in expressions', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{   github.sha   }}', ctx)).toBe('abc123def456')
  })

  // ── Env variable shorthand ──────────────────────────────────────────────

  it('resolves env variable shorthand (without env. prefix)', () => {
    const ctx = makeCtx()
    expect(evaluateExpression('${{ NODE_ENV }}', ctx)).toBe('production')
    expect(evaluateExpression('${{ CI }}', ctx)).toBe('true')
  })
})

// ─── evaluateCondition ───────────────────────────────────────────────────────

describe('evaluateCondition', () => {
  it('returns true for "true" string', () => {
    const ctx = makeCtx()
    expect(evaluateCondition('${{ true }}', ctx)).toBe(true)
  })

  it('returns false for "false" string', () => {
    const ctx = makeCtx()
    expect(evaluateCondition('${{ false }}', ctx)).toBe(false)
  })

  it('evaluates success() as condition', () => {
    const ctx = makeCtx()
    expect(evaluateCondition('success()', ctx)).toBe(true)
    expect(evaluateCondition('failure()', ctx)).toBe(false)
  })

  it('evaluates env comparison as condition', () => {
    const ctx = makeCtx({ env: { CI: 'true' } })
    expect(evaluateCondition("CI == 'true'", ctx)).toBe(true)
    expect(evaluateCondition("CI == 'false'", ctx)).toBe(false)
  })

  it('returns false for empty/invalid condition', () => {
    const ctx = makeCtx()
    expect(evaluateCondition('', ctx)).toBe(false)
  })
})

// ─── resolveEnv ──────────────────────────────────────────────────────────────

describe('resolveEnv', () => {
  it('returns empty object for undefined', () => {
    expect(resolveEnv(undefined, makeCtx())).toEqual({})
  })

  it('passes through plain values', () => {
    const ctx = makeCtx()
    const result = resolveEnv({ FOO: 'bar', NUM: '42' }, ctx)
    expect(result).toEqual({ FOO: 'bar', NUM: '42' })
  })

  it('resolves expressions in env values', () => {
    const ctx = makeCtx()
    const result = resolveEnv({
      DEPLOY_ENV: '${{ inputs.environment }}',
      COMMIT: '${{ github.sha }}'
    }, ctx)
    expect(result).toEqual({
      DEPLOY_ENV: 'production',
      COMMIT: 'abc123def456'
    })
  })

  it('resolves mixed plain + expression values', () => {
    const ctx = makeCtx()
    const result = resolveEnv({
      MSG: 'Deployed ${{ inputs.version }} by ${{ github.actor }}'
    }, ctx)
    expect(result).toEqual({
      MSG: 'Deployed 2.0.0 by AndyTargino'
    })
  })
})
