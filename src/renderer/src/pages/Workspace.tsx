import logoIcon from '@/assets/icon_dark.png'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { OwnerAvatar } from '@/components/shared/OwnerAvatar'
import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  Dialog, DialogContent,
  DialogDescription,
  DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '@/components/ui/tooltip'
import { ChangesView } from '@/components/workspace/ChangesView'
import { HistoryView } from '@/components/workspace/HistoryView'
import { PipelinesView } from '@/components/workspace/PipelinesView'
import { RunsView } from '@/components/workspace/RunsView'
import { useGlobalEvents } from '@/hooks/useSync'
import { electron } from '@/lib/electron'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useAuthStore,
  useDockerStore,
  useRepoStore, useRunsStore,
  useUpdaterStore
} from '@/store'
import { IPC_CHANNELS } from '@shared/constants'
import type { GitBranch as GitBranchType, GitHubRepo, GitStatus, Repo } from '@shared/types'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Check,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock, FileCode,
  FolderOpen,
  FolderSearch,
  GitBranch,
  GitMerge,
  Globe,
  Loader2, LogOut,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Workflow
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function Workspace(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { repos, selectedRepoId, selectRepo, setRepos, addRepo } = useRepoStore()
  const { user, setUser } = useAuthStore()
  const updater = useUpdaterStore()
  const dockerStore = useDockerStore()

  const [tab, setTab] = useState<Tab>('changes')
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranchType[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [repoSearch, setRepoSearch] = useState('')
  const [branchSearch, setBranchSearch] = useState('')
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const [createBranchOpen, setCreateBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [isCreatingBranch, setIsCreatingBranch] = useState(false)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null)
  const [addRepoMode, setAddRepoMode] = useState<'clone' | 'add'>('clone')
  const [confirmDeleteBranch, setConfirmDeleteBranch] = useState<string | null>(null)
  const [confirmMergeBranch, setConfirmMergeBranch] = useState<string | null>(null)

  const formatRelativeTime = (date: Date): string => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
    if (seconds < 60) return t('common.time.just_now', 'just now')
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return t('common.time.minutes_ago', { count: minutes, defaultValue: `${minutes} min ago` })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('common.time.hours_ago', { count: hours, defaultValue: `${hours}h ago` })
    const days = Math.floor(hours / 24)
    return t('common.time.days_ago', { count: days, defaultValue: `${days}d ago` })
  }

  const sidebarSections = [
    {
      label: t('workspace.sections.git', 'Git'),
      items: [
        { key: 'changes' as Tab, label: t('workspace.sections.changes', 'Changes'), icon: FileCode },
        { key: 'history' as Tab, label: t('workspace.sections.history', 'History'), icon: Clock }
      ]
    },
    {
      label: t('workspace.sections.workflows', 'Workflows'),
      items: [
        { key: 'pipelines' as Tab, label: t('workspace.sections.pipelines', 'CI/CD'), icon: Workflow },
        { key: 'runs' as Tab, label: t('workspace.sections.runs', 'Runs'), icon: Play }
      ]
    }
  ]

  useGlobalEvents()

  const repo = repos.find((r) => r.id === selectedRepoId) ?? null

  // Auto-select: restore last repo or pick first
  useEffect(() => {
    if (repos.length === 0) return
    if (selectedRepoId && repos.some((r) => r.id === selectedRepoId)) return
    selectRepo(repos[0].id)
  }, [selectedRepoId, repos, selectRepo])

  const refreshGitStatus = useCallback(async () => {
    if (!repo) return
    try {
      const status = await electron.git.status(repo.id)
      setGitStatus(status)
    } catch {
      setGitStatus(null)
    }
  }, [repo])

  const refreshBranches = useCallback(async () => {
    if (!repo) return
    try {
      const b = await electron.git.branches(repo.id)
      setBranches(b)
    } catch {
      setBranches([])
    }
  }, [repo])

  useEffect(() => {
    if (repo) {
      refreshGitStatus()
      refreshBranches()
    } else {
      setGitStatus(null)
      setBranches([])
    }
  }, [repo, refreshGitStatus, refreshBranches])

  // Realtime run status
  useEffect(() => {
    const unsub = electron.on(IPC_CHANNELS.EVENT_RUN_STATUS, () => {
      electron.runs.list({}).then((r) => useRunsStore.getState().setRuns(r)).catch(() => { })
    })
    return unsub
  }, [])

  // Realtime git status — triggered by fs.watch on .git/index, HEAD and refs
  useEffect(() => {
    const unsub = electron.on(
      IPC_CHANNELS.EVENT_GIT_CHANGED,
      (payload: unknown) => {
        const { repoId } = payload as { repoId: string }
        if (repoId === repo?.id) {
          refreshGitStatus()
        }
      }
    )
    return unsub
  }, [repo?.id, refreshGitStatus])

  // Updater
  useEffect(() => {
    electron.updater.getVersion().then((v) => updater.setCurrentVersion(v))
    const unsub = electron.on(IPC_CHANNELS.EVENT_UPDATER, (event: unknown) => {
      updater.handleEvent(event as { type: string; version?: string; percent?: number; message?: string })
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Docker status polling
  useEffect(() => {
    const check = () => {
      electron.docker.status()
        .then((s) => dockerStore.setStatus(s))
        .catch(() => dockerStore.setStatus({ available: false, version: null, error: 'Not installed' }))
    }
    check()
    const interval = setInterval(check, 30_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFetch = async () => {
    if (!repo) return
    setIsFetching(true)
    try {
      await electron.git.fetch(repo.id)
      setLastFetchedAt(new Date())
      await refreshGitStatus()
      await refreshBranches()
      notify('success', t('workspace.notifications.fetch_success', 'Fetch complete'))
    } catch { /* ignore */ }
    setIsFetching(false)
  }

  const handlePush = async () => {
    if (!repo) return
    setIsFetching(true)
    try {
      await electron.git.push(repo.id)
      notify('success', t('workspace.notifications.push_success', 'Push complete'))
      await refreshGitStatus()
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.push_failed', 'Push failed'), err instanceof Error ? err.message : t('common.error'))
    }
    setIsFetching(false)
  }

  const handlePull = async () => {
    if (!repo) return
    setIsFetching(true)
    try {
      await electron.git.pull(repo.id)
      notify('success', t('workspace.notifications.pull_success', 'Pull complete'))
      await refreshGitStatus()
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.pull_failed', 'Pull failed'), err instanceof Error ? err.message : t('common.error'))
    }
    setIsFetching(false)
  }

  // Safe sync: stash -> pull -> stash pop -> push
  const handleSync = async () => {
    if (!repo || !gitStatus) return
    setIsFetching(true)
    try {
      const hasLocalChanges = gitStatus.staged.length > 0 ||
        gitStatus.unstaged.length > 0 || gitStatus.untracked.length > 0

      // Stash if there are local changes
      if (hasLocalChanges) {
        await electron.git.stash(repo.id, 'OrbitCI auto-stash before sync')
      }

      // Pull first
      if (gitStatus.behind > 0) {
        await electron.git.pull(repo.id)
      }

      // Push if ahead
      if (gitStatus.ahead > 0) {
        await electron.git.push(repo.id)
      }

      // Restore stashed changes
      if (hasLocalChanges) {
        await electron.git.stashPop(repo.id)
      }

      notify('success', t('workspace.notifications.sync_success', 'Sync complete'))
      await refreshGitStatus()
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.sync_failed', 'Sync failed'), err instanceof Error ? err.message : t('common.error'))
    }
    setIsFetching(false)
  }

  const handleCheckout = async (branchName: string) => {
    if (!repo) return
    try {
      await electron.git.checkout(repo.id, branchName)
      await refreshGitStatus()
      await refreshBranches()
      notify('success', t('workspace.notifications.checkout_success', { branch: branchName, defaultValue: `Switched to ${branchName}` }))
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.checkout_failed', 'Checkout failed'), err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleCreateBranch = async () => {
    if (!repo || !newBranchName.trim()) return
    setIsCreatingBranch(true)
    try {
      await electron.git.createBranch(repo.id, newBranchName.trim())
      await electron.git.checkout(repo.id, newBranchName.trim())
      notify('success', t('workspace.notifications.create_branch_success', { branch: newBranchName.trim(), defaultValue: `Created and switched to ${newBranchName.trim()}` }))
      setCreateBranchOpen(false)
      setNewBranchName('')
      await refreshGitStatus()
      await refreshBranches()
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.create_branch_failed', 'Failed to create branch'), err instanceof Error ? err.message : t('common.error'))
    }
    setIsCreatingBranch(false)
  }

  const handleDeleteBranch = async (branchName: string) => {
    setConfirmDeleteBranch(branchName)
  }

  const executeDeleteBranch = async () => {
    if (!repo || !confirmDeleteBranch) return
    try {
      await electron.git.deleteBranch(repo.id, confirmDeleteBranch)
      notify('success', t('workspace.notifications.delete_branch_success', { branch: confirmDeleteBranch, defaultValue: `Deleted branch ${confirmDeleteBranch}` }))
      await refreshBranches()
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.delete_failed', 'Delete failed'), err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleRenameBranch = async (oldName: string) => {
    const newName = prompt(t('workspace.git.rename_prompt', { branch: oldName, defaultValue: `Rename branch "${oldName}" to:` }), oldName)
    if (!newName || newName === oldName || !repo) return
    try {
      await electron.git.renameBranch(repo.id, oldName, newName)
      notify('success', t('workspace.notifications.rename_success', { branch: newName, defaultValue: `Renamed to ${newName}` }))
      await refreshBranches()
      await refreshGitStatus()
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.rename_failed', 'Rename failed'), err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleMergeBranch = async (branchName: string) => {
    setConfirmMergeBranch(branchName)
  }

  const executeMergeBranch = async () => {
    if (!repo || !confirmMergeBranch) return
    try {
      const result = await electron.git.merge(repo.id, confirmMergeBranch)
      if (result.conflicts.length > 0) {
        notify('failure', t('workspace.notifications.merge_conflicts', 'Merge conflicts'), t('workspace.notifications.merge_conflicts_desc', { count: result.conflicts.length, defaultValue: `${result.conflicts.length} conflict(s). Resolve manually.` }))
      } else {
        notify('success', t('workspace.notifications.merge_success', { branch: confirmMergeBranch, defaultValue: `Merged ${confirmMergeBranch}` }))
      }
      await refreshGitStatus()
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.merge_failed', 'Merge failed'), err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleLogout = async () => {
    await electron.auth.logout()
    setUser(null)
    navigate('/login')
  }

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    r.fullName.toLowerCase().includes(repoSearch.toLowerCase())
  )

  const filteredBranches = branches
    .filter((b) => !b.remote)
    .filter((b) => b.name.toLowerCase().includes(branchSearch.toLowerCase()))

  // Dynamic action button
  const getAction = () => {
    if (!gitStatus) return { label: t('workspace.git.fetch', 'Fetch origin'), sublabel: '', icon: RefreshCw, fn: handleFetch, tooltip: t('workspace.git.fetch_tooltip', 'Fetch from remote') }
    if (gitStatus.ahead > 0 && gitStatus.behind > 0)
      return { label: t('workspace.git.sync', 'Sync'), sublabel: `${gitStatus.ahead}\u2191 ${gitStatus.behind}\u2193`, icon: ArrowUpDown, fn: handleSync, tooltip: t('workspace.git.sync_tooltip', 'Pull then push (safe sync)') }
    if (gitStatus.ahead > 0)
      return { label: t('workspace.git.push', 'Push origin'), sublabel: t('workspace.git.commits_count', { count: gitStatus.ahead, defaultValue: `${gitStatus.ahead} commit(s)` }), icon: ArrowUp, fn: handlePush, tooltip: t('workspace.git.push_tooltip', { count: gitStatus.ahead, defaultValue: `Push ${gitStatus.ahead} commit(s) to remote` }) }
    if (gitStatus.behind > 0)
      return { label: t('workspace.git.pull', 'Pull origin'), sublabel: t('workspace.git.commits_count', { count: gitStatus.behind, defaultValue: `${gitStatus.behind} commit(s)` }), icon: ArrowDown, fn: handlePull, tooltip: t('workspace.git.pull_tooltip', { count: gitStatus.behind, defaultValue: `Pull ${gitStatus.behind} commit(s) from remote` }) }
    return { label: t('workspace.git.fetch', 'Fetch origin'), sublabel: lastFetchedAt ? t('workspace.git.last_fetched', { time: formatRelativeTime(lastFetchedAt), defaultValue: `Last fetched ${formatRelativeTime(lastFetchedAt)}` }) : '', icon: RefreshCw, fn: handleFetch, tooltip: t('workspace.git.fetch_tooltip', 'Fetch from remote') }
  }
  const action = getAction()

  const changesCount = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0

  // No repo state
  if (!repo) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-5">
          <FolderOpen className="h-8 w-8 text-muted-foreground/40" />
        </div>
        <h2 className="text-lg font-semibold mb-2">{t('workspace.empty.title', 'No repositories')}</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          {t('workspace.empty.description', 'Add a GitHub repository to start using OrbitCI')}
        </p>
        <Button onClick={() => { setAddRepoMode('clone'); setAddRepoOpen(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          {t('common.add_repository', 'Add Repository')}
        </Button>
        <AddRepoDialog
          open={addRepoOpen}
          mode={addRepoMode}
          onClose={() => setAddRepoOpen(false)}
          onAdded={(r) => {
            addRepo(r)
            selectRepo(r.id)
            setAddRepoOpen(false)
          }}
        />
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex items-center h-[52px] shrink-0 border-b border-border">
          {/* Logo area — aligned with sidebar */}
          <div className="w-[52px] shrink-0 flex items-center justify-center border-r border-border h-full">
            <img src={logoIcon} alt="OrbitCI" className="h-10 w-10" />
          </div>
          {/* Toolbar content */}
          <div className="flex items-center flex-1 gap-2 px-3">
            {/* Repo selector */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button className="no-drag flex items-center gap-2 px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors min-w-[180px] max-w-[260px]">
                      <OwnerAvatar owner={repo.owner} size={20} className="h-5 w-5 shrink-0" />
                      <div className="min-w-0 flex-1 text-left">
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5">{t('workspace.repo_selector.current', 'Current Repository')}</div>
                        <div className="text-[13px] font-medium truncate leading-tight">{repo.name}</div>
                      </div>
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('workspace.repo_selector.switch_tooltip', 'Switch repository')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-[300px] p-0">
                <div className="p-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder={t('common.filter_placeholder', 'Filter...')}
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                      className="w-full pl-8 pr-2 py-1.5 text-[13px] bg-muted rounded-md border-0 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
                <DropdownMenuSeparator className="my-0" />
                <ScrollArea className="max-h-[300px]">
                  {filteredRepos.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onClick={() => selectRepo(r.id)}
                      className={cn(
                        'flex items-center gap-2.5 py-2.5 px-3 rounded-none',
                        r.id === selectedRepoId && 'bg-accent'
                      )}
                    >
                      <OwnerAvatar owner={r.owner} size={24} className="h-6 w-6 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium truncate">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{r.owner}</div>
                      </div>
                      {r.id === selectedRepoId && <Check className="h-4 w-4 text-foreground shrink-0" />}
                    </DropdownMenuItem>
                  ))}
                </ScrollArea>
                <DropdownMenuSeparator className="my-0" />
                <DropdownMenuItem onClick={() => { setAddRepoMode('clone'); setAddRepoOpen(true) }} className="py-2 px-3 rounded-none">
                  <Globe className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  {t('workspace.repo_selector.clone_btn', 'Clone repository...')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setAddRepoMode('add'); setAddRepoOpen(true) }} className="py-2 px-3 rounded-none">
                  <FolderSearch className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  {t('workspace.repo_selector.add_local_btn', 'Add existing repository...')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Branch selector */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button className="no-drag flex items-center gap-2 px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors min-w-[140px] max-w-[220px]">
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1 text-left">
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5">{t('workspace.branch_selector.current', 'Current Branch')}</div>
                        <div className="text-[13px] font-medium truncate leading-tight">{gitStatus?.branch ?? '...'}</div>
                      </div>
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('workspace.branch_selector.switch_tooltip', 'Switch branch')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-[280px] p-0">
                <div className="p-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder={t('workspace.branch_selector.filter_placeholder', 'Filter branches...')}
                      value={branchSearch}
                      onChange={(e) => setBranchSearch(e.target.value)}
                      className="w-full pl-8 pr-2 py-1.5 text-[13px] bg-muted rounded-md border-0 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
                <DropdownMenuSeparator className="my-0" />
                <ScrollArea className="max-h-[300px]">
                  {filteredBranches.map((b) => (
                    <ContextMenu key={b.name}>
                      <ContextMenuTrigger asChild>
                        <DropdownMenuItem
                          onClick={() => handleCheckout(b.name)}
                          className={cn(
                            'flex items-center gap-2 py-2 px-3 text-[13px] rounded-none',
                            b.current && 'bg-accent'
                          )}
                        >
                          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate flex-1">{b.name}</span>
                          {b.current && <Check className="h-4 w-4 text-foreground shrink-0" />}
                        </DropdownMenuItem>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-52">
                        <ContextMenuItem onClick={() => handleCheckout(b.name)}>
                          <Check className="w-3.5 h-3.5 mr-2" />
                          {t('workspace.branch_menu.checkout', 'Checkout')}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleMergeBranch(b.name)} disabled={b.current}>
                          <GitMerge className="w-3.5 h-3.5 mr-2" />
                          {t('workspace.branch_menu.merge', 'Merge into current')}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleRenameBranch(b.name)}>
                          <Pencil className="w-3.5 h-3.5 mr-2" />
                          {t('workspace.branch_menu.rename', 'Rename')}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => handleDeleteBranch(b.name)}
                          disabled={b.current}
                          className="text-red-400 focus:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" />
                          {t('workspace.branch_menu.delete', 'Delete branch')}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </ScrollArea>
                <DropdownMenuSeparator className="my-0" />
                <DropdownMenuItem
                  onClick={() => {
                    setNewBranchName('')
                    setCreateBranchOpen(true)
                  }}
                  className="py-2.5 px-3 rounded-none"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('workspace.branch_selector.new_btn', 'New Branch...')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Fetch/Push/Pull/Sync — same style as repo & branch selectors */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="no-drag flex items-center gap-2 px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none"
                      disabled={isFetching}
                    >
                      {isFetching
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                        : <action.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      }
                      <div className="min-w-0 text-left">
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5">{action.sublabel || t('workspace.git.remote', 'Remote')}</div>
                        <div className="text-[13px] font-medium truncate leading-tight">{action.label}</div>
                      </div>
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{action.tooltip}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={handleFetch} disabled={isFetching}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  <div>
                    <div className="text-[13px]">{t('workspace.git.fetch', 'Fetch origin')}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {lastFetchedAt ? t('workspace.git.last_fetched', { time: formatRelativeTime(lastFetchedAt), defaultValue: `Last fetched ${formatRelativeTime(lastFetchedAt)}` }) : t('workspace.git.fetch_desc', 'Fetch latest changes from origin')}
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlePull} disabled={isFetching}>
                  <ArrowDown className="h-3.5 w-3.5 mr-2" />
                  <div>
                    <div className="text-[13px]">{t('workspace.git.pull', 'Pull origin')}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {gitStatus && gitStatus.behind > 0
                        ? t('workspace.git.pull_commits_desc', { count: gitStatus.behind, defaultValue: `Pull ${gitStatus.behind} commit(s) from remote` })
                        : t('workspace.git.pull_desc', 'Pull latest changes from remote')}
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlePush} disabled={isFetching}>
                  <ArrowUp className="h-3.5 w-3.5 mr-2" />
                  <div>
                    <div className="text-[13px]">{t('workspace.git.push', 'Push origin')}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {gitStatus && gitStatus.ahead > 0
                        ? t('workspace.git.push_commits_desc', { count: gitStatus.ahead, defaultValue: `Push ${gitStatus.ahead} commit(s) to remote` })
                        : t('workspace.git.push_desc', 'Push local commits to remote')}
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSync} disabled={isFetching}>
                  <ArrowUpDown className="h-3.5 w-3.5 mr-2" />
                  <div>
                    <div className="text-[13px]">{t('workspace.git.sync', 'Sync')}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t('workspace.git.sync_desc', 'Safe sync: stash, pull, push, restore')}
                    </div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex-1" />

            {/* Ahead / Behind */}
            {gitStatus && (gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <div className="flex items-center gap-2 text-[12px] font-medium">
                {gitStatus.ahead > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-green-400">
                        <ArrowUp className="h-3 w-3" />{gitStatus.ahead}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('workspace.git.ahead_tooltip', { count: gitStatus.ahead, defaultValue: `${gitStatus.ahead} commit(s) ahead of remote` })}</TooltipContent>
                  </Tooltip>
                )}
                {gitStatus.behind > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-muted-foreground">
                        <ArrowDown className="h-3 w-3" />{gitStatus.behind}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('workspace.git.behind_tooltip', { count: gitStatus.behind, defaultValue: `${gitStatus.behind} commit(s) behind remote` })}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}

            {/* Docker status indicator */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="no-drag flex items-center gap-1 px-2 py-1 rounded-md text-[12px] cursor-default relative">
                  {dockerStore.status === null ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/>
                      </svg>
                      <span className={cn(
                        'absolute bottom-0.5 right-1.5 h-[7px] w-[7px] rounded-full border-[1.5px] border-background',
                        dockerStore.status.available ? 'bg-[#3fb950]' :
                        dockerStore.status.error?.includes('Not installed') || dockerStore.status.error?.includes('not found')
                          ? 'bg-[#f85149]' : 'bg-[#d29922]'
                      )} />
                    </>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {dockerStore.status === null
                  ? t('settings.docker.checking', 'Checking Docker...')
                  : dockerStore.status.available
                    ? t('settings.docker.active_tooltip', { version: dockerStore.status.version, defaultValue: `Docker active${dockerStore.status.version ? ` (${dockerStore.status.version})` : ''}` })
                    : dockerStore.status.error?.includes('Not installed') || dockerStore.status.error?.includes('not found')
                      ? t('settings.docker.not_installed_tooltip', 'Docker not installed')
                      : t('settings.docker.inactive_tooltip', 'Docker inactive — start Docker Desktop')
                }
              </TooltipContent>
            </Tooltip>

            {/* User menu */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button className="no-drag flex items-center rounded-full hover:ring-2 hover:ring-border transition-all">
                      {user?.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.login} className="h-7 w-7 rounded-full" />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-muted" />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('nav.account', 'Account')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                {user && (
                  <>
                    <div className="px-2 py-1.5">
                      <p className="text-[13px] font-medium">{user.name ?? user.login}</p>
                      <p className="text-[11px] text-muted-foreground">@{user.login}</p>
                    </div>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <Settings className="h-3.5 w-3.5 mr-2" />
                  {t('nav.settings', 'Settings')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-400 focus:text-red-400">
                  <LogOut className="h-3.5 w-3.5 mr-2" />
                  {t('nav.sign_out', 'Sign out')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Content area with sidebar */}
        <div className="flex flex-1 min-h-0">
          {/* Left icon sidebar */}
          <div className="w-[52px] shrink-0 border-r border-border flex flex-col items-center py-2 gap-1">
            {sidebarSections.map((section, si) => (
              <div key={section.label} className={cn('flex flex-col items-center gap-1 w-full px-1.5', si > 0 && 'mt-2 pt-2 border-t border-border')}>
                {section.items.map(({ key, label, icon: Icon }) => (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setTab(key)}
                        className={cn(
                          'relative flex items-center justify-center w-[38px] h-[38px] rounded-lg transition-colors',
                          tab === key
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground'
                        )}
                      >
                        <Icon className="h-5 w-5" />
                        {key === 'changes' && changesCount > 0 && (
                          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-violet-500 text-white text-[9px] font-bold px-0.5">
                            {changesCount}
                          </span>
                        )}
                        {tab === key && (
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-violet-500 rounded-full" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{label}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ))}
            <div className="flex-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigate('/dashboard')}
                  className="flex items-center justify-center w-[38px] h-[38px] mb-1 rounded-lg text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground transition-colors"
                >
                  <BarChart3 className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t('nav.dashboard', 'Dashboard')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigate('/settings')}
                  className="flex items-center justify-center w-[38px] h-[38px] mb-1 rounded-lg text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground transition-colors"
                >
                  <Settings className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t('nav.settings', 'Settings')}</TooltipContent>
            </Tooltip>
          </div>

          {/* Main content */}
          <div className="flex flex-1 min-w-0">
            {tab === 'changes' && (
              <ChangesView
                repoId={repo.id}
                gitStatus={gitStatus}
                onRefresh={refreshGitStatus}
                localPath={repo.localPath ?? undefined}
                remoteUrl={repo.remoteUrl ?? undefined}
              />
            )}
            {tab === 'history' && (
              <HistoryView repoId={repo.id} />
            )}
            {tab === 'pipelines' && (
              <PipelinesView repoId={repo.id} localPath={repo.localPath ?? undefined} />
            )}
            {tab === 'runs' && (
              <RunsView repoId={repo.id} />
            )}
          </div>
        </div>

        {/* Add repo dialog */}
        <AddRepoDialog
          open={addRepoOpen}
          mode={addRepoMode}
          onClose={() => setAddRepoOpen(false)}
          onAdded={(r) => {
            addRepo(r)
            selectRepo(r.id)
            setAddRepoOpen(false)
          }}
        />

        {/* Create branch dialog */}
        <Dialog open={createBranchOpen} onOpenChange={setCreateBranchOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-[15px]">{t('workspace.branch_selector.new_title', 'Create New Branch')}</DialogTitle>
              <DialogDescription className="text-[13px]">
                {t('workspace.branch_selector.new_desc', { branch: gitStatus?.branch ?? 'HEAD', defaultValue: `Branch from ${gitStatus?.branch ?? 'HEAD'}` })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <Input
                placeholder={t('workspace.branch_selector.name_placeholder', 'Branch name (e.g. feature/my-feature)')}
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                className="text-[13px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newBranchName.trim()) handleCreateBranch()
                }}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateBranchOpen(false)}
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  size="sm"
                  disabled={!newBranchName.trim() || isCreatingBranch}
                  onClick={handleCreateBranch}
                >
                  {isCreatingBranch && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  {t('workspace.branch_selector.create_btn', 'Create Branch')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={confirmDeleteBranch !== null}
          onOpenChange={(open) => { if (!open) setConfirmDeleteBranch(null) }}
          title={t('workspace.git.delete_branch_title', 'Delete branch')}
          description={t('workspace.git.delete_branch_desc', { branch: confirmDeleteBranch, defaultValue: `Are you sure you want to delete branch "${confirmDeleteBranch}"?` })}
          consequences={[
            t('workspace.git.delete_branch_cons1', 'All commits exclusive to this branch will be lost if they are not in another branch'),
            t('common.action_undone', 'This action cannot be undone'),
            t('workspace.git.delete_branch_cons2', 'The branch will be removed locally only')
          ]}
          confirmLabel={t('common.delete', 'Delete')}
          variant="destructive"
          onConfirm={executeDeleteBranch}
        />

        <ConfirmDialog
          open={confirmMergeBranch !== null}
          onOpenChange={(open) => { if (!open) setConfirmMergeBranch(null) }}
          title={t('workspace.git.merge_branch_title', 'Merge branch')}
          description={t('workspace.git.merge_branch_desc', { branch: confirmMergeBranch, current: gitStatus?.branch ?? 'HEAD', defaultValue: `Changes from "${confirmMergeBranch}" will be merged into current branch (${gitStatus?.branch ?? 'HEAD'}).` })}
          consequences={[
            t('workspace.git.merge_branch_cons1', 'A merge commit will be created if fast-forward is not possible'),
            t('workspace.git.merge_branch_cons2', 'If there are conflicts, you will need to resolve them manually'),
            t('workspace.git.merge_branch_cons3', 'Changes will be applied to the current branch')
          ]}
          confirmLabel={t('workspace.git.merge_btn', 'Merge')}
          variant="warning"
          onConfirm={executeMergeBranch}
        />
      </div>
    </TooltipProvider>
  )
}

function AddRepoDialog({
  open,
  mode,
  onClose,
  onAdded
}: {
  open: boolean
  mode: 'clone' | 'add'
  onClose: () => void
  onAdded: (repo: Repo) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isCloning, setIsCloning] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === 'add') {
      handleLink()
      return
    }
    setIsLoading(true)
    electron.repos.listGitHub()
      .then(setGhRepos)
      .catch(() => { })
      .finally(() => setIsLoading(false))
  }, [open, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClone = async (ghRepo: GitHubRepo) => {
    setIsCloning(ghRepo.full_name)
    try {
      const result = await electron.repos.clone(ghRepo.full_name, ghRepo.clone_url)
      if ('cancelled' in result) {
        setIsCloning(null)
        return
      }
      await electron.repos.add({
        id: ghRepo.full_name,
        name: ghRepo.name,
        owner: ghRepo.owner.login,
        fullName: ghRepo.full_name,
        localPath: result.localPath,
        remoteUrl: ghRepo.clone_url,
        defaultBranch: ghRepo.default_branch
      })
      const repos = await electron.repos.list()
      const added = repos.find((r) => r.id === ghRepo.full_name)
      if (added) onAdded(added)

      try {
        const hasWorkflows = await electron.repos.checkGithubWorkflows(ghRepo.full_name)
        if (hasWorkflows) {
          await electron.repos.importGithubWorkflows(ghRepo.full_name)
        }
      } catch { /* ignore */ }
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.clone_failed', 'Clone failed'), err instanceof Error ? err.message : t('common.error'))
    }
    setIsCloning(null)
  }

  const handleLink = async () => {
    try {
      const result = await electron.repos.link('')
      if ('cancelled' in result) {
        onClose()
        return
      }
      const repos = await electron.repos.list()
      const added = repos.find((r) => r.localPath === result.localPath)
      if (added) onAdded(added)
    } catch {
      onClose()
    }
  }

  // For "add existing" mode, don't show dialog — folder picker was opened directly
  if (mode === 'add') return <></>

  const filtered = ghRepos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle className="text-[15px]">{t('workspace.repo_dialog.clone_title', 'Clone a Repository')}</DialogTitle>
          <DialogDescription className="text-[13px]">
            {t('workspace.repo_dialog.clone_desc', 'Choose a repository from your GitHub account to clone')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('workspace.repo_dialog.filter_placeholder', 'Filter repositories...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-2 py-2 text-[13px] bg-muted rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <ScrollArea className="h-[320px] border-t border-border">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-[13px] text-muted-foreground">
              {t('common.no_results', 'No repositories found')}
            </div>
          ) : (
            filtered.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors border-b border-border last:border-b-0"
              >
                <OwnerAvatar owner={r.owner.login} size={28} className="h-7 w-7 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {r.owner.login} {r.description ? `- ${r.description}` : ''}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] shrink-0"
                  onClick={() => handleClone(r)}
                  disabled={isCloning !== null}
                >
                  {isCloning === r.full_name
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : t('workspace.repo_dialog.clone_btn', 'Clone')
                  }
                </Button>
              </div>
            ))
          )}
        </ScrollArea>

        <div className="border-t border-border px-4 py-3">
          <Button variant="outline" className="w-full h-9 text-[13px] gap-2" onClick={handleLink}>
            <FolderOpen className="h-4 w-4" />
            {t('workspace.repo_dialog.add_local_btn', 'Add Local Repository...')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type Tab = 'changes' | 'history' | 'pipelines' | 'runs'
