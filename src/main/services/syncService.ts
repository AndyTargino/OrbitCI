import { db } from '../db'
import { repos } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getLatestCommitSha, getLatestRelease } from './githubService'
import { notifySyncEvent } from './notifyService'
import { loadToken } from './credentialService'
import type { Repo } from '@shared/types'
import { simpleGit } from 'simple-git'
import { WorkflowRunner } from '../runner/workflowRunner'

interface SyncTimer {
  repoId: string
  timer: NodeJS.Timeout
}

const timers = new Map<string, SyncTimer>()
const syncing = new Set<string>()
let runner: WorkflowRunner | null = null

export function setRunner(r: WorkflowRunner): void {
  runner = r
}

export async function startSyncService(): Promise<void> {
  const token = loadToken()
  if (!token) return

  const allRepos = await db.select().from(repos)
  for (const repo of allRepos) {
    if (repo.localPath) {
      scheduleSync(repo.id, repo.pollInterval ?? 60)
    }
  }
}

export function stopSyncService(): void {
  for (const [, timer] of timers) {
    clearInterval(timer.timer)
  }
  timers.clear()
}

export function scheduleSync(repoId: string, intervalSeconds: number): void {
  if (timers.has(repoId)) {
    clearInterval(timers.get(repoId)!.timer)
  }

  const interval = Math.max(intervalSeconds, 30) * 1000
  const timer = setInterval(() => syncRepo(repoId), interval)

  timers.set(repoId, { repoId, timer })
  // Run immediately
  syncRepo(repoId).catch(console.error)
}

export function unscheduleSync(repoId: string): void {
  const t = timers.get(repoId)
  if (t) {
    clearInterval(t.timer)
    timers.delete(repoId)
  }
}

async function syncRepo(repoId: string): Promise<void> {
  if (syncing.has(repoId)) return
  syncing.add(repoId)

  try {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
    if (!repo || !repo.localPath) return

    const [owner, repoName] = repoId.split('/')
    const branch = repo.defaultBranch ?? 'main'

    // 1. Check remote SHA
    const remoteSha = await getLatestCommitSha(owner, repoName, branch)
    if (!remoteSha) return

    const now = new Date().toISOString()
    notifySyncEvent(repoId, 'check', { messageKey: 'workspace.sync.checking', messageArgs: { repoId } })

    await db.update(repos).set({ lastSyncAt: now }).where(eq(repos.id, repoId))

    if (remoteSha === repo.lastRemoteSha) return

    // 2. New commit detected
    notifySyncEvent(repoId, 'new-commit', { 
      messageKey: 'workspace.sync.new_commit', 
      messageArgs: { sha: remoteSha.slice(0, 7) },
      sha: remoteSha 
    })

    // 3. Pull changes
    const git = simpleGit(repo.localPath)
    await git.fetch('origin')
    await git.merge([`origin/${branch}`])

    // 4. Update SHA BEFORE triggering workflows to prevent re-triggers
    await db
      .update(repos)
      .set({ lastRemoteSha: remoteSha, lastSyncAt: now })
      .where(eq(repos.id, repoId))

    notifySyncEvent(repoId, 'pull', { 
      messageKey: 'workspace.sync.pull_done', 
      messageArgs: { sha: remoteSha.slice(0, 7) },
      sha: remoteSha 
    })

    // 5. Trigger workflows if autoRun
    if (repo.autoRun && runner) {
      await runner.triggerEvent(repoId, 'push', {
        branch,
        sha: remoteSha,
        localPath: repo.localPath
      })
    }

    // 6. Check for new GitHub releases
    if (repo.autoRun && runner) {
      try {
        const latestRelease = await getLatestRelease(owner, repoName)
        if (latestRelease && latestRelease.tag_name !== repo.lastReleaseTag) {
          notifySyncEvent(repoId, 'new-release', {
            messageKey: 'workspace.sync.new_release',
            messageArgs: { tag: latestRelease.tag_name }
          })
        }
      } catch {
        // silently ignore release check failures
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    notifySyncEvent(repoId, 'error', { 
      messageKey: 'workspace.sync.error', 
      messageArgs: { msg } 
    })
  } finally {
    syncing.delete(repoId)
  }
}

export async function forceSyncRepo(repoId: string): Promise<void> {
  return syncRepo(repoId)
}
