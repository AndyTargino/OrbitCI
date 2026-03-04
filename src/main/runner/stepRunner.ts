import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { getAction, type ActionContext } from './actions'
import { evaluateExpression, evaluateCondition, type ExpressionContext } from './expressionEngine'
import {
  execInContainer,
  createWorkflowContainer,
  stopAndRemoveContainer
} from '../services/dockerService'
import type { ProcessMonitor, MetricsSummary } from '../services/processMonitor'
import type { StepDefinition } from '@shared/types'

export interface StepRunnerOpts {
  step: StepDefinition
  stepIndex: number
  workspace: string
  env: Record<string, string>
  ctx: ExpressionContext
  log: (msg: string, type?: string) => void
  setOutput: (key: string, value: string) => void
  containerId?: string
  monitor?: ProcessMonitor
  stepId?: string
  runId?: string
  jobName?: string
}

export interface StepResult {
  status: 'success' | 'failure' | 'skipped'
  durationMs: number
  outputs: Record<string, string>
  error?: string
  metrics?: MetricsSummary | null
}

export async function runStep(opts: StepRunnerOpts): Promise<StepResult> {
  const { step, stepIndex, workspace, env, ctx, log, setOutput, containerId, monitor, stepId, runId, jobName } = opts
  const start = Date.now()
  const outputs: Record<string, string> = {}

  const stepLog = (msg: string) => log(msg)
  const stepSetOutput = (k: string, v: string) => {
    outputs[k] = v
    setOutput(k, v)
  }

  // Evaluate condition
  if (step.if) {
    const condition = evaluateExpression(step.if, ctx)
    const shouldRun = evaluateCondition(condition, ctx)
    if (!shouldRun) {
      log(`⏭ Skipped (condition: ${step.if})`, 'skip')
      return { status: 'skipped', durationMs: Date.now() - start, outputs }
    }
  }

  try {
    if (step.run) {
      // Shell command
      const command = evaluateExpression(step.run, ctx)
      const workDir = step['working-directory']
        ? evaluateExpression(step['working-directory'], ctx)
        : undefined

      if (containerId) {
        // Start Docker container monitoring if available
        const dockerMeta = monitor && runId && jobName
          ? { runId, jobName, stepName: step.name ?? `Step ${stepIndex + 1}` }
          : undefined
        if (monitor && dockerMeta) {
          monitor.startDocker(containerId, dockerMeta)
        }
        // Run inside Docker container
        const result = await execInContainer(containerId, command, workDir)
        if (result.output) log(result.output, 'output')
        if (result.exitCode !== 0) {
          throw new Error(`Exit code ${result.exitCode}`)
        }
      } else {
        // Run locally
        const stepMeta = monitor && runId && jobName
          ? { runId, jobName, stepName: step.name ?? `Step ${stepIndex + 1}` }
          : undefined
        await runShellCommand(command, workspace, workDir, env, stepLog, monitor, stepMeta)
      }
    } else if (step.OrbitCI) {
      // Built-in action
      const actionName = evaluateExpression(step.OrbitCI, ctx)
      const action = getAction(actionName)
      if (!action) throw new Error(`Action não encontrada: ${actionName}`)

      // Resolve `with` params
      const resolvedWith: Record<string, string> = {}
      if (step.with) {
        for (const [k, v] of Object.entries(step.with)) {
          resolvedWith[k] = evaluateExpression(String(v), ctx)
        }
      }

      const actionCtx: ActionContext = {
        workspace,
        env,
        with: resolvedWith,
        log: (msg) => stepLog(msg),
        setOutput: stepSetOutput
      }

      const result = await action(actionCtx)
      if (result) {
        for (const [k, v] of Object.entries(result)) {
          stepSetOutput(k, v)
        }
      }
    }

    return { status: 'success', durationMs: Date.now() - start, outputs }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (step['continue-on-error']) {
      log(`⚠ Continuando após erro: ${message}`, 'warning')
      return { status: 'success', durationMs: Date.now() - start, outputs, error: message }
    }

    return { status: 'failure', durationMs: Date.now() - start, outputs, error: message }
  }
}

function findWindowsBash(): string | null {
  const candidates = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)']!, 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA!, 'Programs', 'Git', 'bin', 'bash.exe'),
    process.env.USERPROFILE && join(process.env.USERPROFILE!, 'scoop', 'shims', 'bash.exe'),
  ].filter(Boolean) as string[]

  // Also scan PATH entries that look like Git directories
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (dir.toLowerCase().includes('git')) {
      candidates.push(join(dir, 'bash.exe'))
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function runShellCommand(
  command: string,
  cwd: string,
  workingDir: string | undefined,
  env: Record<string, string>,
  log: (msg: string) => void,
  monitor?: ProcessMonitor,
  monitorMeta?: { runId: string; jobName: string; stepName: string }
): Promise<void> {
  const resolvedCwd = workingDir ? join(cwd, workingDir) : cwd
  const isWindows = process.platform === 'win32'

  let shell: string
  let shellFlag: string
  if (isWindows) {
    const bash = findWindowsBash()
    if (bash) {
      shell = bash
      shellFlag = '-c'
    } else {
      shell = 'powershell.exe'
      shellFlag = '-Command'
    }
  } else {
    shell = '/bin/sh'
    shellFlag = '-c'
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(shell, [shellFlag, command], {
      cwd: resolvedCwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    // Start resource monitoring if available
    if (monitor && monitorMeta && proc.pid) {
      monitor.start(proc.pid, monitorMeta)
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split('\n')
      for (const line of lines) {
        if (line.trim()) log(line)
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split('\n')
      for (const line of lines) {
        if (line.trim()) log(`⚠ ${line}`)
      }
    })

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Process exited with code ${code}`))
    })

    proc.on('error', reject)
  })
}
