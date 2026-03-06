import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Loader2, RefreshCw, ExternalLink,
  CheckCircle2, XCircle, AlertCircle, Circle,
  GitBranch, GitCommit, Clock, ChevronDown, ChevronRight,
  CircleDot, Inbox, Search, Filter, Timer
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRunsStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusIcon } from '@/components/shared/StatusIcon'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils'
import { RunDetailModal } from '@/components/RunDetailModal'
import { useRepoDetail } from './RepoDetail'
import type { Run, RunStatus, GitHubRun } from '@shared/types'

// ─── Types ───────────────────────────────────────────────────────────────────
type SourceFilter = 'all' | 'orbit' | 'github'
type StatusFilter = 'all' | 'success' | 'failure' | 'running' | 'cancelled'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ghStatusToLocal(status: string | null, conclusion: string | null): RunStatus {
  if (status === 'in_progress' || status === 'queued') return 'running'
  if (conclusion === 'success') return 'success'
  if (conclusion === 'failure') return 'failure'
  if (conclusion === 'cancelled') return 'cancelled'
  return 'pending'
}

type UnifiedRun =
  | { source: 'orbit'; run: Run; createdAt: string }
  | { source: 'github'; run: GitHubRun; createdAt: string }

// Group runs by date
function groupRunsByDate(items: UnifiedRun[]): { label: string; dateKey: string; runs: UnifiedRun[] }[] {
  const groups: Map<string, UnifiedRun[]> = new Map()
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()

  for (const item of items) {
    const d = new Date(item.createdAt)
    const ds = d.toDateString()
    let key: string
    if (ds === today) key = 'today'
    else if (ds === yesterday) key = 'yesterday'
    else key = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    const arr = groups.get(key) ?? []
    arr.push(item)
    groups.set(key, arr)
  }

  return Array.from(groups.entries()).map(([label, runs]) => ({
    label,
    dateKey: label,
    runs
  }))
}

// ─── Filter pill ─────────────────────────────────────────────────────────────
function FilterPill({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5',
        active
          ? 'bg-primary/15 text-primary border border-primary/30'
          : 'bg-muted/50 text-muted-foreground border border-transparent hover:bg-muted hover:text-foreground'
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={cn(
          'text-[9px] tabular-nums rounded-full px-1.5 py-0.5 min-w-[18px] text-center',
          active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground/70'
        )}>
          {count}
        </span>
      )}
    </button>
  )
}

