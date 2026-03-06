import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type {
  AppSettings,
  Repo,
  RunFilter
} from '../shared/types';

const api = {
  // ─── Window ────────────────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },

  // ─── Auth ──────────────────────────────────────────────────────────────────
  auth: {
    login: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, token),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
    getUser: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_USER),
    githubOAuthStart: (clientId: string, clientSecret: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_GITHUB_OAUTH_START, clientId, clientSecret)
  },

  // ─── Repos ─────────────────────────────────────────────────────────────────
  repos: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.REPOS_LIST),
    listGitHub: () => ipcRenderer.invoke(IPC_CHANNELS.REPOS_LIST_GITHUB),
    add: (repo: Partial<Repo>) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_ADD, repo),
    update: (id: string, updates: Partial<Repo>) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_UPDATE, id, updates),
    remove: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_REMOVE, id),
    clone: (repoId: string, remoteUrl: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_CLONE, repoId, remoteUrl),
    link: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_LINK, id),
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.REPOS_SELECT_FOLDER),
    sync: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_SYNC, id),
    openFolder: (localPath: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_OPEN_FOLDER, localPath),
    deleteOrbitDir: (localPath: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_DELETE_ORBIT_DIR, localPath),
    checkGithubWorkflows: (localPath: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_CHECK_GITHUB_WORKFLOWS, localPath),
    importGithubWorkflows: (localPath: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_IMPORT_GITHUB_WORKFLOWS, localPath),
    listGithubWorkflows: (localPath: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_LIST_GITHUB_WORKFLOWS, localPath),
    findLocal: (repoName: string) => ipcRenderer.invoke(IPC_CHANNELS.REPOS_FIND_LOCAL, repoName),
    getGithubWorkflowContent: (localPath: string, file: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPOS_GET_GITHUB_WORKFLOW_CONTENT, localPath, file),
    importGithubWorkflowsSelective: (localPath: string, files: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.REPOS_IMPORT_GITHUB_WORKFLOWS_SELECTIVE, localPath, files)
  },

  // ─── Workflows ─────────────────────────────────────────────────────────────
  workflows: {
    list: (repoId: string) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOWS_LIST, repoId),
    get: (repoId: string, file: string) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOWS_GET, repoId, file),
    save: (repoId: string, file: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKFLOWS_SAVE, repoId, file, content),
    run: (repoId: string, file: string, inputs?: Record<string, string>) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKFLOWS_RUN, repoId, file, inputs),
    create: (repoId: string, file: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKFLOWS_CREATE, repoId, file, content),
    scanSecrets: (repoId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKFLOWS_SCAN_SECRETS, repoId)
  },

  // ─── Runs ──────────────────────────────────────────────────────────────────
  runs: {
    list: (filter?: RunFilter) => ipcRenderer.invoke(IPC_CHANNELS.RUNS_LIST, filter),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.RUNS_GET, id),
    getLogs: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.RUNS_GET_LOGS, runId),
    getJobs: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.RUNS_GET_JOBS, runId),
    getSteps: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.RUNS_GET_STEPS, runId),
    cancel: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.RUNS_CANCEL, runId),
    getMetrics: (runId: string, jobName?: string, stepName?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.RUNS_GET_METRICS, runId, jobName, stepName),
    getJobGraph: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.RUNS_GET_JOB_GRAPH, runId),
    listGitHub: (repoId: string, perPage?: number, page?: number, status?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_RUNS_LIST, repoId, perPage, page, status),
    listGitHubRunJobs: (repoId: string, runId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_RUN_JOBS, repoId, runId),
    getGitHubJobLogs: (repoId: string, jobId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_JOB_LOGS, repoId, jobId)
  },

  // ─── Git ───────────────────────────────────────────────────────────────────
  git: {
    status: (repoId: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS, repoId),
    diff: (repoId: string, file?: string, staged = false) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF, repoId, file, staged),
    stage: (repoId: string, files: string[]) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STAGE, repoId, files),
    stageAll: (repoId: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STAGE_ALL, repoId),
    unstage: (repoId: string, files: string[]) => ipcRenderer.invoke(IPC_CHANNELS.GIT_UNSTAGE, repoId, files),
    discard: (repoId: string, files: string[]) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DISCARD, repoId, files),
    discardAll: (repoId: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DISCARD_ALL, repoId),
    commit: (repoId: string, message: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, repoId, message),
    push: (repoId: string, branch?: string, withTags?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_PUSH, repoId, branch, withTags),
    pull: (repoId: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_PULL, repoId),
    fetch: (repoId: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_FETCH, repoId),
    log: (repoId: string, limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, repoId, limit),
    branches: (repoId: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCHES, repoId),
    createBranch: (repoId: string, name: string, ref?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_CREATE_BRANCH, repoId, name, ref),
    checkout: (repoId: string, ref: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECKOUT, repoId, ref),
    tags: (repoId: string) => ipcRenderer.invoke(IPC_CHANNELS.GIT_TAGS, repoId),
    createTag: (repoId: string, name: string, message?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_CREATE_TAG, repoId, name, message),
    merge: (repoId: string, branch: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_MERGE, repoId, branch),
    mergeAbort: (repoId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_MERGE_ABORT, repoId),
    stash: (repoId: string, message?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH, repoId, message),
    stashPop: (repoId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_POP, repoId),
    stashList: (repoId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STASH_LIST, repoId),
    deleteBranch: (repoId: string, name: string, force?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_DELETE_BRANCH, repoId, name, force),
    renameBranch: (repoId: string, oldName: string, newName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_RENAME_BRANCH, repoId, oldName, newName),
    revert: (repoId: string, sha: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_REVERT, repoId, sha),
    amend: (repoId: string, message: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_AMEND, repoId, message),
    cherryPick: (repoId: string, sha: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_CHERRY_PICK, repoId, sha),
    remotes: (repoId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_REMOTES, repoId),
    unstageAll: (repoId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_UNSTAGE_ALL, repoId),
    diffStaged: (repoId: string, file?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF_STAGED, repoId, file),
    showCommit: (repoId: string, sha: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_SHOW_COMMIT, repoId, sha)
  },

  // ─── Docker ────────────────────────────────────────────────────────────────
  docker: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.DOCKER_STATUS),
    images: () => ipcRenderer.invoke(IPC_CHANNELS.DOCKER_IMAGES),
    containers: () => ipcRenderer.invoke(IPC_CHANNELS.DOCKER_CONTAINERS),
    pull: (image: string) => ipcRenderer.invoke(IPC_CHANNELS.DOCKER_PULL, image),
    removeContainer: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.DOCKER_REMOVE_CONTAINER, id),
    install: () => ipcRenderer.invoke(IPC_CHANNELS.DOCKER_INSTALL)
  },

  // ─── Secrets ───────────────────────────────────────────────────────────────
  secrets: {
    list: (scope: string) => ipcRenderer.invoke(IPC_CHANNELS.SECRETS_LIST, scope),
    set: (scope: string, key: string, value: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SECRETS_SET, scope, key, value),
    delete: (scope: string, key: string) => ipcRenderer.invoke(IPC_CHANNELS.SECRETS_DELETE, scope, key)
  },

  // ─── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    update: (updates: Partial<AppSettings>) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, updates)
  },

  // ─── Updater ──────────────────────────────────────────────────────────────
  updater: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK),
    download: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_DOWNLOAD),
    install: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_INSTALL),
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_GET_VERSION)
  },

  // ─── Notifications ─────────────────────────────────────────────────────────
  notify: {
    test: (opts: { type: string; title: string; body: string; duration: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTIFY_TEST, opts)
  },

  // ─── Shell ─────────────────────────────────────────────────────────────────
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url)
  },

  // ─── Platform ──────────────────────────────────────────────────────────────
  platform: process.platform as 'win32' | 'darwin' | 'linux',

  // ─── Events ────────────────────────────────────────────────────────────────
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeAllListeners(channel)
  }
}

contextBridge.exposeInMainWorld('electron', api)

export type ElectronAPI = typeof api
