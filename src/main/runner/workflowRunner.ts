import { v4 as uuidv4 } from 'uuid'
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import yaml from 'js-yaml'
import { db } from '../db'
import { runs, runLogs, repos, settings } from '../db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { runJob } from './jobRunner'
import { evaluateExpression, evaluateCondition, type ExpressionContext } from './expressionEngine'
import { resolveSecrets } from '../services/secretService'
import { ProcessMonitor } from '../services/processMonitor'
import { sendRunLog, sendToRenderer, notifyRunComplete, notifyRunStart } from '../services/notifyService'
import { getCurrentSha, getCurrentBranch, checkout as gitCheckout } from '../git/gitEngine'
import { getStoredToken } from '../services/githubService'
import { IPC_CHANNELS, WORKFLOW_DIRS, DEFAULT_MAX_CONCURRENT } from '@shared/constants'
import type { WorkflowDefinition, JobDefinition, RunStatus } from '@shared/types'

export interface TriggerEvent {
  branch?: string
  sha?: string
  localPath?: string
  inputs?: Record<string, string>
  eventName?: string
  release?: {
    tag_name: string
    name: string
    body?: string
    draft: boolean
    prerelease: boolean
    html_url?: string
    id?: number
  }
}

// Singleton runner instance (for actions that need to fire events)
let runnerInstance: WorkflowRunner | null = null
export function getRunnerInstance(): WorkflowRunner | null {
  return runnerInstance
}

// Map of runId → cancel flag
const cancelFlags = new Map<string, boolean>()

interface QueueItem {
  runId: string
  repoId: string
  wf: WorkflowDefinition
  workspace: string
  trigger: string
  event: TriggerEvent
}

export class WorkflowRunner {
  private queue: QueueItem[] = []
  private activeRuns = new Set<string>()
  private draining = false

  constructor() {
    runnerInstance = this
  }

  /** Mark stale pending/running runs from previous sessions as cancelled */
  async cleanupStaleRuns(): Promise<void> {
    await db.update(runs).set({
      status: 'cancelled',
      finishedAt: new Date().toISOString()
    }).where(inArray(runs.status, ['pending', 'running']))
  }

  async triggerEvent(repoId: string, eventName: string, event: TriggerEvent): Promise<void> {
    console.log(`[WorkflowRunner] triggerEvent called: event=${eventName}, repoId=${repoId}`)

    const [repoRow] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
    if (!repoRow?.localPath) {
      console.log(`[WorkflowRunner] triggerEvent: repo not found or no localPath for ${repoId}`)
      return
    }

    // Scan both directories (.github/workflows first, then .orbit/workflows)
    // Dedup by filename so .github/workflows takes priority
    const seen = new Set<string>()
    const allFiles: Array<{ file: string; fullPath: string }> = []

    for (const dir of WORKFLOW_DIRS) {
      const workflowsDir = join(repoRow.localPath, dir)
      if (!existsSync(workflowsDir)) continue

      const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      for (const file of files) {
        if (seen.has(file)) continue
        seen.add(file)
        allFiles.push({ file, fullPath: join(workflowsDir, file) })
      }
    }

    if (allFiles.length === 0) {
      console.log(`[WorkflowRunner] triggerEvent: no workflow files found in any directory`)
      return
    }

    console.log(`[WorkflowRunner] triggerEvent: found ${allFiles.length} workflow files: ${allFiles.map(f => f.file).join(', ')}`)

    let matched = 0
    for (const { file, fullPath } of allFiles) {
      const wf = this.parseWorkflow(fullPath)
      if (!wf) {
        console.log(`[WorkflowRunner] triggerEvent: could not parse ${file}`)
        continue
      }

      const matches = this.matchesTrigger(wf, eventName, event)
      console.log(`[WorkflowRunner] triggerEvent: ${file} → matchesTrigger(${eventName}) = ${matches} (on: ${JSON.stringify(wf.on)})`)

      if (matches) {
        matched++
        this.queueRun(repoId, file, eventName, event).catch(console.error)
      }
    }
    console.log(`[WorkflowRunner] triggerEvent: ${matched}/${allFiles.length} workflows matched event '${eventName}'`)
  }

