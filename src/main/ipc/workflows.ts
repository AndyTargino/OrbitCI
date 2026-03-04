import { ipcMain } from 'electron'
import { IPC_CHANNELS, WORKFLOWS_DIR } from '@shared/constants'
import { db } from '../db'
import { repos } from '../db/schema'
import { eq } from 'drizzle-orm'
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { WorkflowRunner } from '../runner/workflowRunner'
import type { WorkflowFile, WorkflowInput } from '@shared/types'
import { registerRepoSchedules } from '../services/scheduleService'

// Regex to find all ${{ secrets.SECRET_NAME }} references in a YAML file
const SECRET_REF_REGEX = /\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

function extractSecretsFromContent(content: string, label: string, map: Map<string, string[]>): void {
  let match: RegExpExecArray | null
  SECRET_REF_REGEX.lastIndex = 0
  while ((match = SECRET_REF_REGEX.exec(content)) !== null) {
    const name = match[1]
    const files = map.get(name) ?? []
    if (!files.includes(label)) files.push(label)
    map.set(name, files)
  }
}

function scanDirForSecrets(dir: string, labelPrefix: string, map: Map<string, string[]>): void {
  if (!existsSync(dir)) return
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8')
      extractSecretsFromContent(content, `${labelPrefix}/${file}`, map)
    } catch { /* skip unreadable files */ }
  }
}

let runner: WorkflowRunner | null = null

export function setWorkflowRunner(r: WorkflowRunner): void {
  runner = r
}

export function registerWorkflowHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WORKFLOWS_LIST, async (_, repoId: string) => {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
    if (!repo?.localPath) return []

    const workflowsDir = join(repo.localPath, WORKFLOWS_DIR)
    if (!existsSync(workflowsDir)) return []

    const files = readdirSync(workflowsDir).filter(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml')
    )

    return files.map((file): WorkflowFile => {
      const content = readFileSync(join(workflowsDir, file), 'utf-8')
      let wf: Record<string, unknown> = {}
      try { wf = yaml.load(content) as Record<string, unknown> } catch { /* ignore */ }

      const on = (wf.on ?? {}) as Record<string, unknown>
      const triggers = Object.keys(on)
      const jobs = Object.keys((wf.jobs ?? {}) as Record<string, unknown>)

      // Parse workflow_dispatch inputs if present
      const dispatchDef = on['workflow_dispatch'] as Record<string, unknown> | null | undefined
      const rawInputs = dispatchDef?.inputs as Record<string, unknown> | undefined
      const inputs: WorkflowFile['inputs'] = rawInputs
        ? Object.fromEntries(
            Object.entries(rawInputs).map(([k, v]) => {
              const inp = (v ?? {}) as Record<string, unknown>
              return [k, {
                description: inp.description as string | undefined,
                required: inp.required as boolean | undefined,
                default: inp.default != null ? String(inp.default) : undefined,
                type: inp.type as WorkflowInput['type'] | undefined,
                options: inp.options as string[] | undefined
              }]
            })
          )
        : undefined

      return {
        name: (wf.name as string) ?? file,
        file,
        path: join(workflowsDir, file),
        triggers,
        jobs,
        inputs
      }
    })
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOWS_GET, async (_, repoId: string, file: string) => {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
    if (!repo?.localPath) throw new Error('Repo sem localPath')
    const filePath = join(repo.localPath, WORKFLOWS_DIR, file)
    if (!existsSync(filePath)) throw new Error(`Workflow não encontrado: ${file}`)
    return readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle(
    IPC_CHANNELS.WORKFLOWS_SAVE,
    async (_, repoId: string, file: string, content: string) => {
      const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
      if (!repo?.localPath) throw new Error('Repo sem localPath')

      const workflowsDir = join(repo.localPath, WORKFLOWS_DIR)
      if (!existsSync(workflowsDir)) mkdirSync(workflowsDir, { recursive: true })

      writeFileSync(join(workflowsDir, file), content, 'utf-8')
      // Re-register cron schedules in case this workflow added/removed a schedule trigger
      registerRepoSchedules(repoId, repo.localPath)
      return { success: true }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WORKFLOWS_RUN,
    async (_, repoId: string, file: string, inputs?: Record<string, string>) => {
      if (!runner) throw new Error('Runner não inicializado')
      const runId = await runner.queueRun(repoId, file, 'workflow_dispatch', { inputs })
      return { runId }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WORKFLOWS_CREATE,
    async (_, repoId: string, file: string, content: string) => {
      const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
      if (!repo?.localPath) throw new Error('Repo sem localPath')

      const workflowsDir = join(repo.localPath, WORKFLOWS_DIR)
      if (!existsSync(workflowsDir)) mkdirSync(workflowsDir, { recursive: true })

      const filePath = join(workflowsDir, file.endsWith('.yml') ? file : `${file}.yml`)
      writeFileSync(filePath, content, 'utf-8')
      // Register cron schedules for the new workflow
      registerRepoSchedules(repoId, repo.localPath)
      return { success: true, file: filePath }
    }
  )

  // ─── Scan workflow files for ${{ secrets.NAME }} references ───────────────
  ipcMain.handle(IPC_CHANNELS.WORKFLOWS_SCAN_SECRETS, async (_, repoId: string) => {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
    if (!repo?.localPath) return []

    const secretMap = new Map<string, string[]>()
    scanDirForSecrets(join(repo.localPath, WORKFLOWS_DIR), '.orbit/workflows', secretMap)
    scanDirForSecrets(join(repo.localPath, '.github/workflows'), '.github/workflows', secretMap)

    return Array.from(secretMap.entries())
      .map(([name, usedIn]) => ({ name, usedIn }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
}
