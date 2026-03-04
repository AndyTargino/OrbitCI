import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Github, Loader2, RefreshCw, ExternalLink,
  CheckCircle2, XCircle, AlertCircle, Circle,
  GitBranch, GitCommit, Clock, ChevronDown, ChevronRight,
  CircleDot, Inbox
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

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'Todos', orbit: 'OrbitCI', github: 'GitHub Actions'
}
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Todos', success: 'Sucesso', failure: 'Falha', running: 'Rodando', cancelled: 'Cancelado'
}

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

// ─── Filter pill ─────────────────────────────────────────────────────────────
function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
        active
          ? 'bg-primary/15 text-primary border border-primary/30'
          : 'bg-muted/50 text-muted-foreground border border-transparent hover:bg-muted hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}

// ─── GitHub run visual helpers ───────────────────────────────────────────────
function ghRunVisual(run: GitHubRun): { icon: JSX.Element; badge: string; badgeCls: string } {
  if (run.status === 'in_progress') {
    return {
      icon: <Loader2 className="h-4 w-4 text-[#58a6ff] animate-spin shrink-0" />,
      badge: 'executando',
      badgeCls: 'text-[#58a6ff] border-[#58a6ff]/25 bg-[#58a6ff]/10'
    }
  }
  if (run.status !== 'completed') {
    return {
      icon: <Circle className="h-4 w-4 text-muted-foreground shrink-0" />,
      badge: 'aguardando',
      badgeCls: 'text-muted-foreground border-border bg-muted/50'
    }
  }
  switch (run.conclusion) {
    case 'success':
      return { icon: <CheckCircle2 className="h-4 w-4 text-[#3fb950] shrink-0" />, badge: 'sucesso', badgeCls: 'text-[#3fb950] border-[#3fb950]/25 bg-[#3fb950]/10' }
    case 'failure':
      return { icon: <XCircle className="h-4 w-4 text-[#f85149] shrink-0" />, badge: 'falhou', badgeCls: 'text-[#f85149] border-[#f85149]/25 bg-[#f85149]/10' }
    case 'cancelled':
      return { icon: <AlertCircle className="h-4 w-4 text-[#d29922] shrink-0" />, badge: 'cancelado', badgeCls: 'text-[#d29922] border-[#d29922]/25 bg-[#d29922]/10' }
    case 'timed_out':
      return { icon: <XCircle className="h-4 w-4 text-[#f85149] shrink-0" />, badge: 'timeout', badgeCls: 'text-[#f85149] border-[#f85149]/25 bg-[#f85149]/10' }
    case 'skipped':
      return { icon: <Circle className="h-4 w-4 text-muted-foreground shrink-0" />, badge: 'ignorado', badgeCls: 'text-muted-foreground border-border bg-muted/50' }
    default:
      return { icon: <Circle className="h-4 w-4 text-muted-foreground shrink-0" />, badge: run.conclusion ?? 'neutro', badgeCls: 'text-muted-foreground border-border bg-muted/50' }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
export function RepoActions(): JSX.Element {
  const { repoId } = useRepoDetail()
  const navigate = useNavigate()
  const { runs, setRuns } = useRunsStore()

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

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

    if (sourceFilter !== 'github') {
      for (const run of repoOrbitRuns) {
        if (statusFilter !== 'all' && run.status !== statusFilter) continue
        items.push({ source: 'orbit', run, createdAt: run.createdAt })
      }
    }

    if (sourceFilter !== 'orbit') {
      for (const run of ghRuns) {
        const mapped = ghStatusToLocal(run.status, run.conclusion)
        if (statusFilter !== 'all' && mapped !== statusFilter) continue
        items.push({ source: 'github', run, createdAt: run.createdAt })
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return items
  }, [repoOrbitRuns, ghRuns, sourceFilter, statusFilter])

  const orbitCount = repoOrbitRuns.length
  const ghCount = ghRuns.length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="px-6 py-2.5 border-b border-border bg-card/20 flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Source toggle */}
          {(Object.keys(SOURCE_LABELS) as SourceFilter[]).map((src) => (
            <FilterPill key={src} label={SOURCE_LABELS[src]} active={sourceFilter === src} onClick={() => setSourceFilter(src)} />
          ))}

          <div className="w-px h-5 bg-border mx-1" />

          {/* Status filter */}
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((status) => (
            <FilterPill key={status} label={STATUS_LABELS[status]} active={statusFilter === status} onClick={() => setStatusFilter(status)} />
          ))}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-muted-foreground">
            {orbitCount} orbit · {ghCount} github
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px] px-2.5 gap-1.5"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        {isLoading && unifiedRuns.length === 0 ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[13px]">Carregando runs...</span>
          </div>
        ) : unifiedRuns.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nenhuma execução encontrada"
            description="Ajuste os filtros ou execute um workflow"
            action={{ label: 'Atualizar', onClick: handleRefresh }}
          />
        ) : (
          <>
            <div className="divide-y divide-border">
              {unifiedRuns.map((item) =>
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
                    Carregar mais do GitHub
                  </Button>
                )}
              </div>
            )}

            {/* Footer count */}
            <div className="text-center py-3 text-[11px] text-muted-foreground/50">
              {unifiedRuns.length} execuções exibidas
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
    <div className="gh-row cursor-pointer group" onClick={onClick}>
      <StatusIcon status={run.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[13px] text-foreground truncate">
            {run.workflowName ?? run.workflowFile}
          </span>
          <StatusBadge status={run.status} />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#8b5cf6]/10 text-[#8b5cf6] font-medium shrink-0">Orbit</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
          <span>{formatRelativeTime(run.createdAt)}</span>
          {run.durationMs != null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(run.durationMs)}
            </span>
          )}
          {run.gitBranch && (
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {run.gitBranch}
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
      <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground transition-colors" />
    </div>
  )
}

// ─── GitHub Actions Run row ──────────────────────────────────────────────────
function GhRunRow({ run, onClick }: { run: GitHubRun; onClick: () => void }): JSX.Element {
  const { icon, badge, badgeCls } = ghRunVisual(run)
  const workflowFile = run.workflowPath.split('/').pop() ?? run.workflowPath

  return (
    <div className="gh-row cursor-pointer group" onClick={onClick}>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[13px] text-foreground truncate">
            {run.displayTitle}
          </span>
          <Badge variant="outline" className={cn('text-[11px] font-medium shrink-0', badgeCls)}>
            {badge}
          </Badge>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-muted-foreground font-medium shrink-0">GitHub</span>
          <span className="text-[11px] text-muted-foreground shrink-0">#{run.runNumber}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
          <span className="font-mono text-muted-foreground/70">{workflowFile}</span>
          {run.headBranch && (
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {run.headBranch}
            </span>
          )}
          <span className="flex items-center gap-1 font-mono text-[10px]">
            <GitCommit className="h-3 w-3" />
            {run.headSha.slice(0, 7)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(run.createdAt)}
          </span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
            {run.event}
          </Badge>
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); electron.shell.openExternal(run.htmlUrl) }}
        className="shrink-0 h-7 w-7 flex items-center justify-center rounded hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
        title="Abrir no GitHub"
      >
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}
