import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import { db } from '../db'
import { runs, runLogs, runJobs, runSteps, runMetrics } from '../db/schema'
import { eq, and, desc, gte, asc, type SQL } from 'drizzle-orm'
import { WorkflowRunner } from '../runner/workflowRunner'
import { listWorkflowRuns, listRunJobs, getJobLogs } from '../services/githubService'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { repos } from '../db/schema'
import { WORKFLOWS_DIR } from '@shared/constants'
import type { RunFilter, WorkflowDefinition, JobGraphNode } from '@shared/types'

let runner: WorkflowRunner | null = null

export function setRunsRunner(r: WorkflowRunner): void {
  runner = r
}

export function registerRunHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.RUNS_LIST, async (_, filter?: RunFilter) => {
    try {
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
        .offset(filter?.offset ?? 0)

      return rows.map((r) => ({
        ...r,
        inputs: r.inputs ? JSON.parse(r.inputs) : null,
        outputs: r.outputs ? JSON.parse(r.outputs) : null
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao listar execuções: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET, async (_, id: string) => {
    try {
      const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1)
      if (!row) return null
      return {
        ...row,
        inputs: row.inputs ? JSON.parse(row.inputs) : null,
        outputs: row.outputs ? JSON.parse(row.outputs) : null
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao buscar execução: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET_LOGS, async (_, runId: string) => {
    try {
      return db
        .select()
        .from(runLogs)
        .where(eq(runLogs.runId, runId))
        .orderBy(runLogs.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao buscar logs da execução: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET_JOBS, async (_, runId: string) => {
    try {
      return db.select().from(runJobs).where(eq(runJobs.runId, runId))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao buscar jobs da execução: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET_STEPS, async (_, runId: string) => {
    try {
      return db.select().from(runSteps).where(eq(runSteps.runId, runId))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao buscar steps da execução: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET_METRICS, async (_, runId: string, jobName?: string, stepName?: string) => {
    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao buscar métricas da execução: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_CANCEL, async (_, runId: string) => {
    try {
      if (!runner) throw new Error('Runner não inicializado. Reinicie o aplicativo.')
      await runner.cancelRun(runId)
      return { success: true }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Runner não inicializado')) throw err
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not found') || msg.includes('not running')) {
        throw new Error('Execução não encontrada ou já finalizada.')
      }
      throw new Error(`Erro ao cancelar execução: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUNS_GET_JOB_GRAPH, async (_, runId: string): Promise<JobGraphNode[]> => {
    try {
      // Get the run to find its workflow file and repo
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1)
      if (!run) return []

      const [repo] = await db.select().from(repos).where(eq(repos.id, run.repoId)).limit(1)
      if (!repo?.localPath) return []

      const wfPath = join(repo.localPath, WORKFLOWS_DIR, run.workflowFile)
      if (!existsSync(wfPath)) return []

      const wf = yaml.load(readFileSync(wfPath, 'utf-8')) as WorkflowDefinition
      if (!wf?.jobs) return []

      return Object.entries(wf.jobs).map(([name, job]) => ({
        name,
        needs: Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : []
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_RUNS_LIST, async (_, repoId: string, perPage?: number, page?: number, status?: string) => {
    try {
      const [owner, repo] = repoId.split('/')
      return await listWorkflowRuns(owner, repo, perPage, page, status)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('401') || msg.includes('Bad credentials')) {
        throw new Error('Erro ao buscar runs do GitHub: token inválido ou expirado.')
      }
      if (msg.includes('404') || msg.includes('Not Found')) {
        throw new Error('Repositório não encontrado no GitHub ou sem permissão de acesso.')
      }
      if (msg.includes('rate limit') || msg.includes('403')) {
        throw new Error('Limite de requisições do GitHub atingido. Aguarde alguns minutos.')
      }
      if (msg.includes('network') || msg.includes('ENOTFOUND')) {
        throw new Error('Sem conexão com o GitHub. Verifique sua internet.')
      }
      throw new Error(`Erro ao buscar runs do GitHub: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_RUN_JOBS, async (_, repoId: string, runId: number) => {
    try {
      const [owner, repo] = repoId.split('/')
      return await listRunJobs(owner, repo, runId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('404')) throw new Error('Run não encontrada no GitHub.')
      if (msg.includes('401')) throw new Error('Token inválido ou expirado.')
      throw new Error(`Erro ao buscar jobs da run: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_JOB_LOGS, async (_, repoId: string, jobId: number) => {
    try {
      const [owner, repo] = repoId.split('/')
      return await getJobLogs(owner, repo, jobId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('404')) throw new Error('Logs do job não encontrados. Eles podem ter expirado.')
      if (msg.includes('401')) throw new Error('Token inválido ou expirado.')
      if (msg.includes('410') || msg.includes('Gone')) throw new Error('Logs do job expiraram e não estão mais disponíveis.')
      throw new Error(`Erro ao buscar logs do job: ${msg}`)
    }
  })
}
