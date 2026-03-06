import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GitCommit, Loader2, RotateCcw, GitMerge, Copy, MoreHorizontal, ChevronDown,
  Search, FileText
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
import { cn, formatRelativeTime } from '@/lib/utils'
import { notify } from '@/lib/notify'
import { useRepoDetail } from './RepoDetail'
import type { GitCommit as GitCommitType } from '@shared/types'

const LOAD_SIZE = 50

// Group commits by date (e.g. "Today", "Yesterday", "Mar 4, 2026")
function groupCommitsByDate(commits: GitCommitType[]): { label: string; dateKey: string; commits: GitCommitType[] }[] {
  const groups: Map<string, GitCommitType[]> = new Map()
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()

  for (const commit of commits) {
    const d = new Date(commit.date)
    const ds = d.toDateString()
    let key: string
    if (ds === today) key = 'today'
    else if (ds === yesterday) key = 'yesterday'
    else key = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    const arr = groups.get(key) ?? []
    arr.push(commit)
    groups.set(key, arr)
  }

  return Array.from(groups.entries()).map(([label, commits]) => ({
    label,
    dateKey: label,
    commits
  }))
}

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
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedSha, setSelectedSha] = useState<string | null>(null)
  const [commitDiff, setCommitDiff] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

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

  const handleSelectCommit = async (sha: string) => {
    if (selectedSha === sha) {
      setSelectedSha(null)
      setCommitDiff(null)
      return
    }
    setSelectedSha(sha)
    setDiffLoading(true)
    try {
      const diff = await electron.git.showCommit(repoId, sha)
      setCommitDiff(diff)
    } catch {
      setCommitDiff(null)
    } finally {
      setDiffLoading(false)
    }
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
      notify('success', t('workspace.history.sha_copied', 'SHA copied to clipboard'), sha.slice(0, 7))
    }).catch(() => {})
  }

  const filteredCommits = useMemo(() => {
    if (!searchTerm.trim()) return commits
    const q = searchTerm.toLowerCase()
    return commits.filter((c) =>
      c.message.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.hash.startsWith(q)
    )
  }, [commits, searchTerm])

  const grouped = useMemo(() => groupCommitsByDate(filteredCommits), [filteredCommits])

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

  const dateLabel = (key: string) => {
    if (key === 'today') return t('common.time.today', 'Today')
    if (key === 'yesterday') return 'Yesterday'
    return key
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-2.5 border-b border-border bg-card/20 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 max-w-[280px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('workspace.history.search_placeholder', 'Search commits...')}
              className="w-full h-7 pl-8 pr-3 rounded-md border border-border bg-muted/30 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/40 focus:border-ring/40"
            />
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
            {filteredCommits.length > 0
              ? t('workspace.history.commits_loaded_count', { count: filteredCommits.length, defaultValue: '{{count}} commits loaded' })
              : t('workspace.history.commit_history_label', 'Commit history')}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[12px] px-2.5 gap-1.5 shrink-0"
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
        ) : filteredCommits.length === 0 ? (
          <EmptyState
            icon={GitCommit}
            title={searchTerm ? t('common.no_results', 'No results found') : t('workspace.history.no_commits_found', 'No commits found')}
            description={searchTerm ? `No commits matching "${searchTerm}"` : t('workspace.history.empty_history_desc', 'The repository history is empty')}
          />
        ) : (
          <>
            {grouped.map((group) => (
              <div key={group.dateKey}>
                {/* Date header */}
                <div className="sticky top-0 z-10 px-5 py-1.5 bg-background/95 backdrop-blur-sm border-b border-border/50">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {dateLabel(group.dateKey)}
                  </span>
                </div>

                {/* Commits with timeline */}
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-[31px] top-0 bottom-0 w-px bg-border" />

                  {group.commits.map((commit, idx) => {
                    const isPending = actionInProgress === commit.hash
                    const isSelected = selectedSha === commit.hash
                    const isLast = idx === group.commits.length - 1
                    // Extract initials from author
                    const initials = commit.author
                      .split(/[\s.]+/)
                      .slice(0, 2)
                      .map((p) => p[0]?.toUpperCase() ?? '')
                      .join('')

                    return (
                      <div key={commit.hash}>
                        <div
                          className={cn(
                            'relative flex items-start gap-3 px-5 py-2.5 group transition-colors cursor-pointer',
                            isSelected ? 'bg-primary/5' : 'hover:bg-accent/30'
                          )}
                          onClick={() => handleSelectCommit(commit.hash)}
                        >
                          {/* Timeline dot */}
                          <div className="relative z-10 mt-0.5 shrink-0">
                            <div className={cn(
                              'w-[14px] h-[14px] rounded-full border-2 flex items-center justify-center',
                              isSelected
                                ? 'border-primary bg-primary'
                                : 'border-border bg-background group-hover:border-muted-foreground/50'
                            )}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-background" />}
                            </div>
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1 py-0.5">
                            <p className={cn(
                              'text-[13px] font-medium leading-snug line-clamp-2 break-words',
                              isSelected ? 'text-foreground' : 'text-foreground/90'
                            )}>
                              {commit.message.split('\n')[0]}
                            </p>
                            <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-muted-foreground">
                              {/* Author avatar */}
                              <div className="flex items-center gap-1.5">
                                <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[8px] font-bold text-muted-foreground shrink-0">
                                  {initials}
                                </div>
                                <span className="font-medium text-foreground/70">{commit.author}</span>
                              </div>
                              <span className="text-muted-foreground/50">{formatRelativeTime(commit.date)}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCopySha(commit.hash) }}
                                className="font-mono text-primary/60 hover:text-primary bg-primary/5 hover:bg-primary/10 px-1.5 py-0.5 rounded text-[10px] transition-colors"
                                title={t('workspace.history.copy_sha_tooltip', 'Copy full commit hash')}
                              >
                                {commit.hash.slice(0, 7)}
                              </button>
                            </div>
                          </div>

                          {/* Actions */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 mt-0.5"
                                disabled={isPending}
                                onClick={(e) => e.stopPropagation()}
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

                        {/* Expanded diff panel */}
                        {isSelected && (
                          <div className="ml-[43px] mr-5 mb-2 rounded-md border border-border bg-card/50 overflow-hidden">
                            {diffLoading ? (
                              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-[12px]">{t('workspace.history.loading_changes', 'Loading changes...')}</span>
                              </div>
                            ) : commitDiff ? (
                              <div className="max-h-[300px] overflow-auto">
                                <DiffBlock diff={commitDiff} />
                              </div>
                            ) : (
                              <div className="py-4 text-center text-[12px] text-muted-foreground">
                                {t('workspace.history.no_diff', 'No diff available for this commit.')}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

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

// ─── Diff block component ────────────────────────────────────────────────────
function DiffBlock({ diff }: { diff: string }): JSX.Element {
  const lines = diff.split('\n')
  // Count changed files from "diff --git" headers
  const fileCount = lines.filter((l) => l.startsWith('diff --git')).length

  return (
    <div>
      {fileCount > 0 && (
        <div className="px-3 py-1.5 border-b border-border bg-muted/30 text-[11px] text-muted-foreground flex items-center gap-1.5">
          <FileText className="h-3 w-3" />
          {fileCount} file{fileCount !== 1 ? 's' : ''} changed
        </div>
      )}
      <pre className="text-[11px] leading-[1.6] font-mono overflow-x-auto">
        {lines.slice(0, 200).map((line, i) => {
          let cls = 'px-3 '
          if (line.startsWith('+') && !line.startsWith('+++')) cls += 'bg-[#3fb950]/8 text-[#3fb950]'
          else if (line.startsWith('-') && !line.startsWith('---')) cls += 'bg-[#f85149]/8 text-[#f85149]'
          else if (line.startsWith('@@')) cls += 'text-[#58a6ff] bg-[#58a6ff]/5'
          else if (line.startsWith('diff --git')) cls += 'text-foreground/80 font-semibold border-t border-border/30 pt-1 mt-1'
          else cls += 'text-muted-foreground/70'
          return (
            <div key={i} className={cls}>
              {line || ' '}
            </div>
          )
        })}
        {lines.length > 200 && (
          <div className="px-3 py-2 text-muted-foreground/50 text-center border-t border-border/30">
            ... {lines.length - 200} more lines
          </div>
        )}
      </pre>
    </div>
  )
}
