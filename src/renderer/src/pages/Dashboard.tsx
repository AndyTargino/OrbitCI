import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Calendar,
  CheckCircle2, ChevronDown, CircleDot, Clock, ExternalLink,
  Filter, GitBranch, Github, Inbox, LineChart, Loader2,
  Play, RefreshCw, Rocket, Timer, TrendingDown, TrendingUp,
  XCircle, Zap
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore, useRunsStore } from '@/store'
import { StatusIcon } from '@/components/shared/StatusIcon'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { OwnerAvatar } from '@/components/shared/OwnerAvatar'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '@/components/ui/tooltip'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectSeparator, SelectTrigger, SelectValue
} from '@/components/ui/select'
import type { Run, RunStatus, GitHubRun } from '@shared/types'

// ─── Types ──────────────────────────────────────────────────────────────────────

type DateRange = 'today' | '7d' | '30d'
type StatusFilter = 'all' | RunStatus
type SourceFilter = 'all' | 'orbit' | 'github'
type ChartMode = 'bar' | 'line' | 'area'

interface DayBucket {
  date: string
  total: number
  success: number
  failure: number
}

interface UnifiedRun {
  id: string | number
  source: 'orbit' | 'github'
  name: string
  status: RunStatus
  repoId: string
  createdAt: string
  durationMs: number | null
  branch: string | null
  htmlUrl?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

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
  }
}

function filterByDate<T extends { createdAt: string }>(items: T[], range: DateRange): T[] {
  const days = dateRangeToDays(range)
  const cutoff = getDateStr(-days + 1)
  return items.filter((r) => r.createdAt >= cutoff)
}

function groupByDay(items: { createdAt: string; status: RunStatus }[], days: number): DayBucket[] {
  const result: DayBucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = getDateStr(-i)
    const dayItems = items.filter((r) => r.createdAt.startsWith(date))
    result.push({
      date,
      total: dayItems.length,
      success: dayItems.filter((r) => r.status === 'success').length,
      failure: dayItems.filter((r) => r.status === 'failure').length
    })
  }
  return result
}

function ghToLocal(status: string | null, conclusion: string | null): RunStatus {
  if (status === 'in_progress' || status === 'queued') return 'running'
  if (conclusion === 'success') return 'success'
  if (conclusion === 'failure') return 'failure'
  if (conclusion === 'cancelled') return 'cancelled'
  return 'pending'
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

function pct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 100) : 0
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

function Sparkline({ data, color, height = 28 }: { data: number[]; color: string; height?: number }) {
  if (data.length === 0) return null
  const max = Math.max(1, ...data)
  const barW = Math.max(2, Math.floor(48 / data.length) - 1)
  return (
    <div className="flex items-end gap-[1px]" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className="rounded-[1px] transition-all"
          style={{
            width: barW,
            height: Math.max(1, (v / max) * height),
            background: v > 0 ? color : 'rgba(255,255,255,0.06)',
            opacity: v > 0 ? 0.7 : 0.3
          }}
        />
      ))}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, detail, iconColor, sparkData, sparkColor, onClick, active }: {
  icon: React.ElementType
  label: string
  value: string | number
  detail?: React.ReactNode
  iconColor?: string
  sparkData?: number[]
  sparkColor?: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg border px-4 py-3 flex flex-col justify-between min-h-[100px] text-left transition-all',
        active
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
          : 'border-border bg-card/50 hover:border-border/80 hover:bg-card/70',
        onClick && 'cursor-pointer'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className={cn('h-3.5 w-3.5', iconColor)} />
          <span className="text-[11px] font-medium">{label}</span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-2 mt-1">
        <div>
          <p className="text-[22px] font-semibold text-foreground leading-tight tabular-nums">{value}</p>
          {detail && <div className="text-[11px] text-muted-foreground mt-0.5">{detail}</div>}
        </div>
        {sparkData && sparkData.length > 0 && (
          <Sparkline data={sparkData} color={sparkColor ?? 'rgba(139,92,246,0.6)'} />
        )}
      </div>
    </button>
  )
}

