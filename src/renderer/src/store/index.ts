import { create } from 'zustand'
import type {
  Repo,
  GitHubUser,
  Run,
  RunLog,
  RunJob,
  RunStep,
  GitStatus,
  DockerStatus,
  AppSettings,
  SyncEvent
} from '@shared/types'

// ─── Auth Store ───────────────────────────────────────────────────────────────
interface AuthState {
  user: GitHubUser | null
  isLoading: boolean
  setUser: (user: GitHubUser | null) => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading })
}))

// ─── Repo Store ───────────────────────────────────────────────────────────────
export interface GitSummary {
  branch: string
  ahead: number
  behind: number
  changes: number // staged + unstaged + untracked
}

interface RepoState {
  repos: Repo[]
  selectedRepoId: string | null
  isLoading: boolean
  setRepos: (repos: Repo[]) => void
  addRepo: (repo: Repo) => void
  updateRepo: (id: string, updates: Partial<Repo>) => void
  removeRepo: (id: string) => void
  selectRepo: (id: string | null) => void
  setLoading: (loading: boolean) => void
  syncEvents: Record<string, SyncEvent>
  addSyncEvent: (event: SyncEvent) => void
  gitSummaries: Record<string, GitSummary>
  setGitSummary: (repoId: string, summary: GitSummary) => void
}

export const useRepoStore = create<RepoState>((set) => ({
  repos: [],
  selectedRepoId: null,
  isLoading: false,
  syncEvents: {},
  gitSummaries: {},
  setRepos: (repos) => set({ repos }),
  addRepo: (repo) => set((s) => ({ repos: [...s.repos, repo] })),
  updateRepo: (id, updates) =>
    set((s) => ({
      repos: s.repos.map((r) => (r.id === id ? { ...r, ...updates } : r))
    })),
  removeRepo: (id) =>
    set((s) => ({
      repos: s.repos.filter((r) => r.id !== id),
      selectedRepoId: s.selectedRepoId === id ? null : s.selectedRepoId
    })),
  selectRepo: (id) => set({ selectedRepoId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  addSyncEvent: (event) =>
    set((s) => ({ syncEvents: { ...s.syncEvents, [event.repoId]: event } })),
  setGitSummary: (repoId, summary) =>
    set((s) => ({ gitSummaries: { ...s.gitSummaries, [repoId]: summary } }))
}))

// ─── Runs Store ───────────────────────────────────────────────────────────────
interface RunsState {
  runs: Run[]
  activeRunId: string | null
  runLogs: Record<string, RunLog[]>
  runJobs: Record<string, RunJob[]>
  runSteps: Record<string, RunStep[]>
  isLoading: boolean
  setRuns: (runs: Run[]) => void
  addRun: (run: Run) => void
  updateRunStatus: (runId: string, status: Run['status']) => void
  setActiveRun: (runId: string | null) => void
  setRunLogs: (runId: string, logs: RunLog[]) => void
  appendRunLog: (log: RunLog) => void
  setRunJobs: (runId: string, jobs: RunJob[]) => void
  setRunSteps: (runId: string, steps: RunStep[]) => void
  setLoading: (loading: boolean) => void
}

export const useRunsStore = create<RunsState>((set) => ({
  runs: [],
  activeRunId: null,
  runLogs: {},
  runJobs: {},
  runSteps: {},
  isLoading: false,
  setRuns: (runs) => set({ runs }),
  addRun: (run) => set((s) => ({ runs: [run, ...s.runs] })),
  updateRunStatus: (runId, status) =>
    set((s) => ({
      runs: s.runs.map((r) => (r.id === runId ? { ...r, status } : r))
    })),
  setActiveRun: (runId) => set({ activeRunId: runId }),
  setRunLogs: (runId, logs) =>
    set((s) => ({ runLogs: { ...s.runLogs, [runId]: logs } })),
  appendRunLog: (log) =>
    set((s) => ({
      runLogs: {
        ...s.runLogs,
        [log.runId]: [...(s.runLogs[log.runId] ?? []), log]
      }
    })),
  setRunJobs: (runId, jobs) =>
    set((s) => ({ runJobs: { ...s.runJobs, [runId]: jobs } })),
  setRunSteps: (runId, steps) =>
    set((s) => ({ runSteps: { ...s.runSteps, [runId]: steps } })),
  setLoading: (isLoading) => set({ isLoading })
}))

// ─── Settings Store ───────────────────────────────────────────────────────────
interface SettingsState {
  settings: AppSettings | null
  setSettings: (s: AppSettings) => void
  updateSettings: (updates: Partial<AppSettings>) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  setSettings: (settings) => set({ settings }),
  updateSettings: (updates) =>
    set((s) => ({ settings: s.settings ? { ...s.settings, ...updates } : null }))
}))

// ─── Docker Store ─────────────────────────────────────────────────────────────
export interface DockerInstallLog {
  message: string
  type: string
}

interface DockerState {
  status: DockerStatus | null
  installing: boolean
  installLogs: DockerInstallLog[]
  setStatus: (status: DockerStatus) => void
  setInstalling: (installing: boolean) => void
  addInstallLog: (log: DockerInstallLog) => void
  clearInstallLogs: () => void
}

export const useDockerStore = create<DockerState>((set) => ({
  status: null,
  installing: false,
  installLogs: [],
  setStatus: (status) => set({ status }),
  setInstalling: (installing) => set({ installing }),
  addInstallLog: (log) => set((s) => ({ installLogs: [...s.installLogs, log] })),
  clearInstallLogs: () => set({ installLogs: [] })
}))

// ─── Updater Store ───────────────────────────────────────────────────────────
export type UpdaterStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

interface UpdaterState {
  status: UpdaterStatus
  version: string | null
  percent: number
  error: string | null
  currentVersion: string | null
  setStatus: (status: UpdaterStatus) => void
  setVersion: (version: string | null) => void
  setPercent: (percent: number) => void
  setError: (error: string | null) => void
  setCurrentVersion: (version: string) => void
  handleEvent: (event: { type: string; version?: string; percent?: number; message?: string }) => void
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  status: 'idle',
  version: null,
  percent: 0,
  error: null,
  currentVersion: null,
  setStatus: (status) => set({ status }),
  setVersion: (version) => set({ version }),
  setPercent: (percent) => set({ percent }),
  setError: (error) => set({ error }),
  setCurrentVersion: (currentVersion) => set({ currentVersion }),
  handleEvent: (event) => {
    switch (event.type) {
      case 'checking':
        set({ status: 'checking', error: null })
        break
      case 'available':
        set({ status: 'available', version: event.version ?? null })
        break
      case 'not-available':
        set({ status: 'not-available' })
        break
      case 'progress':
        set({ status: 'downloading', percent: event.percent ?? 0 })
        break
      case 'downloaded':
        set({ status: 'downloaded', version: event.version ?? null, percent: 100 })
        break
      case 'error':
        set({ status: 'error', error: event.message ?? 'Unknown error' })
        break
    }
  }
}))
