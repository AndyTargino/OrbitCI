import { useEffect, useState } from 'react'
import { useParams, useNavigate, Outlet, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  RefreshCw, GitBranch, MoreHorizontal, FolderOpen,
  ExternalLink, Unlink, ArrowDownToLine, ArrowUpFromLine,
  GitCommit, Github
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore, useRunsStore } from '@/store'
import { useGlobalEvents } from '@/hooks/useSync'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { OwnerAvatar } from '@/components/shared/OwnerAvatar'
import { BranchSelector } from '@/components/shared/BranchSelector'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/notify'
import type { GitStatus, GitBranch as GitBranchType } from '@shared/types'

// ── Context so children can read git status without re-fetching ───────────────
import { createContext, useContext } from 'react'

export interface RepoDetailContext {
  repoId: string
  gitStatus: GitStatus | null
  refreshGitStatus: () => Promise<void>
}

export const RepoDetailCtx = createContext<RepoDetailContext>({
  repoId: '',
  gitStatus: null,
  refreshGitStatus: async () => {}
})

export function useRepoDetail(): RepoDetailContext {
  return useContext(RepoDetailCtx)
}

// ── Sub-nav link ──────────────────────────────────────────────────────────────
function NavTab({
  to,
  label,
  badge
}: {
  to: string
  label: string
  badge?: number
}): JSX.Element {
  return (
    <NavLink
      to={to}
      end={to.endsWith('overview')}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-1.5 px-4 py-2.5 text-[13px] border-b-2 transition-colors whitespace-nowrap',
          isActive
            ? 'border-primary text-foreground font-medium'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        )
      }
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <Badge variant="secondary" className="text-[10px] px-1.5 h-4 ml-0.5">
          {badge}
        </Badge>
      )}
    </NavLink>
  )
}