function RepoSelect({ repos, value, onChange, allLabel }: {
  repos: { id: string; fullName: string; owner: string }[]
  value: string
  onChange: (v: string) => void
  allLabel: string
}) {
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
    ? allLabel
    : repos.find((r) => r.id === value)?.fullName ?? value

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-auto min-w-[160px] text-[11px] border-border bg-muted/50 px-2.5 gap-1.5">
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" className="text-[12px]">{allLabel}</SelectItem>
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

// ─── Activity Chart ─────────────────────────────────────────────────────────────

function ActivityChart({ data, mode, days, t }: {
  data: DayBucket[]
  mode: ChartMode
  days: number
  t: TFunction
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const maxVal = Math.max(1, ...data.map((b) => b.total))
  const chartH = 120

  if (data.every((d) => d.total === 0)) {
    return (
      <div className="flex items-center justify-center py-10 text-[12px] text-muted-foreground">
        {t('dashboard.chart.no_data', 'No activity in this period')}
      </div>
    )
  }

  // Line / Area chart uses SVG
  if (mode === 'line' || mode === 'area') {
    const w = 100
    const h = chartH
    const pts = data.map((d, i) => ({
      x: data.length > 1 ? (i / (data.length - 1)) * w : w / 2,
      ySuccess: h - (d.success / maxVal) * (h - 8) - 4,
      yFailure: h - (d.failure / maxVal) * (h - 8) - 4,
      yTotal: h - (d.total / maxVal) * (h - 8) - 4
    }))
    const toPath = (points: { x: number; y: number }[]) =>
      points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    const toAreaPath = (points: { x: number; y: number }[]) => {
      const linePath = toPath(points)
      return `${linePath} L${points[points.length - 1].x},${h} L${points[0].x},${h} Z`
    }

    const successPts = pts.map((p) => ({ x: p.x, y: p.ySuccess }))
    const failurePts = pts.map((p) => ({ x: p.x, y: p.yFailure }))

    return (
      <div ref={chartRef} className="relative" style={{ height: chartH }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
          {mode === 'area' && (
            <>
              <path d={toAreaPath(successPts)} fill="rgba(63,185,80,0.12)" />
              <path d={toAreaPath(failurePts)} fill="rgba(248,81,73,0.12)" />
            </>
          )}
          <path d={toPath(successPts)} fill="none" stroke="#3fb950" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
          <path d={toPath(failurePts)} fill="none" stroke="#f85149" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.ySuccess} r="0.8" fill="#3fb950" className="transition-all" />
              {data[i].failure > 0 && (
                <circle cx={p.x} cy={p.yFailure} r="0.8" fill="#f85149" className="transition-all" />
              )}
            </g>
          ))}
          {/* Invisible hover hit areas */}
          {data.map((_, i) => {
            const segW = w / data.length
            return (
              <rect
                key={`hit-${i}`}
                x={i * segW} y={0} width={segW} height={h}
                fill="transparent"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            )
          })}
          {/* Hover vertical guide */}
          {hoveredIdx !== null && (
            <line
              x1={pts[hoveredIdx].x} y1={0}
              x2={pts[hoveredIdx].x} y2={h}
              stroke="rgba(255,255,255,0.12)" strokeWidth="0.3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* Tooltip */}
        {hoveredIdx !== null && (
          <ChartTooltip data={data} index={hoveredIdx} chartRef={chartRef} days={days} t={t} />
        )}
      </div>
    )
  }

  // Bar chart (default)
  return (
    <div ref={chartRef} className="relative">
      <div className="flex items-end gap-[3px]" style={{ height: chartH }}>
        {data.map((d, i) => {
          const successH = (d.success / maxVal) * chartH
          const failureH = (d.failure / maxVal) * chartH
          const otherH = ((d.total - d.success - d.failure) / maxVal) * chartH
          const isHovered = hoveredIdx === i
          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-end gap-[1px] relative"
              style={{ height: chartH }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {isHovered && (
                <div className="absolute inset-0 bg-white/[0.03] rounded-sm pointer-events-none" />
              )}
              {otherH > 0 && <div className={cn('rounded-t-[2px] bg-muted-foreground/20 transition-opacity', isHovered && 'opacity-100')} style={{ height: otherH }} />}
              {failureH > 0 && <div className={cn('bg-[#f85149]/70 rounded-t-[2px] transition-opacity', isHovered && 'bg-[#f85149]')} style={{ height: failureH }} />}
              {successH > 0 && <div className={cn('bg-[#3fb950]/70 rounded-t-[2px] transition-opacity', isHovered && 'bg-[#3fb950]')} style={{ height: successH }} />}
              {d.total === 0 && <div className="bg-muted-foreground/10 rounded-t-[2px]" style={{ height: 2 }} />}
            </div>
          )
        })}
      </div>
      {/* Tooltip */}
      {hoveredIdx !== null && (
        <ChartTooltip data={data} index={hoveredIdx} chartRef={chartRef} days={days} t={t} />
      )}
    </div>
  )
}

function ChartTooltip({ data, index, chartRef, days, t }: {
  data: DayBucket[]
  index: number
  chartRef: React.RefObject<HTMLDivElement | null>
  days: number
  t: TFunction
}) {
  const d = data[index]
  const dateObj = new Date(d.date + 'T12:00:00')
  const dateLabel = days === 1
    ? dateObj.toLocaleDateString(undefined, { weekday: 'long' })
    : dateObj.toLocaleDateString(undefined, { day: 'numeric', month: 'short', weekday: 'short' })

  // Calculate horizontal position
  const chartW = chartRef.current?.offsetWidth ?? 600
  const barCenter = ((index + 0.5) / data.length) * chartW
  const tooltipW = 140
  const left = Math.max(0, Math.min(barCenter - tooltipW / 2, chartW - tooltipW))

  return (
    <div
      className="absolute -top-2 pointer-events-none z-20 transform -translate-y-full"
      style={{ left, width: tooltipW }}
    >
      <div className="bg-popover border border-border rounded-md shadow-lg px-2.5 py-2 text-[11px]">
        <p className="font-medium text-foreground mb-1.5">{dateLabel}</p>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t('dashboard.chart.total', 'Total')}</span>
            <span className="font-medium tabular-nums text-foreground">{d.total}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
              <span className="text-muted-foreground">{t('dashboard.chart.success', 'Success')}</span>
            </span>
            <span className="font-medium tabular-nums text-foreground">{d.success}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f85149]" />
              <span className="text-muted-foreground">{t('dashboard.chart.failure', 'Failure')}</span>
            </span>
            <span className="font-medium tabular-nums text-foreground">{d.failure}</span>
          </div>
          {d.total - d.success - d.failure > 0 && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                <span className="text-muted-foreground">{t('dashboard.chart.other', 'Other')}</span>
              </span>
              <span className="font-medium tabular-nums text-foreground">{d.total - d.success - d.failure}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════════
// ─── Dashboard ───────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════════

export function Dashboard(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { repos, gitSummaries } = useRepoStore()
  const { setRuns } = useRunsStore()

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [repoFilter, setRepoFilter] = useState('all')
  const [sortField, setSortField] = useState<'commits' | 'changes' | 'rate'>('commits')
  const [sortAsc, setSortAsc] = useState(false)
  const [chartMode, setChartMode] = useState<ChartMode>('bar')
  const [visibleRunsCount, setVisibleRunsCount] = useState(15)

  // Data
  const [orbitRuns, setOrbitRuns] = useState<Run[]>([])
  const [ghRuns, setGhRuns] = useState<(GitHubRun & { _repoId: string })[]>([])
  const [commitCounts, setCommitCounts] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadGhRuns = useCallback(async () => {
    const all: (GitHubRun & { _repoId: string })[] = []
    await Promise.allSettled(
      repos.map(async (repo) => {
        try {
          const runs = await electron.runs.listGitHub(repo.id, 50)
          all.push(...runs.map((r) => ({ ...r, _repoId: repo.id })))
        } catch { /* skip */ }
      })
    )
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return all
  }, [repos])

  const loadCommitCounts = useCallback(async () => {
    const counts: Record<string, number> = {}
    await Promise.allSettled(
      repos.filter((r) => r.localPath).map(async (repo) => {
        try {
          const log = await electron.git.log(repo.id, 100)
          counts[repo.id] = log.length
        } catch { /* skip */ }
      })
    )
    return counts
  }, [repos])

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    try {
      const [allOrbit, allGh, counts] = await Promise.all([
        electron.runs.list({ limit: 1000 }),
        loadGhRuns(),
        loadCommitCounts()
      ])
      setOrbitRuns(allOrbit)
      setRuns(allOrbit)
      setGhRuns(allGh)
      setCommitCounts(counts)
    } catch { /* ignore */ }
    if (!silent) setIsLoading(false)
  }, [loadGhRuns, loadCommitCounts, setRuns])

  // Initial load
  const [didInitialLoad, setDidInitialLoad] = useState(false)
  useEffect(() => {
    loadAll().then(() => setDidInitialLoad(true))
  }, [loadAll])

  // Re-fetch silently when date range changes
  useEffect(() => {
    if (didInitialLoad) loadAll(true)
  }, [dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await loadAll()
    setIsRefreshing(false)
  }

  // ── Filtered data ─────────────────────────────────────────────────────────

  const filteredOrbit = useMemo(() => {
    let result = filterByDate(orbitRuns, dateRange)
    if (statusFilter !== 'all') result = result.filter((r) => r.status === statusFilter)
    if (repoFilter !== 'all') result = result.filter((r) => r.repoId === repoFilter)
    return result
  }, [orbitRuns, dateRange, statusFilter, repoFilter])

  const ghRunsNormalized = useMemo(() =>
    ghRuns.map((r) => ({ ...r, _status: ghToLocal(r.status, r.conclusion) })),
    [ghRuns]
  )

  const filteredGh = useMemo(() => {
    let result = filterByDate(ghRunsNormalized, dateRange)
    if (statusFilter !== 'all') result = result.filter((r) => r._status === statusFilter)
    if (repoFilter !== 'all') result = result.filter((r) => r._repoId === repoFilter)
    return result
  }, [ghRunsNormalized, dateRange, statusFilter, repoFilter])

  // ── Aggregations ──────────────────────────────────────────────────────────

  const days = dateRangeToDays(dateRange)

  const prevOrbit = useMemo(() => {
    const cutoffStart = getDateStr(-days * 2 + 1)
    const cutoffEnd = getDateStr(-days)
    let result = orbitRuns.filter((r) => r.createdAt >= cutoffStart && r.createdAt < cutoffEnd)
    if (statusFilter !== 'all') result = result.filter((r) => r.status === statusFilter)
    if (repoFilter !== 'all') result = result.filter((r) => r.repoId === repoFilter)
    return result
  }, [orbitRuns, days, statusFilter, repoFilter])

  const prevGh = useMemo(() => {
    const cutoffStart = getDateStr(-days * 2 + 1)
    const cutoffEnd = getDateStr(-days)
    let result = ghRunsNormalized.filter((r) => r.createdAt >= cutoffStart && r.createdAt < cutoffEnd)
    if (statusFilter !== 'all') result = result.filter((r) => r._status === statusFilter)
    if (repoFilter !== 'all') result = result.filter((r) => r._repoId === repoFilter)
    return result
  }, [ghRunsNormalized, days, statusFilter, repoFilter])

  const stats = useMemo(() => {
    const activeOrbit = sourceFilter !== 'github' ? filteredOrbit : []
    const activeGh = sourceFilter !== 'orbit' ? filteredGh : []
    const prevActiveOrbit = sourceFilter !== 'github' ? prevOrbit : []
    const prevActiveGh = sourceFilter !== 'orbit' ? prevGh : []

    const totalCurr = activeOrbit.length + activeGh.length
    const successCurr = activeOrbit.filter((r) => r.status === 'success').length +
      activeGh.filter((r) => r._status === 'success').length
    const failureCurr = activeOrbit.filter((r) => r.status === 'failure').length +
      activeGh.filter((r) => r._status === 'failure').length
    const runningCurr = activeOrbit.filter((r) => r.status === 'running').length +
      activeGh.filter((r) => r._status === 'running').length

    const totalPrev = prevActiveOrbit.length + prevActiveGh.length
    const successPrev = prevActiveOrbit.filter((r) => r.status === 'success').length +
      prevActiveGh.filter((r) => r._status === 'success').length
    const failurePrev = prevActiveOrbit.filter((r) => r.status === 'failure').length +
      prevActiveGh.filter((r) => r._status === 'failure').length

    const rateCurr = pct(successCurr, totalCurr)
    const ratePrev = pct(successPrev, totalPrev)
    const rateDelta = totalPrev > 0 ? rateCurr - ratePrev : null
    const failDelta = totalPrev > 0 ? failureCurr - failurePrev : null

    const completed = activeOrbit.filter((r) => r.durationMs != null && r.durationMs > 0)
    const avgMs = completed.length > 0
      ? Math.round(completed.reduce((s, r) => s + r.durationMs!, 0) / completed.length) : 0

    const sparkLen = Math.min(days, 14)
    const sparkTotal = Array.from({ length: sparkLen }, (_, i) => {
      const date = getDateStr(-sparkLen + 1 + i)
      return activeOrbit.filter((r) => r.createdAt.startsWith(date)).length +
        activeGh.filter((r) => r.createdAt.startsWith(date)).length
    })
    const sparkSuccess = Array.from({ length: sparkLen }, (_, i) => {
      const date = getDateStr(-sparkLen + 1 + i)
      return activeOrbit.filter((r) => r.createdAt.startsWith(date) && r.status === 'success').length +
        activeGh.filter((r) => r.createdAt.startsWith(date) && r._status === 'success').length
    })
    const sparkFailure = Array.from({ length: sparkLen }, (_, i) => {
      const date = getDateStr(-sparkLen + 1 + i)
      return activeOrbit.filter((r) => r.createdAt.startsWith(date) && r.status === 'failure').length +
        activeGh.filter((r) => r.createdAt.startsWith(date) && r._status === 'failure').length
    })
    const sparkDuration = Array.from({ length: sparkLen }, (_, i) => {
      const date = getDateStr(-sparkLen + 1 + i)
      const dayCompleted = activeOrbit.filter((r) => r.createdAt.startsWith(date) && r.durationMs != null && r.durationMs > 0)
      return dayCompleted.length > 0
        ? Math.round(dayCompleted.reduce((s, r) => s + r.durationMs!, 0) / dayCompleted.length)
        : 0
    })

    return {
      totalCurr, successCurr, failureCurr, runningCurr,
      rateCurr, rateDelta, failDelta, avgMs,
      sparkTotal, sparkSuccess, sparkFailure, sparkDuration
    }
  }, [filteredOrbit, filteredGh, prevOrbit, prevGh, sourceFilter, days])

  const chartData = useMemo(() => {
    const orbitNorm = (sourceFilter !== 'github' ? filteredOrbit : [])
      .map((r) => ({ createdAt: r.createdAt, status: r.status }))
    const ghNorm = (sourceFilter !== 'orbit' ? filteredGh : [])
      .map((r) => ({ createdAt: r.createdAt, status: r._status }))
    return groupByDay([...orbitNorm, ...ghNorm], days)
  }, [filteredOrbit, filteredGh, sourceFilter, days])

  const chartSummary = useMemo(() => {
    const totals = chartData.map((d) => d.total)
    const peak = Math.max(0, ...totals)
    const avg = totals.length > 0 ? Math.round(totals.reduce((s, v) => s + v, 0) / totals.length) : 0
    return { peak, avg }
  }, [chartData])

  const sourceStats = useMemo(() => {
    const oTotal = filteredOrbit.length
    const oSuccess = filteredOrbit.filter((r) => r.status === 'success').length
    const oFailure = filteredOrbit.filter((r) => r.status === 'failure').length
    const oCompleted = filteredOrbit.filter((r) => r.durationMs != null && r.durationMs > 0)
    const oAvgMs = oCompleted.length > 0
      ? Math.round(oCompleted.reduce((s, r) => s + r.durationMs!, 0) / oCompleted.length) : 0
    const oPeakCpu = Math.max(0, ...filteredOrbit.map((r) => r.peakCpuPercent ?? 0))
    const oPeakRam = Math.max(0, ...filteredOrbit.map((r) => r.peakRamBytes ?? 0))

    const gTotal = filteredGh.length
    const gSuccess = filteredGh.filter((r) => r._status === 'success').length
    const gFailure = filteredGh.filter((r) => r._status === 'failure').length

    return {
      orbit: { total: oTotal, success: oSuccess, failure: oFailure, rate: pct(oSuccess, oTotal), avgMs: oAvgMs, peakCpu: oPeakCpu, peakRam: oPeakRam },
      github: { total: gTotal, success: gSuccess, failure: gFailure, rate: pct(gSuccess, gTotal) }
    }
  }, [filteredOrbit, filteredGh])

  const repoOverview = useMemo(() => {
    const rows = repos.map((repo) => {
      const git = gitSummaries[repo.id]
      const repoOrbit = filteredOrbit.filter((r) => r.repoId === repo.id)
      const repoGh = filteredGh.filter((r) => r._repoId === repo.id)
      const lastOrbit = repoOrbit[0]
      const lastGh = repoGh[0]
      const totalAll = repoOrbit.length + repoGh.length
      const successAll = repoOrbit.filter((r) => r.status === 'success').length +
        repoGh.filter((r) => r._status === 'success').length
      return {
        repo,
        commits: commitCounts[repo.id] ?? 0,
        changes: git?.changes ?? 0,
        lastOrbitStatus: lastOrbit?.status ?? null,
        lastGhStatus: lastGh ? ghToLocal(lastGh.status, lastGh.conclusion) : null,
        rate: pct(successAll, totalAll),
        totalRuns: totalAll
      }
    })
    rows.sort((a, b) => {
      const mul = sortAsc ? 1 : -1
      switch (sortField) {
        case 'commits': return (a.commits - b.commits) * mul
        case 'changes': return (a.changes - b.changes) * mul
        case 'rate': return (a.rate - b.rate) * mul
      }
    })
    return rows
  }, [repos, gitSummaries, commitCounts, filteredOrbit, filteredGh, sortField, sortAsc])

  const recentRuns = useMemo(() => {
    const orbitItems: UnifiedRun[] = (sourceFilter !== 'github' ? filteredOrbit : [])
      .map((r) => ({
        id: r.id, source: 'orbit' as const, name: r.workflowName ?? r.workflowFile,
        status: r.status, repoId: r.repoId, createdAt: r.createdAt,
        durationMs: r.durationMs, branch: r.gitBranch
      }))
    const ghItems: UnifiedRun[] = (sourceFilter !== 'orbit' ? filteredGh : [])
      .map((r) => ({
        id: r.id, source: 'github' as const, name: r.displayTitle || r.name || 'Workflow',
        status: ghToLocal(r.status, r.conclusion), repoId: r._repoId, createdAt: r.createdAt,
        durationMs: null, branch: r.headBranch, htmlUrl: r.htmlUrl
      }))
    return [...orbitItems, ...ghItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [filteredOrbit, filteredGh, sourceFilter])

  const handleSort = (field: 'commits' | 'changes' | 'rate') => {
    if (sortField === field) setSortAsc((p) => !p)
    else { setSortField(field); setSortAsc(false) }
  }

  const handleStatClick = (filter: StatusFilter) => {
    setStatusFilter((prev) => prev === filter ? 'all' : filter)
  }

  const handleRunClick = (run: UnifiedRun) => {
    if (run.source === 'github' && run.htmlUrl) {
      electron.shell.openExternal(run.htmlUrl)
    }
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!isLoading && repos.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={Rocket}
          title={t('dashboard.empty.title', 'Welcome to OrbitCI')}
          description={t('dashboard.empty.description', 'Add a repository to get started')}
          action={{ label: t('dashboard.empty.add_repo', 'Add Repository'), onClick: () => navigate('/') }}
        />
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const DATE_RANGES: { key: DateRange; label: string }[] = [
    { key: 'today', label: t('dashboard.filters.today', 'Today') },
    { key: '7d', label: t('dashboard.filters.7d', '7 days') },
    { key: '30d', label: t('dashboard.filters.30d', '30 days') }
  ]

  const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('dashboard.filters.all_status', 'All') },
    { key: 'success', label: t('workspace.status.success', 'Success') },
    { key: 'failure', label: t('workspace.status.failure', 'Failure') },
    { key: 'running', label: t('workspace.status.running', 'Running') },
    { key: 'cancelled', label: t('workspace.status.cancelled', 'Cancelled') }
  ]

  const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: t('dashboard.filters.all_sources', 'All') },
    { key: 'orbit', label: t('dashboard.filters.orbit_source', 'OrbitCI') },
    { key: 'github', label: t('dashboard.filters.github_source', 'GitHub') }
  ]

  const CHART_MODES: { key: ChartMode; icon: React.ElementType; label: string }[] = [
    { key: 'bar', icon: BarChart3, label: t('dashboard.chart.bar_view', 'Bar chart') },
    { key: 'line', icon: LineChart, label: t('dashboard.chart.line_view', 'Line chart') },
    { key: 'area', icon: Activity, label: t('dashboard.chart.area_view', 'Area chart') }
  ]

  return (
    <TooltipProvider>
    <div className="h-full overflow-auto">
      <div className="max-w-[1080px] mx-auto px-6 py-6 space-y-4">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={t('dashboard.back', 'Back to workspace')}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{t('dashboard.title', 'Dashboard')}</h1>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {t('dashboard.subtitle', {
                  repoCount: repos.length,
                  orbitCount: orbitRuns.length,
                  ghCount: ghRuns.length,
                  defaultValue: `${repos.length} repos · ${orbitRuns.length} OrbitCI runs · ${ghRuns.length} GitHub Actions`
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 mr-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            {DATE_RANGES.map((r) => (
              <FilterPill key={r.key} label={r.label} active={dateRange === r.key} onClick={() => setDateRange(r.key)} />
            ))}
            <div className="w-px h-5 bg-border mx-0.5" />
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
              {isRefreshing ? t('dashboard.refreshing', 'Refreshing...') : t('dashboard.refresh', 'Refresh')}
            </button>
          </div>
        </div>

        {/* ── Filter bar ─────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          {SOURCE_FILTERS.map((s) => (
            <FilterPill key={s.key} label={s.label} active={sourceFilter === s.key} onClick={() => setSourceFilter(s.key)} />
          ))}
          <div className="w-px h-5 bg-border mx-0.5" />
          <div className="flex items-center gap-1 mr-0.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          {STATUS_FILTERS.map((s) => (
            <FilterPill key={s.key} label={s.label} active={statusFilter === s.key} onClick={() => setStatusFilter(s.key)} />
          ))}
          <div className="w-px h-5 bg-border mx-0.5" />
          <RepoSelect repos={repos} value={repoFilter} onChange={setRepoFilter}
            allLabel={t('dashboard.filters.all_repos', 'All repos')} />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-[13px]">{t('common.loading', 'Loading...')}</span>
          </div>
        ) : (
          <>
            {/* ── Stat cards (clickable to filter by status) ────── */}
            <div className="grid grid-cols-5 gap-3">
              <StatCard
                icon={Play} label={t('dashboard.stats.total_runs', 'Total Runs')}
                value={stats.totalCurr}
                detail={t('dashboard.stats.in_period', 'in period')}
                iconColor="text-[#8b5cf6]"
                sparkData={stats.sparkTotal}
                sparkColor="rgba(139,92,246,0.6)"
                onClick={() => setStatusFilter('all')}
                active={statusFilter === 'all'}
              />
              <StatCard
                icon={CheckCircle2} label={t('dashboard.stats.success_rate', 'Success Rate')}
                value={stats.totalCurr > 0 ? `${stats.rateCurr}%` : t('dashboard.stats.no_data', '—')}
                detail={stats.rateDelta !== null ? (
                  <span className={cn('flex items-center gap-0.5', stats.rateDelta >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                    {stats.rateDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {Math.abs(stats.rateDelta)}% {t('dashboard.stats.vs_prev', 'vs prev.')}
                  </span>
                ) : undefined}
                iconColor={stats.rateCurr >= 80 ? 'text-[#3fb950]' : stats.rateCurr >= 50 ? 'text-[#d29922]' : stats.rateCurr > 0 ? 'text-[#f85149]' : 'text-muted-foreground'}
                sparkData={stats.sparkSuccess}
                sparkColor="rgba(63,185,80,0.6)"
                onClick={() => handleStatClick('success')}
                active={statusFilter === 'success'}
              />
              <StatCard
                icon={XCircle} label={t('dashboard.stats.failures', 'Failures')}
                value={stats.failureCurr}
                detail={stats.failDelta !== null ? (
                  <span className={cn('flex items-center gap-0.5', stats.failDelta <= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                    {stats.failDelta <= 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                    {Math.abs(stats.failDelta)} {t('dashboard.stats.vs_prev', 'vs prev.')}
                  </span>
                ) : undefined}
                iconColor="text-[#f85149]"
                sparkData={stats.sparkFailure}
                sparkColor="rgba(248,81,73,0.6)"
                onClick={() => handleStatClick('failure')}
                active={statusFilter === 'failure'}
              />
              <StatCard
                icon={Zap} label={t('dashboard.stats.running_now', 'Running')}
                value={stats.runningCurr}
                detail={stats.runningCurr > 0 ? t('dashboard.stats.active', 'active') : undefined}
                iconColor="text-[#58a6ff]"
                onClick={() => handleStatClick('running')}
                active={statusFilter === 'running'}
              />
              <StatCard
                icon={Timer} label={t('dashboard.stats.avg_duration', 'Avg Duration')}
                value={stats.avgMs > 0 ? formatDuration(stats.avgMs) : t('dashboard.stats.no_data', '—')}
                detail={stats.avgMs > 0 ? 'OrbitCI' : undefined}
                iconColor="text-muted-foreground"
                sparkData={stats.sparkDuration}
                sparkColor="rgba(255,255,255,0.25)"
              />
            </div>

            {/* ── Activity chart ─────────────────────────────────── */}
            <div className="rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('dashboard.chart.title', 'Activity')}
                  </h2>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                    <span>{t('dashboard.chart.peak', 'Peak')}: {chartSummary.peak}</span>
                    <span className="text-border">·</span>
                    <span>{t('dashboard.chart.avg', 'Avg')}: {chartSummary.avg}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mr-2">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-[#3fb950]/70" /> {t('dashboard.chart.success', 'Success')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-[#f85149]/70" /> {t('dashboard.chart.failure', 'Failure')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-muted-foreground/20" /> {t('dashboard.chart.other', 'Other')}
                    </span>
                  </div>
                  {/* Chart mode toggle */}
                  <div className="flex items-center rounded-md border border-border overflow-hidden">
                    {CHART_MODES.map((m) => (
                      <Tooltip key={m.key}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setChartMode(m.key)}
                            className={cn(
                              'flex items-center justify-center w-7 h-6 transition-colors',
                              chartMode === m.key
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            )}
                          >
                            <m.icon className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[11px]">{m.label}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              </div>
              <ActivityChart data={chartData} mode={chartMode} days={days} t={t} />
              {chartData.length <= 14 && !chartData.every((d) => d.total === 0) && (
                <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground/60">
                  {chartData.map((d) => {
                    const dateObj = new Date(d.date + 'T12:00:00')
                    const dayLabel = days === 1
                      ? dateObj.toLocaleDateString(undefined, { weekday: 'short' })
                      : dateObj.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                    return <span key={d.date}>{dayLabel}</span>
                  })}
                </div>
              )}
            </div>

            {/* ── Source comparison cards ─────────────────────────── */}
            {sourceFilter === 'all' && (
            <div className="grid grid-cols-2 gap-3">
              {/* OrbitCI */}
              <div className="rounded-lg border border-border bg-card/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CircleDot className="h-4 w-4 text-[#8b5cf6]" />
                  <h2 className="text-[13px] font-semibold">{t('dashboard.sources.title_orbit', 'OrbitCI Runner')}</h2>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {sourceStats.orbit.total} {t('dashboard.chart.runs', 'runs')}
                  </span>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">{t('dashboard.sources.success_rate', 'Success rate')}</span>
                    <span className="font-medium tabular-nums">{sourceStats.orbit.total > 0 ? `${sourceStats.orbit.rate}%` : t('dashboard.sources.no_data', 'No data')}</span>
                  </div>
                  {sourceStats.orbit.total > 0 && (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-[#8b5cf6] transition-all" style={{ width: `${sourceStats.orbit.rate}%` }} />
                    </div>
                  )}
                  {sourceStats.orbit.total > 0 && (
                    <div className="flex gap-3 text-[11px]">
                      <span className="text-[#3fb950]">{sourceStats.orbit.success} {t('dashboard.chart.success', 'Success')}</span>
                      <span className="text-[#f85149]">{sourceStats.orbit.failure} {t('dashboard.chart.failure', 'Failure')}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">{t('dashboard.sources.avg_duration', 'Avg duration')}</span>
                    <span className="font-medium tabular-nums">{sourceStats.orbit.avgMs > 0 ? formatDuration(sourceStats.orbit.avgMs) : t('dashboard.sources.no_data', 'No data')}</span>
                  </div>
                  {sourceStats.orbit.peakCpu > 0 && (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">{t('dashboard.sources.peak_cpu', 'Peak CPU')}</span>
                      <span className="font-medium tabular-nums">{Math.round(sourceStats.orbit.peakCpu)}%</span>
                    </div>
                  )}
                  {sourceStats.orbit.peakRam > 0 && (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">{t('dashboard.sources.peak_ram', 'Peak RAM')}</span>
                      <span className="font-medium tabular-nums">{formatBytes(sourceStats.orbit.peakRam)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* GitHub Actions */}
              <div className="rounded-lg border border-border bg-card/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Github className="h-4 w-4" />
                  <h2 className="text-[13px] font-semibold">{t('dashboard.sources.title_github', 'GitHub Actions')}</h2>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {sourceStats.github.total} {t('dashboard.chart.runs', 'runs')}
                  </span>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">{t('dashboard.sources.success_rate', 'Success rate')}</span>
                    <span className="font-medium tabular-nums">{sourceStats.github.total > 0 ? `${sourceStats.github.rate}%` : t('dashboard.sources.no_data', 'No data')}</span>
                  </div>
                  {sourceStats.github.total > 0 && (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-foreground/60 transition-all" style={{ width: `${sourceStats.github.rate}%` }} />
                    </div>
                  )}
                  {sourceStats.github.total > 0 && (
                    <div className="flex gap-3 text-[11px]">
                      <span className="text-[#3fb950]">{sourceStats.github.success} {t('dashboard.chart.success', 'Success')}</span>
                      <span className="text-[#f85149]">{sourceStats.github.failure} {t('dashboard.chart.failure', 'Failure')}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">{t('dashboard.sources.avg_duration', 'Avg duration')}</span>
                    <span className="font-medium tabular-nums text-muted-foreground/60">—</span>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* ── Repository overview table ──────────────────────── */}
            <section>
              <h2 className="text-[13px] font-semibold text-foreground mb-2 flex items-center gap-2">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                {t('dashboard.repos.title', 'Repository Overview')}
              </h2>
              <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_80px_70px_70px_110px] gap-2 px-4 py-2 border-b border-border bg-muted/30">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t('dashboard.repos.col_repo', 'Repository')}
                  </span>
                  <button onClick={() => handleSort('commits')} className="text-[11px] font-medium text-muted-foreground text-center hover:text-foreground transition-colors flex items-center justify-center gap-0.5">
                    {t('dashboard.repos.col_commits', 'Commits')}
                    {sortField === 'commits' && <span className="text-[9px]">{sortAsc ? '▲' : '▼'}</span>}
                  </button>
                  <button onClick={() => handleSort('changes')} className="text-[11px] font-medium text-muted-foreground text-center hover:text-foreground transition-colors flex items-center justify-center gap-0.5">
                    {t('dashboard.repos.col_changes', 'Changes')}
                    {sortField === 'changes' && <span className="text-[9px]">{sortAsc ? '▲' : '▼'}</span>}
                  </button>
                  <span className="text-[11px] font-medium text-muted-foreground text-center">
                    {t('dashboard.repos.col_orbit', 'OrbitCI')}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground text-center">
                    {t('dashboard.repos.col_github', 'GitHub')}
                  </span>
                  <button onClick={() => handleSort('rate')} className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center justify-end gap-0.5">
                    {t('dashboard.repos.col_rate', 'Success Rate')}
                    {sortField === 'rate' && <span className="text-[9px]">{sortAsc ? '▲' : '▼'}</span>}
                  </button>
                </div>
                {repoOverview.map(({ repo, commits, changes, lastOrbitStatus, lastGhStatus, rate, totalRuns }) => (
                  <button
                    key={repo.id}
                    onClick={() => {
                      setRepoFilter(repo.id)
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    className="grid grid-cols-[1fr_80px_80px_70px_70px_110px] gap-2 px-4 py-2.5 items-center hover:bg-accent/40 transition-colors w-full text-left border-b border-border last:border-b-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <OwnerAvatar owner={repo.owner} className="h-5 w-5 shrink-0" size={24} />
                      <span className="text-[13px] font-medium truncate">{repo.fullName}</span>
                    </div>
                    <span className="text-[12px] tabular-nums text-center text-muted-foreground">
                      {commits > 0 ? commits : t('dashboard.repos.no_commits', '—')}
                    </span>
                    <span className={cn('text-[12px] tabular-nums text-center', changes > 0 ? 'text-[#d29922] font-medium' : 'text-muted-foreground')}>
                      {changes > 0 ? changes : '0'}
                    </span>
                    <div className="flex justify-center">
                      {lastOrbitStatus ? <StatusIcon status={lastOrbitStatus} size="xs" /> : <span className="text-[11px] text-muted-foreground/40">—</span>}
                    </div>
                    <div className="flex justify-center">
                      {lastGhStatus ? <StatusIcon status={lastGhStatus} size="xs" /> : <span className="text-[11px] text-muted-foreground/40">—</span>}
                    </div>
                    <div className="flex items-center gap-1.5 justify-end">
                      {totalRuns > 0 ? (
                        <>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[60px]">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${rate}%`,
                                background: rate >= 80 ? '#3fb950' : rate >= 50 ? '#d29922' : '#f85149'
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right">{rate}%</span>
                        </>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/40">{t('dashboard.repos.no_runs', '—')}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {/* ── Recent runs (unified timeline) ─────────────────── */}
            <section>
              <h2 className="text-[13px] font-semibold text-foreground mb-2 flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                {t('dashboard.recent.title', 'Recent Runs')}
                {recentRuns.length > 0 && (
                  <span className="text-[11px] font-normal text-muted-foreground">({recentRuns.length})</span>
                )}
              </h2>
              {recentRuns.length === 0 ? (
                <div className="rounded-lg border border-border bg-card/50">
                  <EmptyState
                    icon={Inbox}
                    title={t('dashboard.recent.empty_title', 'No runs found')}
                    description={t('dashboard.recent.empty_desc', 'Adjust filters or run a workflow')}
                    className="py-8"
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-card/50 divide-y divide-border">
                  {recentRuns.slice(0, visibleRunsCount).map((run) => {
                    const repo = repos.find((r) => r.id === run.repoId)
                    const isClickable = run.source === 'github' && !!run.htmlUrl
                    return (
                      <div
                        key={`${run.source}-${run.id}`}
                        onClick={() => handleRunClick(run)}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5 transition-colors',
                          isClickable ? 'hover:bg-accent/40 cursor-pointer' : 'hover:bg-accent/20'
                        )}
                      >
                        <StatusIcon status={run.status} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium truncate">{run.name}</span>
                            <StatusBadge status={run.status} />
                            <span className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0',
                              run.source === 'orbit'
                                ? 'bg-[#8b5cf6]/10 text-[#8b5cf6]'
                                : 'bg-foreground/5 text-muted-foreground'
                            )}>
                              {run.source === 'orbit'
                                ? t('dashboard.recent.source_orbit', 'Orbit')
                                : t('dashboard.recent.source_github', 'GitHub')}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                            {repo && <span>{repo.fullName}</span>}
                            <span>{formatRelativeTime(run.createdAt)}</span>
                            {run.durationMs != null && run.durationMs > 0 && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />{formatDuration(run.durationMs)}
                              </span>
                            )}
                            {run.branch && (
                              <span className="flex items-center gap-1">
                                <GitBranch className="h-2.5 w-2.5" />{run.branch}
                              </span>
                            )}
                          </div>
                        </div>
                        {isClickable ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-[11px]">
                              {t('dashboard.recent.open_github', 'Open on GitHub')}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
                        )}
                      </div>
                    )
                  })}
                  {recentRuns.length > visibleRunsCount && (
                    <button
                      onClick={() => setVisibleRunsCount((p) => p + 15)}
                      className="w-full px-4 py-2.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <ChevronDown className="h-3 w-3" />
                      {t('dashboard.recent.load_more', 'Load more')}
                      <span className="text-muted-foreground/60 ml-1">
                        ({visibleRunsCount}/{recentRuns.length})
                      </span>
                    </button>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
    </TooltipProvider>
  )
}
