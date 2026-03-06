import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GitCommit, Loader2, RotateCcw, GitMerge, Copy, MoreHorizontal, ChevronDown
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { formatRelativeTime } from '@/lib/utils'
import { notify } from '@/lib/notify'
import { useRepoDetail } from './RepoDetail'
import type { GitCommit as GitCommitType } from '@shared/types'

const LOAD_SIZE = 50

export function RepoHistory(): JSX.Element {
  const { t } = useTranslation()
  const { repoId, refreshGitStatus } = useRepoDetail()
  const { repos } = useRepoStore()
  const repo = repos.find((r) => r.id === repoId)

  const [commits, setCommits] = useState<GitCommitType[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [limit, setLimit] = useState(LOAD_SIZE)
  const [hasMore, setHasMore] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [confirmRevert, setConfirmRevert] = useState<{ sha: string; message: string } | null>(null)
  const [confirmCherryPick, setConfirmCherryPick] = useState<{ sha: string; message: string } | null>(null)

  useEffect(() => {
    if (!repoId || !repo?.localPath) return
    loadCommits(LOAD_SIZE, true)
  }, [repoId, repo?.localPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadCommits = async (count: number, reset = false) => {
    setIsLoading(true)
    try {
      const result = await electron.git.log(repoId, count)
      setCommits(reset ? result : result)
      setHasMore(result.length === count)
      setLimit(count)
    } catch { /* git unavailable */ } finally {
      setIsLoading(false)
    }
  }

  const handleLoadMore = () => {
    const next = limit + LOAD_SIZE
    loadCommits(next)
  }

  const executeRevert = async () => {
    if (!confirmRevert) return
    const { sha } = confirmRevert
    setActionInProgress(sha)
    try {
      await electron.git.revert(repoId, sha)
      notify('success', t('workspace.history.revert_success_title', 'Revert complete'), t('workspace.history.revert_success_desc', { sha: sha.slice(0, 7), defaultValue: 'Commit {{sha}} reverted' }))
      await loadCommits(limit, true)
      await refreshGitStatus()
    } catch (err: unknown) {
      notify('failure', t('workspace.history.revert_error_title', 'Error reverting'), err instanceof Error ? err.message : t('common.error', 'Error'))
    } finally {
      setActionInProgress(null)
    }
  }

  const executeCherryPick = async () => {
    if (!confirmCherryPick) return
    const { sha } = confirmCherryPick
    setActionInProgress(sha)
    try {
      await electron.git.cherryPick(repoId, sha)
      notify('success', t('workspace.history.cherry_pick_success_title', 'Cherry-pick complete'), t('workspace.history.cherry_pick_success_desc', { sha: sha.slice(0, 7), defaultValue: 'Commit {{sha}} applied' }))
      await loadCommits(limit, true)
      await refreshGitStatus()
    } catch (err: unknown) {
      notify('failure', t('workspace.history.cherry_pick_error_title', 'Error in cherry-pick'), err instanceof Error ? err.message : t('common.error', 'Error'))
    } finally {
      setActionInProgress(null)
    }
  }

  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha).then(() => {
      notify('success', t('workspace.changes.path_copied', 'SHA copied'), sha)
    }).catch(() => {})
  }

  if (!repo?.localPath) {
    return (
      <EmptyState
        icon={GitCommit}
        title={t('workspace.repos.no_local_folder', 'No local folder')}
        description={t('workspace.repos.no_local_folder_desc_history', 'Link a local folder to the repository to see commit history')}
        className="h-full"
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-6 py-2.5 border-b border-border bg-card/20 flex items-center justify-between shrink-0">
        <span className="text-[12px] text-muted-foreground">
          {commits.length > 0
            ? t('workspace.history.commits_loaded_count', { count: commits.length, defaultValue: '{{count}} commits loaded' })
            : t('workspace.history.commit_history_label', 'Commit history')}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[12px] px-2.5 gap-1.5"
          onClick={() => loadCommits(limit, true)}
          disabled={isLoading}
        >
          <Loader2 className={isLoading ? 'h-3 w-3 animate-spin' : 'hidden'} />
          {t('common.refresh', 'Refresh')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {isLoading && commits.length === 0 ? (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[13px]">{t('workspace.history.loading_history', 'Loading history...')}</span>
          </div>
        ) : commits.length === 0 ? (
          <EmptyState
            icon={GitCommit}
            title={t('workspace.history.no_commits_found', 'No commits found')}
            description={t('workspace.history.empty_history_desc', 'The repository history is empty')}
          />
        ) : (
          <>
            <div className="divide-y divide-border">
              {commits.map((commit) => {
                const isPending = actionInProgress === commit.hash
                return (
                  <div key={commit.hash} className="flex items-start gap-3 px-5 py-3 group hover:bg-accent/20 transition-colors">
                    {/* Visual commit line */}
                    <div className="flex flex-col items-center mt-1 shrink-0">
                      <GitCommit className="h-3.5 w-3.5 text-primary/50" />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground leading-snug line-clamp-2">
                        {commit.message}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                        <code className="font-mono text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded text-[10px]">
                          {commit.hash.slice(0, 7)}
                        </code>
                        <span>{commit.author}</span>
                        <span>{formatRelativeTime(commit.date)}</span>
                      </div>
                    </div>

                    {/* Actions dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          disabled={isPending}
                        >
                          {isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 text-[13px]">
                        <DropdownMenuItem onClick={() => handleCopySha(commit.hash)}>
                          <Copy className="h-3.5 w-3.5 mr-2" />
                          {t('workspace.history.copy_sha', 'Copy SHA')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setConfirmCherryPick({ sha: commit.hash, message: commit.message })}>
                          <GitMerge className="h-3.5 w-3.5 mr-2" />
                          {t('workspace.history.cherry_pick', 'Cherry-pick')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setConfirmRevert({ sha: commit.hash, message: commit.message })}
                          className="text-destructive focus:text-destructive"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-2" />
                          {t('workspace.history.revert', 'Revert')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
            </div>

            {/* Load more footer */}
            <div className="flex items-center justify-center py-4 border-t border-border/30">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : hasMore ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[12px] px-4 gap-1.5"
                  onClick={handleLoadMore}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  {t('common.load_more', 'Load more')}
                </Button>
              ) : (
                <span className="text-[11px] text-muted-foreground/50">
                  {t('workspace.history.total_commits_count', { count: commits.length, defaultValue: '{{count}} commits in total' })}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmRevert !== null}
        onOpenChange={(open) => { if (!open) setConfirmRevert(null) }}
        title={t('workspace.history.revert_title', 'Revert commit')}
        description={t('workspace.history.revert_desc', { message: confirmRevert?.message?.slice(0, 60), defaultValue: 'A new commit will be created that undoes the changes from "{{message}}".' })}
        consequences={[
          t('workspace.history.revert_cons1', 'A new revert commit will be added to history'),
          t('workspace.history.revert_cons2', 'If there are conflicts, you will need to resolve them manually'),
          t('workspace.history.revert_cons3', 'Changes from original commit will be undone in current branch')
        ]}
        confirmLabel={t('workspace.history.revert', 'Revert')}
        variant="warning"
        onConfirm={executeRevert}
      />

      <ConfirmDialog
        open={confirmCherryPick !== null}
        onOpenChange={(open) => { if (!open) setConfirmCherryPick(null) }}
        title={t('workspace.history.cherry_pick_title', 'Cherry-pick commit')}
        description={t('workspace.history.cherry_pick_desc', { message: confirmCherryPick?.message?.slice(0, 60), defaultValue: 'Changes from commit "{{message}}" will be applied to current branch.' })}
        consequences={[
          t('workspace.history.cherry_pick_cons1', 'A new commit will be created in current branch with the same changes'),
          t('workspace.history.cherry_pick_cons2', 'If there are conflicts, you will need to resolve them manually'),
          t('workspace.history.cherry_pick_cons3', 'Original commit remains unchanged in origin branch')
        ]}
        confirmLabel={t('workspace.history.apply_btn', 'Apply')}
        variant="warning"
        onConfirm={executeCherryPick}
      />
    </div>
  )
}
