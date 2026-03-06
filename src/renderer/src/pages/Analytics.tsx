import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2, XCircle, Loader2, Clock, Activity,
  TrendingUp, GitBranch, Zap, BarChart2, ChevronDown,
  ChevronUp, Cpu, MemoryStick, Monitor, X, Filter
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore } from '@/store'
import { cn, formatDuration } from '@/lib/utils'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { Run, RunStatus, GitHubRun } from '@shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────
type DateRange = 'today' | '7d' | '30d' | '90d'
type Source = 'orbit' | 'github'
type SortField = 'total' | 'success' | 'failure' | 'avgDurationMs' | 'rate'
type SortDir = 'asc' | 'desc'

interface TaggedGhRun { repoId: string; run: GitHubRun }

interface RepoStat {
  repoId: string
  total: number
  success: number
  failure: number
  running: number
  avgDurationMs: number
  avgCpu: number | null
  avgRam: number | null
  avgGpu: number | null
}

interface DayBucket {
  label: string
  date: string
  count: number
  failure: number
  success: number
  repos: Map<string, number>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function dateRangeDays(r: DateRange): number {
  return r === 'today' ? 1 : r === '7d' ? 7 : r === '30d' ? 30 : 90
}

function startOfRange(r: DateRange): Date {
  const now = new Date()
  if (r === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const d = new Date(now)
  d.setDate(d.getDate() - (dateRangeDays(r) - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10) }
function buildEmptyBuckets(range: DateRange, i18n: any): DayBucket[] {
  const days = dateRangeDays(range)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (days - 1 - i))
    d.setHours(0, 0, 0, 0)
    return {
      label: d.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' }),
      date: isoDate(d),
      count: 0,
      failure: 0,
      success: 0,
      repos: new Map()
    }
  })
}

