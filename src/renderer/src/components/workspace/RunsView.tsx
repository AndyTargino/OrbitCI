import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '@/components/ui/tooltip'
import { electron } from '@/lib/electron'
import { cn, formatDuration, formatRelativeTime } from '@/lib/utils'
import { IPC_CHANNELS } from '@shared/constants'
import type { GitHubJob, GitHubRun, Run, RunJob, RunLog, RunStatus, RunStep } from '@shared/types'
import * as jsYaml from 'js-yaml'
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Clock,
  ExternalLink,
  GitBranch,
  Github,
  Loader2,
  RefreshCw,
  Square,
  Terminal,
  Workflow,
  XCircle
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  repoId: string
}

// ─── Status Icon ────────────────────────────────────────────────────────────────

function StatusIcon({
  status,
  className
}: {
  status: RunStatus | string
  className?: string
}) {
  switch (status) {
    case 'success':
    case 'completed':
      return <CheckCircle2 className={cn('text-green-400', className)} />
    case 'failure':
      return <XCircle className={cn('text-red-400', className)} />
    case 'running':
    case 'in_progress':
      return <Loader2 className={cn('text-blue-400 animate-spin', className)} />
    case 'cancelled':
      return <Ban className={cn('text-gray-400', className)} />
    case 'queued':
    case 'waiting':
      return <CircleDot className={cn('text-yellow-400', className)} />
    default:
      return <Circle className={cn('text-gray-500', className)} />
  }
}

// ─── Status Badge ───────────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: RunStatus | string }) {
  const { t } = useTranslation()
  const label = t(`workspace.status.${status}`, { defaultValue: status.charAt(0).toUpperCase() + status.slice(1) })
  const colorClass = {
    success: 'bg-green-500/15 text-green-400 border-green-500/30',
    completed: 'bg-green-500/15 text-green-400 border-green-500/30',
    failure: 'bg-red-500/15 text-red-400 border-red-500/30',
    running: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    in_progress: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    cancelled: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
    pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    queued: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  }[status] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'

  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium', colorClass)}>
      <StatusIcon status={status} className="w-3 h-3 mr-1" />
      {label}
    </Badge>
  )
}

// ─── Log line color ─────────────────────────────────────────────────────────────

function logLineClass(type: RunLog['type']): string {
  switch (type) {
    case 'error': return 'log-error'
    case 'success': return 'log-success'
    case 'warning': return 'log-warning'
    case 'step': return 'log-step'
    case 'job': return 'log-job'
    case 'skip': return 'log-skip'
    case 'output': return 'log-output'
    default: return 'log-info'
  }
}

// ─── Pipeline Graph ─────────────────────────────────────────────────────────────

interface GraphJob {
  id: string
  name: string
  runsOn: string
  needs: string[]     // job IDs (not names)
  status: string
  durationMs: number | null
}

/** Parse a workflow YAML into graphJobs, overlaying runtime status+duration */
function parseWorkflowToGraph(
  yaml: string,
  statusByName: Record<string, string>,
  durationByName: Record<string, number | null>
): GraphJob[] {
  try {
    const doc = jsYaml.load(yaml) as Record<string, unknown>
    if (!doc || typeof doc !== 'object') return []
    const jobsRaw = (doc.jobs ?? {}) as Record<string, Record<string, unknown>>
    return Object.entries(jobsRaw).map(([id, job]) => {
      const needs = Array.isArray(job.needs)
        ? job.needs.map(String)
        : job.needs ? [String(job.needs)] : []
      const name = (job.name as string) ?? id
      const runsOn = (job['runs-on'] as string) ?? 'unknown'
      const status = statusByName[name] ?? statusByName[id] ?? 'pending'
      const durationMs = durationByName[name] ?? durationByName[id] ?? null
      return { id, name, runsOn, needs, status, durationMs }
    })
  } catch { return [] }
}

