import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play, Clock, GitBranch, AlertTriangle, TrendingUp, TrendingDown,
  CheckCircle2, XCircle, ArrowRight, Loader2, Inbox, Rocket,
  Timer, Activity, BarChart3, Zap, Container, Calendar, Filter,
  ExternalLink, RefreshCw, Github, CircleDot
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore, useRunsStore, useDockerStore } from '@/store'
import { useGlobalEvents } from '@/hooks/useSync'
import { StatusIcon } from '@/components/shared/StatusIcon'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { OwnerAvatar } from '@/components/shared/OwnerAvatar'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectSeparator, SelectTrigger, SelectValue
} from '@/components/ui/select'
import type { Run, RunStatus, GitHubRun } from '@shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────
type DateRange = 'today' | '7d' | '30d' | 'all'
type StatusFilter = 'all' | RunStatus
type RunSource = 'all' | 'orbit' | 'github'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getDateStr(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().split('T')[0]
}

function dateRangeToDays(range: DateRange): number {
  switch (range) {
    case 'today': return 1
    case '7d': return 7
    case '30d': return 30
    case 'all': return 365
  }
}

function filterByDateRange(runs: Run[], range: DateRange): Run[] {
  if (range === 'all') return runs
  const days = dateRangeToDays(range)
  const cutoff = getDateStr(-days + 1)
  return runs.filter((r) => r.createdAt >= cutoff)
}

function groupByDay(runs: Run[], days: number): { date: string; total: number; success: number; failure: number }[] {
  const result: { date: string; total: number; success: number; failure: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = getDateStr(-i)
    const dayRuns = runs.filter((r) => r.createdAt.startsWith(date))
    result.push({
      date,
      total: dayRuns.length,
      success: dayRuns.filter((r) => r.status === 'success').length,
      failure: dayRuns.filter((r) => r.status === 'failure').length
    })
  }
  return result
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

function ghStatusToLocal(status: string | null, conclusion: string | null): RunStatus {
  if (status === 'in_progress' || status === 'queued') return 'running'
  if (conclusion === 'success') return 'success'
  if (conclusion === 'failure') return 'failure'
  if (conclusion === 'cancelled') return 'cancelled'
  return 'pending'
}

const DATE_LABELS: Record<DateRange, string> = { today: 'Hoje', '7d': '7 dias', '30d': '30 dias', all: 'Tudo' }
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Todos', pending: 'Pendente', running: 'Rodando',
  success: 'Sucesso', failure: 'Falha', cancelled: 'Cancelado'
}

// ─── Mini bar chart ───────────────────────────────────────────────────────────
function MiniChart({ data, height = 48 }: { data: { success: number; failure: number; total: number }[]; height?: number }): JSX.Element {
  const maxVal = Math.max(1, ...data.map((d) => d.total))
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d, i) => {
        const successH = (d.success / maxVal) * height
        const failureH = (d.failure / maxVal) * height
        const otherH = ((d.total - d.success - d.failure) / maxVal) * height
        return (
          <div key={i} className="flex-1 flex flex-col justify-end gap-[1px]" style={{ height }}>
            {otherH > 0 && <div className="rounded-t-[2px] bg-muted-foreground/20" style={{ height: otherH }} />}
            {failureH > 0 && <div className="bg-[#f85149]/70 rounded-t-[2px]" style={{ height: failureH }} />}
            {successH > 0 && <div className="bg-[#3fb950]/70 rounded-t-[2px]" style={{ height: successH }} />}
            {d.total === 0 && <div className="bg-muted-foreground/10 rounded-t-[2px]" style={{ height: 2 }} />}
          </div>
        )
      })}
    </div>
  )
}

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