function fmtAvg(n: number): string {
  return n === 0 ? '0' : (n % 1 === 0 ? String(n) : n.toFixed(1))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ─── Interactive Bar chart with hover ─────────────────────────────────────────
function InteractiveBarChart({ buckets, color, height = 140 }: {
  buckets: DayBucket[]; color: string; height?: number
}): JSX.Element {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [hoverPctX, setHoverPctX] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)

  const maxVal = Math.max(1, ...buckets.map((b) => b.count))
  const W = 600
  const H = height - 20
  const barW = W / buckets.length
  const gap = 2

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const relX = e.clientX - rect.left
    const pct = relX / rect.width
    const x = pct * W
    const idx = Math.floor(x / barW)
    if (idx >= 0 && idx < buckets.length) {
      setHoverIdx(idx)
      setHoverPctX(pct * 100)
    } else {
      setHoverIdx(null)
    }
  }, [buckets.length, barW])

  const handleMouseLeave = useCallback(() => setHoverIdx(null), [])

  const hoveredBucket = hoverIdx !== null ? buckets[hoverIdx] : null

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = H - pct * H
          return <line key={pct} x1={0} y1={y} x2={W} y2={y} stroke="#2b3040" strokeWidth={0.5} />
        })}

        {/* Bars */}
        {buckets.map((b, i) => {
          const h = (b.count / maxVal) * H
          const fh = (b.failure / maxVal) * H
          const x = i * barW + gap / 2
          const w = barW - gap
          const isHovered = hoverIdx === i
          return (
            <g key={b.date}>
              {/* Hover background */}
              {isHovered && <rect x={i * barW} y={0} width={barW} height={H} fill="#ffffff" opacity={0.03} />}
              {b.count === 0 && <circle cx={x + w / 2} cy={H - 2} r={1.5} fill="#2b3040" />}
              {b.count > 0 && (
                <rect x={x} y={H - h} width={w} height={h} fill={color}
                  opacity={isHovered ? 0.9 : 0.65} rx={2} />
              )}
              {b.failure > 0 && (
                <rect x={x} y={H - fh} width={w} height={fh} fill="#f85149"
                  opacity={isHovered ? 0.7 : 0.5} rx={2} />
              )}
            </g>
          )
        })}

        {/* Bottom line */}
        <line x1={0} y1={H + 1} x2={W} y2={H + 1} stroke="#2b3040" strokeWidth={0.5} />

        {/* X labels */}
        {buckets.map((b, i) => {
          const step = buckets.length <= 7 ? 1 : buckets.length <= 14 ? 2 : buckets.length <= 31 ? 5 : 10
          if (i % step !== 0) return null
          return (
            <text key={b.date} x={i * barW + barW / 2} y={H + 14} fill="#6b7280" fontSize={9}
              textAnchor="middle" className="select-none">
              {b.label}
            </text>
          )
        })}

        {/* Hover indicator line */}
        {hoverIdx !== null && (
          <line x1={hoverIdx * barW + barW / 2} y1={0} x2={hoverIdx * barW + barW / 2} y2={H}
            stroke="#9ca3af" strokeWidth={0.5} strokeDasharray="4,3" />
        )}
      </svg>

      {/* Tooltip */}
      {hoveredBucket && hoverIdx !== null && (
        <div
          className="absolute z-50 rounded-lg border border-border/60 bg-[#161b26] shadow-xl pointer-events-none"
          style={{
            left: `${Math.min(Math.max(hoverPctX, 8), 85)}%`,
            top: -8,
            transform: 'translateX(-50%) translateY(-100%)',
            minWidth: 180
          }}
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-border/40 flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">{hoveredBucket.label}</span>
            <span className="text-[11px] font-bold text-foreground ml-4 tabular-nums">{hoveredBucket.count} exec</span>
          </div>

          {/* Status breakdown */}
          <div className="px-3 py-2 flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#3fb950' }} />
              <span className="tabular-nums font-medium">{hoveredBucket.success}</span>
            </span>
            {hoveredBucket.failure > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#f85149' }} />
                <span className="tabular-nums font-medium">{hoveredBucket.failure}</span>
              </span>
            )}
            {hoveredBucket.count - hoveredBucket.success - hoveredBucket.failure > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#6b7280' }} />
                <span className="tabular-nums font-medium">{hoveredBucket.count - hoveredBucket.success - hoveredBucket.failure}</span>
              </span>
            )}
          </div>

          {/* Per-repo breakdown */}
          {hoveredBucket.repos.size > 0 && (
            <div className="border-t border-border/40 px-3 py-2">
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium mb-1.5">Repositórios</p>
              <div className="space-y-1">
                {Array.from(hoveredBucket.repos.entries())
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([repoId, count]) => {
                    const pct = Math.round((count / hoveredBucket.count) * 100)
                    return (
                      <div key={repoId} className="flex items-center gap-2 text-[11px]">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-foreground/80 truncate">{repoId.split('/')[1] ?? repoId}</span>
                            <span className="text-muted-foreground tabular-nums ml-2 shrink-0">{count}</span>
                          </div>
                          <div className="h-1 rounded-full bg-border/40 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, opacity: 0.6 }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Donut chart ──────────────────────────────────────────────────────────────
function DonutChart({ success, failure, running, cancelled, accentColor, onClickSegment }: {
  success: number; failure: number; running: number; cancelled: number; accentColor: string
  onClickSegment?: (status: RunStatus | null) => void
}): JSX.Element {
  const total = success + failure + running + cancelled
  const r = 24, circ = 2 * Math.PI * r
  if (total === 0) return (
    <svg viewBox="0 0 64 64" className="w-28 h-28">
      <circle cx={32} cy={32} r={r} fill="none" stroke="#2b3040" strokeWidth={10} />
    </svg>
  )
  const segments: { value: number; color: string; status: RunStatus }[] = [
    { value: success, color: '#3fb950', status: 'success' },
    { value: failure, color: '#f85149', status: 'failure' },
    { value: running, color: accentColor, status: 'running' },
    { value: cancelled, color: '#d29922', status: 'cancelled' },
  ]
  let offset = 0
  const arcs = segments.map((seg) => {
    const dash = (seg.value / total) * circ
    const arc = { ...seg, dash, offset }
    offset += dash
    return arc
  })
  return (
    <svg viewBox="0 0 64 64" className="w-28 h-28 -rotate-90">
      {arcs.map((arc, i) => arc.dash > 0 ? (
        <circle key={i} cx={32} cy={32} r={r} fill="none" stroke={arc.color}
          strokeWidth={10} strokeDasharray={`${arc.dash} ${circ - arc.dash}`}
          strokeDashoffset={-arc.offset} strokeLinecap="butt"
          className={onClickSegment ? 'cursor-pointer hover:opacity-80 transition-opacity' : undefined}
          onClick={() => onClickSegment?.(arc.status)} />
      ) : null)}
      <circle cx={32} cy={32} r={19} fill="#121924" />
    </svg>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, iconBg, onClick, active }: {
  icon: React.FC<{ className?: string }>; label: string; value: string | number; sub?: string; iconBg: string
  onClick?: () => void; active?: boolean
}): JSX.Element {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-card px-4 py-3.5 flex items-center gap-3.5 transition-all',
        onClick && 'cursor-pointer hover:border-primary/40 hover:shadow-md',
        active ? 'border-primary ring-1 ring-primary/30' : 'border-border'
      )}
    >
      <div className={cn('rounded-lg p-2.5 shrink-0', iconBg)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground truncate uppercase tracking-wide font-medium">{label}</p>
        <p className="text-[22px] font-bold leading-tight tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Live row ─────────────────────────────────────────────────────────────────
function LiveRow({ run, tick }: { run: Run; tick: number }): JSX.Element {
  void tick
  const elapsed = run.startedAt ? Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000) : null
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-muted/20">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#58a6ff] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{run.workflowName ?? run.workflowFile}</p>
        <p className="text-xs text-muted-foreground truncate">{run.repoId}</p>
      </div>
      {elapsed !== null && (
        <span className="text-xs tabular-nums text-muted-foreground shrink-0 bg-muted px-2 py-0.5 rounded font-mono">
          {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
        </span>
      )}
    </div>
  )
}

// ─── Sortable header ─────────────────────────────────────────────────────────
function SortHeader({ label, field, sortBy, sortDir, onSort, align = 'right' }: {
  label: string; field: SortField; sortBy: SortField; sortDir: SortDir
  onSort: (field: SortField) => void; align?: 'left' | 'right'
}): JSX.Element {
  const isActive = sortBy === field
  return (
    <th
      onClick={() => onSort(field)}
      className={cn(
        'px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none',
        align === 'left' ? 'text-left' : 'text-right',
        isActive ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {isActive && (sortDir === 'asc'
          ? <ChevronUp className="h-3 w-3" />
          : <ChevronDown className="h-3 w-3" />
        )}
      </span>
    </th>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function Analytics(): JSX.Element {
  const { t, i18n } = useTranslation()
  const { repos } = useRepoStore()
  const [range, setRange] = useState<DateRange>('7d')
  const [source, setSource] = useState<Source>('orbit')
  const [repoFilter, setRepoFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<RunStatus | null>(null)
  const [orbitRuns, setOrbitRuns] = useState<Run[]>([])
  const [taggedGhRuns, setTaggedGhRuns] = useState<TaggedGhRun[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [liveRuns, setLiveRuns] = useState<Run[]>([])
  const [tick, setTick] = useState(0)
  const [sortBy, setSortBy] = useState<SortField>('total')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { load() }, [range, repos.length])

  const load = async () => {
    setIsLoading(true)
    try {
      const since = startOfRange(range).toISOString()
      const [allRuns, running] = await Promise.all([
        electron.runs.list({ since, limit: 2000 }),
        electron.runs.list({ status: 'running', limit: 50 })
      ])
      setOrbitRuns(allRuns)
      setLiveRuns(running)

      if (repos.length > 0) {
        const cutoff = startOfRange(range)
        const results = await Promise.allSettled(
          repos.map((r) => electron.runs.listGitHub(r.id, 100).then((runs) => ({ repoId: r.id, runs })))
        )
        const tagged: TaggedGhRun[] = []
        for (const res of results) {
          if (res.status === 'fulfilled') {
            for (const run of res.value.runs) {
              if (new Date(run.runStartedAt ?? run.createdAt) >= cutoff)
                tagged.push({ repoId: res.value.repoId, run })
            }
          }
        }
        setTaggedGhRuns(tagged)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleSort = (field: SortField) => {
    if (sortBy === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('desc') }
  }

  const handleStatusFilter = (status: RunStatus | null) => {
    setStatusFilter((prev) => prev === status ? null : status)
  }

  // ── Filter by selected repo + status ────
  const filteredOrbit = useMemo(() => {
    let filtered = repoFilter === 'all' ? orbitRuns : orbitRuns.filter((r) => r.repoId === repoFilter)
    if (statusFilter) filtered = filtered.filter((r) => r.status === statusFilter)
    return filtered
  }, [orbitRuns, repoFilter, statusFilter])

  const filteredGh = useMemo(() => {
    let filtered = repoFilter === 'all' ? taggedGhRuns.map((t) => t.run) : taggedGhRuns.filter((t) => t.repoId === repoFilter).map((t) => t.run)
    if (statusFilter) {
      const ghStatusMap: Record<string, string> = { success: 'success', failure: 'failure', running: 'in_progress', cancelled: 'cancelled' }
      filtered = filtered.filter((r) =>
        statusFilter === 'running' ? r.status === 'in_progress' : r.conclusion === ghStatusMap[statusFilter]
      )
    }
    return filtered
  }, [taggedGhRuns, repoFilter, statusFilter])

  // ── Compute stats (unfiltered by status for stat cards) ──────
  const orbitStatsAll = useMemo(() => {
    const runs = repoFilter === 'all' ? orbitRuns : orbitRuns.filter((r) => r.repoId === repoFilter)
    const total = runs.length
    const success = runs.filter((r) => r.status === 'success').length
    const failure = runs.filter((r) => r.status === 'failure').length
    const running = runs.filter((r) => r.status === 'running').length
    const cancelled = runs.filter((r) => r.status === 'cancelled').length
    const finished = runs.filter((r) => r.durationMs != null)
    const avgMs = finished.length > 0
      ? Math.round(finished.reduce((s, r) => s + (r.durationMs ?? 0), 0) / finished.length) : 0
    const rate = (success + failure) > 0 ? Math.round((success / (success + failure)) * 100) : 0

    const withCpu = runs.filter((r) => r.peakCpuPercent != null)
    const withRam = runs.filter((r) => r.peakRamBytes != null)
    const withGpu = runs.filter((r) => r.peakGpuPercent != null)
    const avgCpu = withCpu.length > 0 ? withCpu.reduce((s, r) => s + (r.peakCpuPercent ?? 0), 0) / withCpu.length : null
    const avgRam = withRam.length > 0 ? withRam.reduce((s, r) => s + (r.peakRamBytes ?? 0), 0) / withRam.length : null
    const avgGpu = withGpu.length > 0 ? withGpu.reduce((s, r) => s + (r.peakGpuPercent ?? 0), 0) / withGpu.length : null

    return { total, success, failure, running, cancelled, avgMs, rate, avgCpu, avgRam, avgGpu }
  }, [orbitRuns, repoFilter])

  const ghStatsAll = useMemo(() => {
    const runs = repoFilter === 'all' ? taggedGhRuns.map((t) => t.run) : taggedGhRuns.filter((t) => t.repoId === repoFilter).map((t) => t.run)
    const total = runs.length
    const success = runs.filter((r) => r.conclusion === 'success').length
    const failure = runs.filter((r) => r.conclusion === 'failure').length
    const running = runs.filter((r) => r.status === 'in_progress').length
    const cancelled = runs.filter((r) => r.conclusion === 'cancelled').length
    const rate = (success + failure) > 0 ? Math.round((success / (success + failure)) * 100) : 0
    return { total, success, failure, running, cancelled, rate, avgMs: 0, avgCpu: null as number | null, avgRam: null as number | null, avgGpu: null as number | null }
  }, [taggedGhRuns, repoFilter])

  const active = source === 'orbit' ? orbitStatsAll : ghStatsAll
  const accentColor = source === 'orbit' ? '#8b5cf6' : '#58a6ff'

  // ── Day buckets (with repo breakdown) ───────────────
  const buckets = useMemo((): DayBucket[] => {
    const days = buildEmptyBuckets(range, i18n)
    const map = new Map(days.map((b) => [b.date, b]))

    if (source === 'orbit') {
      for (const r of filteredOrbit) {
        const date = (r.startedAt ?? r.createdAt).slice(0, 10)
        const b = map.get(date)
        if (b) {
          b.count++
          if (r.status === 'failure') b.failure++
          if (r.status === 'success') b.success++
          b.repos.set(r.repoId, (b.repos.get(r.repoId) ?? 0) + 1)
        }
      }
    } else {
      for (const t of (repoFilter === 'all' ? taggedGhRuns : taggedGhRuns.filter((t) => t.repoId === repoFilter))) {
        const r = t.run
        if (statusFilter) {
          if (statusFilter === 'running' && r.status !== 'in_progress') continue
          if (statusFilter !== 'running' && r.conclusion !== statusFilter) continue
        }
        const date = (r.runStartedAt ?? r.createdAt).slice(0, 10)
        const b = map.get(date)
        if (b) {
          b.count++
          if (r.conclusion === 'failure') b.failure++
          if (r.conclusion === 'success') b.success++
          b.repos.set(t.repoId, (b.repos.get(t.repoId) ?? 0) + 1)
        }
      }
    }
    return days
  }, [filteredOrbit, taggedGhRuns, range, source, repoFilter, statusFilter])

  // ── Per-repo table ─────────────
  const repoStats = useMemo((): RepoStat[] => {
    const map = new Map<string, RepoStat>()
    if (source === 'orbit') {
      for (const r of filteredOrbit) {
        if (!map.has(r.repoId)) map.set(r.repoId, { repoId: r.repoId, total: 0, success: 0, failure: 0, running: 0, avgDurationMs: 0, avgCpu: null, avgRam: null, avgGpu: null })
        const s = map.get(r.repoId)!
        s.total++
        if (r.status === 'success') s.success++
        if (r.status === 'failure') s.failure++
        if (r.status === 'running') s.running++
        if (r.durationMs) s.avgDurationMs = Math.round((s.avgDurationMs * (s.total - 1) + r.durationMs) / s.total)
        if (r.peakCpuPercent != null) s.avgCpu = ((s.avgCpu ?? 0) * (s.total - 1) + r.peakCpuPercent) / s.total
        if (r.peakRamBytes != null) s.avgRam = ((s.avgRam ?? 0) * (s.total - 1) + r.peakRamBytes) / s.total
      }
    } else {
      for (const { repoId, run: r } of taggedGhRuns) {
        if (statusFilter) {
          if (statusFilter === 'running' && r.status !== 'in_progress') continue
          if (statusFilter !== 'running' && r.conclusion !== statusFilter) continue
        }
        if (repoFilter !== 'all' && repoId !== repoFilter) continue
        if (!map.has(repoId)) map.set(repoId, { repoId, total: 0, success: 0, failure: 0, running: 0, avgDurationMs: 0, avgCpu: null, avgRam: null, avgGpu: null })
        const s = map.get(repoId)!
        s.total++
        if (r.conclusion === 'success') s.success++
        if (r.conclusion === 'failure') s.failure++
        if (r.status === 'in_progress') s.running++
      }
    }

    const arr = Array.from(map.values())
    return arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortBy === 'rate') {
        const rateA = (a.success + a.failure) > 0 ? a.success / (a.success + a.failure) : 0
        const rateB = (b.success + b.failure) > 0 ? b.success / (b.success + b.failure) : 0
        return (rateA - rateB) * dir
      }
      return ((a[sortBy] ?? 0) - (b[sortBy] ?? 0)) * dir
    })
  }, [filteredOrbit, taggedGhRuns, source, statusFilter, repoFilter, sortBy, sortDir])

  const totalRuns = buckets.reduce((s, b) => s + b.count, 0)
  const peakDay = Math.max(0, ...buckets.map((b) => b.count))
  const avgPerDay = buckets.length > 0 ? totalRuns / buckets.length : 0

  const rangeLabels: { value: DateRange; label: string }[] = [
    { value: 'today', label: t('common.time.today', 'Today') },
    { value: '7d', label: t('common.time.days_count', { count: 7, defaultValue: '7 days' }) },
    { value: '30d', label: t('common.time.days_count', { count: 30, defaultValue: '30 days' }) },
    { value: '90d', label: t('common.time.days_count', { count: 90, defaultValue: '90 days' }) },
  ]

  const hasActiveFilters = statusFilter !== null || repoFilter !== 'all'

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="p-6 max-w-6xl mx-auto space-y-5">

        {/* ── Header + Filter Bar ─────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-primary" />
              {t('workspace.analytics.title', 'Analytics')}
            </h1>
          </div>

          {/* Filter bar — all controls in one row */}
          <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border bg-card/50 px-4 py-2.5">
            {/* Source toggle */}
            <div className="flex items-center rounded-lg overflow-hidden border border-border">
              <button
                onClick={() => setSource('orbit')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all',
                  source === 'orbit'
                    ? 'bg-[#8b5cf6] text-white shadow-sm'
                    : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <span className={cn('w-2 h-2 rounded-full', source === 'orbit' ? 'bg-white' : 'bg-[#8b5cf6]')} />
                OrbitCI
              </button>
              <button
                onClick={() => setSource('github')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all',
                  source === 'github'
                    ? 'bg-[#2563eb] text-white shadow-sm'
                    : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <span className={cn('w-2 h-2 rounded-full', source === 'github' ? 'bg-white' : 'bg-[#2563eb]')} />
                GitHub Actions
              </button>
            </div>

            <div className="w-px h-5 bg-border mx-1" />

            {/* Date range */}
            <div className="flex items-center rounded-lg overflow-hidden border border-border">
              {rangeLabels.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRange(r.value)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-all',
                    range === r.value
                      ? 'bg-foreground/10 text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-border mx-1" />

            {/* Repo filter dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                  repoFilter !== 'all'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}>
                  <GitBranch className="h-3 w-3" />
                  <span className="max-w-[140px] truncate">
                    {repoFilter === 'all' ? t('workspace.analytics.all_repos', 'All repos') : (repos.find((r) => r.id === repoFilter)?.name ?? repoFilter.split('/')[1] ?? repoFilter)}
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 text-[13px]">
                <DropdownMenuItem onClick={() => setRepoFilter('all')}>
                  <span className={cn('flex-1', repoFilter === 'all' && 'font-semibold text-primary')}>{t('workspace.analytics.all_repositories', 'All repositories')}</span>
                </DropdownMenuItem>
                {repos.map((r) => (
                  <DropdownMenuItem key={r.id} onClick={() => setRepoFilter(r.id)}>
                    <span className={cn('flex-1 truncate', repoFilter === r.id && 'font-semibold text-primary')}>{r.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Status filter dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                  statusFilter
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}>
                  <Filter className="h-3 w-3" />
                  <span>{statusFilter ? t(`workspace.status.${statusFilter}`, { defaultValue: statusFilter }) : t('workspace.analytics.all_status', 'All status')}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 text-[13px]">
                <DropdownMenuItem onClick={() => setStatusFilter(null)}>
                  <span className={cn('flex-1', !statusFilter && 'font-semibold text-primary')}>{t('workspace.analytics.all_status', 'All status')}</span>
                </DropdownMenuItem>
                {[
                  { status: 'success' as RunStatus, label: t('workspace.status.success', 'Success'), color: '#3fb950' },
                  { status: 'failure' as RunStatus, label: t('workspace.status.failure', 'Failure'), color: '#f85149' },
                  { status: 'running' as RunStatus, label: t('workspace.status.running', 'Running'), color: '#58a6ff' },
                  { status: 'cancelled' as RunStatus, label: t('workspace.status.cancelled', 'Cancelled'), color: '#d29922' },
                ].map((item) => (
                  <DropdownMenuItem key={item.status} onClick={() => setStatusFilter(item.status)}>
                    <span className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ background: item.color }} />
                    <span className={cn('flex-1', statusFilter === item.status && 'font-semibold text-primary')}>{item.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={() => { setStatusFilter(null); setRepoFilter('all') }}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
                {t('common.clear', 'Clear')}
              </button>
            )}

            {/* Summary text */}
            <div className="flex-1" />
            <span className="text-[11px] text-muted-foreground">
              {source === 'orbit' ? t('workspace.analytics.source_orbit_label', 'OrbitCI Local') : 'GitHub Actions'}
              {' — '}{dateRangeDays(range) === 1 ? t('common.time.today', 'today') : t('common.time.last_days_label', { count: dateRangeDays(range), defaultValue: `last ${dateRangeDays(range)} days` })}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* ── Live activity ────────────────────────────────────────── */}
            {source === 'orbit' && liveRuns.length > 0 && (
              <div className="rounded-xl border border-[#58a6ff]/25 bg-[#58a6ff]/5 p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#58a6ff] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#58a6ff]" />
                  </span>
                  <p className="text-xs font-semibold text-[#58a6ff] uppercase tracking-wide">
                    {t('workspace.analytics.live_running_count', { count: liveRuns.length, defaultValue: `${liveRuns.length} running now` })}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {liveRuns.map((r) => <LiveRow key={r.id} run={r} tick={tick} />)}
                </div>
              </div>
            )}

            {/* ── Stat cards ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                icon={Activity} label={t('workspace.analytics.total_runs_label', 'Total runs')} value={active.total}
                iconBg={source === 'orbit' ? 'bg-primary/10 text-primary' : 'bg-[#58a6ff]/10 text-[#58a6ff]'}
                onClick={() => handleStatusFilter(null)}
                active={statusFilter === null}
              />
              <StatCard
                icon={TrendingUp} label={t('workspace.analytics.success_rate_label', 'Success rate')} value={`${active.rate}%`}
                sub={t('workspace.analytics.success_breakdown', { success: active.success, failure: active.failure, defaultValue: `${active.success} ok \u00b7 ${active.failure} failure${active.failure !== 1 ? 's' : ''}` })}
                iconBg="bg-[#3fb950]/10 text-[#3fb950]"
              />
              <StatCard
                icon={Clock} label={t('workspace.analytics.avg_duration_label', 'Average duration')}
                value={source === 'orbit' ? formatDuration(active.avgMs) : '—'}
                sub={source === 'orbit' ? t('workspace.analytics.finished_count', { count: orbitRuns.filter((r) => r.durationMs != null).length, defaultValue: `from ${orbitRuns.filter((r) => r.durationMs != null).length} finished` }) : t('workspace.analytics.no_data_available', 'data unavailable')}
                iconBg="bg-[#d29922]/10 text-[#d29922]"
              />
              <StatCard
                icon={Zap} label={t('workspace.status.running', 'Running')}
                value={source === 'orbit' ? liveRuns.length : active.running}
                sub={active.cancelled > 0 ? t('workspace.analytics.cancelled_count', { count: active.cancelled, defaultValue: `${active.cancelled} cancelled` }) : undefined}
                iconBg="bg-[#58a6ff]/10 text-[#58a6ff]"
              />
            </div>

            {/* ── Resource metric cards (always visible for OrbitCI) ────── */}
            {source === 'orbit' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-border bg-card px-4 py-3.5 flex items-center gap-3">
                  <div className="rounded-lg p-2.5 bg-blue-500/10 shrink-0">
                    <Cpu className="h-4 w-4 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{t('workspace.analytics.avg_peak_cpu', 'Avg Peak CPU')}</p>
                    <p className="text-lg font-bold tabular-nums">{active.avgCpu !== null ? `${active.avgCpu.toFixed(1)}%` : t('common.no_data', 'No data')}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card px-4 py-3.5 flex items-center gap-3">
                  <div className="rounded-lg p-2.5 bg-green-500/10 shrink-0">
                    <MemoryStick className="h-4 w-4 text-green-400" />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{t('workspace.analytics.avg_peak_ram', 'Avg Peak RAM')}</p>
                    <p className="text-lg font-bold tabular-nums">{active.avgRam !== null ? formatBytes(active.avgRam) : t('common.no_data', 'No data')}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card px-4 py-3.5 flex items-center gap-3">
                  <div className="rounded-lg p-2.5 bg-purple-500/10 shrink-0">
                    <Monitor className="h-4 w-4 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{t('workspace.analytics.avg_peak_gpu', 'Avg Peak GPU')}</p>
                    <p className="text-lg font-bold tabular-nums">{active.avgGpu !== null ? `${active.avgGpu.toFixed(1)}%` : 'N/A'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Charts ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Bar chart with hover */}
              <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold">{t('workspace.analytics.runs_per_day_title', 'Executions per day')}</h2>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: accentColor, opacity: 0.7 }} />
                      {source === 'orbit' ? 'OrbitCI' : 'GitHub Actions'}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#f85149] opacity-55" />
                      {t('workspace.status.failure', 'Failure')}
                    </span>
                  </div>
                </div>

                <InteractiveBarChart buckets={buckets} color={accentColor} height={160} />

                <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 text-center gap-2">
                  {[
                    { label: t('common.total', 'Total'), value: String(totalRuns) },
                    { label: t('workspace.analytics.peak_day', 'Peak/day'), value: `${peakDay}` },
                    { label: t('workspace.analytics.avg_day', 'Avg/day'), value: fmtAvg(avgPerDay) },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-sm font-bold tabular-nums">{item.value}</p>
                      <p className="text-[10px] text-muted-foreground">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Donut */}
              <div className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold mb-3">{t('workspace.analytics.distribution_title', 'Distribution')}</h2>
                <div className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <DonutChart
                      success={active.success} failure={active.failure}
                      running={active.running} cancelled={active.cancelled}
                      accentColor={accentColor}
                      onClickSegment={(status) => handleStatusFilter(status)}
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                        <p className="text-xl font-bold leading-none">{active.total}</p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">{t('workspace.analytics.runs_label', 'runs')}</p>
                      </div>
                    </div>
                  </div>
                  <div className="w-full space-y-1.5">
                    {[
                      { label: t('workspace.status.success', 'Success'), color: '#3fb950', value: active.success, status: 'success' as RunStatus },
                      { label: t('workspace.status.failure', 'Failure'), color: '#f85149', value: active.failure, status: 'failure' as RunStatus },
                      { label: t('workspace.status.running', 'Running'), color: accentColor, value: active.running, status: 'running' as RunStatus },
                      { label: t('workspace.status.cancelled', 'Cancelled'), color: '#d29922', value: active.cancelled, status: 'cancelled' as RunStatus },
                    ].map((item) => {
                      const pct = active.total > 0 ? Math.round((item.value / active.total) * 100) : 0
                      return (
                        <div
                          key={item.label}
                          className={cn(
                            'flex items-center gap-2 px-1.5 py-0.5 rounded cursor-pointer transition-colors hover:bg-muted/40',
                            statusFilter === item.status && 'bg-muted/60'
                          )}
                          onClick={() => handleStatusFilter(item.status)}
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
                          <span className="text-xs text-muted-foreground flex-1">{item.label}</span>
                          <span className="text-xs font-semibold tabular-nums">{item.value}</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Success rate bar ─────────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">{t('workspace.analytics.performance_title', 'General performance')}</h2>
                <span className="text-[11px] text-muted-foreground">{t('workspace.analytics.runs_in_period_count', { count: active.total, defaultValue: `${active.total} runs in selected period` })}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: t('workspace.status.success', 'Success'), value: active.success, color: 'text-[#3fb950]', icon: CheckCircle2, bg: 'bg-[#3fb950]/8', status: 'success' as RunStatus },
                  { label: t('workspace.status.failure', 'Failure'), value: active.failure, color: 'text-[#f85149]', icon: XCircle, bg: 'bg-[#f85149]/8', status: 'failure' as RunStatus },
                  { label: t('workspace.status.running', 'Running'), value: active.running, color: 'text-[#58a6ff]', icon: Loader2, bg: 'bg-[#58a6ff]/8', status: 'running' as RunStatus },
                  { label: t('workspace.status.cancelled', 'Cancelled'), value: active.cancelled, color: 'text-[#d29922]', icon: Clock, bg: 'bg-[#d29922]/8', status: 'cancelled' as RunStatus },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={cn(
                      'rounded-lg p-3 flex items-center gap-2.5 cursor-pointer transition-all hover:ring-1 hover:ring-primary/30',
                      item.bg,
                      statusFilter === item.status && 'ring-1 ring-primary/50'
                    )}
                    onClick={() => handleStatusFilter(item.status)}
                  >
                    <item.icon className={cn('h-4 w-4 shrink-0', item.color)} />
                    <div>
                      <p className={cn('text-xl font-bold leading-none', item.color)}>{item.value}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{t('workspace.analytics.success_rate_label', 'Success rate')}</span>
                  <span className="font-semibold text-foreground">{active.rate}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${active.rate}%`, background: accentColor }} />
                </div>
              </div>
            </div>

            {/* ── Per-repo table (sortable, clickable) ─────────────────── */}
            {repoStats.length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{t('workspace.analytics.by_repo_title', 'By repository')}</h2>
                  <span className="text-[11px] text-muted-foreground">{t('workspace.analytics.click_to_filter', { count: repoStats.length, defaultValue: `${repoStats.length} repos \u00b7 click to filter` })}</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-left">
                        {t('common.repository', 'Repository')}
                      </th>
                      <SortHeader label={t('common.total', 'Total')} field="total" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label={t('workspace.status.success', 'Success')} field="success" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader label={t('workspace.status.failure', 'Failure')} field="failure" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      {source === 'orbit' && (
                        <SortHeader label="Avg" field="avgDurationMs" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      )}
                      <SortHeader label={t('workspace.analytics.rate_label', 'Rate')} field="rate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="left" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {repoStats.map((s) => {
                      const rate = (s.success + s.failure) > 0
                        ? Math.round((s.success / (s.success + s.failure)) * 100) : 0
                      const isSelected = repoFilter === s.repoId
                      return (
                        <tr
                          key={s.repoId}
                          className={cn(
                            'hover:bg-muted/20 transition-colors cursor-pointer',
                            isSelected && 'bg-primary/5 hover:bg-primary/8'
                          )}
                          onClick={() => setRepoFilter(isSelected ? 'all' : s.repoId)}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                              <div>
                                <p className="text-sm font-medium truncate max-w-[180px]">
                                  {s.repoId.split('/')[1] ?? s.repoId}
                                </p>
                                <p className="text-[10px] text-muted-foreground">{s.repoId.split('/')[0]}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-sm tabular-nums font-semibold">{s.total}</td>
                          <td className="px-4 py-2.5 text-right text-sm tabular-nums text-[#3fb950] font-medium">{s.success}</td>
                          <td className="px-4 py-2.5 text-right text-sm tabular-nums text-[#f85149] font-medium">{s.failure}</td>
                          {source === 'orbit' && (
                            <td className="px-4 py-2.5 text-right text-sm tabular-nums text-muted-foreground">
                              {formatDuration(s.avgDurationMs)}
                            </td>
                          )}
                          <td className="px-4 py-2.5 min-w-[120px]">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${rate}%`, background: accentColor }} />
                              </div>
                              <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">{rate}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Empty state ──────────────────────────────────────────── */}
            {active.total === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-border bg-card/50">
                {source === 'github' ? (
                  <GitBranch className="h-10 w-10 text-muted-foreground/20 mb-3" />
                ) : (
                  <BarChart2 className="h-10 w-10 text-muted-foreground/20 mb-3" />
                )}
                <h3 className="text-base font-semibold">{t('workspace.analytics.no_data_title', 'No data in period')}</h3>
                <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                  {source === 'github'
                    ? t('workspace.analytics.no_data_desc_gh', 'Configure a GitHub token in settings to load remote executions')
                    : t('workspace.analytics.no_data_desc_orbit', 'Run a local workflow to see statistics here')}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
