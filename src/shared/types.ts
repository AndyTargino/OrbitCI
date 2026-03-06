// ─── Repo ────────────────────────────────────────────────────────────────────
export interface Repo {
  id: string // "owner/repo"
  name: string
  owner: string
  fullName: string
  localPath: string | null
  remoteUrl: string | null
  defaultBranch: string
  watchBranches: string[] // parsed from JSON
  pollInterval: number
  autoRun: boolean
  notifications: boolean
  lastSyncAt: string | null
  lastRemoteSha: string | null
  lastReleaseTag: string | null
  gitUserName: string | null
  gitUserEmail: string | null
  createdAt: string
}

export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  owner: { login: string; avatar_url: string }
  private: boolean
  description: string | null
  default_branch: string
  clone_url: string
  html_url: string
  pushed_at: string
  language: string | null
}

// ─── Workflow ─────────────────────────────────────────────────────────────────
export interface WorkflowFile {
  name: string
  file: string
  path: string
  triggers: string[]
  jobs: string[]
  inputs?: Record<string, WorkflowInput>
}

export interface WorkflowInput {
  description?: string
  required?: boolean
  default?: string
  type?: 'string' | 'boolean' | 'number' | 'choice'
  options?: string[]
}

export interface WorkflowDefinition {
  name: string
  on: Record<string, unknown>
  env?: Record<string, string>
  jobs: Record<string, JobDefinition>
}

export interface JobDefinition {
  name?: string
  needs?: string | string[]
  'runs-on'?: string
  container?: string
  if?: string
  env?: Record<string, string>
  steps: StepDefinition[]
}

export interface StepDefinition {
  name?: string
  id?: string
  if?: string
  run?: string
  OrbitCI?: string
  with?: Record<string, string>
  env?: Record<string, string>
  'working-directory'?: string
  'continue-on-error'?: boolean
  'retry'?: number
}

// ─── GitHub Actions Run ────────────────────────────────────────────────────────
export type GitHubRunStatus = 'queued' | 'in_progress' | 'completed' | 'waiting' | 'pending' | 'requested'
export type GitHubRunConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'stale' | 'startup_failure' | null

export interface GitHubRun {
  id: number
  name: string | null
  headBranch: string | null
  headSha: string
  displayTitle: string
  runNumber: number
  event: string
  status: GitHubRunStatus
  conclusion: GitHubRunConclusion
  workflowPath: string
  htmlUrl: string
  createdAt: string
  updatedAt: string
  runStartedAt: string | null
  actor: { login: string; avatarUrl: string } | null
}

export interface GitHubJobStep {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: GitHubRunConclusion
  number: number
  startedAt: string | null
  completedAt: string | null
}

export interface GitHubJob {
  id: number
  runId: number
  name: string
  status: GitHubRunStatus
  conclusion: GitHubRunConclusion
  startedAt: string | null
  completedAt: string | null
  htmlUrl: string
  steps: GitHubJobStep[]
}

export interface GitHubRunFilter {
  status?: 'all' | GitHubRunStatus
  conclusion?: GitHubRunConclusion
}

// ─── Run ──────────────────────────────────────────────────────────────────────
export type RunStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled'

export interface Run {
  id: string
  repoId: string
  workflowFile: string
  workflowName: string | null
  trigger: string | null
  status: RunStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  gitSha: string | null
  gitBranch: string | null
  inputs: Record<string, string> | null
  outputs: Record<string, string> | null
  error: string | null
  peakCpuPercent: number | null
  peakRamBytes: number | null
  peakGpuPercent: number | null
  peakGpuMemBytes: number | null
  createdAt: string
}

export interface RunJob {
  id: string
  runId: string
  jobName: string
  status: RunStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
}

export interface JobGraphNode {
  name: string
  needs: string[]
}

export interface RunStep {
  id: string
  runId: string
  jobId: string
  stepName: string | null
  stepIndex: number
  status: RunStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  peakCpuPercent: number | null
  peakRamBytes: number | null
  peakGpuPercent: number | null
  peakGpuMemBytes: number | null
}

// ─── Metrics ─────────────────────────────────────────────────────────────────
export interface MetricSample {
  timestamp: string
  cpuPercent: number
  ramBytes: number
  gpuPercent: number | null
  gpuMemBytes: number | null
}

export type LogType = 'info' | 'output' | 'error' | 'success' | 'skip' | 'step' | 'job' | 'warning'

export interface RunLog {
  id: number
  runId: string
  jobName: string | null
  stepName: string | null
  message: string
  type: LogType
  timestamp: string
}

// ─── Git ──────────────────────────────────────────────────────────────────────
export interface GitStatus {
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: GitFile[]
  ahead: number
  behind: number
  branch: string
  tracking: string | null
}

export interface GitFile {
  path: string
  status: string
}

export interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
}

export interface GitTag {
  name: string
  date: string
}

export interface GitStash {
  index: number
  message: string
}

export interface GitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

// ─── Docker ───────────────────────────────────────────────────────────────────
export interface DockerStatus {
  available: boolean
  version: string | null
  error: string | null
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  runId: string | null
}

export interface DockerImage {
  id: string
  tags: string[]
  size: number
  created: number
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export interface AppSettings {
  githubToken: string | null
  githubUser: GitHubUser | null
  githubClientId: string | null
  githubClientSecret: string | null
  defaultPollInterval: number
  maxConcurrentRuns: number
  jobTimeoutMinutes: number
  dockerEnabled: boolean
  defaultDockerImage: string
  theme: 'dark' | 'light' | 'system'
  notifications: boolean
  autoUpdate: boolean
  language: string | null
}

export interface GitHubUser {
  login: string
  name: string | null
  email: string | null
  avatarUrl: string
  htmlUrl: string
}

// ─── Secret ───────────────────────────────────────────────────────────────────
export interface Secret {
  key: string
  scope: string // 'global' | repoId
  createdAt: string
  updatedAt: string
}

// ─── IPC Events ───────────────────────────────────────────────────────────────
export interface RunLogEvent {
  runId: string
  jobName: string | null
  stepName: string | null
  message: string
  type: LogType
  timestamp: string
}

export interface RunStatusEvent {
  runId: string
  status: RunStatus
  jobName?: string
  stepName?: string
  stepStatus?: RunStatus
}

export interface SyncEvent {
  repoId: string
  type: 'new-commit' | 'pull' | 'error' | 'check' | 'new-release'
  message?: string
  messageKey?: string
  messageArgs?: Record<string, any>
  sha?: string
}

// ─── Filter ───────────────────────────────────────────────────────────────────
export interface RunFilter {
  repoId?: string
  status?: RunStatus
  workflowFile?: string
  since?: string
  limit?: number
  offset?: number
}
