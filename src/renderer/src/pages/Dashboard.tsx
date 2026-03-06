import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis,
  Pie, PieChart, RadialBar, RadialBarChart, PolarAngleAxis,
  Label as RechartsLabel, Cell, Tooltip as ReTooltip
} from 'recharts'
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Calendar,
  CheckCircle2, ChevronDown, CircleDot, Clock, Code2, ExternalLink,
  Filter, GitBranch, GitPullRequest, Inbox, Loader2, Play,
  RefreshCw, Rocket, Star, Timer, TrendingDown, TrendingUp,
  Users, XCircle, Zap
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
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig
} from '@/components/ui/chart'
import type { Run, RunStatus, GitHubRun } from '@shared/types'

// ─── Types ──────────────────────────────────────────────────────────────────────

type DateRange = 'today' | '7d' | '30d'
type StatusFilter = 'all' | RunStatus
type SourceFilter = 'all' | 'orbit' | 'github'
type ChartMode = 'bar' | 'area'

interface DayBucket {
  date: string
  label: string
  total: number
  success: number
  failure: number
  other: number
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

interface RepoStatsData {
  stargazersCount: number
  forksCount: number
  openIssuesCount: number
  watchersCount: number
  size: number
  language: string | null
}

interface PrCountsData {
  open: number
  closed: number
  merged: number
}

interface CommitActivityWeek {
  week: number
  total: number
  days: number[]
}

interface ContributorData {
  login: string
  avatarUrl: string
  contributions: number
}

// ─── Chart configs ──────────────────────────────────────────────────────────────

const activityChartConfig = {
  success: { label: 'Success', color: '#3fb950' },
  failure: { label: 'Failure', color: '#f85149' },
  other: { label: 'Other', color: 'hsl(var(--muted-foreground) / 0.25)' }
} satisfies ChartConfig

const statusPieConfig = {
  success: { label: 'Success', color: '#3fb950' },
  failure: { label: 'Failure', color: '#f85149' },
  running: { label: 'Running', color: '#58a6ff' },
  cancelled: { label: 'Cancelled', color: '#d29922' },
  pending: { label: 'Pending', color: 'hsl(var(--muted-foreground) / 0.4)' }
} satisfies ChartConfig

const sourceRadialConfig = {
  orbit: { label: 'OrbitCI', color: '#8b5cf6' },
  github: { label: 'GitHub', color: 'hsl(var(--foreground) / 0.6)' }
} satisfies ChartConfig

const prChartConfig = {
  open: { label: 'Open', color: '#3fb950' },
  closed: { label: 'Closed', color: '#f85149' },
  merged: { label: 'Merged', color: '#8b5cf6' }
} satisfies ChartConfig

const commitActivityConfig = {
  total: { label: 'Commits', color: '#58a6ff' }
} satisfies ChartConfig

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f7df1e', Python: '#3572A5',
  Rust: '#dea584', Go: '#00ADD8', Java: '#b07219', Ruby: '#701516',
  'C++': '#f34b7d', C: '#555555', 'C#': '#178600', PHP: '#4F5D95',
  Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB', Shell: '#89e051',
  HTML: '#e34c26', CSS: '#563d7c', SCSS: '#c6538c', Vue: '#41b883',
  Svelte: '#ff3e00'
}

