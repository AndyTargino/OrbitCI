import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import { db } from '../db'
import { repos } from '../db/schema'
import { eq } from 'drizzle-orm'
import * as gitEngine from '../git/gitEngine'
import { loadToken } from '../services/credentialService'

async function getLocalPath(repoId: string): Promise<string> {
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
  if (!repo?.localPath) throw new Error(`Repositório não encontrado ou sem pasta local vinculada.`)
  return repo.localPath
}

/** Parse git error messages into user-friendly Portuguese messages */
function friendlyGitError(err: unknown, operation: string): Error {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  // Authentication / permission errors
  if (lower.includes('authentication') || lower.includes('401') || lower.includes('403') || lower.includes('permission denied')) {
    return new Error(`${operation}: autenticação falhou. Verifique se seu token tem as permissões corretas.`)
  }
  if (lower.includes('could not resolve host') || lower.includes('unable to access') || lower.includes('network')) {
    return new Error(`${operation}: sem conexão com o servidor remoto. Verifique sua internet.`)
  }
  if (lower.includes('repository not found') || lower.includes('404')) {
    return new Error(`${operation}: repositório remoto não encontrado. Verifique se a URL está correta e se você tem acesso.`)
  }

  // Lock errors
  if (lower.includes('.lock') || lower.includes('index.lock') || lower.includes('unable to create')) {
    return new Error(`${operation}: o repositório está travado (arquivo .lock existente). Outro processo Git pode estar rodando. Se não, delete o arquivo .lock manualmente.`)
  }

  // Not a git repo
  if (lower.includes('not a git repository')) {
    return new Error(`${operation}: a pasta não é um repositório Git válido.`)
  }

  // Merge conflicts
  if (lower.includes('merge conflict') || lower.includes('conflict') && lower.includes('fix conflicts')) {
    return new Error(`${operation}: existem conflitos de merge que precisam ser resolvidos manualmente.`)
  }

  // Uncommitted changes
  if (lower.includes('local changes would be overwritten') || lower.includes('uncommitted changes') || lower.includes('your local changes')) {
    return new Error(`${operation}: você tem alterações locais não commitadas. Faça commit ou stash antes de continuar.`)
  }

  // Nothing to commit
  if (lower.includes('nothing to commit') || lower.includes('no changes added')) {
    return new Error(`${operation}: não há alterações para commitar.`)
  }

  // Detached HEAD
  if (lower.includes('detached head')) {
    return new Error(`${operation}: HEAD está desconectado. Crie ou mude para uma branch antes de continuar.`)
  }

  // Branch already exists
  if (lower.includes('already exists')) {
    return new Error(`${operation}: já existe uma branch ou tag com esse nome.`)
  }

  // Cannot delete current branch
  if (lower.includes('cannot delete') && lower.includes('checked out')) {
    return new Error(`${operation}: não é possível deletar a branch atual. Mude para outra branch primeiro.`)
  }

  // Not fully merged
  if (lower.includes('not fully merged')) {
    return new Error(`${operation}: a branch não foi totalmente mergeada. Use force delete se tiver certeza.`)
  }

  // Push rejected (non-fast-forward)
  if (lower.includes('non-fast-forward') || lower.includes('rejected') || lower.includes('fetch first')) {
    return new Error(`${operation}: push rejeitado. O remoto tem commits que você não tem localmente. Faça pull primeiro.`)
  }

  // Empty commit message
  if (lower.includes('empty') && lower.includes('message')) {
    return new Error(`${operation}: a mensagem de commit não pode ser vazia.`)
  }

  // No upstream / no tracking
  if (lower.includes('no upstream') || lower.includes('no tracking') || lower.includes('does not track')) {
    return new Error(`${operation}: esta branch não tem upstream configurado. Use push com --set-upstream.`)
  }

  // Stash errors
  if (lower.includes('no stash entries') || lower.includes('no stash found')) {
    return new Error(`${operation}: não há stashes salvos.`)
  }
  if (lower.includes('could not apply') && lower.includes('stash')) {
    return new Error(`${operation}: não foi possível aplicar o stash. Pode haver conflitos com suas alterações atuais.`)
  }

  // Pathspec / file not found
  if (lower.includes('pathspec') || lower.includes('did not match any')) {
    return new Error(`${operation}: arquivo ou referência não encontrado.`)
  }

  // Tag errors
  if (lower.includes('tag') && lower.includes('already exists')) {
    return new Error(`${operation}: já existe uma tag com esse nome.`)
  }

  // Bad revision
  if (lower.includes('bad revision') || lower.includes('unknown revision')) {
    return new Error(`${operation}: referência (branch, tag ou commit) não encontrada.`)
  }

  // Revert errors
  if (lower.includes('is a merge commit') || lower.includes('mainline')) {
    return new Error(`${operation}: não é possível reverter um merge commit diretamente. Use a opção -m para especificar o parent.`)
  }

  // Generic fallback
  return new Error(`${operation} falhou: ${msg}`)
}

