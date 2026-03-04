import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import { db } from '../db'
import { repos } from '../db/schema'
import { eq } from 'drizzle-orm'
import * as gitEngine from '../git/gitEngine'
import { loadToken } from '../services/credentialService'

async function getLocalPath(repoId: string): Promise<string> {
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
  if (!repo?.localPath) throw new Error(`Repo sem caminho local: ${repoId}`)
  return repo.localPath
}

export function registerGitHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_, repoId: string) => {
    const localPath = await getLocalPath(repoId)
    return gitEngine.getStatus(localPath)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DIFF, async (_, repoId: string, file?: string) => {
    const localPath = await getLocalPath(repoId)
    return gitEngine.getDiff(localPath, file)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STAGE, async (_, repoId: string, files: string[]) => {
    const localPath = await getLocalPath(repoId)
    await gitEngine.stageFiles(localPath, files)
    return gitEngine.getStatus(localPath)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STAGE_ALL, async (_, repoId: string) => {
    const localPath = await getLocalPath(repoId)
    await gitEngine.stageAll(localPath)
    return gitEngine.getStatus(localPath)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_UNSTAGE, async (_, repoId: string, files: string[]) => {
    const localPath = await getLocalPath(repoId)
    await gitEngine.unstageFiles(localPath, files)
    return gitEngine.getStatus(localPath)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD, async (_, repoId: string, files: string[]) => {
    const localPath = await getLocalPath(repoId)
    await gitEngine.discardFiles(localPath, files)
    return gitEngine.getStatus(localPath)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD_ALL, async (_, repoId: string) => {
    const localPath = await getLocalPath(repoId)
    await gitEngine.discardAll(localPath)
    return gitEngine.getStatus(localPath)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_, repoId: string, message: string) => {
    const localPath = await getLocalPath(repoId)
    const sha = await gitEngine.commit(localPath, message)
    return { sha, success: true }
  })

  ipcMain.handle(
    IPC_CHANNELS.GIT_PUSH,
    async (_, repoId: string, branch?: string, withTags?: boolean) => {
      const localPath = await getLocalPath(repoId)
      const token = loadToken()
      if (token) {
        await gitEngine.authenticatedPush(localPath, token, 'origin', branch, withTags)
      } else {
        await gitEngine.push(localPath, 'origin', branch, withTags)
      }
      return { success: true }
    }
  )

  ipcMain.handle(IPC_CHANNELS.GIT_PULL, async (_, repoId: string) => {
    const localPath = await getLocalPath(repoId)
    await gitEngine.pull(localPath)
    return gitEngine.getStatus(localPath)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_FETCH, async (_, repoId: string) => {
    const localPath = await getLocalPath(repoId)
    await gitEngine.fetch(localPath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_LOG, async (_, repoId: string, limit = 20) => {
    const localPath = await getLocalPath(repoId)
    return gitEngine.getLog(localPath, limit)
  })

  ipcMain.handle(IPC_CHANNELS.GIT_BRANCHES, async (_, repoId: string) => {
    const localPath = await getLocalPath(repoId)
    return gitEngine.getBranches(localPath)
  })

  ipcMain.handle(
    IPC_CHANNELS.GIT_CREATE_BRANCH,
    async (_, repoId: string, name: string, ref?: string) => {
      const localPath = await getLocalPath(repoId)
      await gitEngine.createBranch(localPath, name, ref)
      return { success: true }
    }
  )

  ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT, async (_, repoId: string, ref: string) => {
    const localPath = await getLocalPath(repoId)
    await gitEngine.checkout(localPath, ref)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_TAGS, async (_, repoId: string) => {
    const localPath = await getLocalPath(repoId)
    return gitEngine.getTags(localPath)
  })

  ipcMain.handle(
    IPC_CHANNELS.GIT_CREATE_TAG,
    async (_, repoId: string, name: string, message?: string) => {
      const localPath = await getLocalPath(repoId)
      await gitEngine.createTag(localPath, name, message)
      return { success: true }
    }
  )
}