  async queueRun(
    repoId: string,
    workflowFile: string,
    trigger: string,
    event: TriggerEvent
  ): Promise<string> {
    const [repoRow] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
    if (!repoRow?.localPath) throw new Error('Repo not found or no local path')

    // Resolve workflow file from both directories (.github/workflows first)
    const workflowPath = this.resolveWorkflowFile(repoRow.localPath, workflowFile)
    if (!workflowPath) throw new Error(`Workflow not found: ${workflowFile}`)
    const wf = this.parseWorkflow(workflowPath)
    if (!wf) throw new Error(`Cannot parse workflow: ${workflowFile}`)

    let sha = event.sha
    let branch = event.branch
    try {
      if (!sha) sha = await getCurrentSha(repoRow.localPath)
      if (!branch) branch = await getCurrentBranch(repoRow.localPath)
    } catch { /* ignore */ }

    // Dedup: if a run with the same (repoId, workflowFile, gitSha) is already pending/running, skip
    if (sha) {
      const existing = await db
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.repoId, repoId),
            eq(runs.workflowFile, workflowFile),
            eq(runs.gitSha, sha),
            inArray(runs.status, ['pending', 'running'])
          )
        )
        .limit(1)

      if (existing.length > 0) {
        console.log(`[WorkflowRunner] Dedup: skipping ${workflowFile} for SHA ${sha.slice(0, 7)} (existing run ${existing[0].id})`)
        return existing[0].id
      }
    }

    const runId = uuidv4()
    await db.insert(runs).values({
      id: runId,
      repoId,
      workflowFile,
      workflowName: wf.name ?? workflowFile,
      trigger,
      status: 'pending',
      gitSha: sha ?? null,
      gitBranch: branch ?? null,
      inputs: event.inputs ? JSON.stringify(event.inputs) : null,
      createdAt: new Date().toISOString()
    })

    // Add to FIFO queue instead of executing immediately
    this.queue.push({ runId, repoId, wf, workspace: repoRow.localPath, trigger, event })
    this.drain().catch(console.error)
    return runId
  }

  async cancelRun(runId: string): Promise<void> {
    cancelFlags.set(runId, true)

    // Remove from queue if still pending
    const idx = this.queue.findIndex((item) => item.runId === runId)
    if (idx !== -1) this.queue.splice(idx, 1)

    await db.update(runs).set({
      status: 'cancelled',
      finishedAt: new Date().toISOString()
    }).where(eq(runs.id, runId))
    sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, { runId, status: 'cancelled' })
  }

  /** FIFO drain: process queued runs respecting maxConcurrentRuns */
  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true

    try {
      while (this.queue.length > 0) {
        const maxConcurrent = await this.getMaxConcurrentRuns()
        if (this.activeRuns.size >= maxConcurrent) break

        const item = this.queue.shift()!
        this.activeRuns.add(item.runId)

        this.executeRun(
          item.runId,
          item.repoId,
          item.wf,
          item.workspace,
          item.trigger,
          item.event
        )
          .catch(console.error)
          .finally(() => {
            this.activeRuns.delete(item.runId)
            this.drain().catch(console.error)
          })
      }
    } finally {
      this.draining = false
    }
  }

  private async getMaxConcurrentRuns(): Promise<number> {
    try {
      const [row] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, 'maxConcurrentRuns'))
        .limit(1)
      return row ? Math.max(1, parseInt(row.value, 10) || DEFAULT_MAX_CONCURRENT) : DEFAULT_MAX_CONCURRENT
    } catch {
      return DEFAULT_MAX_CONCURRENT
    }
  }

  private async executeRun(
    runId: string,
    repoId: string,
    wf: WorkflowDefinition,
    workspace: string,
    trigger: string,
    event: TriggerEvent
  ): Promise<void> {
    cancelFlags.set(runId, false)
    const startedAt = new Date().toISOString()

    // Save original branch so we can restore after workflow execution
    let originalBranch: string | null = null
    try {
      originalBranch = await getCurrentBranch(workspace)
      if (originalBranch === 'HEAD') originalBranch = null // Already detached
    } catch { /* ignore */ }

    await db.update(runs).set({ status: 'running', startedAt }).where(eq(runs.id, runId))
    notifyRunStart(runId, wf.name ?? 'Workflow', repoId)

    const log = async (msg: string, type = 'info', jobName?: string, stepName?: string) => {
      await db.insert(runLogs).values({
        runId,
        jobName: jobName ?? null,
        stepName: stepName ?? null,
        message: msg,
        type,
        timestamp: new Date().toISOString()
      })
      sendRunLog(runId, jobName ?? null, stepName ?? null, msg, type)
    }

    const [owner, repo] = repoId.split('/')
    const sha = event.sha ?? ''
    const branch = event.branch ?? 'main'

    // Create GitHub Actions file-protocol temp files for this run
    // These files live on the HOST but are mounted into containers at /runner_tmp
    const runTmpDir = mkdtempSync(join(tmpdir(), 'orbitci-'))
    const hostOutputFile = join(runTmpDir, 'github_output')
    const hostEnvFile = join(runTmpDir, 'github_env')
    const hostSummaryFile = join(runTmpDir, 'github_step_summary')
    const hostPathFile = join(runTmpDir, 'github_path')
    const hostStateFile = join(runTmpDir, 'github_state')
    for (const f of [hostOutputFile, hostEnvFile, hostSummaryFile, hostPathFile, hostStateFile]) {
      writeFileSync(f, '')
    }
    try { mkdirSync(join(runTmpDir, 'tool_cache'), { recursive: true }) } catch { /* ignore */ }

    // Container-internal paths (mounted via Docker bind at /runner_tmp)
    const containerTmpDir = '/runner_tmp'
    const githubOutputFile = `${containerTmpDir}/github_output`
    const githubEnvFile = `${containerTmpDir}/github_env`
    const githubSummaryFile = `${containerTmpDir}/github_step_summary`
    const githubPathFile = `${containerTmpDir}/github_path`
    const githubStateFile = `${containerTmpDir}/github_state`

    // Base context — auto-inject GITHUB_TOKEN from auth if not in secrets
    const secrets = resolveSecrets([repoId])
    const ghToken = getStoredToken()
    if (ghToken && !secrets['GITHUB_TOKEN']) {
      secrets['GITHUB_TOKEN'] = ghToken
    }
    const runNumeric = parseInt(runId.replace(/-/g, '').slice(0, 8), 16)
    const baseEnv: Record<string, string> = {
      // GitHub Actions standard variables
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: repoId,
      GITHUB_REPOSITORY_OWNER: owner,
      GITHUB_REPOSITORY_ID: '0',
      GITHUB_SHA: sha,
      GITHUB_REF: trigger === 'release' && event.release
        ? `refs/tags/${event.release.tag_name}`
        : `refs/heads/${branch}`,
      GITHUB_REF_NAME: trigger === 'release' && event.release
        ? event.release.tag_name
        : branch,
      GITHUB_REF_TYPE: trigger === 'release' ? 'tag' : 'branch',
      GITHUB_HEAD_REF: branch,
      GITHUB_BASE_REF: branch,
      GITHUB_ACTOR: owner,
      GITHUB_TRIGGERING_ACTOR: owner,
      GITHUB_EVENT_NAME: trigger,
      GITHUB_WORKSPACE: '/workspace',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_GRAPHQL_URL: 'https://api.github.com/graphql',
      GITHUB_RUN_ID: String(runNumeric),
      GITHUB_RUN_NUMBER: '1',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: '',
      // File-protocol variables (prevents "ambiguous redirect" errors)
      GITHUB_OUTPUT: githubOutputFile,
      GITHUB_ENV: githubEnvFile,
      GITHUB_STEP_SUMMARY: githubSummaryFile,
      GITHUB_PATH: githubPathFile,
      GITHUB_STATE: githubStateFile,
      // Runner variables
      RUNNER_NAME: 'OrbitCI',
      RUNNER_OS: 'Linux',  // Default — overridden per-job in jobRunner based on runs-on target
      RUNNER_ARCH: 'X64',  // Default Docker arch

      RUNNER_TEMP: containerTmpDir,
      RUNNER_TOOL_CACHE: `${containerTmpDir}/tool_cache`,
      // OrbitCI identifiers
      ORBIT_RUN_ID: runId,
      ORBIT_TIMESTAMP: startedAt,
      // Inject secrets as env vars (GitHub Actions convention)
      ...Object.fromEntries(
        Object.entries(secrets).map(([k, v]) => [`SECRET_${k}`, v])
      ),
      // GITHUB_TOKEN gets its own env var (standard GitHub Actions behavior)
      ...(secrets['GITHUB_TOKEN'] ? { GITHUB_TOKEN: secrets['GITHUB_TOKEN'] } : {}),
      ...resolveEnvDefs(wf.env, {})
    }

    const ctx: ExpressionContext = {
      github: {
        sha,
        ref: trigger === 'release' && event.release
          ? `refs/tags/${event.release.tag_name}`
          : `refs/heads/${branch}`,
        ref_name: trigger === 'release' && event.release
          ? event.release.tag_name
          : branch,
        repository: repoId,
        actor: owner,
        event_name: trigger,
        workspace,
        ...(event.release ? {
          event: {
            release: {
              tag_name: event.release.tag_name,
              name: event.release.name,
              body: event.release.body ?? '',
              draft: String(event.release.draft),
              prerelease: String(event.release.prerelease),
              html_url: event.release.html_url ?? '',
              id: String(event.release.id ?? '')
            }
          }
        } : {})
      },
      inputs: event.inputs ?? {},
      env: { ...baseEnv },
      secrets,
      OrbitCI: { run_id: runId, timestamp: startedAt, workspace },
      steps: {},
      needs: {}
    }

    // ── Expand matrix strategies into individual jobs ────────────────────────
    const expandedJobs = expandMatrixJobs(wf.jobs)
    const jobNames = Object.keys(expandedJobs)
    const jobResults: Record<string, 'success' | 'failure' | 'cancelled' | 'skipped'> = {}
    const jobOutputs: Record<string, Record<string, string>> = {}
    let finalStatus: RunStatus = 'success'

    // Create process monitor for resource tracking
    const monitor = new ProcessMonitor()

    // Container reuse pool: jobs with the same image can share a container within this run
    const containerPool = new Map<string, string>() // image -> containerId

    try {
      // ── Parallel job execution respecting DAG dependencies ────────────────
      const completed = new Set<string>()
      const running = new Map<string, Promise<void>>()

      const launchReadyJobs = async (): Promise<void> => {
        if (cancelFlags.get(runId)) {
          finalStatus = 'cancelled'
          return
        }

        for (const jobName of jobNames) {
          if (completed.has(jobName) || running.has(jobName)) continue

          const job = expandedJobs[jobName]
          const needs = Array.isArray(job.needs)
            ? job.needs
            : job.needs
            ? [job.needs]
            : []

          const allDepsComplete = needs.every((dep) => completed.has(dep))
          if (!allDepsComplete) continue

          // Build needs context (always, even if no deps — needed for expression evaluation)
          const needsCtx: Record<string, { outputs: Record<string, string>; result: string }> = {}
          for (const dep of needs) {
            needsCtx[dep] = {
              outputs: jobOutputs[dep] ?? {},
              result: jobResults[dep] ?? 'success'
            }
          }

          const jobCtx: ExpressionContext = {
            ...ctx,
            needs: needsCtx,
            steps: {}
          }

          if ((job as ExpandedJob).matrixValues) {
            // Resolve expressions in matrix values (e.g. ${{ needs.*.outputs.* }})
            // These couldn't be resolved at expansion time because needs wasn't available yet
            const rawMatrix = (job as ExpandedJob).matrixValues!
            const resolvedMatrix: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(rawMatrix)) {
              resolvedMatrix[k] = typeof v === 'string'
                ? evaluateExpression(v, jobCtx)
                : v
            }
            jobCtx.matrix = resolvedMatrix
          }

          // ── Evaluate job-level `if:` condition (like GitHub Actions / nektos/act / Gitea) ──
          // GitHub Actions behavior:
          //   - Default `if:` is `success()` when no condition is specified
          //   - `success()` returns true only if ALL needs deps have result == 'success'
          //   - `skipped` deps cause `success()` to return false (cascade skip)
          //   - Evaluated BEFORE container creation, with access to `needs.*` but NOT `steps.*`
          const effectiveIf = job.if ?? 'success()'
          const conditionResult = evaluateCondition(effectiveIf, jobCtx)
          if (!conditionResult) {
            completed.add(jobName)
            // Match GitHub Actions: skipped when condition is false
            // Use 'skipped' so downstream jobs also cascade correctly
            const depFailed = needs.some((dep) => jobResults[dep] === 'failure')
            jobResults[jobName] = depFailed ? 'failure' : 'skipped'
            jobOutputs[jobName] = {}
            console.log(`[OrbitCI] [${runId.replace(/-/g, '').slice(0, 8)}/${jobName}] [SKIP] Skipped (condition: ${effectiveIf})`)
            await log(`[SKIP] Job '${jobName}' skipped (condition: ${effectiveIf})`, 'skip')
            // Re-check if other jobs can now launch
            await launchReadyJobs()
            return
          }

          // Launch job as a parallel promise
          const jobPromise = (async () => {
            const result = await runJob({
              runId,
              repoId,
              jobName,
              job,
              workspace,
              runTmpDir,
              baseEnv,
              baseCtx: jobCtx,
              cancelCheck: () => cancelFlags.get(runId) ?? false,
              monitor,
              containerPool
            })

            running.delete(jobName)
            completed.add(jobName)
            jobResults[jobName] = result.status
            jobOutputs[jobName] = result.outputs

            if (result.status === 'failure') {
              finalStatus = 'failure'
              // fail-fast: cancel sibling matrix jobs
              const expandedJob = job as ExpandedJob
              if (expandedJob.matrixParent) {
                const parentJob = wf.jobs[expandedJob.matrixParent]
                const failFast = parentJob?.strategy?.['fail-fast'] !== false
                if (failFast) {
                  for (const [sibName, sibJob] of Object.entries(expandedJobs)) {
                    if (!completed.has(sibName) && !running.has(sibName) && (sibJob as ExpandedJob).matrixParent === expandedJob.matrixParent) {
                      completed.add(sibName)
                      jobResults[sibName] = 'cancelled'
                      jobOutputs[sibName] = {}
                      await log(`[SKIP] Job '${sibName}' cancelled (fail-fast)`, 'skip')
                    }
                  }
                }
              }
            }
            if (result.status === 'cancelled') finalStatus = 'cancelled'

            // After a job completes, try to launch more ready jobs
            await launchReadyJobs()
          })()

          running.set(jobName, jobPromise)
        }
      }

      // Initial launch
      await launchReadyJobs()

      // Wait for all running jobs to finish
      while (running.size > 0) {
        await Promise.race([...running.values()])
        if (finalStatus !== 'success') {
          // Wait for already-running jobs to finish before breaking
          if (running.size > 0) await Promise.allSettled([...running.values()])
          break
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      finalStatus = 'failure'
      await log(`[FAIL] Fatal error: ${msg}`, 'error')
    } finally {
      monitor.dispose()
      // Clean up any reusable containers from the pool
      const { stopAndRemoveContainer } = await import('../services/dockerService')
      for (const [image, cId] of containerPool) {
        try { await stopAndRemoveContainer(cId) } catch { /* ignore */ }
      }
      containerPool.clear()
    }

    const finishedAt = new Date().toISOString()
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()

    // Calculate run-level peak metrics from step metrics
    let peakCpu: number | null = null
    let peakRam: number | null = null
    let peakGpu: number | null = null
    let peakGpuMem: number | null = null
    try {
      const { runSteps: runStepsTable } = await import('../db/schema')
      const stepRows = await db.select({
        peakCpuPercent: runStepsTable.peakCpuPercent,
        peakRamBytes: runStepsTable.peakRamBytes,
        peakGpuPercent: runStepsTable.peakGpuPercent,
        peakGpuMemBytes: runStepsTable.peakGpuMemBytes
      }).from(runStepsTable).where(eq(runStepsTable.runId, runId))

      for (const row of stepRows) {
        if (row.peakCpuPercent != null && (peakCpu === null || row.peakCpuPercent > peakCpu)) peakCpu = row.peakCpuPercent
        if (row.peakRamBytes != null && (peakRam === null || row.peakRamBytes > peakRam)) peakRam = row.peakRamBytes
        if (row.peakGpuPercent != null && (peakGpu === null || row.peakGpuPercent > peakGpu)) peakGpu = row.peakGpuPercent
        if (row.peakGpuMemBytes != null && (peakGpuMem === null || row.peakGpuMemBytes > peakGpuMem)) peakGpuMem = row.peakGpuMemBytes
      }
    } catch { /* ignore */ }

    await db.update(runs).set({
      status: finalStatus,
      finishedAt,
      durationMs,
      peakCpuPercent: peakCpu,
      peakRamBytes: peakRam,
      peakGpuPercent: peakGpu,
      peakGpuMemBytes: peakGpuMem
    }).where(eq(runs.id, runId))

    const runShort = runId.replace(/-/g, '').slice(0, 8)
    console.log(`[WorkflowRunner] [${runShort}] Workflow finished: ${finalStatus} (${durationMs}ms) | Jobs: ${Object.entries(jobResults).map(([j, r]) => `${j}=${r}`).join(', ')}`)
    sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, { runId, status: finalStatus })
    if (finalStatus !== 'cancelled') {
      notifyRunComplete(runId, wf.name ?? workflowFile(runId), finalStatus as 'success' | 'failure', repoId)
    }
    cancelFlags.delete(runId)

    // Restore original branch if workflow left repo in detached HEAD
    if (originalBranch) {
      try {
        const currentBranch = await getCurrentBranch(workspace)
        if (currentBranch === 'HEAD' || currentBranch !== originalBranch) {
          await gitCheckout(workspace, originalBranch)
          console.log(`[WorkflowRunner] Restored branch: ${originalBranch}`)
        }
      } catch (err) {
        console.warn(`[WorkflowRunner] Could not restore branch '${originalBranch}':`, err)
      }
    }

    // Clean up temp files created for this run
    try { rmSync(runTmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  /**
   * Resolve a workflow file across both directories (.github/workflows first).
   * Handles filenames with or without directory prefixes.
   */
  resolveWorkflowFile(localPath: string, file: string): string | null {
    // If file already has a directory prefix, try it directly
    const directPath = join(localPath, file)
    if (existsSync(directPath)) return directPath

    // Strip any directory prefix to get just the filename
    const filename = file.replace(/^\.github\/workflows\//, '').replace(/^\.orbit\/workflows\//, '')

    for (const dir of WORKFLOW_DIRS) {
      const full = join(localPath, dir, filename)
      if (existsSync(full)) return full
    }
    return null
  }

  parseWorkflow(filePath: string): WorkflowDefinition | null {
    try {
      const content = readFileSync(filePath, 'utf-8')
      return yaml.load(content) as WorkflowDefinition
    } catch {
      return null
    }
  }

  private matchesTrigger(
    wf: WorkflowDefinition,
    eventName: string,
    event: TriggerEvent
  ): boolean {
    const on = wf.on
    if (!on) return false

    // Schedule trigger: on.schedule is an array of { cron } objects
    if (eventName === 'schedule') {
      return Array.isArray(on['schedule']) && (on['schedule'] as unknown[]).length > 0
    }

    // Release trigger: on.release with optional types filter
    if (eventName === 'release' && on['release']) {
      const releaseTrigger = on['release'] as { types?: string[] }
      if (releaseTrigger.types) {
        return releaseTrigger.types.includes('published')
      }
      return true
    }

    // Push trigger with branch filtering
    if (eventName === 'push' && on['push']) {
      const pushTrigger = on['push'] as { branches?: string[] }
      if (pushTrigger.branches && event.branch) {
        return pushTrigger.branches.some(
          (b) => b === event.branch || b === '*' || b.endsWith('*')
        )
      }
      return true
    }

    if (on[eventName] !== undefined) return true

    return false
  }
}

function resolveEnvDefs(
  envDefs: Record<string, string> | undefined,
  existing: Record<string, string>
): Record<string, string> {
  if (!envDefs) return {}
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(envDefs)) {
    result[key] = String(val)
  }
  return result
}

function workflowFile(runId: string): string {
  return `run-${runId.slice(0, 8)}`
}

// ── Matrix strategy expansion ─────────────────────────────────────────────────

interface ExpandedJob extends JobDefinition {
  matrixValues?: Record<string, unknown>
  matrixParent?: string
}

/**
 * Expand jobs with `strategy.matrix` into multiple concrete jobs.
 *
 * Example: a job "build" with matrix { os: [ubuntu, windows], node: [18, 20] }
 * becomes: "build (ubuntu, 18)", "build (ubuntu, 20)", "build (windows, 18)", "build (windows, 20)"
 *
 * Supports:
 * - Regular matrix keys (cartesian product)
 * - `include` (additional combinations)
 * - `exclude` (removed combinations)
 */
function expandMatrixJobs(
  jobs: Record<string, JobDefinition>
): Record<string, ExpandedJob> {
  const result: Record<string, ExpandedJob> = {}

  for (const [jobName, job] of Object.entries(jobs)) {
    if (!job.strategy?.matrix) {
      result[jobName] = job
      continue
    }

    const matrix = job.strategy.matrix
    const combos = generateMatrixCombinations(matrix)

    if (combos.length === 0) {
      result[jobName] = job
      continue
    }

    for (const combo of combos) {
      // Build display label: "build (ubuntu-latest, 20)"
      const values = Object.values(combo).map(String)
      const label = `${jobName} (${values.join(', ')})`

      // Clone job definition with matrix values interpolated into runs-on
      const expandedJob: ExpandedJob = {
        ...job,
        name: label,
        matrixValues: combo,
        matrixParent: jobName,
        // Interpolate matrix values in runs-on
        'runs-on': interpolateMatrix(job['runs-on'] ?? '', combo),
      }

      // Map needs from original job names (so all matrix variants depend on same needs)
      result[label] = expandedJob
    }
  }

  return result
}

/**
 * Generate all matrix combinations from a matrix definition.
 * Handles cartesian product of regular keys, plus include/exclude.
 */
function generateMatrixCombinations(
  matrix: Record<string, unknown[]> & {
    include?: Record<string, unknown>[]
    exclude?: Record<string, unknown>[]
  }
): Record<string, unknown>[] {
  // Extract regular keys (not include/exclude)
  const regularKeys = Object.keys(matrix).filter(
    (k) => k !== 'include' && k !== 'exclude'
  )

  // Generate cartesian product (start empty if no regular keys — include-only matrix)
  let combos: Record<string, unknown>[] = regularKeys.length > 0 ? [{}] : []
  for (const key of regularKeys) {
    const values = Array.isArray(matrix[key]) ? matrix[key] : [matrix[key]]
    const newCombos: Record<string, unknown>[] = []
    for (const combo of combos) {
      for (const val of values) {
        newCombos.push({ ...combo, [key]: val })
      }
    }
    combos = newCombos
  }

  // Apply excludes
  if (matrix.exclude) {
    combos = combos.filter((combo) =>
      !matrix.exclude!.some((exc) =>
        Object.entries(exc).every(([k, v]) => String(combo[k]) === String(v))
      )
    )
  }

  // Apply includes (add additional combinations)
  if (matrix.include) {
    for (const inc of matrix.include) {
      // Check if this include matches an existing combo (merge) or is new (add)
      let merged = false
      for (const combo of combos) {
        const matches = Object.entries(inc).every(
          ([k, v]) => regularKeys.includes(k) && String(combo[k]) === String(v)
        )
        if (matches) {
          Object.assign(combo, inc)
          merged = true
        }
      }
      if (!merged) {
        combos.push({ ...inc })
      }
    }
  }

  return combos
}

/**
 * Interpolate ${{ matrix.* }} expressions in a string.
 */
function interpolateMatrix(str: string, values: Record<string, unknown>): string {
  return str.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => {
    return values[key] !== undefined ? String(values[key]) : `\${{ matrix.${key} }}`
  })
}