// ── Main shell ────────────────────────────────────────────────────────────────
export function RepoDetail(): JSX.Element {
  const { t } = useTranslation()
  const { repoId } = useParams<{ repoId: string }>()
  const navigate = useNavigate()
  const decodedId = decodeURIComponent(repoId ?? '')
  const { repos, syncEvents } = useRepoStore()
  const { runs } = useRunsStore()
  const repo = repos.find((r) => r.id === decodedId)

  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranchType[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)

  useGlobalEvents()

  useEffect(() => {
    if (!decodedId || !repo?.localPath) return
    refreshGitStatus()
    electron.git.branches(decodedId).then(setBranches).catch(() => {})
  }, [decodedId, repo?.localPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshGitStatus = async () => {
    if (!repo?.localPath) return
    try {
      const status = await electron.git.status(decodedId)
      setGitStatus(status)
    } catch { /* git not available */ }
  }

  const handleFetch = async () => {
    setIsFetching(true)
    try {
      await electron.git.fetch(decodedId)
      await refreshGitStatus()
      notify('success', t('workspace.notifications.fetch_success', 'Fetch complete'), t('workspace.git.fetch_success_desc', 'Remote references updated'))
    } catch (err: unknown) {
      notify('failure', t('common.error', 'Error'), err instanceof Error ? err.message : t('common.error_unknown', 'Unknown error'))
    } finally { setIsFetching(false) }
  }

  const handlePull = async () => {
    setIsPulling(true)
    try {
      await electron.git.pull(decodedId)
      await refreshGitStatus()
      notify('success', t('workspace.notifications.pull_success', 'Pull complete'), t('workspace.git.pull_success_desc', 'Branch updated from remote'))
    } catch (err: unknown) {
      notify('failure', t('common.error', 'Error'), err instanceof Error ? err.message : t('common.error_unknown', 'Unknown error'))
    } finally { setIsPulling(false) }
  }

  const handlePush = async () => {
    setIsPushing(true)
    try {
      await electron.git.push(decodedId)
      await refreshGitStatus()
      notify('success', t('workspace.notifications.push_success', 'Push complete'), t('workspace.git.push_success_desc', 'Commits sent to remote'))
    } catch (err: unknown) {
      notify('failure', t('common.error', 'Error'), err instanceof Error ? err.message : t('common.error_unknown', 'Unknown error'))
    } finally { setIsPushing(false) }
  }

  const handleCheckout = async (branch: string) => {
    try {
      await electron.git.checkout(decodedId, branch)
      await refreshGitStatus()
      const updated = await electron.git.branches(decodedId)
      setBranches(updated)
    } catch (err: unknown) {
      notify('failure', t('workspace.notifications.checkout_failed', 'Checkout failed'), err instanceof Error ? err.message : t('common.error', 'Error'))
    }
  }

  const executeUnlink = async () => {
    try {
      const updated = await electron.repos.update(decodedId, { localPath: null })
      useRepoStore.getState().updateRepo(decodedId, updated)
      notify('success', t('workspace.repos.unlinked_success_title', 'Folder unlinked'), t('workspace.repos.unlinked_success_desc', { name: repo?.fullName, defaultValue: '{{name}} unlinked from local folder' }))
    } catch (err: unknown) {
      notify('failure', t('workspace.repos.unlink_error_title', 'Error unlinking'), err instanceof Error ? err.message : t('common.error', 'Error'))
    }
  }

  const totalChanges = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0

  const repoRuns = runs.filter((r) => r.repoId === decodedId)
  const syncEvent = syncEvents[decodedId]
  const baseUrl = `/repo/${encodeURIComponent(decodedId)}`

  if (!repo) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{t('workspace.repos.not_found', 'Repository not found')}</p>
      </div>
    )
  }

  return (
    <RepoDetailCtx.Provider value={{ repoId: decodedId, gitStatus, refreshGitStatus }}>
      <div className="h-full flex flex-col">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="border-b border-border px-5 py-3 bg-card/30 shrink-0">
          <div className="flex items-center justify-between gap-3">
            {/* Left: avatar + breadcrumb */}
            <div className="flex items-center gap-3 min-w-0">
              <OwnerAvatar owner={repo.owner} className="h-8 w-8 ring-1 ring-border shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-[13px]">
                  <button
                    onClick={() => navigate('/repos')}
                    className="text-muted-foreground hover:text-foreground transition-colors font-medium"
                  >
                    {repo.owner}
                  </button>
                  <span className="text-muted-foreground/40 mx-0.5">/</span>
                  <span className="text-foreground font-semibold">{repo.name}</span>
                </div>
                {syncEvent && (
                  <p className="text-[11px] text-muted-foreground leading-tight">{syncEvent.message}</p>
                )}
              </div>

              {/* Branch selector */}
              {gitStatus && repo.localPath && (
                <BranchSelector
                  branches={branches}
                  current={gitStatus.branch}
                  onSelect={handleCheckout}
                  className="ml-2"
                />
              )}
              {!gitStatus && repo.localPath && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-secondary text-[13px] text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>{repo.defaultBranch}</span>
                </div>
              )}
            </div>

            {/* Right: git actions + dropdown */}
            <div className="flex items-center gap-1.5 shrink-0">
              {repo.localPath && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[12px] px-2.5 gap-1.5"
                    onClick={handleFetch}
                    disabled={isFetching}
                    title={t('workspace.git.fetch', 'Fetch')}
                  >
                    <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
                    {t('workspace.git.fetch', 'Fetch')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[12px] px-2.5 gap-1.5"
                    onClick={handlePull}
                    disabled={isPulling}
                    title={t('workspace.git.pull', 'Pull')}
                  >
                    <ArrowDownToLine className={cn('h-3 w-3', isPulling && 'animate-spin')} />
                    {t('workspace.git.pull', 'Pull')}
                    {gitStatus && gitStatus.behind > 0 && (
                      <span className="text-[#d29922] font-semibold">↓{gitStatus.behind}</span>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[12px] px-2.5 gap-1.5"
                    onClick={handlePush}
                    disabled={isPushing}
                    title={t('workspace.git.push', 'Push')}
                  >
                    <ArrowUpFromLine className={cn('h-3 w-3', isPushing && 'animate-spin')} />
                    {t('workspace.git.push', 'Push')}
                    {gitStatus && gitStatus.ahead > 0 && (
                      <span className="text-[#3fb950] font-semibold">↑{gitStatus.ahead}</span>
                    )}
                  </Button>
                </>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 text-[13px]">
                  {repo.localPath && (
                    <DropdownMenuItem onClick={() => electron.repos.openFolder(repo.localPath!)}>
                      <FolderOpen className="h-3.5 w-3.5 mr-2" />
                      {t('common.open_folder', 'Open folder')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() =>
                      electron.shell.openExternal(`https://github.com/${repo.fullName}`)
                    }
                  >
                    <Github className="h-3.5 w-3.5 mr-2" />
                    {t('common.view_github', 'View on GitHub')}
                  </DropdownMenuItem>
                  {repo.localPath && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setConfirmUnlink(true)} className="text-destructive focus:text-destructive">
                        <Unlink className="h-3.5 w-3.5 mr-2" />
                        {t('workspace.repos.unlink_folder', 'Unlink folder')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* ── Sub-navigation ───────────────────────────────────────────────── */}
        <div className="border-b border-border px-5 bg-card/20 shrink-0 flex items-end overflow-x-auto">
          <NavTab to={`${baseUrl}/overview`} label={t('common.overview', 'Overview')} />
          <NavTab to={`${baseUrl}/changes`} label={t('workspace.sections.changes', 'Changes')} badge={totalChanges} />
          <NavTab to={`${baseUrl}/workflows`} label={t('workspace.sections.workflows', 'Workflows')} />
          <NavTab to={`${baseUrl}/runs`} label={t('workspace.sections.runs', 'Runs')} />
          <NavTab to={`${baseUrl}/history`} label={t('workspace.sections.history', 'History')} />
        </div>

        {/* ── Child page ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden min-h-0">
          <Outlet />
        </div>
      </div>
      <ConfirmDialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title={t('workspace.repos.unlink_title', 'Unlink local folder')}
        description={t('workspace.repos.unlink_desc', { name: repo?.fullName, defaultValue: 'Do you want to unlink the local folder from "{{name}}"?' })}
        consequences={[
          t('workspace.repos.unlink_cons1', 'The repository will remain visible in OrbitCI, but without local access'),
          t('workspace.repos.unlink_cons2', 'No local files will be deleted'),
          t('workspace.repos.unlink_cons3', 'You can link a folder again at any time')
        ]}
        confirmLabel={t('workspace.repos.unlink_btn', 'Unlink')}
        variant="warning"
        onConfirm={executeUnlink}
      />
    </RepoDetailCtx.Provider>
  )
}