// ─── GitHub run visual helpers ───────────────────────────────────────────────
function ghRunVisual(run: GitHubRun, t: ReturnType<typeof useTranslation>['t']): { icon: JSX.Element; badge: string; badgeCls: string } {
  if (run.status === 'in_progress') {
    return {
      icon: <Loader2 className="h-4 w-4 text-[#58a6ff] animate-spin shrink-0" />,
      badge: t('workspace.status.running', 'running'),
      badgeCls: 'text-[#58a6ff] border-[#58a6ff]/25 bg-[#58a6ff]/10'
    }
  }
  if (run.status !== 'completed') {
    return {
      icon: <Circle className="h-4 w-4 text-muted-foreground shrink-0" />,
      badge: t('workspace.status.pending', 'pending'),
      badgeCls: 'text-muted-foreground border-border bg-muted/50'
    }
  }
  switch (run.conclusion) {
    case 'success':
      return { icon: <CheckCircle2 className="h-4 w-4 text-[#3fb950] shrink-0" />, badge: t('workspace.status.success', 'success'), badgeCls: 'text-[#3fb950] border-[#3fb950]/25 bg-[#3fb950]/10' }
    case 'failure':
      return { icon: <XCircle className="h-4 w-4 text-[#f85149] shrink-0" />, badge: t('workspace.status.failed', 'failed'), badgeCls: 'text-[#f85149] border-[#f85149]/25 bg-[#f85149]/10' }
    case 'cancelled':
      return { icon: <AlertCircle className="h-4 w-4 text-[#d29922] shrink-0" />, badge: t('workspace.status.cancelled', 'cancelled'), badgeCls: 'text-[#d29922] border-[#d29922]/25 bg-[#d29922]/10' }
    case 'timed_out':
      return { icon: <XCircle className="h-4 w-4 text-[#f85149] shrink-0" />, badge: t('workspace.status.timed_out', 'timed out'), badgeCls: 'text-[#f85149] border-[#f85149]/25 bg-[#f85149]/10' }
    case 'skipped':
      return { icon: <Circle className="h-4 w-4 text-muted-foreground shrink-0" />, badge: t('workspace.status.skipped', 'skipped'), badgeCls: 'text-muted-foreground border-border bg-muted/50' }
    default:
      return { icon: <Circle className="h-4 w-4 text-muted-foreground shrink-0" />, badge: run.conclusion ?? t('workspace.status.neutral', 'neutral'), badgeCls: 'text-muted-foreground border-border bg-muted/50' }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
export function RepoActions(): JSX.Element {
  const { t } = useTranslation()
  const { repoId } = useRepoDetail()
  const navigate = useNavigate()
  const { runs, setRuns } = useRunsStore()

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')

  const [ghRuns, setGhRuns] = useState<GitHubRun[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [ghPage, setGhPage] = useState(1)
  const [ghHasMore, setGhHasMore] = useState(true)

  const [detailRun, setDetailRun] = useState<{ source: 'orbit' | 'github'; run: Run | GitHubRun } | null>(null)

  // ── Load data ────────────────────────────────────────────────────────────
  const loadOrbitRuns = useCallback(async () => {
    try {
      const list = await electron.runs.list({ repoId, limit: 100 })
      setRuns(list)
    } catch { /* ignored */ }
  }, [repoId, setRuns])

  const loadGhRuns = useCallback(async (reset = true) => {
    const nextPage = reset ? 1 : ghPage + 1
    if (!reset && !ghHasMore) return
    setIsLoading(true)
    try {
      const list = await electron.runs.listGitHub(repoId, 30, nextPage)
      setGhRuns((prev) => (reset ? list : [...prev, ...list]))
      setGhPage(reset ? 1 : nextPage)
      setGhHasMore(list.length === 30)
    } catch { /* GitHub API unavailable */ } finally {
      setIsLoading(false)
    }
  }, [repoId, ghPage, ghHasMore])

  useEffect(() => {
    if (!repoId) return
    loadOrbitRuns()
    loadGhRuns(true)
  }, [repoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setIsLoading(true)
    await Promise.all([loadOrbitRuns(), loadGhRuns(true)])
    setIsLoading(false)
  }

  // ── Merge & filter ───────────────────────────────────────────────────────
  const repoOrbitRuns = useMemo(() => runs.filter((r) => r.repoId === repoId), [runs, repoId])

  const unifiedRuns = useMemo(() => {
    const items: UnifiedRun[] = []
    const q = searchTerm.toLowerCase()

    if (sourceFilter !== 'github') {
      for (const run of repoOrbitRuns) {
        if (statusFilter !== 'all' && run.status !== statusFilter) continue
        if (q && !(run.workflowName ?? run.workflowFile).toLowerCase().includes(q) && !(run.gitBranch ?? '').toLowerCase().includes(q)) continue
        items.push({ source: 'orbit', run, createdAt: run.createdAt })
      }
    }

    if (sourceFilter !== 'orbit') {
      for (const run of ghRuns) {
        const mapped = ghStatusToLocal(run.status, run.conclusion)
        if (statusFilter !== 'all' && mapped !== statusFilter) continue
        if (q && !run.displayTitle.toLowerCase().includes(q) && !(run.headBranch ?? '').toLowerCase().includes(q)) continue
        items.push({ source: 'github', run, createdAt: run.createdAt })
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return items
  }, [repoOrbitRuns, ghRuns, sourceFilter, statusFilter, searchTerm])

  const grouped = useMemo(() => groupRunsByDate(unifiedRuns), [unifiedRuns])

  // Counts for filter pills
  const orbitCount = repoOrbitRuns.length
  const ghCount = ghRuns.length

  const statusCounts = useMemo(() => {
    const all = [
      ...repoOrbitRuns.map((r) => r.status),
      ...ghRuns.map((r) => ghStatusToLocal(r.status, r.conclusion))
    ]
    return {
      success: all.filter((s) => s === 'success').length,
      failure: all.filter((s) => s === 'failure').length,
      running: all.filter((s) => s === 'running').length,
      cancelled: all.filter((s) => s === 'cancelled').length
    }
  }, [repoOrbitRuns, ghRuns])

  const dateLabel = (key: string) => {
    if (key === 'today') return t('common.time.today', 'Today')
    if (key === 'yesterday') return 'Yesterday'
    return key
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="px-5 py-2.5 border-b border-border bg-card/20 space-y-2.5 shrink-0">
        {/* Top row: search + refresh */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-[280px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('workspace.runs.search_placeholder', 'Search runs...')}
              className="w-full h-7 pl-8 pr-3 rounded-md border border-border bg-muted/30 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/40 focus:border-ring/40"
            />
          </div>
          <div className="flex-1" />
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {orbitCount > 0 && <span className="text-[#8b5cf6] font-medium">{orbitCount}</span>}
            {orbitCount > 0 && ghCount > 0 && <span className="mx-1 text-border">/</span>}
            {ghCount > 0 && <span className="font-medium">{ghCount}</span>}
            <span className="ml-1">{t('dashboard.chart.runs', 'runs')}</span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px] px-2.5 gap-1.5 shrink-0"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>

        {/* Bottom row: filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterPill label={t('workspace.status.all', 'All')} active={sourceFilter === 'all'} onClick={() => setSourceFilter('all')} />
          <FilterPill label="OrbitCI" active={sourceFilter === 'orbit'} onClick={() => setSourceFilter('orbit')} count={orbitCount} />
          <FilterPill label="GitHub Actions" active={sourceFilter === 'github'} onClick={() => setSourceFilter('github')} count={ghCount} />

          <div className="w-px h-5 bg-border mx-0.5" />

          <FilterPill label={t('workspace.status.success', 'Success')} active={statusFilter === 'success'} onClick={() => setStatusFilter(statusFilter === 'success' ? 'all' : 'success')} count={statusCounts.success} />
          <FilterPill label={t('workspace.status.failure', 'Failure')} active={statusFilter === 'failure'} onClick={() => setStatusFilter(statusFilter === 'failure' ? 'all' : 'failure')} count={statusCounts.failure} />
          <FilterPill label={t('workspace.status.running', 'Running')} active={statusFilter === 'running'} onClick={() => setStatusFilter(statusFilter === 'running' ? 'all' : 'running')} count={statusCounts.running} />
          <FilterPill label={t('workspace.status.cancelled', 'Cancelled')} active={statusFilter === 'cancelled'} onClick={() => setStatusFilter(statusFilter === 'cancelled' ? 'all' : 'cancelled')} count={statusCounts.cancelled} />

          {(statusFilter !== 'all' || sourceFilter !== 'all' || searchTerm) && (
            <>
              <div className="w-px h-5 bg-border mx-0.5" />
              <button
                onClick={() => { setStatusFilter('all'); setSourceFilter('all'); setSearchTerm('') }}
                className="px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                {t('common.clear', 'Clear')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        {isLoading && unifiedRuns.length === 0 ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[13px]">{t('workspace.runs.loading_runs', 'Loading runs...')}</span>
          </div>
        ) : unifiedRuns.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t('workspace.runs.no_runs_found', 'No runs found')}
            description={searchTerm
              ? `No runs matching "${searchTerm}"`
              : t('workspace.runs.filter_no_results', 'Adjust filters or run a workflow')}
            action={{ label: t('common.refresh', 'Refresh'), onClick: handleRefresh }}
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

                <div className="divide-y divide-border/50">
                  {group.runs.map((item) =>
                    item.source === 'orbit' ? (
                      <OrbitRunRow
                        key={`orbit-${item.run.id}`}
                        run={item.run as Run}
                        onClick={() => setDetailRun({ source: 'orbit', run: item.run })}
                      />
                    ) : (
                      <GhRunRow
                        key={`gh-${(item.run as GitHubRun).id}`}
                        run={item.run as GitHubRun}
                        onClick={() => setDetailRun({ source: 'github', run: item.run })}
                      />
                    )
                  )}
                </div>
              </div>
            ))}

            {/* Load more (GitHub) */}
            {sourceFilter !== 'orbit' && ghHasMore && (
              <div className="flex items-center justify-center py-4 border-t border-border/30">
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[12px] px-4 gap-1.5"
                    onClick={() => loadGhRuns(false)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    {t('common.load_more', 'Load more')}
                  </Button>
                )}
              </div>
            )}

            {/* Footer count */}
            <div className="text-center py-3 text-[11px] text-muted-foreground/50">
              {t('workspace.runs.runs_displayed_count', { count: unifiedRuns.length, defaultValue: '{{count}} executions displayed' })}
            </div>
          </>
        )}
      </div>

      {/* Run detail modal */}
      <RunDetailModal
        open={detailRun !== null}
        onClose={() => setDetailRun(null)}
        source={detailRun?.source ?? 'orbit'}
        run={detailRun?.run ?? null}
        repoId={repoId}
      />
    </div>
  )
}

// ─── OrbitCI Run row ──────────────────────────────────────────────────────────
function OrbitRunRow({ run, onClick }: { run: Run; onClick: () => void }): JSX.Element {
  return (
    <div
      className="flex items-center gap-3 px-5 py-3 cursor-pointer group hover:bg-accent/30 transition-colors"
      onClick={onClick}
    >
      <StatusIcon status={run.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="font-medium text-[13px] text-foreground min-w-0 flex-1 leading-snug line-clamp-2 break-words">
            {run.workflowName ?? run.workflowFile}
          </p>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <StatusBadge status={run.status} />
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#8b5cf6]/10 text-[#8b5cf6] font-medium">Orbit</span>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(run.createdAt)}
          </span>
          {run.durationMs != null && (
            <span className="flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {formatDuration(run.durationMs)}
            </span>
          )}
          {run.gitBranch && (
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              <span className="max-w-[140px] truncate">{run.gitBranch}</span>
            </span>
          )}
          {run.gitSha && (
            <span className="flex items-center gap-1 font-mono text-[10px]">
              <GitCommit className="h-3 w-3" />
              {run.gitSha.slice(0, 7)}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0 group-hover:text-muted-foreground transition-colors" />
    </div>
  )
}

// ─── GitHub Actions Run row ──────────────────────────────────────────────────
function GhRunRow({ run, onClick }: { run: GitHubRun; onClick: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { icon, badge, badgeCls } = ghRunVisual(run, t)
  const workflowFile = run.workflowPath.split('/').pop() ?? run.workflowPath

  return (
    <div
      className="flex items-center gap-3 px-5 py-3 cursor-pointer group hover:bg-accent/30 transition-colors"
      onClick={onClick}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="font-medium text-[13px] text-foreground min-w-0 flex-1 leading-snug line-clamp-2 break-words">
            {run.displayTitle}
          </p>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <Badge variant="outline" className={cn('text-[10px] font-medium py-0 h-[18px]', badgeCls)}>
              {badge}
            </Badge>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-muted-foreground font-medium">GitHub</span>
            <span className="text-[11px] text-muted-foreground/60">#{run.runNumber}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(run.createdAt)}
          </span>
          <span className="font-mono text-muted-foreground/50 text-[10px]">{workflowFile}</span>
          {run.headBranch && (
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              <span className="max-w-[140px] truncate">{run.headBranch}</span>
            </span>
          )}
          <span className="flex items-center gap-1 font-mono text-[10px]">
            <GitCommit className="h-3 w-3" />
            {run.headSha.slice(0, 7)}
          </span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground/60">
            {run.event}
          </Badge>
          {run.actor && (
            <span className="flex items-center gap-1">
              <img src={run.actor.avatarUrl} alt={run.actor.login} className="w-3.5 h-3.5 rounded-full" />
              <span className="text-[10px]">{run.actor.login}</span>
            </span>
          )}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); electron.shell.openExternal(run.htmlUrl) }}
        className="shrink-0 h-7 w-7 flex items-center justify-center rounded hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
        title={t('common.view_github', 'View on GitHub')}
      >
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}
