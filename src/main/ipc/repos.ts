import { ipcMain, dialog, shell } from 'electron'
import { IPC_CHANNELS, WORKFLOWS_DIR } from '@shared/constants'
import { db } from '../db'
import { repos } from '../db/schema'
import { eq } from 'drizzle-orm'
import { listUserRepos } from '../services/githubService'
import { cloneRepo } from '../git/gitEngine'
import { loadToken } from '../services/credentialService'
import { scheduleSync, unscheduleSync } from '../services/syncService'
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Repo } from '@shared/types'

const GITHUB_WORKFLOWS_DIR = '.github/workflows'

function rowToRepo(row: typeof repos.$inferSelect): Repo {
  return {
    ...row,
    watchBranches: JSON.parse(row.watchBranches ?? '["main"]'),
    autoRun: Boolean(row.autoRun),
    notifications: Boolean(row.notifications),
    defaultBranch: row.defaultBranch ?? 'main',
    pollInterval: row.pollInterval ?? 60,
    createdAt: row.createdAt ?? new Date().toISOString()
  }
}

export function registerRepoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.REPOS_LIST, async () => {
    const rows = await db.select().from(repos)
    return rows.map(rowToRepo)
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_LIST_GITHUB, async () => {
    return listUserRepos()
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_ADD, async (_, repoData: Partial<Repo>) => {
    const existing = await db
      .select()
      .from(repos)
      .where(eq(repos.id, repoData.id!))
      .limit(1)

    if (existing.length > 0) {
      throw new Error(`Repositório já adicionado: ${repoData.id}`)
    }

    await db.insert(repos).values({
      id: repoData.id!,
      name: repoData.name!,
      owner: repoData.owner!,
      fullName: repoData.fullName!,
      localPath: repoData.localPath ?? null,
      remoteUrl: repoData.remoteUrl ?? null,
      defaultBranch: repoData.defaultBranch ?? 'main',
      watchBranches: JSON.stringify(repoData.watchBranches ?? ['main']),
      pollInterval: repoData.pollInterval ?? 60,
      autoRun: repoData.autoRun ? 1 : 0,
      notifications: repoData.notifications ? 1 : 0
    })

    if (repoData.localPath) {
      const workflowsPath = join(repoData.localPath, WORKFLOWS_DIR)
      if (!existsSync(workflowsPath)) {
        mkdirSync(workflowsPath, { recursive: true })
      }
      scheduleSync(repoData.id!, repoData.pollInterval ?? 60)
    }

    const [created] = await db.select().from(repos).where(eq(repos.id, repoData.id!))
    return rowToRepo(created)
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_UPDATE, async (_, id: string, updates: Partial<Repo>) => {
    const updateData: Partial<typeof repos.$inferInsert> = {}
    if (updates.localPath !== undefined) updateData.localPath = updates.localPath
    if (updates.pollInterval !== undefined) updateData.pollInterval = updates.pollInterval
    if (updates.autoRun !== undefined) updateData.autoRun = updates.autoRun ? 1 : 0
    if (updates.notifications !== undefined) updateData.notifications = updates.notifications ? 1 : 0
    if (updates.watchBranches !== undefined) updateData.watchBranches = JSON.stringify(updates.watchBranches)
    if (updates.gitUserName !== undefined) updateData.gitUserName = updates.gitUserName
    if (updates.gitUserEmail !== undefined) updateData.gitUserEmail = updates.gitUserEmail

    await db.update(repos).set(updateData).where(eq(repos.id, id))

    if (updates.pollInterval) {
      const [row] = await db.select().from(repos).where(eq(repos.id, id))
      if (row?.localPath) scheduleSync(id, updates.pollInterval)
    }

    const [updated] = await db.select().from(repos).where(eq(repos.id, id))
    return rowToRepo(updated)
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_REMOVE, async (_, id: string) => {
    unscheduleSync(id)
    await db.delete(repos).where(eq(repos.id, id))
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_CLONE, async (_, repoId: string, remoteUrl: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Selecionar pasta para clonar o repositório'
    })

    if (result.canceled || !result.filePaths[0]) {
      return { cancelled: true }
    }

    const basePath = result.filePaths[0]
    const repoName = repoId.split('/')[1]
    const localPath = join(basePath, repoName)
    const token = loadToken()

    if (!token) throw new Error('Não autenticado')

    await cloneRepo(remoteUrl, localPath, token)

    const workflowsPath = join(localPath, WORKFLOWS_DIR)
    if (!existsSync(workflowsPath)) {
      mkdirSync(workflowsPath, { recursive: true })
    }

    return { localPath }
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_LINK, async (_, id: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Selecionar pasta do repositório local'
    })

    if (result.canceled || !result.filePaths[0]) {
      return { cancelled: true }
    }

    const localPath = result.filePaths[0]
    await db.update(repos).set({ localPath }).where(eq(repos.id, id))

    const workflowsPath = join(localPath, WORKFLOWS_DIR)
    if (!existsSync(workflowsPath)) {
      mkdirSync(workflowsPath, { recursive: true })
    }

    const [row] = await db.select().from(repos).where(eq(repos.id, id))
    if (row) scheduleSync(id, row.pollInterval ?? 60)

    return { localPath }
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Selecionar pasta'
    })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_SYNC, async (_, id: string) => {
    const { forceSyncRepo } = await import('../services/syncService')
    await forceSyncRepo(id)
    return { success: true }
  })

  // ─── Open local folder in file explorer ────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.REPOS_OPEN_FOLDER, async (_, localPath: string) => {
    if (!localPath || !existsSync(localPath)) {
      throw new Error('Pasta não encontrada: ' + localPath)
    }
    shell.openPath(localPath)
    return { success: true }
  })

  // ─── Delete the .orbit directory from the repo ────────────────────────────
  ipcMain.handle(IPC_CHANNELS.REPOS_DELETE_ORBIT_DIR, async (_, localPath: string) => {
    const orbitPath = join(localPath, '.orbit')
    if (!existsSync(orbitPath)) return { success: true, deleted: false }
    rmSync(orbitPath, { recursive: true, force: true })
    return { success: true, deleted: true }
  })

  // ─── Check if .github/workflows/ exists and list its files ────────────────
  ipcMain.handle(IPC_CHANNELS.REPOS_CHECK_GITHUB_WORKFLOWS, async (_, localPath: string) => {
    const githubDir = join(localPath, GITHUB_WORKFLOWS_DIR)
    if (!existsSync(githubDir)) return { found: false, files: [] }
    const files = readdirSync(githubDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    return { found: files.length > 0, files }
  })

  // ─── List .github/workflows/ files with content ───────────────────────────
  ipcMain.handle(IPC_CHANNELS.REPOS_LIST_GITHUB_WORKFLOWS, async (_, localPath: string) => {
    const githubDir = join(localPath, GITHUB_WORKFLOWS_DIR)
    if (!existsSync(githubDir)) return []
    return readdirSync(githubDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => ({ file: f, path: join(githubDir, f) }))
  })

  // ─── Import workflow files from .github/workflows/ to .orbit/workflows/ ───
  ipcMain.handle(
    IPC_CHANNELS.REPOS_IMPORT_GITHUB_WORKFLOWS,
    async (_, localPath: string) => {
      const githubDir = join(localPath, GITHUB_WORKFLOWS_DIR)
      const orbitDir = join(localPath, WORKFLOWS_DIR)

      if (!existsSync(githubDir)) throw new Error('.github/workflows não encontrado')
      if (!existsSync(orbitDir)) mkdirSync(orbitDir, { recursive: true })

      const files = readdirSync(githubDir)
        .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))

      for (const file of files) {
        copyFileSync(join(githubDir, file), join(orbitDir, file))
      }

      return { success: true, count: files.length, files }
    }
  )

  // ─── Search common directories for a folder matching the repo name ─────────
  ipcMain.handle(IPC_CHANNELS.REPOS_FIND_LOCAL, async (_, repoName: string) => {
    const home = homedir()
    const candidates = [
      join(home, 'Desktop', repoName),
      join(home, 'Documents', repoName),
      join(home, 'Projects', repoName),
      join(home, 'dev', repoName),
      join(home, 'code', repoName),
      join(home, 'Code', repoName),
      join(home, 'repos', repoName),
      join(home, 'source', repoName),
      join(home, 'Documents', 'GitHub', repoName),
      join(home, 'source', 'repos', repoName),
      join(home, 'OneDrive', 'Desktop', repoName),
      join(home, 'OneDrive', 'Documents', repoName)
    ]
    return candidates.filter(existsSync)
  })

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, async (_, url: string) => {
    await shell.openExternal(url)
  })
}
