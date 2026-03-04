import { simpleGit, SimpleGit, CleanOptions } from 'simple-git'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import type { GitStatus, GitFile, GitCommit, GitBranch, GitTag } from '@shared/types'

const instances = new Map<string, SimpleGit>()

function git(localPath: string): SimpleGit {
  if (!instances.has(localPath)) {
    instances.set(localPath, simpleGit(localPath))
  }
  return instances.get(localPath)!
}

export async function cloneRepo(
  cloneUrl: string,
  localPath: string,
  token: string
): Promise<void> {
  mkdirSync(localPath, { recursive: true })
  const urlWithAuth = cloneUrl.replace('https://', `https://x-access-token:${token}@`)
  const g = simpleGit()
  await g.clone(urlWithAuth, localPath)
  instances.delete(localPath)
}

const GIT_CODE: Record<string, string> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'unmerged',
  '?': 'untracked',
}

export async function getStatus(localPath: string): Promise<GitStatus> {
  const g = git(localPath)
  const status = await g.status()

  const staged: GitFile[] = []
  const unstaged: GitFile[] = []
  const untracked: GitFile[] = []

  for (const file of status.files) {
    const idx = file.index.trim()
    const wd  = file.working_dir.trim()

    if (idx === '?' && wd === '?') {
      untracked.push({ path: file.path, status: 'untracked' })
      continue
    }
    if (idx && idx !== ' ') {
      staged.push({ path: file.path, status: GIT_CODE[idx] ?? 'modified' })
    }
    if (wd && wd !== ' ' && wd !== '?') {
      unstaged.push({ path: file.path, status: GIT_CODE[wd] ?? 'modified' })
    }
  }

  return {
    staged,
    unstaged,
    untracked,
    ahead: status.ahead,
    behind: status.behind,
    branch: status.current ?? 'HEAD',
    tracking: status.tracking ?? null
  }
}

export async function getDiff(localPath: string, file?: string): Promise<string> {
  const g = git(localPath)
  if (file) return g.diff(['HEAD', '--', file])
  return g.diff(['HEAD'])
}

export async function stageFiles(localPath: string, files: string[]): Promise<void> {
  const g = git(localPath)
  await g.add(files)
}

export async function stageAll(localPath: string): Promise<void> {
  const g = git(localPath)
  await g.add('.')
}

export async function unstageFiles(localPath: string, files: string[]): Promise<void> {
  const g = git(localPath)
  await g.reset(['HEAD', '--', ...files])
}

export async function commit(localPath: string, message: string): Promise<string> {
  const g = git(localPath)
  const result = await g.commit(message)
  return result.commit
}

export async function push(
  localPath: string,
  remote = 'origin',
  branch?: string,
  withTags = false
): Promise<void> {
  const g = git(localPath)
  const status = await g.status()
  const targetBranch = branch ?? status.current ?? 'main'
  const args: string[] = ['--set-upstream', remote, targetBranch]
  if (withTags) args.push('--tags')
  await g.push(args)
}

export async function authenticatedPush(
  localPath: string,
  token: string,
  remote = 'origin',
  branch?: string,
  withTags = false
): Promise<void> {
  const g = git(localPath)
  // Get remote URL and inject token
  const remotes = await g.getRemotes(true)
  const originRemote = remotes.find((r) => r.name === remote)
  if (!originRemote) throw new Error(`Remote '${remote}' not found`)

  const originalUrl = originRemote.refs.push || originRemote.refs.fetch
  const authedUrl = originalUrl.replace('https://', `https://x-access-token:${token}@`)

  await g.remote(['set-url', remote, authedUrl])
  try {
    await push(localPath, remote, branch, withTags)
  } finally {
    await g.remote(['set-url', remote, originalUrl])
  }
}

export async function pull(localPath: string, remote = 'origin'): Promise<void> {
  const g = git(localPath)
  const status = await g.status()
  await g.pull(remote, status.current ?? 'main')
}

export async function fetch(localPath: string, remote = 'origin'): Promise<void> {
  const g = git(localPath)
  await g.fetch(remote)
}

export async function getLog(localPath: string, limit = 20): Promise<GitCommit[]> {
  const g = git(localPath)
  const log = await g.log({ maxCount: limit })
  return log.all.map((c) => ({
    hash: c.hash,
    message: c.message,
    author: c.author_name,
    date: c.date
  }))
}

export async function getBranches(localPath: string): Promise<GitBranch[]> {
  const g = git(localPath)
  const branches = await g.branch(['-a'])
  return Object.entries(branches.branches).map(([name, b]) => ({
    name: name.replace(/^remotes\//, ''),
    current: b.current,
    remote: name.startsWith('remotes/')
  }))
}

export async function createBranch(
  localPath: string,
  name: string,
  ref?: string
): Promise<void> {
  const g = git(localPath)
  if (ref) {
    await g.checkoutBranch(name, ref)
  } else {
    await g.checkoutLocalBranch(name)
  }
}

export async function checkout(localPath: string, ref: string): Promise<void> {
  const g = git(localPath)
  await g.checkout(ref)
}

export async function getTags(localPath: string): Promise<GitTag[]> {
  const g = git(localPath)
  const result = await g.tags()
  const tags: GitTag[] = []
  for (const name of result.all) {
    try {
      const log = await g.log({ from: name, maxCount: 1 })
      tags.push({ name, date: log.latest?.date ?? '' })
    } catch {
      tags.push({ name, date: '' })
    }
  }
  return tags.reverse()
}

export async function createTag(
  localPath: string,
  name: string,
  message?: string
): Promise<void> {
  const g = git(localPath)
  if (message) {
    await g.addAnnotatedTag(name, message)
  } else {
    await g.addTag(name)
  }
}

export async function getCurrentSha(localPath: string): Promise<string> {
  const g = git(localPath)
  return g.revparse(['HEAD'])
}

export async function getCurrentBranch(localPath: string): Promise<string> {
  const g = git(localPath)
  const status = await g.status()
  return status.current ?? 'HEAD'
}

export function invalidateCache(localPath: string): void {
  instances.delete(localPath)
}
