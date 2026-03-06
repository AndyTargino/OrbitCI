import { ipcMain, dialog, shell } from 'electron'
import { IPC_CHANNELS, WORKFLOWS_DIR, GITHUB_WORKFLOWS_DIR } from '@shared/constants'
import { db } from '../db'
import { repos } from '../db/schema'
import { eq } from 'drizzle-orm'
import { listUserRepos } from '../services/githubService'
import { cloneRepo } from '../git/gitEngine'
import { loadToken } from '../services/credentialService'
import { scheduleSync, unscheduleSync } from '../services/syncService'
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Repo } from '@shared/types'

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
    try {
      const rows = await db.select().from(repos)
      return rows.map(rowToRepo)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao listar repositórios: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_LIST_GITHUB, async () => {
    try {
      return await listUserRepos()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('401') || msg.includes('Bad credentials')) {
        throw new Error('Erro ao buscar repositórios do GitHub: token inválido ou expirado. Faça login novamente.')
      }
      if (msg.includes('network') || msg.includes('ENOTFOUND') || msg.includes('fetch')) {
        throw new Error('Erro ao buscar repositórios do GitHub: sem conexão com a internet.')
      }
      if (msg.includes('rate limit') || msg.includes('403')) {
        throw new Error('Erro ao buscar repositórios do GitHub: limite de requisições atingido. Aguarde alguns minutos.')
      }
      throw new Error(`Erro ao buscar repositórios do GitHub: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_ADD, async (_, repoData: Partial<Repo>) => {
    try {
      const existing = await db
        .select()
        .from(repos)
        .where(eq(repos.id, repoData.id!))
        .limit(1)

      if (existing.length > 0) {
        throw new Error(`Repositório já adicionado: ${repoData.fullName ?? repoData.id}`)
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
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Repositório já adicionado')) throw err
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao adicionar repositório: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_UPDATE, async (_, id: string, updates: Partial<Repo>) => {
    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao atualizar repositório: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.REPOS_REMOVE, async (_, id: string) => {
    try {
      unscheduleSync(id)
      await db.delete(repos).where(eq(repos.id, id))
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao remover repositório: ${msg}`)
    }
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

    if (!token) throw new Error('Não autenticado. Faça login antes de clonar.')

    try {
      await cloneRepo(remoteUrl, localPath, token)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('already exists')) {
        throw new Error(`A pasta "${localPath}" já existe. Escolha outro local ou delete a pasta existente.`)
      }
      if (msg.includes('authentication') || msg.includes('401') || msg.includes('403')) {
        throw new Error('Falha na autenticação ao clonar. Verifique se seu token tem permissão de acesso ao repositório.')
      }
      if (msg.includes('not found') || msg.includes('404')) {
        throw new Error('Repositório não encontrado. Verifique se a URL está correta e se você tem acesso.')
      }
      if (msg.includes('ENOSPC') || msg.includes('No space')) {
        throw new Error('Sem espaço em disco para clonar o repositório.')
      }
      if (msg.includes('EACCES') || msg.includes('permission denied')) {
        throw new Error(`Sem permissão para escrever na pasta "${basePath}". Escolha outro local.`)
      }
      throw new Error(`Erro ao clonar repositório: ${msg}`)
    }

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

    try {
      const localPath = result.filePaths[0]
      await db.update(repos).set({ localPath }).where(eq(repos.id, id))

      const workflowsPath = join(localPath, WORKFLOWS_DIR)
      if (!existsSync(workflowsPath)) {
        mkdirSync(workflowsPath, { recursive: true })
      }

      const [row] = await db.select().from(repos).where(eq(repos.id, id))
      if (row) scheduleSync(id, row.pollInterval ?? 60)

      return { localPath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao vincular pasta: ${msg}`)
    }
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
    try {
      const { forceSyncRepo } = await import('../services/syncService')
      await forceSyncRepo(id)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('authentication') || msg.includes('401')) {
        throw new Error('Erro ao sincronizar: autenticação falhou. Verifique seu token.')
      }
      if (msg.includes('network') || msg.includes('ENOTFOUND')) {
        throw new Error('Erro ao sincronizar: sem conexão com o servidor remoto.')
      }
      throw new Error(`Erro ao sincronizar repositório: ${msg}`)
    }
  })

  // ─── Open local folder in file explorer ────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.REPOS_OPEN_FOLDER, async (_, localPath: string) => {
    if (!localPath || !existsSync(localPath)) {
      throw new Error(`Pasta não encontrada: "${localPath}". Verifique se ela ainda existe.`)
    }
    shell.openPath(localPath)
    return { success: true }
  })

  // ─── Delete the .orbit directory from the repo ────────────────────────────
  ipcMain.handle(IPC_CHANNELS.REPOS_DELETE_ORBIT_DIR, async (_, localPath: string) => {
    try {
      const orbitPath = join(localPath, '.orbit')
      if (!existsSync(orbitPath)) return { success: true, deleted: false }
      rmSync(orbitPath, { recursive: true, force: true })
      return { success: true, deleted: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('EACCES') || msg.includes('EPERM') || msg.includes('permission')) {
        throw new Error('Sem permissão para deletar a pasta .orbit. Feche programas que podem estar usando os arquivos.')
      }
      if (msg.includes('EBUSY') || msg.includes('resource busy')) {
        throw new Error('A pasta .orbit está em uso por outro processo. Feche-o e tente novamente.')
      }
      throw new Error(`Erro ao deletar pasta .orbit: ${msg}`)
    }
  })

  // ─── Check if .github/workflows/ exists and list its files ────────────────
  ipcMain.handle(IPC_CHANNELS.REPOS_CHECK_GITHUB_WORKFLOWS, async (_, localPath: string) => {
    try {
      const githubDir = join(localPath, GITHUB_WORKFLOWS_DIR)
      if (!existsSync(githubDir)) return { found: false, files: [] }
      const files = readdirSync(githubDir)
        .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      return { found: files.length > 0, files }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao verificar workflows do GitHub: ${msg}`)
    }
  })

  // ─── List .github/workflows/ files with content ───────────────────────────
  ipcMain.handle(IPC_CHANNELS.REPOS_LIST_GITHUB_WORKFLOWS, async (_, localPath: string) => {
    try {
      const githubDir = join(localPath, GITHUB_WORKFLOWS_DIR)
      if (!existsSync(githubDir)) return []
      return readdirSync(githubDir)
        .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
        .map((f) => ({
          file: f,
          path: join(githubDir, f),
          content: readFileSync(join(githubDir, f), 'utf-8')
        }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao listar workflows do GitHub: ${msg}`)
    }
  })

  // ─── Import workflow files from .github/workflows/ to .orbit/workflows/ ───
  ipcMain.handle(
    IPC_CHANNELS.REPOS_IMPORT_GITHUB_WORKFLOWS,
    async (_, localPath: string) => {
      try {
        const githubDir = join(localPath, GITHUB_WORKFLOWS_DIR)
        const orbitDir = join(localPath, WORKFLOWS_DIR)

        if (!existsSync(githubDir)) throw new Error('Pasta .github/workflows/ não encontrada neste repositório.')
        if (!existsSync(orbitDir)) mkdirSync(orbitDir, { recursive: true })

        const files = readdirSync(githubDir)
          .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))

        if (files.length === 0) throw new Error('Nenhum arquivo de workflow encontrado em .github/workflows/.')

        for (const file of files) {
          copyFileSync(join(githubDir, file), join(orbitDir, file))
        }

        return { success: true, count: files.length, files }
      } catch (err) {
        if (err instanceof Error && (err.message.includes('não encontrad') || err.message.includes('Nenhum arquivo'))) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`Erro ao importar workflows: ${msg}`)
      }
    }
  )

  // ─── Read a single .github/workflows/ file content ─────────────────────────
  ipcMain.handle(IPC_CHANNELS.REPOS_GET_GITHUB_WORKFLOW_CONTENT, async (_, localPath: string, file: string) => {
    try {
      const filePath = join(localPath, GITHUB_WORKFLOWS_DIR, file)
      if (!existsSync(filePath)) throw new Error(`Arquivo "${file}" não encontrado em .github/workflows/.`)
      return readFileSync(filePath, 'utf-8')
    } catch (err) {
      if (err instanceof Error && err.message.includes('não encontrad')) throw err
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao ler workflow do GitHub: ${msg}`)
    }
  })

  // ─── Import selected workflow files from .github/workflows/ to .orbit/workflows/ ─
  ipcMain.handle(
    IPC_CHANNELS.REPOS_IMPORT_GITHUB_WORKFLOWS_SELECTIVE,
    async (_, localPath: string, selectedFiles: string[]) => {
      try {
        const githubDir = join(localPath, GITHUB_WORKFLOWS_DIR)
        const orbitDir = join(localPath, WORKFLOWS_DIR)

        if (!existsSync(githubDir)) throw new Error('Pasta .github/workflows/ não encontrada neste repositório.')
        if (!existsSync(orbitDir)) mkdirSync(orbitDir, { recursive: true })

        let count = 0
        for (const file of selectedFiles) {
          const src = join(githubDir, file)
          if (existsSync(src)) {
            copyFileSync(src, join(orbitDir, file))
            count++
          }
        }

        return { success: true, count, files: selectedFiles }
      } catch (err) {
        if (err instanceof Error && (err.message.includes('não encontrad') || err.message.includes('Nenhum arquivo'))) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`Erro ao importar workflows: ${msg}`)
      }
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
