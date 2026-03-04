import type {
  Repo,
  GitHubRepo,
  GitHubRun,
  GitHubJob,
  RunFilter,
  AppSettings,
  GitHubUser,
  WorkflowFile,
  Run,
  RunLog,
  RunJob,
  RunStep,
  MetricSample,
  GitStatus,
  GitCommit,
  GitBranch,
  GitTag,
  GitStash,
  GitRemote,
  DockerStatus,
  DockerContainer,
  Secret
} from '@shared/types'

// ─── ElectronAPI type (mirrors preload/index.ts contextBridge API) ─────────────
export interface ElectronAPI {
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  auth: {
    login: (token: string) => Promise<{ success: boolean; user: GitHubUser }>
    logout: () => Promise<{ success: boolean }>
    getUser: () => Promise<GitHubUser | null>
    githubOAuthStart: (clientId: string, clientSecret: string) => Promise<{ ok: boolean }>
  }
  repos: {
    list: () => Promise<Repo[]>
    listGitHub: () => Promise<GitHubRepo[]>
    add: (repo: Partial<Repo>) => Promise<Repo>
    update: (id: string, updates: Partial<Repo>) => Promise<Repo>
    remove: (id: string) => Promise<{ success: boolean }>
    clone: (repoId: string, remoteUrl: string) => Promise<{ cancelled: true } | { localPath: string }>
    link: (id: string) => Promise<{ cancelled: true } | { localPath: string }>
    selectFolder: () => Promise<string | null>
    sync: (id: string) => Promise<{ success: boolean }>
    openFolder: (localPath: string) => Promise<{ success: boolean }>
    deleteOrbitDir: (localPath: string) => Promise<{ success: boolean; deleted: boolean }>
    checkGithubWorkflows: (localPath: string) => Promise<{ found: boolean; files: string[] }>
    importGithubWorkflows: (localPath: string) => Promise<{ success: boolean; count: number; files: string[] }>
    listGithubWorkflows: (localPath: string) => Promise<{ file: string; path: string }[]>
    findLocal: (repoName: string) => Promise<string[]>
  }
  workflows: {
    list: (repoId: string) => Promise<WorkflowFile[]>
    get: (repoId: string, file: string) => Promise<string>
    save: (repoId: string, file: string, content: string) => Promise<void>
    run: (repoId: string, file: string, inputs?: Record<string, string>) => Promise<string>
    create: (repoId: string, file: string, content: string) => Promise<void>
    scanSecrets: (repoId: string) => Promise<{ name: string; usedIn: string[] }[]>
  }
  runs: {
    list: (filter?: RunFilter) => Promise<Run[]>
    get: (id: string) => Promise<Run | null>
    getLogs: (runId: string) => Promise<RunLog[]>
    getJobs: (runId: string) => Promise<RunJob[]>
    getSteps: (runId: string) => Promise<RunStep[]>
    cancel: (runId: string) => Promise<{ success: boolean }>
    getMetrics: (runId: string, jobName?: string, stepName?: string) => Promise<MetricSample[]>
    listGitHub: (repoId: string, perPage?: number, page?: number, status?: string) => Promise<GitHubRun[]>
    listGitHubRunJobs: (repoId: string, runId: number) => Promise<GitHubJob[]>
    getGitHubJobLogs: (repoId: string, jobId: number) => Promise<string>
  }
  git: {
    status: (repoId: string) => Promise<GitStatus>
    diff: (repoId: string, file?: string) => Promise<string>
    stage: (repoId: string, files: string[]) => Promise<void>
    stageAll: (repoId: string) => Promise<void>
    unstage: (repoId: string, files: string[]) => Promise<void>
    discard: (repoId: string, files: string[]) => Promise<void>
    discardAll: (repoId: string) => Promise<void>
    commit: (repoId: string, message: string) => Promise<{ sha: string }>
    push: (repoId: string, branch?: string, withTags?: boolean) => Promise<void>
    pull: (repoId: string) => Promise<void>
    fetch: (repoId: string) => Promise<void>
    log: (repoId: string, limit?: number) => Promise<GitCommit[]>
    branches: (repoId: string) => Promise<GitBranch[]>
    createBranch: (repoId: string, name: string, ref?: string) => Promise<void>
    checkout: (repoId: string, ref: string) => Promise<void>
    tags: (repoId: string) => Promise<GitTag[]>
    createTag: (repoId: string, name: string, message?: string) => Promise<void>
    merge: (repoId: string, branch: string) => Promise<{ success: boolean; conflicts: string[] }>
    mergeAbort: (repoId: string) => Promise<{ success: boolean }>
    stash: (repoId: string, message?: string) => Promise<{ success: boolean }>
    stashPop: (repoId: string) => Promise<{ success: boolean }>
    stashList: (repoId: string) => Promise<GitStash[]>
    deleteBranch: (repoId: string, name: string, force?: boolean) => Promise<{ success: boolean }>
    renameBranch: (repoId: string, oldName: string, newName: string) => Promise<{ success: boolean }>
    revert: (repoId: string, sha: string) => Promise<{ success: boolean }>
    amend: (repoId: string, message: string) => Promise<{ sha: string; success: boolean }>
    cherryPick: (repoId: string, sha: string) => Promise<{ success: boolean }>
    remotes: (repoId: string) => Promise<GitRemote[]>
    unstageAll: (repoId: string) => Promise<GitStatus>
    diffStaged: (repoId: string, file?: string) => Promise<string>
  }
  docker: {
    status: () => Promise<DockerStatus>
    images: () => Promise<{ id: string; repoTags: string[]; size: number }[]>
    containers: () => Promise<DockerContainer[]>
    pull: (image: string) => Promise<void>
    removeContainer: (id: string) => Promise<void>
    install: () => Promise<{ status: string; url?: string }>
  }
  secrets: {
    list: (scope: string) => Promise<Secret[]>
    set: (scope: string, key: string, value: string) => Promise<void>
    delete: (scope: string, key: string) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (updates: Partial<AppSettings>) => Promise<{ success: boolean }>
  }
  updater: {
    check: () => Promise<{ success: boolean; version?: string | null; error?: string }>
    download: () => Promise<{ success: boolean; error?: string }>
    install: () => Promise<{ success: boolean }>
    getVersion: () => Promise<string>
  }
  notify: {
    test: (opts: { type: string; title: string; body: string; duration: number }) => Promise<{ ok: boolean }>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  off: (channel: string, callback: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export const electron = window.electron
