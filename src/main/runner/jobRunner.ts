import { readFileSync, writeFileSync, existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db'
import { runJobs, runSteps, runLogs } from '../db/schema'
import { runStep } from './stepRunner'
import { evaluateExpression, evaluateCondition, resolveEnv, type ExpressionContext } from './expressionEngine'
import {
  ensureImageAvailable,
  createWorkflowContainer,
  stopAndRemoveContainer
} from '../services/dockerService'
import { sendRunLog, sendToRenderer } from '../services/notifyService'
import { IPC_CHANNELS } from '@shared/constants'
import type { ProcessMonitor } from '../services/processMonitor'
import type { JobDefinition } from '@shared/types'

export interface JobRunnerOpts {
  runId: string
  repoId: string
  jobName: string
  job: JobDefinition
  workspace: string
  baseEnv: Record<string, string>
  baseCtx: ExpressionContext
  cancelCheck: () => boolean
  monitor?: ProcessMonitor
}

export interface JobResult {
  status: 'success' | 'failure' | 'cancelled'
  outputs: Record<string, string>
  durationMs: number
}

export async function runJob(opts: JobRunnerOpts): Promise<JobResult> {
  const { runId, repoId, jobName, job, workspace, baseEnv, baseCtx, cancelCheck, monitor } = opts
  const jobId = uuidv4()
  const start = Date.now()

  // Insert job record
  await db.insert(runJobs).values({
    id: jobId,
    runId,
    jobName,
    status: 'running',
    startedAt: new Date().toISOString()
  })

  sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, { runId, status: 'running', jobName })

  const log = async (
    message: string,
    type: string = 'output',
    stepName?: string
  ) => {
    await db.insert(runLogs).values({
      runId,
      jobName,
      stepName: stepName ?? null,
      message,
      type,
      timestamp: new Date().toISOString()
    })
    sendRunLog(runId, jobName, stepName ?? null, message, type)
  }

  // Job env
  const env: Record<string, string> = {
    ...baseEnv,
    ...(job.env ?? {}),
    ORBIT_JOB: jobName
  }

  const ctx: ExpressionContext = { ...baseCtx, env }

  // Docker container for this job?
  let containerId: string | undefined
  if (job.container) {
    const image = evaluateExpression(job.container, ctx)
    try {
      await log(`Preparando container: ${image}`, 'info')
      await ensureImageAvailable(image)
      containerId = await createWorkflowContainer({
        image,
        repoPath: workspace,
        env,
        runId,
        jobName
      })
      await log(`✓ Container iniciado: ${containerId.slice(0, 12)}`, 'info')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await log(`❌ Falha ao criar container: ${msg}`, 'error')
      await finalizeJob(jobId, 'failure', Date.now() - start)
      return { status: 'failure', outputs: {}, durationMs: Date.now() - start }
    }
  }

  const outputs: Record<string, string> = {}
  let jobStatus: 'success' | 'failure' | 'cancelled' = 'success'

  try {
    await log(`▶ Job: ${jobName}`, 'job')

    const steps = job.steps ?? []
    for (let i = 0; i < steps.length; i++) {
      if (cancelCheck()) {
        jobStatus = 'cancelled'
        break
      }

      const step = steps[i]
      const stepId = uuidv4()
      const stepName = step.name ?? step.run?.slice(0, 40) ?? step.OrbitCI ?? `Step ${i + 1}`

      await db.insert(runSteps).values({
        id: stepId,
        runId,
        jobId,
        stepName,
        stepIndex: i,
        status: 'running',
        startedAt: new Date().toISOString()
      })

      sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, {
        runId,
        status: 'running',
        jobName,
        stepName,
        stepStatus: 'running'
      })

      await log(`  · ${stepName}`, 'step', stepName)

      // Step-level env
      const stepEnv = { ...env, ...resolveEnv(step.env, ctx) }

      const result = await runStep({
        step,
        stepIndex: i,
        workspace,
        env: stepEnv,
        ctx: { ...ctx, env: stepEnv },
        log: async (msg) => log(msg, 'output', stepName),
        setOutput: (k, v) => { outputs[k] = v; env[k] = v },
        containerId,
        monitor,
        stepId,
        runId,
        jobName
      })

      // Stop monitor and save metrics for this step
      if (monitor) {
        const metrics = await monitor.stop()
        if (metrics) {
          await monitor.savePeaksToStep(stepId, metrics)
        }
      }

      // Parse GITHUB_OUTPUT file → expose as step outputs for expressions
      const outputFilePath = stepEnv.GITHUB_OUTPUT
      if (outputFilePath && existsSync(outputFilePath)) {
        try {
          const content = readFileSync(outputFilePath, 'utf-8').trim()
          for (const line of content.split('\n')) {
            const eq = line.indexOf('=')
            if (eq > 0) {
              const k = line.slice(0, eq).trim()
              const v = line.slice(eq + 1)
              if (k) { outputs[k] = v; result.outputs[k] = v }
            }
          }
          writeFileSync(outputFilePath, '') // Clear for next step
        } catch { /* ignore */ }
      }

      // Parse GITHUB_ENV file → propagate env vars to subsequent steps
      const envFilePath = stepEnv.GITHUB_ENV
      if (envFilePath && existsSync(envFilePath)) {
        try {
          const content = readFileSync(envFilePath, 'utf-8').trim()
          for (const line of content.split('\n')) {
            const eq = line.indexOf('=')
            if (eq > 0) {
              const k = line.slice(0, eq).trim()
              const v = line.slice(eq + 1)
              if (k) { env[k] = v }
            }
          }
        } catch { /* ignore */ }
      }

      // Update step status
      await db
        .update(runSteps)
        .set({
          status: result.status,
          finishedAt: new Date().toISOString(),
          durationMs: result.durationMs,
        })
        .where(require('drizzle-orm').eq(runSteps.id, stepId))

      sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, {
        runId,
        status: result.status === 'failure' ? 'failure' : 'running',
        jobName,
        stepName,
        stepStatus: result.status
      })

      if (result.status === 'success' || result.status === 'skipped') {
        await log(`    ✓ ${stepName} (${result.durationMs}ms)`, 'success', stepName)
      } else if (result.status === 'failure') {
        await log(`    ❌ ${stepName}: ${result.error}`, 'error', stepName)
        jobStatus = 'failure'
        break
      }
    }
  } finally {
    if (containerId) {
      await stopAndRemoveContainer(containerId)
      await log(`✓ Container removido`, 'info')
    }
  }

  const durationMs = Date.now() - start
  await finalizeJob(jobId, jobStatus, durationMs)
  return { status: jobStatus, outputs, durationMs }
}

async function finalizeJob(
  jobId: string,
  status: string,
  durationMs: number
): Promise<void> {
  const { eq } = await import('drizzle-orm')
  await db.update(runJobs).set({
    status,
    finishedAt: new Date().toISOString(),
    durationMs
  }).where(eq(runJobs.id, jobId))
}