function getLangColor(lang: string): string {
  return LANG_COLORS[lang] ?? `hsl(${(lang.charCodeAt(0) * 37) % 360}, 55%, 55%)`
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
    const success = dayItems.filter((r) => r.status === 'success').length
    const failure = dayItems.filter((r) => r.status === 'failure').length
    const dateObj = new Date(date + 'T12:00:00')
    const label = days === 1
      ? dateObj.toLocaleDateString(undefined, { weekday: 'short' })
      : dateObj.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    result.push({
      date, label,
      total: dayItems.length,
      success, failure,
      other: dayItems.length - success - failure
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

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
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

function StatCard({ icon: Icon, label, value, detail, iconColor, onClick, active }: {
  icon: React.ElementType
  label: string
  value: string | number
  detail?: React.ReactNode
  iconColor?: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg border px-4 py-3 text-left transition-all',
        active
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
          : 'border-border bg-card/50 hover:border-border/80 hover:bg-card/70',
        onClick && 'cursor-pointer'
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-[20px] font-semibold text-foreground leading-tight tabular-nums">{value}</p>
      {detail && <div className="text-[11px] text-muted-foreground mt-0.5">{detail}</div>}
    </button>
  )
}

function MiniStatCard({ icon: Icon, label, value, iconColor }: {
  icon: React.ElementType
  label: string
  value: string | number
  iconColor?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
        <Icon className={cn('h-3 w-3', iconColor)} />
        <span className="text-[10px] font-medium">{label}</span>
      </div>
      <p className="text-[16px] font-semibold text-foreground leading-tight tabular-nums">{value}</p>
    </div>
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
  const [chartMode, setChartMode] = useState<ChartMode>('area')
  const [visibleRunsCount, setVisibleRunsCount] = useState(15)

  // Data
  const [orbitRuns, setOrbitRuns] = useState<Run[]>([])
  const [ghRuns, setGhRuns] = useState<(GitHubRun & { _repoId: string })[]>([])
  const [commitCounts, setCommitCounts] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // GitHub analytics data
  const [repoStatsMap, setRepoStatsMap] = useState<Record<string, RepoStatsData>>({})
  const [prCountsMap, setPrCountsMap] = useState<Record<string, PrCountsData>>({})
  const [commitActivity, setCommitActivity] = useState<CommitActivityWeek[]>([])
  const [contributors, setContributors] = useState<ContributorData[]>([])
  const [languages, setLanguages] = useState<Record<string, number>>({})

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

  const loadGitHubAnalytics = useCallback(async () => {
    const statsMap: Record<string, RepoStatsData> = {}
    const prMap: Record<string, PrCountsData> = {}
    let allActivity: CommitActivityWeek[] = []
    let allContributors: ContributorData[] = []
    let allLanguages: Record<string, number> = {}

    // Pick the target repo(s) for analytics
    const targetRepos = repoFilter !== 'all'
      ? repos.filter((r) => r.id === repoFilter)
      : repos

    await Promise.allSettled(
      targetRepos.map(async (repo) => {
        try {
          const [stats, prs, activity, contribs, langs] = await Promise.allSettled([
            electron.runs.getRepoStats(repo.id),
            electron.runs.getPrCounts(repo.id),
            electron.runs.getCommitActivity(repo.id),
            electron.runs.getContributors(repo.id, 10),
            electron.runs.getLanguages(repo.id)
          ])
          if (stats.status === 'fulfilled') statsMap[repo.id] = stats.value
          if (prs.status === 'fulfilled') prMap[repo.id] = prs.value
          if (activity.status === 'fulfilled' && activity.value.length > 0) {
            if (targetRepos.length === 1) {
              allActivity = activity.value
            } else if (allActivity.length === 0) {
              allActivity = activity.value
            } else {
              // Merge weekly data
              for (let i = 0; i < activity.value.length && i < allActivity.length; i++) {
                allActivity[i] = {
                  ...allActivity[i],
                  total: allActivity[i].total + activity.value[i].total
                }
              }
            }
          }
          if (contribs.status === 'fulfilled') {
            for (const c of contribs.value) {
              const existing = allContributors.find((e) => e.login === c.login)
              if (existing) existing.contributions += c.contributions
              else allContributors.push({ ...c })
            }
          }
          if (langs.status === 'fulfilled') {
            for (const [lang, bytes] of Object.entries(langs.value)) {
              allLanguages[lang] = (allLanguages[lang] ?? 0) + bytes
            }
          }
        } catch { /* skip */ }
      })
    )

    allContributors.sort((a, b) => b.contributions - a.contributions)
    allContributors = allContributors.slice(0, 10)

    setRepoStatsMap(statsMap)
    setPrCountsMap(prMap)
    setCommitActivity(allActivity)
    setContributors(allContributors)
    setLanguages(allLanguages)
  }, [repos, repoFilter])

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

  const [didInitialLoad, setDidInitialLoad] = useState(false)
  useEffect(() => {
    loadAll().then(() => setDidInitialLoad(true))
  }, [loadAll])

  // Load GitHub analytics after initial load
  useEffect(() => {
    if (didInitialLoad) loadGitHubAnalytics()
  }, [didInitialLoad, loadGitHubAnalytics])

  useEffect(() => {
    if (didInitialLoad) loadAll(true)
  }, [dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([loadAll(), loadGitHubAnalytics()])
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

    const cancelledCurr = activeOrbit.filter((r) => r.status === 'cancelled').length +
      activeGh.filter((r) => r._status === 'cancelled').length
    const pendingCurr = activeOrbit.filter((r) => r.status === 'pending').length +
      activeGh.filter((r) => r._status === 'pending').length

    const statusBreakdown = [
      { status: 'success', count: successCurr, fill: '#3fb950' },
      { status: 'failure', count: failureCurr, fill: '#f85149' },
      { status: 'running', count: runningCurr, fill: '#58a6ff' },
      { status: 'cancelled', count: cancelledCurr, fill: '#d29922' },
      { status: 'pending', count: pendingCurr, fill: 'hsl(var(--muted-foreground) / 0.4)' }
    ].filter((d) => d.count > 0)

    return {
      totalCurr, successCurr, failureCurr, runningCurr,
      rateCurr, rateDelta, failDelta, avgMs,
      statusBreakdown
    }
  }, [filteredOrbit, filteredGh, prevOrbit, prevGh, sourceFilter])

  const chartData = useMemo(() => {
    const orbitNorm = (sourceFilter !== 'github' ? filteredOrbit : [])
      .map((r) => ({ createdAt: r.createdAt, status: r.status }))
    const ghNorm = (sourceFilter !== 'orbit' ? filteredGh : [])
      .map((r) => ({ createdAt: r.createdAt, status: r._status }))
    return groupByDay([...orbitNorm, ...ghNorm], days)
  }, [filteredOrbit, filteredGh, sourceFilter, days])

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

  // ── Aggregated GitHub stats ───────────────────────────────────────────────

  const aggregatedRepoStats = useMemo(() => {
    const values = Object.values(repoStatsMap)
    if (values.length === 0) return null
    return {
      stars: values.reduce((s, v) => s + v.stargazersCount, 0),
      forks: values.reduce((s, v) => s + v.forksCount, 0),
      openIssues: values.reduce((s, v) => s + v.openIssuesCount, 0),
      watchers: values.reduce((s, v) => s + v.watchersCount, 0)
    }
  }, [repoStatsMap])

  const aggregatedPrCounts = useMemo(() => {
    const values = Object.values(prCountsMap)
    if (values.length === 0) return null
    return {
      open: values.reduce((s, v) => s + v.open, 0),
      closed: values.reduce((s, v) => s + v.closed, 0),
      merged: values.reduce((s, v) => s + v.merged, 0)
    }
  }, [prCountsMap])

  // Commit activity chart data (last 12 weeks)
  const commitChartData = useMemo(() => {
    if (commitActivity.length === 0) return []
    const recent = commitActivity.slice(-12)
    return recent.map((w) => {
      const d = new Date(w.week * 1000)
      return {
        label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        total: w.total
      }
    })
  }, [commitActivity])

  // Language pie data
  const languageChartData = useMemo(() => {
    const entries = Object.entries(languages)
    if (entries.length === 0) return []
    const totalBytes = entries.reduce((s, [, b]) => s + b, 0)
    const sorted = entries.sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 8)
    const otherBytes = sorted.slice(8).reduce((s, [, b]) => s + b, 0)
    const result = top.map(([lang, bytes]) => ({
      name: lang,
      value: bytes,
      pct: Math.round((bytes / totalBytes) * 100),
      fill: getLangColor(lang)
    }))
    if (otherBytes > 0) {
      result.push({
        name: 'Other',
        value: otherBytes,
        pct: Math.round((otherBytes / totalBytes) * 100),
        fill: 'hsl(var(--muted-foreground) / 0.3)'
      })
    }
    return result
  }, [languages])

  // PR chart data
  const prChartData = useMemo(() => {
    if (!aggregatedPrCounts) return []
    return [
      { name: 'Open', value: aggregatedPrCounts.open, fill: '#3fb950' },
      { name: 'Closed', value: aggregatedPrCounts.closed, fill: '#f85149' },
      { name: 'Merged', value: aggregatedPrCounts.merged, fill: '#8b5cf6' }
    ].filter((d) => d.value > 0)
  }, [aggregatedPrCounts])

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

  const langChartConfig: ChartConfig = {}
  for (const d of languageChartData) {
    langChartConfig[d.name] = { label: d.name, color: d.fill }
  }

  return (
    <TooltipProvider>
    <div className="h-full overflow-auto">
      <div className="max-w-[1080px] mx-auto px-6 py-6 space-y-5">

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
          {(statusFilter !== 'all' || sourceFilter !== 'all' || repoFilter !== 'all') && (
            <button
              onClick={() => { setStatusFilter('all'); setSourceFilter('all'); setRepoFilter('all') }}
              className="px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {t('common.clear', 'Clear')}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-[13px]">{t('common.loading', 'Loading...')}</span>
          </div>
        ) : (
          <>
            {/* ── Stat cards ─────────────────────────────────────── */}
            <div className="grid grid-cols-5 gap-3">
              <StatCard
                icon={Play} label={t('dashboard.stats.total_runs', 'Total Runs')}
                value={stats.totalCurr}
                detail={t('dashboard.stats.in_period', 'in period')}
                iconColor="text-[#8b5cf6]"
                onClick={() => setStatusFilter('all')}
                active={statusFilter === 'all'}
              />
              <StatCard
                icon={CheckCircle2} label={t('dashboard.stats.success_rate', 'Success Rate')}
                value={stats.totalCurr > 0 ? `${stats.rateCurr}%` : t('dashboard.stats.no_data', '\u2014')}
                detail={stats.rateDelta !== null ? (
                  <span className={cn('flex items-center gap-0.5', stats.rateDelta >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]')}>
                    {stats.rateDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {Math.abs(stats.rateDelta)}% {t('dashboard.stats.vs_prev', 'vs prev.')}
                  </span>
                ) : undefined}
                iconColor={stats.rateCurr >= 80 ? 'text-[#3fb950]' : stats.rateCurr >= 50 ? 'text-[#d29922]' : stats.rateCurr > 0 ? 'text-[#f85149]' : 'text-muted-foreground'}
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
                value={stats.avgMs > 0 ? formatDuration(stats.avgMs) : t('dashboard.stats.no_data', '\u2014')}
                detail={stats.avgMs > 0 ? 'OrbitCI' : undefined}
                iconColor="text-muted-foreground"
              />
            </div>

            {/* ── Activity chart (recharts) ──────────────────────── */}
            <div className="rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                  <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('dashboard.chart.title', 'Activity')}
                </h2>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-[#3fb950]" /> {t('dashboard.chart.success', 'Success')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-[#f85149]" /> {t('dashboard.chart.failure', 'Failure')}
                    </span>
                  </div>
                  <div className="flex items-center rounded-md border border-border overflow-hidden">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setChartMode('area')}
                          className={cn(
                            'flex items-center justify-center w-7 h-6 transition-colors',
                            chartMode === 'area'
                              ? 'bg-primary/15 text-primary'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          )}
                        >
                          <Activity className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-[11px]">{t('dashboard.chart.area_view', 'Area chart')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setChartMode('bar')}
                          className={cn(
                            'flex items-center justify-center w-7 h-6 transition-colors',
                            chartMode === 'bar'
                              ? 'bg-primary/15 text-primary'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          )}
                        >
                          <BarChart3 className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-[11px]">{t('dashboard.chart.bar_view', 'Bar chart')}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>

              <ChartContainer config={activityChartConfig} className="h-[180px] w-full">
                {chartMode === 'area' ? (
                  <AreaChart data={chartData} accessibilityLayer>
                    <defs>
                      <linearGradient id="fillSuccess" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3fb950" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3fb950" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="fillFailure" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f85149" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f85149" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={10}
                      interval={days > 14 ? Math.floor(days / 7) : 0} />
                    <YAxis tickLine={false} axisLine={false} width={28} fontSize={10} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                    <Area dataKey="success" type="monotone" fill="url(#fillSuccess)" stroke="#3fb950" strokeWidth={1.5} stackId="a" />
                    <Area dataKey="failure" type="monotone" fill="url(#fillFailure)" stroke="#f85149" strokeWidth={1.5} stackId="a" />
                  </AreaChart>
                ) : (
                  <BarChart data={chartData} accessibilityLayer>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={10}
                      interval={days > 14 ? Math.floor(days / 7) : 0} />
                    <YAxis tickLine={false} axisLine={false} width={28} fontSize={10} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                    <Bar dataKey="success" fill="#3fb950" radius={[3, 3, 0, 0]} stackId="a" />
                    <Bar dataKey="failure" fill="#f85149" radius={[3, 3, 0, 0]} stackId="a" />
                  </BarChart>
                )}
              </ChartContainer>
            </div>

            {/* ── Charts row: Status distribution + Source comparison + Performance ── */}
            <div className="grid grid-cols-3 gap-3">

              {/* Status distribution (Donut/Pie chart) */}
              <div className="rounded-lg border border-border bg-card/50 p-4">
                <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
                  <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('dashboard.analytics.distribution_title', 'Distribution')}
                </h2>
                {stats.statusBreakdown.length > 0 ? (
                  <ChartContainer config={statusPieConfig} className="h-[160px] w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent nameKey="status" hideLabel />} />
                      <Pie
                        data={stats.statusBreakdown}
                        dataKey="count"
                        nameKey="status"
                        innerRadius={45}
                        outerRadius={65}
                        strokeWidth={2}
                        stroke="hsl(var(--background))"
                      >
                        {stats.statusBreakdown.map((entry) => (
                          <Cell key={entry.status} fill={entry.fill} />
                        ))}
                        <RechartsLabel
                          content={({ viewBox }) => {
                            if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                              return (
                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                  <tspan x={viewBox.cx} y={(viewBox.cy || 0) - 6} className="fill-foreground text-xl font-bold">
                                    {stats.totalCurr}
                                  </tspan>
                                  <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 10} className="fill-muted-foreground text-[10px]">
                                    {t('dashboard.chart.runs', 'runs')}
                                  </tspan>
                                </text>
                              )
                            }
                            return null
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                ) : (
                  <div className="h-[160px] flex items-center justify-center text-[12px] text-muted-foreground">
                    {t('dashboard.chart.no_data', 'No activity in this period')}
                  </div>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  {stats.statusBreakdown.map((d) => (
                    <span key={d.status} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.fill }} />
                      {statusPieConfig[d.status as keyof typeof statusPieConfig]?.label ?? d.status} ({d.count})
                    </span>
                  ))}
                </div>
              </div>

              {/* Source comparison (Radial bar chart) */}
              {sourceFilter === 'all' && (
              <div className="rounded-lg border border-border bg-card/50 p-4">
                <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
                  <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('dashboard.sources.success_rate', 'Success Rate')}
                </h2>
                {(sourceStats.orbit.total > 0 || sourceStats.github.total > 0) ? (
                  <ChartContainer config={sourceRadialConfig} className="h-[160px] w-full">
                    <RadialBarChart
                      data={[
                        { name: 'GitHub', rate: sourceStats.github.rate, fill: 'hsl(var(--foreground) / 0.5)' },
                        { name: 'OrbitCI', rate: sourceStats.orbit.rate, fill: '#8b5cf6' }
                      ]}
                      innerRadius={35}
                      outerRadius={70}
                      startAngle={180}
                      endAngle={0}
                      barSize={10}
                    >
                      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} angleAxisId={0} />
                      <RadialBar dataKey="rate" background={{ fill: 'hsl(var(--muted) / 0.5)' }} cornerRadius={5} angleAxisId={0} />
                      <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                    </RadialBarChart>
                  </ChartContainer>
                ) : (
                  <div className="h-[160px] flex items-center justify-center text-[12px] text-muted-foreground">
                    {t('dashboard.sources.no_data', 'No data')}
                  </div>
                )}
                <div className="space-y-1.5 mt-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-[#8b5cf6]" />
                      <span className="text-muted-foreground">OrbitCI</span>
                    </span>
                    <span className="font-medium tabular-nums">
                      {sourceStats.orbit.total > 0 ? `${sourceStats.orbit.rate}%` : '\u2014'}
                      <span className="text-muted-foreground/60 ml-1">({sourceStats.orbit.total})</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-foreground/50" />
                      <span className="text-muted-foreground">GitHub</span>
                    </span>
                    <span className="font-medium tabular-nums">
                      {sourceStats.github.total > 0 ? `${sourceStats.github.rate}%` : '\u2014'}
                      <span className="text-muted-foreground/60 ml-1">({sourceStats.github.total})</span>
                    </span>
                  </div>
                </div>
              </div>
              )}

              {/* Performance metrics card */}
              <div className="rounded-lg border border-border bg-card/50 p-4">
                <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('dashboard.analytics.performance_title', 'Performance')}
                </h2>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-muted-foreground">{t('dashboard.sources.avg_duration', 'Avg duration')}</span>
                      <span className="font-medium tabular-nums">{sourceStats.orbit.avgMs > 0 ? formatDuration(sourceStats.orbit.avgMs) : '\u2014'}</span>
                    </div>
                    {sourceStats.orbit.avgMs > 0 && (
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-[#8b5cf6]/60 transition-all" style={{ width: `${Math.min(100, (sourceStats.orbit.avgMs / 300000) * 100)}%` }} />
                      </div>
                    )}
                  </div>
                  {sourceStats.orbit.peakCpu > 0 && (
                    <div>
                      <div className="flex items-center justify-between text-[12px] mb-1">
                        <span className="text-muted-foreground">{t('dashboard.sources.peak_cpu', 'Peak CPU')}</span>
                        <span className="font-medium tabular-nums">{Math.round(sourceStats.orbit.peakCpu)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, sourceStats.orbit.peakCpu)}%`,
                            background: sourceStats.orbit.peakCpu > 80 ? '#f85149' : sourceStats.orbit.peakCpu > 50 ? '#d29922' : '#3fb950'
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {sourceStats.orbit.peakRam > 0 && (
                    <div>
                      <div className="flex items-center justify-between text-[12px] mb-1">
                        <span className="text-muted-foreground">{t('dashboard.sources.peak_ram', 'Peak RAM')}</span>
                        <span className="font-medium tabular-nums">{formatBytes(sourceStats.orbit.peakRam)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-[#58a6ff]/60 transition-all" style={{ width: `${Math.min(100, (sourceStats.orbit.peakRam / (4 * 1024 * 1024 * 1024)) * 100)}%` }} />
                      </div>
                    </div>
                  )}
                  {sourceStats.orbit.peakCpu === 0 && sourceStats.orbit.peakRam === 0 && sourceStats.orbit.avgMs === 0 && (
                    <div className="h-[120px] flex items-center justify-center text-[12px] text-muted-foreground">
                      {t('dashboard.sources.no_data', 'No data')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── GitHub Stats Cards (stars, forks, issues, PRs) ── */}
            {aggregatedRepoStats && (
              <div className="grid grid-cols-6 gap-3">
                <MiniStatCard icon={Star} label={t('dashboard.github.stars', 'Stars')} value={formatNumber(aggregatedRepoStats.stars)} iconColor="text-[#d29922]" />
                <MiniStatCard icon={GitBranch} label={t('dashboard.github.forks', 'Forks')} value={formatNumber(aggregatedRepoStats.forks)} iconColor="text-muted-foreground" />
                <MiniStatCard icon={CircleDot} label={t('dashboard.github.open_issues', 'Open Issues')} value={formatNumber(aggregatedRepoStats.openIssues)} iconColor="text-[#f85149]" />
                <MiniStatCard icon={Users} label={t('dashboard.github.watchers', 'Watchers')} value={formatNumber(aggregatedRepoStats.watchers)} iconColor="text-[#58a6ff]" />
                {aggregatedPrCounts && (
                  <>
                    <MiniStatCard icon={GitPullRequest} label={t('dashboard.github.prs_open', 'PRs Open')} value={aggregatedPrCounts.open} iconColor="text-[#3fb950]" />
                    <MiniStatCard icon={GitPullRequest} label={t('dashboard.github.prs_merged', 'PRs Merged')} value={aggregatedPrCounts.merged} iconColor="text-[#8b5cf6]" />
                  </>
                )}
              </div>
            )}

            {/* ── GitHub Charts row: Commit Activity + Languages + PRs / Contributors ── */}
            {(commitChartData.length > 0 || languageChartData.length > 0 || contributors.length > 0) && (
              <div className="grid grid-cols-2 gap-3">

                {/* Commit activity (Area chart) */}
                {commitChartData.length > 0 && (
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                      {t('dashboard.github.commit_activity', 'Commit Activity')}
                      <span className="text-[11px] font-normal text-muted-foreground">{t('dashboard.github.last_12_weeks', 'last 12 weeks')}</span>
                    </h2>
                    <ChartContainer config={commitActivityConfig} className="h-[160px] w-full">
                      <AreaChart data={commitChartData} accessibilityLayer>
                        <defs>
                          <linearGradient id="fillCommits" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#58a6ff" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#58a6ff" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={10} />
                        <YAxis tickLine={false} axisLine={false} width={28} fontSize={10} allowDecimals={false} />
                        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                        <Area dataKey="total" type="monotone" fill="url(#fillCommits)" stroke="#58a6ff" strokeWidth={1.5} />
                      </AreaChart>
                    </ChartContainer>
                  </div>
                )}

                {/* Language breakdown (Pie chart) */}
                {languageChartData.length > 0 && (
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {t('dashboard.github.languages', 'Languages')}
                    </h2>
                    <div className="flex items-start gap-4">
                      <ChartContainer config={langChartConfig} className="h-[140px] w-[140px] shrink-0">
                        <PieChart>
                          <ReTooltip
                            content={({ active, payload }) => {
                              if (active && payload?.[0]) {
                                const d = payload[0].payload
                                return (
                                  <div className="rounded-md border border-border bg-popover px-3 py-1.5 text-[11px] shadow-md">
                                    <span className="font-medium">{d.name}</span>
                                    <span className="text-muted-foreground ml-1.5">{d.pct}%</span>
                                  </div>
                                )
                              }
                              return null
                            }}
                          />
                          <Pie
                            data={languageChartData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={35}
                            outerRadius={60}
                            strokeWidth={2}
                            stroke="hsl(var(--background))"
                          >
                            {languageChartData.map((entry) => (
                              <Cell key={entry.name} fill={entry.fill} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ChartContainer>
                      <div className="flex-1 space-y-1 pt-1">
                        {languageChartData.map((d) => (
                          <div key={d.name} className="flex items-center gap-2 text-[11px]">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.fill }} />
                            <span className="text-foreground flex-1 truncate">{d.name}</span>
                            <span className="text-muted-foreground tabular-nums">{d.pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Pull Request breakdown */}
                {prChartData.length > 0 && (
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
                      <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
                      {t('dashboard.github.pull_requests', 'Pull Requests')}
                    </h2>
                    <ChartContainer config={prChartConfig} className="h-[140px] w-full">
                      <BarChart data={prChartData} accessibilityLayer layout="vertical">
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <XAxis type="number" tickLine={false} axisLine={false} fontSize={10} />
                        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} fontSize={10} width={50} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {prChartData.map((entry) => (
                            <Cell key={entry.name} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  </div>
                )}

                {/* Top contributors */}
                {contributors.length > 0 && (
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      {t('dashboard.github.contributors', 'Top Contributors')}
                    </h2>
                    <div className="space-y-2">
                      {contributors.slice(0, 6).map((c, i) => {
                        const maxContrib = contributors[0]?.contributions ?? 1
                        return (
                          <div key={c.login} className="flex items-center gap-2.5">
                            <span className="text-[10px] text-muted-foreground/60 w-3 text-right tabular-nums">{i + 1}</span>
                            <img
                              src={c.avatarUrl}
                              alt={c.login}
                              className="w-5 h-5 rounded-full shrink-0"
                            />
                            <span className="text-[12px] font-medium truncate flex-1 min-w-0">{c.login}</span>
                            <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                              <div
                                className="h-full rounded-full bg-[#8b5cf6]/60 transition-all"
                                style={{ width: `${(c.contributions / maxContrib) * 100}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">{formatNumber(c.contributions)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
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
                    {sortField === 'commits' && <span className="text-[9px]">{sortAsc ? '\u25B2' : '\u25BC'}</span>}
                  </button>
                  <button onClick={() => handleSort('changes')} className="text-[11px] font-medium text-muted-foreground text-center hover:text-foreground transition-colors flex items-center justify-center gap-0.5">
                    {t('dashboard.repos.col_changes', 'Changes')}
                    {sortField === 'changes' && <span className="text-[9px]">{sortAsc ? '\u25B2' : '\u25BC'}</span>}
                  </button>
                  <span className="text-[11px] font-medium text-muted-foreground text-center">
                    {t('dashboard.repos.col_orbit', 'OrbitCI')}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground text-center">
                    {t('dashboard.repos.col_github', 'GitHub')}
                  </span>
                  <button onClick={() => handleSort('rate')} className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center justify-end gap-0.5">
                    {t('dashboard.repos.col_rate', 'Success Rate')}
                    {sortField === 'rate' && <span className="text-[9px]">{sortAsc ? '\u25B2' : '\u25BC'}</span>}
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
                      {commits > 0 ? commits : t('dashboard.repos.no_commits', '\u2014')}
                    </span>
                    <span className={cn('text-[12px] tabular-nums text-center', changes > 0 ? 'text-[#d29922] font-medium' : 'text-muted-foreground')}>
                      {changes > 0 ? changes : '0'}
                    </span>
                    <div className="flex justify-center">
                      {lastOrbitStatus ? <StatusIcon status={lastOrbitStatus} size="xs" /> : <span className="text-[11px] text-muted-foreground/40">{'\u2014'}</span>}
                    </div>
                    <div className="flex justify-center">
                      {lastGhStatus ? <StatusIcon status={lastGhStatus} size="xs" /> : <span className="text-[11px] text-muted-foreground/40">{'\u2014'}</span>}
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
                        <span className="text-[11px] text-muted-foreground/40">{t('dashboard.repos.no_runs', '\u2014')}</span>
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