export function registerGitHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      return gitEngine.getStatus(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Status')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DIFF, async (_, repoId: string, file?: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      return gitEngine.getDiff(localPath, file)
    } catch (err) {
      throw friendlyGitError(err, 'Diff')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STAGE, async (_, repoId: string, files: string[]) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.stageFiles(localPath, files)
      return gitEngine.getStatus(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Stage')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STAGE_ALL, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.stageAll(localPath)
      return gitEngine.getStatus(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Stage All')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_UNSTAGE, async (_, repoId: string, files: string[]) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.unstageFiles(localPath, files)
      return gitEngine.getStatus(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Unstage')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD, async (_, repoId: string, files: string[]) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.discardFiles(localPath, files)
      return gitEngine.getStatus(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Descartar alterações')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD_ALL, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.discardAll(localPath)
      return gitEngine.getStatus(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Descartar todas as alterações')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_, repoId: string, message: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      const sha = await gitEngine.commit(localPath, message)
      return { sha, success: true }
    } catch (err) {
      throw friendlyGitError(err, 'Commit')
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.GIT_PUSH,
    async (_, repoId: string, branch?: string, withTags?: boolean) => {
      try {
        const localPath = await getLocalPath(repoId)
        const token = loadToken()
        if (token) {
          await gitEngine.authenticatedPush(localPath, token, 'origin', branch, withTags)
        } else {
          await gitEngine.push(localPath, 'origin', branch, withTags)
        }
        return { success: true }
      } catch (err) {
        throw friendlyGitError(err, 'Push')
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.GIT_PULL, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.pull(localPath)
      return gitEngine.getStatus(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Pull')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_FETCH, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.fetch(localPath)
      return { success: true }
    } catch (err) {
      throw friendlyGitError(err, 'Fetch')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_LOG, async (_, repoId: string, limit = 20) => {
    try {
      const localPath = await getLocalPath(repoId)
      return gitEngine.getLog(localPath, limit)
    } catch (err) {
      throw friendlyGitError(err, 'Log')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_BRANCHES, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      return gitEngine.getBranches(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Branches')
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.GIT_CREATE_BRANCH,
    async (_, repoId: string, name: string, ref?: string) => {
      try {
        const localPath = await getLocalPath(repoId)
        await gitEngine.createBranch(localPath, name, ref)
        return { success: true }
      } catch (err) {
        throw friendlyGitError(err, 'Criar branch')
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT, async (_, repoId: string, ref: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.checkout(localPath, ref)
      return { success: true }
    } catch (err) {
      throw friendlyGitError(err, 'Checkout')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_TAGS, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      return gitEngine.getTags(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Tags')
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.GIT_CREATE_TAG,
    async (_, repoId: string, name: string, message?: string) => {
      try {
        const localPath = await getLocalPath(repoId)
        await gitEngine.createTag(localPath, name, message)
        return { success: true }
      } catch (err) {
        throw friendlyGitError(err, 'Criar tag')
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.GIT_MERGE, async (_, repoId: string, branch: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      return gitEngine.merge(localPath, branch)
    } catch (err) {
      throw friendlyGitError(err, 'Merge')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_MERGE_ABORT, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.abortMerge(localPath)
      return { success: true }
    } catch (err) {
      throw friendlyGitError(err, 'Abortar merge')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STASH, async (_, repoId: string, message?: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.stashSave(localPath, message)
      return { success: true }
    } catch (err) {
      throw friendlyGitError(err, 'Stash')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STASH_POP, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.stashPop(localPath)
      return { success: true }
    } catch (err) {
      throw friendlyGitError(err, 'Stash pop')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STASH_LIST, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      return gitEngine.stashList(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Stash list')
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.GIT_DELETE_BRANCH,
    async (_, repoId: string, name: string, force?: boolean) => {
      try {
        const localPath = await getLocalPath(repoId)
        await gitEngine.deleteBranch(localPath, name, force)
        return { success: true }
      } catch (err) {
        throw friendlyGitError(err, 'Deletar branch')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.GIT_RENAME_BRANCH,
    async (_, repoId: string, oldName: string, newName: string) => {
      try {
        const localPath = await getLocalPath(repoId)
        await gitEngine.renameBranch(localPath, oldName, newName)
        return { success: true }
      } catch (err) {
        throw friendlyGitError(err, 'Renomear branch')
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.GIT_REVERT, async (_, repoId: string, sha: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.revertCommit(localPath, sha)
      return { success: true }
    } catch (err) {
      throw friendlyGitError(err, 'Revert')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_AMEND, async (_, repoId: string, message: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      const sha = await gitEngine.amendCommit(localPath, message)
      return { sha, success: true }
    } catch (err) {
      throw friendlyGitError(err, 'Amend')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_CHERRY_PICK, async (_, repoId: string, sha: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.cherryPick(localPath, sha)
      return { success: true }
    } catch (err) {
      throw friendlyGitError(err, 'Cherry-pick')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_REMOTES, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      return gitEngine.getRemotes(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Remotes')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_UNSTAGE_ALL, async (_, repoId: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      await gitEngine.unstageAll(localPath)
      return gitEngine.getStatus(localPath)
    } catch (err) {
      throw friendlyGitError(err, 'Unstage all')
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DIFF_STAGED, async (_, repoId: string, file?: string) => {
    try {
      const localPath = await getLocalPath(repoId)
      return gitEngine.getDiffStaged(localPath, file)
    } catch (err) {
      throw friendlyGitError(err, 'Diff staged')
    }
  })
}
