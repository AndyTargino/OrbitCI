import { Octokit } from '@octokit/rest'
import type { GitHubUser, GitHubRepo, GitHubRun, GitHubJob } from '@shared/types'

let octokit: Octokit | null = null
let storedToken: string | null = null

export function initGitHub(token: string): void {
  octokit = new Octokit({ auth: token })
  storedToken = token
}

export function getOctokit(): Octokit {
  if (!octokit) throw new Error('GitHub not authenticated')
  return octokit
}

export function getStoredToken(): string | null {
  return storedToken
}

export function clearGitHub(): void {
  octokit = null
  storedToken = null
}

export async function validateToken(token: string): Promise<GitHubUser> {
  const kit = new Octokit({ auth: token })
  const { data } = await kit.users.getAuthenticated()
  let email: string | null = null
  try {
    const { data: emails } = await kit.users.listEmailsForAuthenticatedUser()
    const primary = emails.find((e) => e.primary)
    email = primary?.email ?? null
  } catch {
    email = null
  }
  return {
    login: data.login,
    name: data.name ?? null,
    email,
    avatarUrl: data.avatar_url,
    htmlUrl: data.html_url
  }
}

export async function listUserRepos(): Promise<GitHubRepo[]> {
  const kit = getOctokit()
  const repos: GitHubRepo[] = []
  let page = 1
  while (true) {
    const { data } = await kit.repos.listForAuthenticatedUser({
      per_page: 100,
      page,
      sort: 'pushed',
      direction: 'desc'
    })
    if (data.length === 0) break
    repos.push(
      ...data.map((r) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        owner: { login: r.owner.login, avatar_url: r.owner.avatar_url },
        private: r.private,
        description: r.description ?? null,
        default_branch: r.default_branch,
        clone_url: r.clone_url,
        html_url: r.html_url,
        pushed_at: r.pushed_at ?? '',
        language: r.language ?? null
      }))
    )
    if (data.length < 100) break
    page++
  }
  return repos
}

export async function getLatestCommitSha(
  owner: string,
  repo: string,
  branch: string
): Promise<string | null> {
  try {
    const kit = getOctokit()
    const { data } = await kit.repos.listCommits({
      owner,
      repo,
      sha: branch,
      per_page: 1
    })
    return data[0]?.sha ?? null
  } catch {
    return null
  }
}

export async function getLatestRelease(
  owner: string,
  repo: string
): Promise<{
  tag_name: string
  name: string
  body: string
  draft: boolean
  prerelease: boolean
  html_url: string
  id: number
} | null> {
  try {
    const kit = getOctokit()
    const { data } = await kit.repos.getLatestRelease({ owner, repo })
    return {
      tag_name: data.tag_name,
      name: data.name ?? data.tag_name,
      body: data.body ?? '',
      draft: data.draft,
      prerelease: data.prerelease,
      html_url: data.html_url,
      id: data.id
    }
  } catch {
    return null
  }
}

export async function createRelease(
  owner: string,
  repo: string,
  opts: {
    tagName: string
    name: string
    body?: string
    draft?: boolean
    prerelease?: boolean
  }
): Promise<{ id: number; uploadUrl: string; htmlUrl: string }> {
  const kit = getOctokit()
  const { data } = await kit.repos.createRelease({
    owner,
    repo,
    tag_name: opts.tagName,
    name: opts.name,
    body: opts.body,
    draft: opts.draft ?? false,
    prerelease: opts.prerelease ?? false
  })
  return { id: data.id, uploadUrl: data.upload_url, htmlUrl: data.html_url }
}

export async function uploadReleaseAsset(
  owner: string,
  repo: string,
  releaseId: number,
  filePath: string,
  fileName: string
): Promise<void> {
  const kit = getOctokit()
  const { readFileSync } = await import('fs')
  const data = readFileSync(filePath)
  await kit.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: releaseId,
    name: fileName,
    data: data as unknown as string
  })
}

export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body?: string,
  labels?: string[]
): Promise<number> {
  const kit = getOctokit()
  const { data } = await kit.issues.create({ owner, repo, title, body, labels })
  return data.number
}

export async function closeIssue(owner: string, repo: string, issueNumber: number): Promise<void> {
  const kit = getOctokit()
  await kit.issues.update({ owner, repo, issue_number: issueNumber, state: 'closed' })
}

export async function addComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  const kit = getOctokit()
  await kit.issues.createComment({ owner, repo, issue_number: issueNumber, body })
}

export async function listWorkflowRuns(
  owner: string,
  repo: string,
  perPage = 30,
  page = 1,
  status?: string
): Promise<GitHubRun[]> {
  const kit = getOctokit()
  const params: Record<string, unknown> = {
    owner,
    repo,
    per_page: perPage,
    page
  }
  if (status && status !== 'all') {
    params.status = status
  }
  const { data } = await kit.actions.listWorkflowRunsForRepo(params as Parameters<typeof kit.actions.listWorkflowRunsForRepo>[0])
  return data.workflow_runs.map((r) => ({
    id: r.id,
    name: r.name ?? null,
    headBranch: r.head_branch ?? null,
    headSha: r.head_sha,
    displayTitle: r.display_title,
    runNumber: r.run_number,
    event: r.event,
    status: r.status as GitHubRun['status'],
    conclusion: (r.conclusion ?? null) as GitHubRun['conclusion'],
    workflowPath: r.path,
    htmlUrl: r.html_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    runStartedAt: r.run_started_at ?? null,
    actor: r.actor ? { login: r.actor.login, avatarUrl: r.actor.avatar_url } : null
  }))
}

export async function listRunJobs(
  owner: string,
  repo: string,
  runId: number
): Promise<GitHubJob[]> {
  const kit = getOctokit()
  const { data } = await kit.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
    per_page: 100
  })
  return data.jobs.map((j) => ({
    id: j.id,
    runId: j.run_id,
    name: j.name,
    status: j.status as GitHubJob['status'],
    conclusion: (j.conclusion ?? null) as GitHubJob['conclusion'],
    startedAt: j.started_at ?? null,
    completedAt: j.completed_at ?? null,
    htmlUrl: j.html_url ?? '',
    steps: (j.steps ?? []).map((s) => ({
      name: s.name,
      status: s.status as 'queued' | 'in_progress' | 'completed',
      conclusion: (s.conclusion ?? null) as GitHubJob['conclusion'],
      number: s.number,
      startedAt: s.started_at ?? null,
      completedAt: s.completed_at ?? null
    }))
  }))
}

export async function getJobLogs(
  owner: string,
  repo: string,
  jobId: number
): Promise<string> {
  if (!storedToken) throw new Error('GitHub not authenticated')
  // Octokit returns 302; fetch the redirect URL manually
  const redirectRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,
    {
      headers: {
        Authorization: `Bearer ${storedToken}`,
        'User-Agent': 'OrbitCI'
      },
      redirect: 'follow'
    }
  )
  if (!redirectRes.ok) return ''
  return redirectRes.text()
}

export async function setCommitStatus(
  owner: string,
  repo: string,
  sha: string,
  state: 'pending' | 'success' | 'failure' | 'error',
  description?: string,
  context?: string
): Promise<void> {
  const kit = getOctokit()
  await kit.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    description,
    context: context ?? 'OrbitCI'
  })
}
