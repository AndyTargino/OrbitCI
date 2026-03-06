import type { GitBranch, GitCommit, GitFile, GitStatus, GitTag } from '@shared/types'
import { mkdirSync } from 'fs'
import { simpleGit, SimpleGit } from 'simple-git'

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
    const wd = file.working_dir.trim()

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

export async function getDiff(localPath: string, file?: string, staged = false): Promise<string> {
  const g = git(localPath)
  const CTX = ['-U3'] // 3 lines of context, same as GitHub default

  if (staged) {
    // Staged diff: compare index vs HEAD (or empty tree if no commits yet)
    const args = ['--staged', ...CTX]
    if (file) args.push('--', file)
    const d = await g.diff(args).catch(() => '')
    if (d.trim()) return d
    // No commits yet: compare index vs empty tree
    const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
    const args2 = ['--cached', ...CTX, emptyTree]
    if (file) args2.push('--', file)
    return g.diff(args2).catch(() => '')
  }

  if (!file) {
    // All unstaged changes
    const d = await g.diff([...CTX, 'HEAD']).catch(() => '')
    return d
  }

  // Unstaged diff for a specific file
  // 1. Try against HEAD (works for tracked modified files)
  const d = await g.diff([...CTX, 'HEAD', '--', file]).catch(() => '')
  if (d.trim()) return d

  // 2. Repo has no commits yet — compare working tree vs index
  const d2 = await g.diff([...CTX, '--', file]).catch(() => '')
  if (d2.trim()) return d2

  // 3. Check if the file exists in HEAD (is tracked)
  //    If it IS in HEAD but diffs are empty → all changes are staged; show the staged diff instead
  //    If it is NOT in HEAD → genuinely new file, use --no-index to show full content
  const inHead = await g.raw(['ls-files', '--error-unmatch', '--', file]).catch(() => '')
  if (inHead.trim()) {
    // File is tracked in HEAD but has no unstaged changes.
    // Show the staged diff so the user sees what will be committed.
    const staged = await g.diff(['--staged', ...CTX, '--', file]).catch(() => '')
    if (staged.trim()) return staged
    // Staged diff also empty (e.g. file unchanged at all) — nothing to show
    return ''
  }

  // Check if the file is in the index (staged as new file, not yet in HEAD)
  const inIndex = await g.raw(['ls-files', '--', file]).catch(() => '')
  if (inIndex.trim()) {
    // New file staged but not yet committed — show staged diff vs empty tree
    const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
    const d3 = await g.diff(['--cached', ...CTX, emptyTree, '--', file]).catch(() => '')
    if (d3.trim()) return d3
  }

  // 4. Truly untracked file (never staged, never in HEAD) — show full content as additions
  try {
    return await g.diff([...CTX, '--no-index', '/dev/null', file])
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = (err as { message: string }).message
      const diffStart = msg.indexOf('diff --git')
      if (diffStart !== -1) return msg.slice(diffStart)
    }
    return ''
  }
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

export async function discardFiles(localPath: string, files: string[]): Promise<void> {
  const g = git(localPath)
  // Separate tracked vs untracked
  const status = await getStatus(localPath)
  const untrackedPaths = new Set(status.untracked.map((f) => f.path))
  const tracked = files.filter((f) => !untrackedPaths.has(f))
  const untracked = files.filter((f) => untrackedPaths.has(f))

  if (tracked.length > 0) {
    await g.checkout(['--', ...tracked])
  }
  if (untracked.length > 0) {
    const { resolve } = await import('path')
    const { unlink } = await import('fs/promises')
    for (const f of untracked) {
      await unlink(resolve(localPath, f)).catch(() => { })
    }
  }
}

export async function discardAll(localPath: string): Promise<void> {
  const g = git(localPath)
  await g.checkout(['--', '.'])
  await g.clean('f', ['-d'])
}

export async function commit(localPath: string, message: string): Promise<string> {
  const g = git(localPath)
  const status = await g.status()
  if (!status.current || status.current === 'HEAD') {
    throw new Error('Commit: HEAD está desanexado (detached HEAD). Faça checkout de uma branch antes de commitar.')
  }
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
  if (!branch && (!status.current || status.current === 'HEAD')) {
    throw new Error('Push: HEAD está desanexado (detached HEAD). Faça checkout de uma branch antes de fazer push.')
  }
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

export async function merge(localPath: string, branch: string): Promise<{ success: boolean; conflicts: string[] }> {
  const g = git(localPath)
  try {
    await g.merge([branch])
    return { success: true, conflicts: [] }
  } catch (err: unknown) {
    const status = await g.status()
    const conflicts = status.conflicted || []
    if (conflicts.length > 0) {
      return { success: false, conflicts }
    }
    throw err
  }
}

export async function abortMerge(localPath: string): Promise<void> {
  const g = git(localPath)
  await g.merge(['--abort'])
}

export async function stashSave(localPath: string, message?: string): Promise<void> {
  const g = git(localPath)
  const args = ['push']
  if (message) args.push('-m', message)
  await g.stash(args)
}

export async function stashPop(localPath: string): Promise<void> {
  const g = git(localPath)
  await g.stash(['pop'])
}

export async function stashList(localPath: string): Promise<{ index: number; message: string }[]> {
  const g = git(localPath)
  const result = await g.stash(['list', '--format=%gd|||%gs'])
  if (!result.trim()) return []
  return result.trim().split('\n').map((line) => {
    const [ref, msg] = line.split('|||')
    const index = parseInt(ref.replace('stash@{', '').replace('}', ''), 10)
    return { index, message: msg || '' }
  })
}

export async function deleteBranch(localPath: string, name: string, force = false): Promise<void> {
  const g = git(localPath)
  await g.branch([force ? '-D' : '-d', name])
}

export async function renameBranch(localPath: string, oldName: string, newName: string): Promise<void> {
  const g = git(localPath)
  await g.branch(['-m', oldName, newName])
}

export async function revertCommit(localPath: string, sha: string): Promise<void> {
  const g = git(localPath)
  await g.revert(sha)
}

export async function amendCommit(localPath: string, message: string): Promise<string> {
  const g = git(localPath)
  const result = await g.commit(message, undefined, { '--amend': null })
  return result.commit
}

export async function cherryPick(localPath: string, sha: string): Promise<void> {
  const g = git(localPath)
  await g.raw(['cherry-pick', sha])
}

export async function getRemotes(localPath: string): Promise<{ name: string; fetchUrl: string; pushUrl: string }[]> {
  const g = git(localPath)
  const remotes = await g.getRemotes(true)
  return remotes.map((r) => ({
    name: r.name,
    fetchUrl: r.refs.fetch || '',
    pushUrl: r.refs.push || ''
  }))
}

export async function unstageAll(localPath: string): Promise<void> {
  const g = git(localPath)
  await g.reset(['HEAD'])
}

export async function showCommit(localPath: string, sha: string): Promise<string> {
  const g = git(localPath)
  return g.show([sha, '--format=', '--patch'])
}

export async function getDiffStaged(localPath: string, file?: string): Promise<string> {
  const g = git(localPath)
  const args = ['--staged']
  if (file) args.push('--', file)
  return g.diff(args)
}

export function invalidateCache(localPath: string): void {
  instances.delete(localPath)
}