/** Build graph from live GitHub API jobs, optionally resolving needs from YAML */
function ghJobsToGraphJobs(jobs: GitHubJob[], workflowYaml?: string): GraphJob[] {
  // Build a map job-name → job-id (as string) for needs resolution
  const nameToId = new Map(jobs.map((j) => [j.name, String(j.id)]))

  // Try to extract needs from YAML (match by job name or job key)
  // needsByKey: YAML job key → needs (as YAML job keys)
  // needsByDisplayName: display name → needs (as YAML job keys)
  const needsByKey: Record<string, string[]> = {}
  const needsByDisplayName: Record<string, string[]> = {}
  if (workflowYaml) {
    try {
      const doc = jsYaml.load(workflowYaml) as Record<string, unknown>
      const jobsRaw = (doc?.jobs ?? {}) as Record<string, Record<string, unknown>>
      for (const [key, jobDef] of Object.entries(jobsRaw)) {
        const rawNeeds = Array.isArray(jobDef.needs)
          ? jobDef.needs.map(String)
          : jobDef.needs ? [String(jobDef.needs)] : []
        needsByKey[key] = rawNeeds
        const displayName = (jobDef.name as string) ?? ''
        if (displayName && displayName !== key) {
          needsByDisplayName[displayName] = rawNeeds
        }
      }
    } catch { /* ignore */ }
  }

  return jobs.map((job) => {
    const status = job.status === 'completed' ? (job.conclusion ?? 'success') : job.status

    // Duration
    let durationMs: number | null = null
    if (job.startedAt && job.completedAt) {
      durationMs = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
    } else if (job.startedAt && status === 'in_progress') {
      durationMs = Date.now() - new Date(job.startedAt).getTime()
    }

    // Resolve needs: YAML stores job keys, API uses display names (or key when no name)
    // Look up needs by API job name first (matches YAML key when no explicit name),
    // then by display name
    const rawNeeds = needsByKey[job.name] ?? needsByDisplayName[job.name] ?? []
    const resolvedNeeds = rawNeeds
      .map((needKey) => {
        // needKey is a YAML job key; match against API job names
        // When no explicit name field, API uses the YAML key as job name
        const matched = jobs.find((j) =>
          j.name === needKey ||
          j.name.toLowerCase() === needKey.toLowerCase() ||
          j.name.replace(/[-_\s]/g, '') === needKey.replace(/[-_\s]/g, '')
        )
        return matched ? String(matched.id) : nameToId.get(needKey) ?? null
      })
      .filter((id): id is string => id !== null)

    return {
      id: String(job.id),
      name: job.name,
      runsOn: 'github-hosted',
      needs: resolvedNeeds,
      status,
      durationMs,
    }
  })
}

function getNodeStyle(status: string): { bg: string; border: string } {
  switch (status) {
    case 'success':
    case 'completed': return { bg: 'rgba(74,222,128,0.09)', border: 'rgba(74,222,128,0.45)' }
    case 'failure': return { bg: 'rgba(248,113,113,0.09)', border: 'rgba(248,113,113,0.45)' }
    case 'running':
    case 'in_progress': return { bg: 'rgba(96,165,250,0.09)', border: 'rgba(96,165,250,0.45)' }
    case 'queued':
    case 'waiting': return { bg: 'rgba(251,191,36,0.09)', border: 'rgba(251,191,36,0.35)' }
    case 'cancelled': return { bg: 'rgba(107,114,128,0.09)', border: 'rgba(107,114,128,0.35)' }
    default: return { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.12)' }
  }
}

const PIPELINE_NODE_W = 185
const PIPELINE_NODE_H = 56
const PIPELINE_GAP_X = 60
const PIPELINE_GAP_Y = 12

function fmtDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return ''
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function RunPipelineGraph({ graphJobs }: { graphJobs: GraphJob[] }): JSX.Element {
  if (graphJobs.length === 0) return <></>

  // Topological sort into column-levels
  const levels: GraphJob[][] = []
  const placed = new Set<string>()
  let remaining = [...graphJobs]
  while (remaining.length > 0) {
    const level = remaining.filter((j) => j.needs.length === 0 || j.needs.every((n) => placed.has(n)))
    if (level.length === 0) { levels.push(remaining); break }
    levels.push(level)
    level.forEach((j) => placed.add(j.id))
    remaining = remaining.filter((j) => !placed.has(j.id))
  }

  const LEVEL_W = PIPELINE_NODE_W + PIPELINE_GAP_X
  const jobPos = new Map<string, { x: number; y: number }>()
  let maxRows = 0
  levels.forEach((level, li) => {
    if (level.length > maxRows) maxRows = level.length
    level.forEach((job, ji) => {
      jobPos.set(job.id, { x: li * LEVEL_W, y: ji * (PIPELINE_NODE_H + PIPELINE_GAP_Y) })
    })
  })

  const totalW = levels.length * LEVEL_W - PIPELINE_GAP_X
  const totalH = maxRows * (PIPELINE_NODE_H + PIPELINE_GAP_Y) - PIPELINE_GAP_Y

  const connectors: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const job of graphJobs) {
    const to = jobPos.get(job.id)
    if (!to) continue
    for (const need of job.needs) {
      const from = jobPos.get(need)
      if (!from) continue
      connectors.push({
        x1: from.x + PIPELINE_NODE_W,
        y1: from.y + PIPELINE_NODE_H / 2,
        x2: to.x,
        y2: to.y + PIPELINE_NODE_H / 2,
      })
    }
  }

  return (
    <div className="overflow-x-auto px-4 py-3">
      <div className="relative" style={{ width: totalW, height: totalH, minWidth: totalW }}>
        <svg
          className="absolute inset-0 pointer-events-none"
          width={totalW}
          height={totalH}
          style={{ overflow: 'visible' }}
        >
          {connectors.map((c, i) => {
            const midX = (c.x1 + c.x2) / 2
            return (
              <path
                key={i}
                d={`M ${c.x1} ${c.y1} C ${midX} ${c.y1}, ${midX} ${c.y2}, ${c.x2} ${c.y2}`}
                fill="none"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1.5"
              />
            )
          })}
        </svg>

        {graphJobs.map((job) => {
          const pos = jobPos.get(job.id)
          if (!pos) return null
          const ns = getNodeStyle(job.status)
          return (
            <div
              key={job.id}
              className="absolute flex items-center gap-2.5 px-3 rounded-lg border cursor-default select-none"
              style={{
                left: pos.x,
                top: pos.y,
                width: PIPELINE_NODE_W,
                height: PIPELINE_NODE_H,
                background: ns.bg,
                borderColor: ns.border,
              }}
            >
              <StatusIcon status={job.status} className="w-4 h-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold truncate leading-tight">{job.name}</p>
                <p className="text-[10px] text-muted-foreground/60 truncate leading-tight mt-0.5">{job.runsOn}</p>
              </div>
              {fmtDuration(job.durationMs) && (
                <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums ml-1">
                  {fmtDuration(job.durationMs)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type ViewMode = 'orbit' | 'github'

const RUNS_PAGE_SIZE = 30

// ─── Main Component ─────────────────────────────────────────────────────────────

export function RunsView({ repoId }: Props): JSX.Element {
  const { t } = useTranslation()
  const [viewMode, setViewMode] = useState<ViewMode>('orbit')

  // OrbitCI state
  const [runs, setRuns] = useState<Run[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<Run | null>(null)
  const [jobs, setJobs] = useState<RunJob[]>([])
  const [steps, setSteps] = useState<RunStep[]>([])
  const [logs, setLogs] = useState<RunLog[]>([])
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set())
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const logEndRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const [orbitHasMore, setOrbitHasMore] = useState(true)
  const [orbitLoadingMore, setOrbitLoadingMore] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  // GitHub Actions state
  const [ghRuns, setGhRuns] = useState<GitHubRun[]>([])
  const [ghLoading, setGhLoading] = useState(false)
  const [selectedGhRun, setSelectedGhRun] = useState<GitHubRun | null>(null)
  const [ghJobs, setGhJobs] = useState<GitHubJob[]>([])
  const [ghJobLogs, setGhJobLogs] = useState<Record<number, string>>({})
  const [expandedGhJobs, setExpandedGhJobs] = useState<Set<number>>(new Set())
  const [ghPage, setGhPage] = useState(1)
  const [ghHasMore, setGhHasMore] = useState(true)
  const [ghLoadingMore, setGhLoadingMore] = useState(false)
  const [ghLastRefresh, setGhLastRefresh] = useState<Date | null>(null)

  // Pipeline graph state
  const [pipelineOpen, setPipelineOpen] = useState(true)
  const [orbitWorkflowYaml, setOrbitWorkflowYaml] = useState('')
  const [ghWorkflowYaml, setGhWorkflowYaml] = useState('')

  // ── Fetch OrbitCI runs ─────────────────────────────────────────────────────

  const fetchRuns = useCallback(async (offset = 0) => {
    try {
      const filter: { repoId?: string; status?: RunStatus; limit?: number; offset?: number } = {
        repoId, limit: RUNS_PAGE_SIZE, offset
      }
      if (statusFilter !== 'all') filter.status = statusFilter as RunStatus
      const result = await electron.runs.list(filter)
      if (offset === 0) {
        setRuns(result)
      } else {
        setRuns((prev) => [...prev, ...result])
      }
      setOrbitHasMore(result.length >= RUNS_PAGE_SIZE)
    } catch { /* ignore */ }
  }, [repoId, statusFilter])

  useEffect(() => {
    setOrbitHasMore(true)
    fetchRuns(0)
  }, [fetchRuns])

  const handleLoadMoreOrbit = async () => {
    setOrbitLoadingMore(true)
    await fetchRuns(runs.length)
    setOrbitLoadingMore(false)
  }

  // ── Fetch GitHub runs ──────────────────────────────────────────────────────

  const fetchGhRuns = useCallback(async (page = 1, append = false) => {
    if (!append) setGhLoading(true)
    try {
      const result = await electron.runs.listGitHub(repoId, RUNS_PAGE_SIZE, page)
      if (append) {
        setGhRuns((prev) => [...prev, ...result])
      } else {
        setGhRuns(result)
      }
      setGhHasMore(result.length >= RUNS_PAGE_SIZE)
    } catch { /* ignore */ }
    if (!append) setGhLoading(false)
  }, [repoId])

  useEffect(() => {
    if (viewMode === 'github') {
      setGhPage(1)
      setGhHasMore(true)
      fetchGhRuns(1, false)
    }
  }, [viewMode, fetchGhRuns])

  const handleLoadMoreGh = async () => {
    const nextPage = ghPage + 1
    setGhLoadingMore(true)
    await fetchGhRuns(nextPage, true)
    setGhPage(nextPage)
    setGhLoadingMore(false)
  }

  // ── Fetch selected OrbitCI run detail ──────────────────────────────────────

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null); setJobs([]); setSteps([]); setLogs([])
      return
    }
    let cancelled = false
    async function load() {
      try {
        const [run, runJobs, runSteps, runLogs] = await Promise.all([
          electron.runs.get(selectedRunId!),
          electron.runs.getJobs(selectedRunId!),
          electron.runs.getSteps(selectedRunId!),
          electron.runs.getLogs(selectedRunId!)
        ])
        if (cancelled) return
        setSelectedRun(run)
        setJobs(runJobs)
        setSteps(runSteps)
        setLogs(runLogs)
        setExpandedJobs(new Set(runJobs.map((j) => j.id)))
      } catch { /* ignore */ }
    }
    load()
    return () => { cancelled = true }
  }, [selectedRunId])

  // ── Fetch selected GitHub run detail ───────────────────────────────────────

  useEffect(() => {
    if (!selectedGhRun) { setGhJobs([]); setGhJobLogs({}); return }
    let cancelled = false
    async function load() {
      try {
        const jobs = await electron.runs.listGitHubRunJobs(repoId, selectedGhRun!.id)
        if (!cancelled) {
          setGhJobs(jobs)
          setExpandedGhJobs(new Set(jobs.map((j) => j.id)))
        }
      } catch { /* ignore */ }
    }
    load()
    return () => { cancelled = true }
  }, [selectedGhRun, repoId])

  const loadGhJobLog = async (jobId: number) => {
    if (ghJobLogs[jobId]) return
    try {
      const log = await electron.runs.getGitHubJobLogs(repoId, jobId)
      setGhJobLogs((prev) => ({ ...prev, [jobId]: log }))
    } catch { /* ignore */ }
  }

  // ── Realtime subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    const unsubLog = electron.on(IPC_CHANNELS.EVENT_RUN_LOG, (data: unknown) => {
      const log = data as RunLog & { runId: string }
      if (log.runId === selectedRunId) setLogs((prev) => [...prev, log])
    })
    const unsubStatus = electron.on(IPC_CHANNELS.EVENT_RUN_STATUS, (data: unknown) => {
      const evt = data as { runId: string; status: RunStatus }
      setRuns((prev) => prev.map((r) => (r.id === evt.runId ? { ...r, status: evt.status } : r)))
      if (evt.runId === selectedRunId) {
        setSelectedRun((prev) => (prev ? { ...prev, status: evt.status } : prev))
        if (['success', 'failure', 'cancelled'].includes(evt.status)) {
          electron.runs.get(evt.runId).then((run) => setSelectedRun(run)).catch(() => { })
          electron.runs.getJobs(evt.runId).then(setJobs).catch(() => { })
          electron.runs.getSteps(evt.runId).then(setSteps).catch(() => { })
        }
      }
      fetchRuns(0)
    })
    return () => { unsubLog(); unsubStatus() }
  }, [selectedRunId, fetchRuns])

  // ── Auto-scroll ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (autoScrollRef.current && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  useEffect(() => {
    if (selectedRun?.status === 'running' || selectedRun?.status === 'pending') {
      autoScrollRef.current = true
    }
  }, [selectedRun?.status])

  // ── Fetch workflow YAML for pipeline graph when OrbitCI run selected ────────

  useEffect(() => {
    if (!selectedRun?.workflowFile) { setOrbitWorkflowYaml(''); return }
    let cancelled = false
    electron.workflows.get(repoId, selectedRun.workflowFile)
      .then((y) => { if (!cancelled) setOrbitWorkflowYaml(y) })
      .catch(() => { if (!cancelled) setOrbitWorkflowYaml('') })
    return () => { cancelled = true }
  }, [selectedRun?.workflowFile, repoId])

  // ── Fetch workflow YAML for pipeline graph when GitHub run selected ────────

  useEffect(() => {
    if (!selectedGhRun?.workflowPath) { setGhWorkflowYaml(''); return }
    let cancelled = false
    electron.workflows.get(repoId, selectedGhRun.workflowPath)
      .then((y) => { if (!cancelled) setGhWorkflowYaml(y) })
      .catch(async () => {
        // Fallback: tentar ler da pasta .github/workflows real do projeto local
        try {
          const repos = await electron.repos.list()
          const repo = repos.find(r => r.id === repoId)
          if (repo && repo.localPath) {
            // workflowPath usually is ".github/workflows/foo.yml". Extract "foo.yml"
            const filename = selectedGhRun.workflowPath.split('/').pop()
            if (filename) {
              const y = await electron.repos.getGithubWorkflowContent(repo.localPath, filename)
              if (!cancelled) setGhWorkflowYaml(y)
              return
            }
          }
        } catch { /* ignorar falha fallback */ }
        if (!cancelled) setGhWorkflowYaml('')
      })
    return () => { cancelled = true }
  }, [selectedGhRun?.workflowPath, repoId])

  // ── GitHub Actions auto-refresh (list every 15s, jobs every 10s) ────────

  useEffect(() => {
    if (viewMode !== 'github') return
    const timer = setInterval(() => {
      fetchGhRuns(1, false).then(() => setGhLastRefresh(new Date())).catch(() => { })
    }, 15_000)
    return () => clearInterval(timer)
  }, [viewMode, fetchGhRuns])

  useEffect(() => {
    if (!selectedGhRun) return
    const currentStatus = selectedGhRun.status === 'completed'
      ? (selectedGhRun.conclusion ?? 'success')
      : selectedGhRun.status
    if (currentStatus !== 'in_progress' && currentStatus !== 'queued') return

    const timer = setInterval(async () => {
      try {
        const [updatedRuns, updatedJobs] = await Promise.all([
          electron.runs.listGitHub(repoId, RUNS_PAGE_SIZE, 1),
          electron.runs.listGitHubRunJobs(repoId, selectedGhRun.id)
        ])
        setGhRuns(updatedRuns)
        setGhLastRefresh(new Date())
        const updated = updatedRuns.find((r) => r.id === selectedGhRun.id)
        if (updated) setSelectedGhRun(updated)
        setGhJobs(updatedJobs)
      } catch { /* ignore */ }
    }, 10_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGhRun?.id, selectedGhRun?.status, selectedGhRun?.conclusion])

  // ── OrbitCI backup polling when a run is active (supplements events) ────

  useEffect(() => {
    const hasActive = runs.some((r) => r.status === 'running' || r.status === 'pending')
    if (!hasActive) return
    const timer = setInterval(() => fetchRuns(0), 5_000)
    return () => clearInterval(timer)
  }, [runs, fetchRuns])

  const handleCancel = () => {
    if (!selectedRunId) return
    setConfirmCancel(true)
  }

  const executeCancel = async () => {
    if (!selectedRunId) return
    try { await electron.runs.cancel(selectedRunId) } catch { /* ignore */ }
  }

  const toggleJob = (jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId)
      return next
    })
  }

  const toggleStep = (stepKey: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(stepKey)) next.delete(stepKey); else next.add(stepKey)
      return next
    })
  }

  const toggleGhJob = (jobId: number) => {
    setExpandedGhJobs((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) { next.delete(jobId) } else { next.add(jobId); loadGhJobLog(jobId) }
      return next
    })
  }

  const getJobSteps = (jobId: string) =>
    steps.filter((s) => s.jobId === jobId).sort((a, b) => a.stepIndex - b.stepIndex)

  const getStepLogs = (stepName: string | null, jobName: string) =>
    logs.filter((l) => l.stepName === stepName && l.jobName === jobName)

  const ghStatusToLocal = (run: GitHubRun): string => {
    if (run.status === 'completed') return run.conclusion ?? 'success'
    return run.status
  }

  return (
    <TooltipProvider delayDuration={400}>
      <>
        {/* Left sidebar */}
        <div className="w-[300px] shrink-0 flex flex-col border-r border-border">
          {/* Mode toggle + filter */}
          <div className="px-3 py-2 border-b border-border space-y-2">
            <div className="flex gap-1">
              <button
                onClick={() => { setViewMode('orbit'); setSelectedGhRun(null) }}
                className={cn(
                  'flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors',
                  viewMode === 'orbit'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                OrbitCI
              </button>
              <button
                onClick={() => { setViewMode('github'); setSelectedRunId(null); setSelectedRun(null) }}
                className={cn(
                  'flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors flex items-center justify-center gap-1',
                  viewMode === 'github'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <Github className="h-3 w-3" />
                GitHub Actions
              </button>
            </div>
            {viewMode === 'orbit' ? (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-7 text-[12px]">
                  <SelectValue placeholder={t('workspace.runs.filter_placeholder', 'Filter by status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('workspace.status.all', 'All')}</SelectItem>
                  <SelectItem value="success">{t('workspace.status.success', 'Success')}</SelectItem>
                  <SelectItem value="failure">{t('workspace.status.failure', 'Failure')}</SelectItem>
                  <SelectItem value="running">{t('workspace.status.running', 'Running')}</SelectItem>
                  <SelectItem value="cancelled">{t('workspace.status.cancelled', 'Cancelled')}</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-7 text-[12px] gap-1.5"
                  disabled={ghLoading}
                  onClick={() => fetchGhRuns(1, false).then(() => setGhLastRefresh(new Date())).catch(() => { })}
                >
                  {ghLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {t('common.refresh_now', 'Refresh now')}
                </Button>
                {ghLastRefresh && (
                  <p className="text-[10px] text-muted-foreground text-center flex items-center justify-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    {t('workspace.runs.auto_refresh', 'Auto-refresh')} · {formatRelativeTime(ghLastRefresh.toISOString())}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Runs list */}
          <ScrollArea className="flex-1">
            {viewMode === 'orbit' ? (
              runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                    <Terminal className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-[13px] text-muted-foreground font-medium">{t('workspace.runs.no_local_title', 'No local runs')}</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">
                    {t('workspace.runs.no_local_desc', 'Run a workflow from the CI/CD tab to see results here')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {runs.map((run) => (
                      <Tooltip key={run.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => { setSelectedRunId(run.id); setSelectedGhRun(null) }}
                            className={cn(
                              'w-full text-left px-3 py-2.5 transition-colors hover:bg-accent/50 overflow-hidden',
                              selectedRunId === run.id && 'bg-accent'
                            )}
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              <StatusIcon status={run.status} className="w-4 h-4 mt-0.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium truncate">
                                  {run.workflowName || run.workflowFile}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {run.gitBranch && (
                                    <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground truncate">
                                      <GitBranch className="w-3 h-3 shrink-0" />
                                      {run.gitBranch}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                                  <span className="flex items-center gap-0.5 shrink-0">
                                    <Clock className="w-3 h-3" />
                                    {formatDuration(run.durationMs)}
                                  </span>
                                  {run.trigger && <span className="shrink-0">{run.trigger}</span>}
                                  <span className="shrink-0">{formatRelativeTime(run.createdAt)}</span>
                                </div>
                              </div>
                            </div>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[300px] text-[12px]">
                          {run.workflowName || run.workflowFile}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  {orbitHasMore && runs.length > 0 && (
                    <div className="p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-[12px]"
                        disabled={orbitLoadingMore}
                        onClick={handleLoadMoreOrbit}
                      >
                        {orbitLoadingMore ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 mr-1" />
                        )}
                        {orbitLoadingMore ? t('common.loading', 'Loading...') : t('common.load_more', 'Load more')}
                      </Button>
                    </div>
                  )}
                </>
              )
            ) : (
              ghLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-[13px]">{t('common.loading', 'Loading...')}</span>
                </div>
              ) : ghRuns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                    <Github className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-[13px] text-muted-foreground font-medium">{t('workspace.runs.no_gh_title', 'No GitHub Actions runs')}</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">
                    {t('workspace.runs.no_gh_desc', 'Runs from GitHub Actions will appear here')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {ghRuns.map((run) => (
                      <Tooltip key={run.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => { setSelectedGhRun(run); setSelectedRunId(null); setSelectedRun(null) }}
                            className={cn(
                              'w-full text-left px-3 py-2.5 transition-colors hover:bg-accent/50 overflow-hidden',
                              selectedGhRun?.id === run.id && 'bg-accent'
                            )}
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              <StatusIcon status={ghStatusToLocal(run)} className="w-4 h-4 mt-0.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium truncate">
                                  {run.displayTitle || run.name || 'Workflow'}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {run.headBranch && (
                                    <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground truncate">
                                      <GitBranch className="w-3 h-3 shrink-0" />
                                      {run.headBranch}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground/50 shrink-0">
                                    #{run.runNumber}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                                  <span className="shrink-0">{run.event}</span>
                                  <span className="shrink-0">{formatRelativeTime(run.createdAt)}</span>
                                </div>
                              </div>
                            </div>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[300px] text-[12px]">
                          {run.displayTitle || run.name || 'Workflow'}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  {ghHasMore && ghRuns.length > 0 && (
                    <div className="p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-[12px]"
                        disabled={ghLoadingMore}
                        onClick={handleLoadMoreGh}
                      >
                        {ghLoadingMore ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 mr-1" />
                        )}
                        {ghLoadingMore ? t('common.loading', 'Loading...') : t('common.load_more', 'Load more')}
                      </Button>
                    </div>
                  )}
                </>
              )
            )}
          </ScrollArea>
        </div>

        {/* Right content */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {/* OrbitCI run detail */}
          {viewMode === 'orbit' && !selectedRun && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <Terminal className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-[13px] text-muted-foreground">{t('workspace.runs.select_run_prompt', 'Select a run to view details')}</p>
            </div>
          )}

          {viewMode === 'orbit' && selectedRun && (
            <>
              <div className="px-4 py-3 border-b border-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <RunStatusBadge status={selectedRun.status} />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[13px] font-medium truncate">
                          {selectedRun.workflowName || selectedRun.workflowFile}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[400px] text-[12px]">
                        {selectedRun.workflowName || selectedRun.workflowFile}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {(selectedRun.status === 'running' || selectedRun.status === 'pending') && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 text-[12px] gap-1" onClick={handleCancel}>
                          <Square className="w-3 h-3" />
                          {t('common.cancel', 'Cancel')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('workspace.runs.cancel_tooltip', 'Cancel this run')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[12px] text-muted-foreground flex-wrap">
                  {selectedRun.gitBranch && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />{selectedRun.gitBranch}
                    </span>
                  )}
                  {selectedRun.gitSha && (
                    <span className="font-mono">{selectedRun.gitSha.slice(0, 7)}</span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />{formatDuration(selectedRun.durationMs)}
                  </span>
                  {selectedRun.startedAt && <span>{t('workspace.runs.started_at', { time: formatRelativeTime(selectedRun.startedAt), defaultValue: `Started ${formatRelativeTime(selectedRun.startedAt)}` })}</span>}
                  {selectedRun.finishedAt && <span>{t('workspace.runs.finished_at', { time: formatRelativeTime(selectedRun.finishedAt), defaultValue: `Finished ${formatRelativeTime(selectedRun.finishedAt)}` })}</span>}
                </div>
                {selectedRun.error && (
                  <p className="text-[12px] text-red-400 mt-1">{selectedRun.error}</p>
                )}
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-2">
                  {/* Pipeline graph */}
                  {(() => {
                    const statusByName: Record<string, string> = {}
                    const durationByName: Record<string, number | null> = {}
                    jobs.forEach((j) => {
                      statusByName[j.jobName] = j.status
                      durationByName[j.jobName] = j.durationMs ?? null
                    })
                    const graphJobs = orbitWorkflowYaml
                      ? parseWorkflowToGraph(orbitWorkflowYaml, statusByName, durationByName)
                      : jobs.map((j) => ({ id: j.id, name: j.jobName, runsOn: 'local', needs: [], status: j.status, durationMs: j.durationMs ?? null }))
                    if (graphJobs.length === 0) return null
                    return (
                      <div className="border border-border rounded-md overflow-hidden mb-2">
                        <button
                          onClick={() => setPipelineOpen((p) => !p)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/40 transition-colors text-left"
                        >
                          {pipelineOpen
                            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                          <Workflow className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-[12px] font-medium text-muted-foreground">{t('workspace.runs.pipeline_label', 'Pipeline')}</span>
                        </button>
                        {pipelineOpen && <RunPipelineGraph graphJobs={graphJobs} />}
                      </div>
                    )
                  })()}
                  {jobs.length === 0 && <p className="text-[12px] text-muted-foreground">{t('workspace.runs.no_jobs', 'No jobs')}</p>}
                  {jobs.map((job) => {
                    const jobSteps = getJobSteps(job.id)
                    const isExpanded = expandedJobs.has(job.id)
                    return (
                      <div key={job.id} className="border border-border rounded-md overflow-hidden">
                        <button
                          onClick={() => toggleJob(job.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors"
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                          <StatusIcon status={job.status} className="w-4 h-4 shrink-0" />
                          <span className="text-[13px] font-medium truncate">{job.jobName}</span>
                          <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{formatDuration(job.durationMs)}</span>
                        </button>
                        {isExpanded && (
                          <div className="border-t border-border">
                            {jobSteps.length === 0 && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('workspace.runs.no_steps', 'No steps')}</p>}
                            {jobSteps.map((step) => {
                              const stepKey = `${step.jobId}:${step.id}`
                              const isStepExpanded = expandedSteps.has(stepKey)
                              const stepLogs = getStepLogs(step.stepName, job.jobName)
                              return (
                                <div key={step.id} className="border-t border-border/50">
                                  <button
                                    onClick={() => toggleStep(stepKey)}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 pl-8 hover:bg-accent/30 transition-colors"
                                  >
                                    {isStepExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                                    <StatusIcon status={step.status} className="w-3.5 h-3.5 shrink-0" />
                                    <span className="text-[12px] truncate">{step.stepName || t('workspace.runs.step_indexed', { index: step.stepIndex + 1, defaultValue: `Step ${step.stepIndex + 1}` })}</span>
                                    <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{formatDuration(step.durationMs)}</span>
                                  </button>
                                  {isStepExpanded && stepLogs.length > 0 && (
                                    <div className="bg-black/30 px-4 py-2 max-h-[300px] overflow-y-auto">
                                      {stepLogs.map((log, i) => (
                                        <div key={log.id ?? i} className={cn('font-mono text-[12px] leading-5 whitespace-pre-wrap break-all', logLineClass(log.type))}>
                                          {log.message}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {logs.length > 0 && jobs.length === 0 && (
                    <div className="border border-border rounded-md overflow-hidden">
                      <div className="px-3 py-2 border-b border-border text-[12px] font-medium text-muted-foreground">{t('workspace.runs.output_label', 'Output')}</div>
                      <div className="bg-black/30 px-4 py-2 max-h-[500px] overflow-y-auto">
                        {logs.map((log, i) => (
                          <div key={log.id ?? i} className={cn('font-mono text-[12px] leading-5 whitespace-pre-wrap break-all', logLineClass(log.type))}>
                            {log.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div ref={logEndRef} />
                </div>
              </ScrollArea>
            </>
          )}

          {/* GitHub Actions run detail */}
          {viewMode === 'github' && !selectedGhRun && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <Terminal className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-[13px] text-muted-foreground">{t('workspace.runs.select_gh_run_prompt', 'Select a GitHub Actions run to view details')}</p>
            </div>
          )}

          {viewMode === 'github' && selectedGhRun && (
            <>
              <div className="px-4 py-3 border-b border-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <RunStatusBadge status={ghStatusToLocal(selectedGhRun)} />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[13px] font-medium truncate">
                          {selectedGhRun.displayTitle || selectedGhRun.name || 'Workflow'}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[400px] text-[12px]">
                        {selectedGhRun.displayTitle || selectedGhRun.name || 'Workflow'}
                      </TooltipContent>
                    </Tooltip>
                    <Badge variant="outline" className="text-[10px] shrink-0">#{selectedGhRun.runNumber}</Badge>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[12px] gap-1"
                        onClick={() => electron.shell.openExternal(selectedGhRun.htmlUrl)}
                      >
                        <ExternalLink className="w-3 h-3" />
                        GitHub
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('workspace.runs.open_gh_tooltip', 'Open in GitHub')}</TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-3 text-[12px] text-muted-foreground flex-wrap">
                  {selectedGhRun.headBranch && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />{selectedGhRun.headBranch}
                    </span>
                  )}
                  <span className="font-mono">{selectedGhRun.headSha.slice(0, 7)}</span>
                  <span>{selectedGhRun.event}</span>
                  {selectedGhRun.actor && (
                    <span className="flex items-center gap-1">
                      <img src={selectedGhRun.actor.avatarUrl} className="w-3.5 h-3.5 rounded-full" alt="" />
                      {selectedGhRun.actor.login}
                    </span>
                  )}
                  <span>{formatRelativeTime(selectedGhRun.createdAt)}</span>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-2">
                  {/* Pipeline graph for GitHub run */}
                  {ghJobs.length > 0 && (() => {
                    const graphJobs = ghJobsToGraphJobs(ghJobs, ghWorkflowYaml)
                    return (
                      <div className="border border-border rounded-md overflow-hidden mb-2">
                        <button
                          onClick={() => setPipelineOpen((p) => !p)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/40 transition-colors text-left"
                        >
                          {pipelineOpen
                            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                          <Workflow className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-[12px] font-medium text-muted-foreground">{t('workspace.runs.pipeline_label', 'Pipeline')}</span>
                          {selectedGhRun.status !== 'completed' && (
                            <span className="ml-auto flex items-center gap-1 text-[10px] text-blue-400">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              {t('common.live', 'Live')}
                            </span>
                          )}
                        </button>
                        {pipelineOpen && <RunPipelineGraph graphJobs={graphJobs} />}
                      </div>
                    )
                  })()}
                  {ghJobs.length === 0 && (
                    <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('workspace.runs.loading_jobs', 'Loading jobs...')}
                    </div>
                  )}
                  {ghJobs.map((job) => {
                    const isExpanded = expandedGhJobs.has(job.id)
                    const jobStatus = job.status === 'completed' ? (job.conclusion ?? 'success') : job.status
                    const jobDurationMs = job.startedAt && job.completedAt
                      ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
                      : job.startedAt && jobStatus === 'in_progress'
                        ? Date.now() - new Date(job.startedAt).getTime()
                        : null
                    return (
                      <div key={job.id} className="border border-border rounded-md overflow-hidden">
                        <button
                          onClick={() => toggleGhJob(job.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors"
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                          <StatusIcon status={jobStatus} className="w-4 h-4 shrink-0" />
                          <span className="text-[13px] font-medium truncate">{job.name}</span>
                          {jobDurationMs !== null && (
                            <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{fmtDuration(jobDurationMs)}</span>
                          )}
                        </button>

                        {isExpanded && (
                          <div className="border-t border-border">
                            {/* Steps */}
                            {job.steps.map((step) => {
                              const stepStatus = step.status === 'completed' ? (step.conclusion ?? 'success') : step.status
                              const stepDurationMs = step.startedAt && step.completedAt
                                ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
                                : null
                              return (
                                <div key={step.number} className="flex items-center gap-2 px-3 py-1.5 pl-8 border-t border-border/50">
                                  <StatusIcon status={stepStatus} className="w-3.5 h-3.5 shrink-0" />
                                  <span className="text-[12px] truncate">{step.name}</span>
                                  {stepDurationMs !== null && (
                                    <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{fmtDuration(stepDurationMs)}</span>
                                  )}
                                </div>
                              )
                            })}

                            {/* Job logs */}
                            {ghJobLogs[job.id] && (
                              <div className="bg-black/30 px-4 py-2 max-h-[400px] overflow-y-auto border-t border-border">
                                <pre className="font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-all">
                                  {ghJobLogs[job.id]}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('workspace.runs.cancel_title', 'Cancel run')}
        description={t('workspace.runs.cancel_desc', { workflow: selectedRun?.workflowName ?? selectedRun?.workflowFile ?? 'workflow', defaultValue: `Are you sure you want to cancel the execution of "${selectedRun?.workflowName ?? selectedRun?.workflowFile ?? 'workflow'}"?` })}
        consequences={[
          t('workspace.runs.cancel_cons1', 'The execution will be stopped immediately'),
          t('workspace.runs.cancel_cons2', 'In-progress jobs will finish with "cancelled" status'),
          t('workspace.runs.cancel_cons3', 'Partial changes made by the run will not be reverted')
        ]}
        confirmLabel={t('workspace.runs.cancel_btn', 'Cancel run')}
        variant="destructive"
        onConfirm={executeCancel}
      />
    </TooltipProvider>
  )
}
