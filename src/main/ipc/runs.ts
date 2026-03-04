import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import { db } from '../db'
import { runs, runLogs, runJobs, runSteps, runMetrics } from '../db/schema'
import { eq, and, desc, gte, asc, type SQL } from 'drizzle-orm'
import { WorkflowRunner } from '../runner/workflowRunner'
import { listWorkflowRuns, listRunJobs, getJobLogs } from '../services/githubService'
import type { RunFilter } from '@shared/types'

let runner: WorkflowRunner | null = null

export function setRunsRunner(r: WorkflowRunner): void {
  runner = r
}

export function registerRunHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.RUNS_LIST, async (_, filter?: RunFilter) => {
    const conditions: SQL[] = []
    if (filter?.repoId) conditions.push(eq(runs.repoId, filter.repoId))
    if (filter?.status) conditions.push(eq(runs.status, filter.status))
    if (filter?.workflowFile) conditions.push(eq(runs.workflowFile, filter.workflowFile))
    if (filter?.since) conditions.push(gte(runs.createdAt, filter.since))

    const rows = await db
      .select()
      .from(runs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(runs.createdAt))
      .limit(filter?.limit ?? 100)

    return rows.map((r) => ({
      ...r,
      inputs: r.inputs ? JSON.parse(r.inputs) : null,
      outputs: r.outputs ? JSON.parse(r.outputs) : null
    }))
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET, async (_, id: string) => {
    const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1)
    if (!row) return null
    return {
      ...row,
      inputs: row.inputs ? JSON.parse(row.inputs) : null,
      outputs: row.outputs ? JSON.parse(row.outputs) : null
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET_LOGS, async (_, runId: string) => {
    return db
      .select()
      .from(runLogs)
      .where(eq(runLogs.runId, runId))
      .orderBy(runLogs.id)
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET_JOBS, async (_, runId: string) => {
    return db.select().from(runJobs).where(eq(runJobs.runId, runId))
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET_STEPS, async (_, runId: string) => {
    return db.select().from(runSteps).where(eq(runSteps.runId, runId))
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET_METRICS, async (_, runId: string, jobName?: string, stepName?: string) => {
    const conditions: SQL[] = [eq(runMetrics.runId, runId)]
    if (jobName) conditions.push(eq(runMetrics.jobName, jobName))
    if (stepName) conditions.push(eq(runMetrics.stepName, stepName))

    const rows = await db
      .select({
        timestamp: runMetrics.timestamp,
        cpuPercent: runMetrics.cpuPercent,
        ramBytes: runMetrics.ramBytes,
        gpuPercent: runMetrics.gpuPercent,
        gpuMemBytes: runMetrics.gpuMemBytes
      })
      .from(runMetrics)
      .where(and(...conditions))
      .orderBy(asc(runMetrics.timestamp))

    return rows.map((r) => ({
      timestamp: r.timestamp,
      cpuPercent: r.cpuPercent ?? 0,
      ramBytes: r.ramBytes ?? 0,
      gpuPercent: r.gpuPercent,
      gpuMemBytes: r.gpuMemBytes
    }))
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_CANCEL, async (_, runId: string) => {
    if (!runner) throw new Error('Runner não inicializado')
    await runner.cancelRun(runId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_RUNS_LIST, async (_, repoId: string, perPage?: number, page?: number, status?: string) => {
    const [owner, repo] = repoId.split('/')
    return listWorkflowRuns(owner, repo, perPage, page, status)
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_RUN_JOBS, async (_, repoId: string, runId: number) => {
    const [owner, repo] = repoId.split('/')
    return listRunJobs(owner, repo, runId)
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_JOB_LOGS, async (_, repoId: string, jobId: number) => {
    const [owner, repo] = repoId.split('/')
    return getJobLogs(owner, repo, jobId)
  })
}
