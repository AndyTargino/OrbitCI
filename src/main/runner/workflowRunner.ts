import { v4 as uuidv4 } from 'uuid'
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import yaml from 'js-yaml'
import { db } from '../db'
import { runs, runLogs, repos, settings } from '../db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { runJob } from './jobRunner'
import { evaluateExpression, type ExpressionContext } from './expressionEngine'
import { resolveSecrets } from '../services/secretService'
import { ProcessMonitor } from '../services/processMonitor'
import { sendRunLog, sendToRenderer, notifyRunComplete, notifyRunStart } from '../services/notifyService'
import { getCurrentSha, getCurrentBranch, checkout as gitCheckout } from '../git/gitEngine'
import { getStoredToken } from '../services/githubService'
import { IPC_CHANNELS, WORKFLOWS_DIR, DEFAULT_MAX_CONCURRENT } from '@shared/constants'
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

    const workflowsDir = join(repoRow.localPath, WORKFLOWS_DIR)
    if (!existsSync(workflowsDir)) {
      console.log(`[WorkflowRunner] triggerEvent: workflows dir not found: ${workflowsDir}`)
      return
    }

    const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    console.log(`[WorkflowRunner] triggerEvent: found ${files.length} workflow files: ${files.join(', ')}`)

    let matched = 0
    for (const file of files) {
      const wf = this.parseWorkflow(join(workflowsDir, file))
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
    console.log(`[WorkflowRunner] triggerEvent: ${matched}/${files.length} workflows matched event '${eventName}'`)
  }

  async queueRun(
    repoId: string,
    workflowFile: string,
    trigger: string,
    event: TriggerEvent
  ): Promise<string> {
    const [repoRow] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
    if (!repoRow?.localPath) throw new Error('Repo not found or no local path')

    const workflowPath = join(repoRow.localPath, WORKFLOWS_DIR, workflowFile)
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
    const runTmpDir = mkdtempSync(join(tmpdir(), 'orbitci-'))
    const githubOutputFile = join(runTmpDir, 'github_output')
    const githubEnvFile = join(runTmpDir, 'github_env')
    const githubSummaryFile = join(runTmpDir, 'github_step_summary')
    const githubPathFile = join(runTmpDir, 'github_path')
    const githubStateFile = join(runTmpDir, 'github_state')
    for (const f of [githubOutputFile, githubEnvFile, githubSummaryFile, githubPathFile, githubStateFile]) {
      writeFileSync(f, '')
    }
    try { mkdirSync(join(runTmpDir, 'tool_cache'), { recursive: true }) } catch { /* ignore */ }

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
      GITHUB_WORKSPACE: workspace,
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
      RUNNER_OS: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
      RUNNER_ARCH: process.arch === 'x64' ? 'X64' : process.arch === 'arm64' ? 'ARM64' : process.arch,
      RUNNER_TEMP: runTmpDir,
      RUNNER_TOOL_CACHE: join(runTmpDir, 'tool_cache'),
      // OrbitCI identifiers
      ORBIT_RUN_ID: runId,
      ORBIT_TIMESTAMP: startedAt,
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

    const jobNames = Object.keys(wf.jobs)
    const jobResults: Record<string, 'success' | 'failure' | 'cancelled' | 'skipped'> = {}
    const jobOutputs: Record<string, Record<string, string>> = {}
    let finalStatus: RunStatus = 'success'

    // Create process monitor for resource tracking
    const monitor = new ProcessMonitor()

    try {
      // Process jobs respecting `needs:` dependencies
      const completed = new Set<string>()
      const maxIterations = jobNames.length * 2

      for (let iter = 0; iter < maxIterations && completed.size < jobNames.length; iter++) {
        for (const jobName of jobNames) {
          if (completed.has(jobName)) continue
          if (cancelFlags.get(runId)) { finalStatus = 'cancelled'; break }

          const job = wf.jobs[jobName]
          const needs = Array.isArray(job.needs)
            ? job.needs
            : job.needs
            ? [job.needs]
            : []

          const allDepsComplete = needs.every((dep) => completed.has(dep))
          const anyDepFailed = needs.some((dep) => jobResults[dep] === 'failure')

          if (!allDepsComplete) continue
          if (anyDepFailed) {
            completed.add(jobName)
            jobResults[jobName] = 'failure'
            jobOutputs[jobName] = {}
            await log(`⏭ Job '${jobName}' ignorado (dependência falhou)`, 'skip')
            continue
          }

          // Skip jobs whose runs-on doesn't match the current platform
          if (job['runs-on'] && !platformMatches(job['runs-on'])) {
            completed.add(jobName)
            jobResults[jobName] = 'skipped'
            jobOutputs[jobName] = {}
            await log(`⏭ Job '${jobName}' ignorado (runs-on: ${job['runs-on']} ≠ ${currentPlatformLabel()})`, 'skip')
            continue
          }

          // Build needs context so dependent jobs can access ${{ needs.<job>.outputs.<key> }}
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
            steps: {} // Reset steps per job
          }

          const result = await runJob({
            runId,
            repoId,
            jobName,
            job,
            workspace,
            baseEnv,
            baseCtx: jobCtx,
            cancelCheck: () => cancelFlags.get(runId) ?? false,
            monitor
          })

          completed.add(jobName)
          jobResults[jobName] = result.status
          jobOutputs[jobName] = result.outputs
          if (result.status === 'failure') finalStatus = 'failure'
          if (result.status === 'cancelled') finalStatus = 'cancelled'
        }

        if (finalStatus !== 'success') break
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      finalStatus = 'failure'
      await log(`❌ Erro fatal: ${msg}`, 'error')
    } finally {
      monitor.dispose()
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

/** Check if a `runs-on` value matches the current OS */
function platformMatches(runsOn: string): boolean {
  const label = runsOn.toLowerCase()
  const plat = process.platform
  if (plat === 'win32') return label.includes('windows')
  if (plat === 'darwin') return label.includes('macos') || label.includes('mac')
  // linux
  return label.includes('ubuntu') || label.includes('linux')
}

function currentPlatformLabel(): string {
  if (process.platform === 'win32') return 'Windows'
  if (process.platform === 'darwin') return 'macOS'
  return 'Linux'
}