// ─── Repo select (grouped by owner) ──────────────────────────────────────────
function RepoSelect({ repos, value, onChange }: {
  repos: { id: string; fullName: string; owner: string }[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof repos>()
    for (const repo of repos) {
      const ownerRepos = map.get(repo.owner) ?? []
      ownerRepos.push(repo)
      map.set(repo.owner, ownerRepos)
    }
    return Array.from(map.entries())
  }, [repos])

  const selectedLabel = value === 'all'
    ? 'Todos os repos'
    : repos.find((r) => r.id === value)?.fullName ?? value

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-auto min-w-[160px] text-[11px] border-border bg-muted/50 px-2.5 gap-1.5">
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" className="text-[12px]">Todos os repos</SelectItem>
        {grouped.map(([owner, ownerRepos], idx) => (
          <SelectGroup key={owner}>
            {idx === 0 && <SelectSeparator />}
            <SelectLabel className="text-[10px] text-muted-foreground uppercase tracking-wider pl-2 py-1 flex items-center gap-1.5">
              <OwnerAvatar owner={owner} className="h-3.5 w-3.5" size={16} />
              {owner}
            </SelectLabel>
            {ownerRepos.map((repo) => (
              <SelectItem key={repo.id} value={repo.id} className="text-[12px] pl-6">
                {repo.fullName.split('/')[1]}
              </SelectItem>
            ))}
            {idx < grouped.length - 1 && <SelectSeparator />}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Dashboard ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export function Home(): JSX.Element {
  const navigate = useNavigate()
  const { repos, gitSummaries } = useRepoStore()
  const { runs, setRuns } = useRunsStore()
  const docker = useDockerStore((s) => s.status)

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<RunSource>('all')
  const [repoFilter, setRepoFilter] = useState<string>('all')

  // GitHub Actions runs
  const [ghRuns, setGhRuns] = useState<GitHubRun[]>([])
  const [ghLoading, setGhLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useGlobalEvents()

  // Load OrbitCI runs
  useEffect(() => {
    electron.runs.list({ limit: 500 }).then(setRuns).catch(() => {})
    electron.docker.status().then((s) => useDockerStore.getState().setStatus(s)).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load GitHub Actions runs for all repos
  const loadGhRuns = useCallback(async () => {
    setGhLoading(true)
    try {
      const allGh: GitHubRun[] = []
      await Promise.all(repos.map(async (repo) => {
        try {
          const runs = await electron.runs.listGitHub(repo.id, 30)
          allGh.push(...runs.map((r) => ({ ...r, _repoId: repo.id } as GitHubRun & { _repoId: string })))
        } catch { /* skip repos without GH access */ }
      }))
      allGh.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setGhRuns(allGh)
    } finally {
      setGhLoading(false)
    }
  }, [repos])

  useEffect(() => { loadGhRuns() }, [loadGhRuns])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([
      electron.runs.list({ limit: 500 }).then(setRuns).catch(() => {}),
      loadGhRuns()
    ])
    setIsRefreshing(false)
  }

  // ── Filtered OrbitCI runs ─────────────────────────────────────────────────
  const filteredRuns = useMemo(() => {
    let result = filterByDateRange(runs, dateRange)
    if (statusFilter !== 'all') result = result.filter((r) => r.status === statusFilter)
    if (repoFilter !== 'all') result = result.filter((r) => r.repoId === repoFilter)
    return result
  }, [runs, dateRange, statusFilter, repoFilter])

  // ── Filtered GitHub runs ──────────────────────────────────────────────────
  const filteredGhRuns = useMemo(() => {
    let result = ghRuns
    if (dateRange !== 'all') {
      const days = dateRangeToDays(dateRange)
      const cutoff = getDateStr(-days + 1)
      result = result.filter((r) => r.createdAt >= cutoff)
    }
    if (statusFilter !== 'all') {
      result = result.filter((r) => ghStatusToLocal(r.status, r.conclusion) === statusFilter)
    }
    if (repoFilter !== 'all') {
      result = result.filter((r) => (r as GitHubRun & { _repoId?: string })._repoId === repoFilter)
    }
    return result
  }, [ghRuns, dateRange, statusFilter, repoFilter])

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const today = getDateStr()
    const yesterday = getDateStr(-1)
    const todayRuns = runs.filter((r) => r.createdAt.startsWith(today))
    const yesterdayRuns = runs.filter((r) => r.createdAt.startsWith(yesterday))
    const activeRuns = runs.filter((r) => r.status === 'running')

    const todaySuccess = todayRuns.filter((r) => r.status === 'success').length
    const todayFail = todayRuns.filter((r) => r.status === 'failure').length
    const todayRate = todayRuns.length > 0 ? Math.round((todaySuccess / todayRuns.length) * 100) : -1
    const yesterdayRate = yesterdayRuns.length > 0
      ? Math.round((yesterdayRuns.filter((r) => r.status === 'success').length / yesterdayRuns.length) * 100) : -1

    const completedToday = todayRuns.filter((r) => r.durationMs != null && r.durationMs > 0)
    const avgDuration = completedToday.length > 0
      ? Math.round(completedToday.reduce((sum, r) => sum + r.durationMs!, 0) / completedToday.length) : 0

    const recentCompleted = runs.filter((r) => r.status === 'success' || r.status === 'failure').slice(0, 20)
    const peakCpu = Math.max(0, ...recentCompleted.map((r) => r.peakCpuPercent ?? 0))
    const peakRam = Math.max(0, ...recentCompleted.map((r) => r.peakRamBytes ?? 0))

    const chartDays = dateRange === 'today' ? 1 : dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 14
    const weekData = groupByDay(runs, chartDays)

    const repoStats = repos.map((repo) => {
      const repoRuns = runs.filter((r) => r.repoId === repo.id)
      const lastRun = repoRuns[0] ?? null
      const last5 = repoRuns.slice(0, 5)
      const git = gitSummaries[repo.id]
      return { repo, lastRun, last5, git }
    })

    const ghActive = ghRuns.filter((r) => r.status === 'in_progress' || r.status === 'queued')
    const ghTodayRuns = ghRuns.filter((r) => r.createdAt.startsWith(today))
    const ghTodaySuccess = ghTodayRuns.filter((r) => r.conclusion === 'success').length
    const ghTodayFail = ghTodayRuns.filter((r) => r.conclusion === 'failure').length

    return {
      todayRuns, todaySuccess, todayFail, todayRate,
      yesterdayRate, activeRuns, avgDuration,
      peakCpu, peakRam, weekData, repoStats,
      ghActive, ghTodayRuns, ghTodaySuccess, ghTodayFail
    }
  }, [runs, repos, gitSummaries, dateRange, ghRuns])

  // Repos needing attention
  const attentionRepos = useMemo(() => {
    return repos.filter((repo) => {
      const repoRuns = runs.filter((r) => r.repoId === repo.id)
      const lastRun = repoRuns[0]
      const git = gitSummaries[repo.id]
      return lastRun?.status === 'failure' || (git && git.behind > 0) || (git && git.changes > 0)
    }).slice(0, 5)
  }, [repos, runs, gitSummaries])

  if (repos.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={Rocket}
          title="Welcome to OrbitCI"
          description="Add a repository to get started with local CI/CD"
          action={{ label: 'Add Repository', onClick: () => navigate('/repos') }}
        />
      </div>
    )
  }

  const rateDelta = stats.todayRate >= 0 && stats.yesterdayRate >= 0
    ? stats.todayRate - stats.yesterdayRate : null

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-[1080px] mx-auto px-6 py-6 space-y-5">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {repos.length} repo{repos.length !== 1 ? 's' : ''} · {runs.length} runs locais · {ghRuns.length} GitHub Actions
            </p>
          </div>
          <div className="flex items-center gap-3">
            {docker && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Container className="h-3.5 w-3.5" />
                <span className={cn('font-medium', docker.available ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                  {docker.available ? 'Online' : 'Offline'}
                </span>
              </div>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
              Atualizar
            </button>
          </div>
        </div>

        {/* ── Filters ────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 mr-1">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          {(Object.keys(DATE_LABELS) as DateRange[]).map((range) => (
            <FilterPill key={range} label={DATE_LABELS[range]} active={dateRange === range} onClick={() => setDateRange(range)} />
          ))}

          <div className="w-px h-5 bg-border mx-1" />

          <div className="flex items-center gap-1 mr-1">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((status) => (
            <FilterPill key={status} label={STATUS_LABELS[status]} active={statusFilter === status} onClick={() => setStatusFilter(status)} />
          ))}

          <div className="w-px h-5 bg-border mx-1" />

          <RepoSelect repos={repos} value={repoFilter} onChange={setRepoFilter} />
        </div>

        {/* ── Stats cards ────────────────────────────────────── */}
        <div className="grid grid-cols-5 gap-3">
          <StatCard icon={Play} label="Orbit Runs hoje" value={stats.todayRuns.length}
            detail={stats.todayRuns.length > 0 ? `${stats.todaySuccess} ok · ${stats.todayFail} falha` : undefined}
            iconColor="text-[#8b5cf6]" />
          <StatCard icon={Github} label="GH Actions hoje" value={stats.ghTodayRuns.length}
            detail={stats.ghTodayRuns.length > 0 ? `${stats.ghTodaySuccess} ok · ${stats.ghTodayFail} falha` : undefined}
            iconColor="text-foreground" />
          <StatCard icon={CheckCircle2} label="Taxa sucesso"
            value={stats.todayRate >= 0 ? `${stats.todayRate}%` : '—'}
            detail={rateDelta !== null ? (
              <span className={cn('flex items-center gap-0.5', rateDelta >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                {rateDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(rateDelta)}% vs ontem
              </span>
            ) : undefined}
            iconColor={stats.todayRate >= 80 ? 'text-[#3fb950]' : stats.todayRate >= 50 ? 'text-[#d29922]' : stats.todayRate >= 0 ? 'text-[#f85149]' : 'text-muted-foreground'} />
          <StatCard icon={Timer} label="Duração média"
            value={stats.avgDuration > 0 ? formatDuration(stats.avgDuration) : '—'}
            detail={stats.avgDuration > 0 ? 'hoje (local)' : undefined}
            iconColor="text-muted-foreground" />
          <StatCard icon={Zap} label="Pico recursos"
            value={stats.peakCpu > 0 ? `${Math.round(stats.peakCpu)}% CPU` : '—'}
            detail={stats.peakRam > 0 ? `${formatBytes(stats.peakRam)} RAM` : undefined}
            iconColor="text-[#d29922]" />
        </div>

        {/* ── Activity chart + Status panel ───────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                {DATE_LABELS[dateRange]}
              </h2>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-[#3fb950]/70" /> Sucesso
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-[#f85149]/70" /> Falha
                </span>
              </div>
            </div>
            <MiniChart data={stats.weekData} height={64} />
            {stats.weekData.length <= 14 && (
              <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground/60">
                {stats.weekData.map((d) => (
                  <span key={d.date}>{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })}</span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/50 p-4">
            <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
              {(stats.activeRuns.length + stats.ghActive.length) > 0 ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin text-[#58a6ff]" /> Em execução</>
              ) : (
                <><Activity className="h-3.5 w-3.5 text-muted-foreground" /> Resumo</>
              )}
            </h2>
            {stats.activeRuns.length > 0 && (
              <div className="space-y-1.5 mb-3">
                <p className="text-[10px] font-medium text-[#8b5cf6] uppercase tracking-wider">OrbitCI</p>
                {stats.activeRuns.slice(0, 3).map((run) => {
                  const repo = repos.find((r) => r.id === run.repoId)
                  return (
                    <button key={run.id} onClick={() => navigate(`/run/${run.id}`)}
                      className="flex items-center gap-2 w-full text-left p-1.5 rounded-md hover:bg-accent/40 transition-colors">
                      <StatusIcon status="running" size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium truncate">{run.workflowName ?? run.workflowFile}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{repo?.fullName}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            {stats.ghActive.length > 0 && (
              <div className="space-y-1.5 mb-3">
                <p className="text-[10px] font-medium text-foreground/60 uppercase tracking-wider">GitHub Actions</p>
                {stats.ghActive.slice(0, 3).map((run) => (
                  <div key={run.id} className="flex items-center gap-2 p-1.5">
                    <StatusIcon status="running" size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate">{run.displayTitle}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{run.headBranch}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {stats.activeRuns.length === 0 && stats.ghActive.length === 0 && (
              <div className="space-y-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Repositórios</span>
                  <span className="font-medium">{repos.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Orbit Runs</span>
                  <span className="font-medium">{filteredRuns.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">GH Actions</span>
                  <span className="font-medium">{filteredGhRuns.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Docker</span>
                  <span className={cn('font-medium', docker?.available ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                    {docker?.available ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Needs attention ────────────────────────────────── */}
        {attentionRepos.length > 0 && (
          <section>
            <h2 className="text-[13px] font-semibold text-foreground mb-2 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-[#d29922]" />
              Precisa de atenção
            </h2>
            <div className="rounded-lg border border-border bg-card/50 divide-y divide-border">
              {attentionRepos.map((repo) => {
                const git = gitSummaries[repo.id]
                const lastRun = runs.filter((r) => r.repoId === repo.id)[0]
                return (
                  <button key={repo.id} onClick={() => navigate(`/repo/${encodeURIComponent(repo.id)}`)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-accent/40 transition-colors">
                    <OwnerAvatar owner={repo.owner} className="h-6 w-6" size={32} />
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium truncate block">{repo.fullName}</span>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        {lastRun?.status === 'failure' && (
                          <span className="text-[#f85149] flex items-center gap-1"><XCircle className="h-3 w-3" /> Última run falhou</span>
                        )}
                        {git && git.behind > 0 && <span className="text-[#d29922]">{git.behind} atrás</span>}
                        {git && git.changes > 0 && <span>{git.changes} alterações</span>}
                      </div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Repository health table ────────────────────────── */}
        <section>
          <h2 className="text-[13px] font-semibold text-foreground mb-2 flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            Saúde dos repositórios
          </h2>
          <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
            <div className="grid grid-cols-[1fr_100px_120px_100px_80px] gap-2 px-4 py-2 border-b border-border bg-muted/30">
              <span className="text-[11px] font-medium text-muted-foreground">Repositório</span>
              <span className="text-[11px] font-medium text-muted-foreground">Última run</span>
              <span className="text-[11px] font-medium text-muted-foreground">Últimas 5</span>
              <span className="text-[11px] font-medium text-muted-foreground">Branch</span>
              <span className="text-[11px] font-medium text-muted-foreground text-right">Status</span>
            </div>
            {stats.repoStats.map(({ repo, lastRun, last5, git }) => (
              <button key={repo.id} onClick={() => navigate(`/repo/${encodeURIComponent(repo.id)}`)}
                className="grid grid-cols-[1fr_100px_120px_100px_80px] gap-2 px-4 py-2.5 items-center hover:bg-accent/40 transition-colors w-full text-left border-b border-border last:border-b-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <OwnerAvatar owner={repo.owner} className="h-5 w-5 shrink-0" size={24} />
                  <span className="text-[13px] font-medium truncate">{repo.fullName}</span>
                </div>
                <span className="text-[11px] text-muted-foreground truncate">
                  {lastRun ? formatRelativeTime(lastRun.createdAt) : '—'}
                </span>
                <div className="flex items-center gap-1">
                  {last5.length === 0 ? <span className="text-[11px] text-muted-foreground">—</span> : (
                    last5.map((r) => (
                      <div key={r.id} className={cn('w-4 h-4 rounded-full flex items-center justify-center',
                        r.status === 'success' && 'bg-[#3fb950]/20', r.status === 'failure' && 'bg-[#f85149]/20',
                        r.status === 'running' && 'bg-[#58a6ff]/20', r.status === 'cancelled' && 'bg-muted-foreground/10')}>
                        <div className={cn('w-2 h-2 rounded-full',
                          r.status === 'success' && 'bg-[#3fb950]', r.status === 'failure' && 'bg-[#f85149]',
                          r.status === 'running' && 'bg-[#58a6ff]', r.status === 'cancelled' && 'bg-muted-foreground/40')} />
                      </div>
                    ))
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                  <GitBranch className="h-2.5 w-2.5 shrink-0" />{git?.branch ?? repo.defaultBranch}
                </span>
                <div className="flex justify-end">
                  {git ? (git.behind > 0
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#d29922]/15 text-[#d29922] font-medium">{git.behind} atrás</span>
                    : git.ahead > 0
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#58a6ff]/15 text-[#58a6ff] font-medium">{git.ahead} ahead</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3fb950]/10 text-[#3fb950] font-medium">Sync</span>
                  ) : <span className="text-[10px] text-muted-foreground/50">—</span>}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── OrbitCI Runs (local) ────────────────────────────── */}
        {(sourceFilter === 'all' || sourceFilter === 'orbit') && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                <CircleDot className="h-3.5 w-3.5 text-[#8b5cf6]" />
                OrbitCI Runner
                <span className="text-[11px] font-normal text-muted-foreground ml-1">
                  {filteredRuns.length} run{filteredRuns.length !== 1 ? 's' : ''}
                </span>
              </h2>
              <div className="flex items-center gap-2">
                {(['all', 'orbit', 'github'] as RunSource[]).map((src) => (
                  <FilterPill key={src} label={src === 'all' ? 'Ambos' : src === 'orbit' ? 'OrbitCI' : 'GitHub'}
                    active={sourceFilter === src} onClick={() => setSourceFilter(src)} />
                ))}
              </div>
            </div>
            {filteredRuns.length === 0 ? (
              <div className="rounded-lg border border-border bg-card/50">
                <EmptyState icon={Inbox} title="Nenhuma run encontrada"
                  description="Ajuste os filtros ou execute um workflow" className="py-8" />
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card/50 divide-y divide-border">
                {filteredRuns.slice(0, 10).map((run) => (
                  <RunRow key={run.id} run={run} onClick={() => navigate(`/run/${run.id}`)} />
                ))}
                {filteredRuns.length > 10 && (
                  <button onClick={() => navigate('/history')}
                    className="w-full px-4 py-2.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors text-center">
                    Ver mais {filteredRuns.length - 10} runs →
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── GitHub Actions Runs ─────────────────────────────── */}
        {(sourceFilter === 'all' || sourceFilter === 'github') && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                <Github className="h-3.5 w-3.5" />
                GitHub Actions
                <span className="text-[11px] font-normal text-muted-foreground ml-1">
                  {ghLoading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : `${filteredGhRuns.length} run${filteredGhRuns.length !== 1 ? 's' : ''}`}
                </span>
              </h2>
              {sourceFilter !== 'all' && (
                <div className="flex items-center gap-2">
                  {(['all', 'orbit', 'github'] as RunSource[]).map((src) => (
                    <FilterPill key={src} label={src === 'all' ? 'Ambos' : src === 'orbit' ? 'OrbitCI' : 'GitHub'}
                      active={sourceFilter === src} onClick={() => setSourceFilter(src)} />
                  ))}
                </div>
              )}
            </div>
            {ghLoading ? (
              <div className="flex items-center justify-center py-10 rounded-lg border border-border bg-card/50">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredGhRuns.length === 0 ? (
              <div className="rounded-lg border border-border bg-card/50">
                <EmptyState icon={Github} title="Nenhuma run do GitHub Actions"
                  description="Ajuste os filtros ou verifique a conexão com o GitHub" className="py-8" />
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card/50 divide-y divide-border">
                {filteredGhRuns.slice(0, 10).map((run) => (
                  <GhRunRow key={run.id} run={run} repos={repos} />
                ))}
                {filteredGhRuns.length > 10 && (
                  <div className="w-full px-4 py-2.5 text-[12px] text-muted-foreground text-center">
                    Mostrando 10 de {filteredGhRuns.length} runs
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, detail, iconColor }: {
  icon: React.ElementType; label: string; value: string | number
  detail?: React.ReactNode; iconColor?: string
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card/50 px-4 py-3">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-[20px] font-semibold text-foreground leading-tight">{value}</p>
      {detail && <div className="text-[11px] text-muted-foreground mt-0.5">{detail}</div>}
    </div>
  )
}

// ─── OrbitCI Run row ──────────────────────────────────────────────────────────
function RunRow({ run, onClick }: { run: Run; onClick: () => void }): JSX.Element {
  const repo = useRepoStore.getState().repos.find((r) => r.id === run.repoId)
  return (
    <button onClick={onClick} className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-accent/40 transition-colors">
      <StatusIcon status={run.status} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium truncate">{run.workflowName ?? run.workflowFile}</span>
          <StatusBadge status={run.status} />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#8b5cf6]/10 text-[#8b5cf6] font-medium shrink-0">Orbit</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
          {repo && <span>{repo.fullName}</span>}
          <span>{formatRelativeTime(run.createdAt)}</span>
          {run.durationMs != null && (
            <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{formatDuration(run.durationMs)}</span>
          )}
          {run.gitBranch && (
            <span className="flex items-center gap-1"><GitBranch className="h-2.5 w-2.5" />{run.gitBranch}</span>
          )}
        </div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
    </button>
  )
}

// ─── GitHub Actions Run row ───────────────────────────────────────────────────
function GhRunRow({ run, repos }: { run: GitHubRun & { _repoId?: string }; repos: { id: string; fullName: string }[] }): JSX.Element {
  const status = ghStatusToLocal(run.status, run.conclusion)
  const repo = repos.find((r) => r.id === run._repoId)
  return (
    <div className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-accent/40 transition-colors">
      <StatusIcon status={status} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium truncate">{run.displayTitle || run.name}</span>
          <StatusBadge status={status} />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-muted-foreground font-medium shrink-0">GitHub</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
          {repo && <span>{repo.fullName}</span>}
          <span>{formatRelativeTime(run.createdAt)}</span>
          <span className="flex items-center gap-1">#{run.runNumber}</span>
          {run.headBranch && (
            <span className="flex items-center gap-1"><GitBranch className="h-2.5 w-2.5" />{run.headBranch}</span>
          )}
          {run.event && <span className="text-muted-foreground/60">{run.event}</span>}
        </div>
      </div>
      <a
        href={run.htmlUrl}
        onClick={(e) => { e.preventDefault(); electron.shell.openExternal(run.htmlUrl) }}
        className="shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors"
        title="Abrir no GitHub"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  )
}
