import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { DialogPortal, DialogOverlay, DialogClose } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  CheckCircle2, XCircle, Loader2, Circle, MinusCircle, AlertCircle,
  ChevronRight, ChevronDown, ExternalLink, GitBranch, Clock, X,
  RefreshCw, StopCircle, Cpu, MemoryStick, Monitor
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { cn } from '@/lib/utils'
import { ResourceChart } from './ResourceChart'
import { WorkflowGraph } from './shared/WorkflowGraph'
import { ConfirmDialog } from './shared/ConfirmDialog'
import type { GitHubRun, Run, RunJob, RunStep, MetricSample, JobGraphNode } from '@shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────
type InternalJob = {
  id: string | number
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  steps: InternalStep[]
}

type InternalStep = {
  id: string
  name: string
  status: string
  conclusion: string | null
  number: number
  startedAt: string | null
  completedAt: string | null
}

type Props = {
  open: boolean
  onClose: () => void
  source: 'github' | 'orbit'
  run: GitHubRun | Run | null
  repoId: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDuration(a: string | null, b: string | null): string {
  if (!a || !b) return ''
  const s = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000)
  if (s <= 0) return '<1s'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

function fmtRelative(dateStr: string, t: any): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return t('common.time.just_now', 'just now')
  const m = Math.floor(s / 60)
  if (m < 60) return t('common.time.minutes_ago', { count: m, defaultValue: `${m}m ago` })
  const h = Math.floor(m / 60)
  if (h < 24) return t('common.time.hours_ago', { count: h, defaultValue: `${h}h ago` })
  return t('common.time.days_ago', { count: Math.floor(h / 24), defaultValue: `${Math.floor(h / 24)}d ago` })
}

// ─── Status helpers ───────────────────────────────────────────────────────────
function isFailed(status: string, conclusion: string | null) {
  return conclusion === 'failure' || status === 'failure'
}
function isSuccess(status: string, conclusion: string | null) {
  return conclusion === 'success' || status === 'success'
}
function isRunning(status: string) {
  return status === 'in_progress' || status === 'running'
}

function StatusIcon({ status, conclusion, size = 'sm' }: {
  status: string; conclusion: string | null; size?: 'sm' | 'md' | 'lg'
}): JSX.Element {
  const sz = size === 'lg' ? 'h-5 w-5' : size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'
  if (isRunning(status)) return <Loader2 className={cn(sz, 'animate-spin text-[#e3b341]')} />
  if (status === 'queued' || status === 'pending' || status === 'waiting')
    return <Circle className={cn(sz, 'text-muted-foreground')} />
  if (isSuccess(status, conclusion)) return <CheckCircle2 className={cn(sz, 'text-[#3fb950]')} />
  if (isFailed(status, conclusion)) return <XCircle className={cn(sz, 'text-[#f85149]')} />
  if (conclusion === 'cancelled' || status === 'cancelled')
    return <MinusCircle className={cn(sz, 'text-muted-foreground')} />
  if (conclusion === 'skipped' || status === 'skipped') return <MinusCircle className={cn(sz, 'text-muted-foreground/40')} />
  return <AlertCircle className={cn(sz, 'text-[#e3b341]')} />
}

function StatusBadge({ status, conclusion }: { status: string; conclusion: string | null }): JSX.Element {
  const { t } = useTranslation()
  let cls = 'text-muted-foreground bg-muted/40 border-border/40'
  let label = conclusion ?? status
  if (isRunning(status)) { 
    cls = 'text-[#e3b341] bg-[#e3b341]/10 border-[#e3b341]/30'
    label = t('workspace.status.running', 'running')
  } else if (isSuccess(status, conclusion)) { 
    cls = 'text-[#3fb950] bg-[#3fb950]/10 border-[#3fb950]/30'
    label = t('workspace.status.success', 'success')
  } else if (isFailed(status, conclusion)) { 
    cls = 'text-[#f85149] bg-[#f85149]/10 border-[#f85149]/30'
    label = t('workspace.status.failed', 'failed')
  } else if (conclusion === 'cancelled') { 
    cls = 'text-muted-foreground bg-muted/40 border-border/40'
    label = t('workspace.status.cancelled', 'cancelled')
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold uppercase tracking-wide', cls)}>
      {label}
    </span>
  )
}

// ─── Log parsing (GitHub raw logs) ────────────────────────────────────────────
function parseGitHubLogs(raw: string): Map<number, string[]> {
  const map = new Map<number, string[]>()
  let step = 0
  for (const line of raw.split('\n')) {
    const stripped = line.length > 29 && /^\d{4}-\d{2}-\d{2}T/.test(line) ? line.substring(29) : line
    if (stripped.startsWith('##[group]')) {
      step++
      if (!map.has(step)) map.set(step, [])
    } else if (!stripped.startsWith('##[endgroup]') && step > 0 && stripped.trim()) {
      const bucket = map.get(step) ?? []
      bucket.push(stripped)
      map.set(step, bucket)
    }
  }
  return map
}

// ─── Log line renderer ────────────────────────────────────────────────────────
function LogLine({ line, index }: { line: string; index: number }): JSX.Element {
  const isErr = line.includes('##[error]') || /\berror:/i.test(line)
  const isWarn = line.includes('##[warning]') || /\bwarning:/i.test(line)
  const clean = line.replace(/##\[(?:error|warning|group|endgroup)\]/g, '')
  return (
    <div className={cn('flex min-w-0 hover:bg-white/[0.04]', isErr && 'bg-[#f85149]/10', isWarn && 'bg-[#e3b341]/8')}>
      <span className="select-none w-11 shrink-0 text-right pr-3 text-muted-foreground/25 font-mono text-[11px] py-px leading-5">
        {index + 1}
      </span>
      <span className={cn(
        'flex-1 font-mono text-[11px] py-px leading-5 pr-4 whitespace-pre break-all',
        isErr ? 'text-[#f85149]' : isWarn ? 'text-[#e3b341]' : 'text-[#c9d1d9]'
      )}>
        {clean}
      </span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function RunDetailModal({ open, onClose, source, run, repoId }: Props) {
  const { t } = useTranslation()
  const [jobs, setJobs] = useState<InternalJob[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | number | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [stepLogs, setStepLogs] = useState<Map<string, string[]>>(new Map())
  const [jobLogCache, setJobLogCache] = useState<Map<string | number, Map<number, string[]>>>(new Map())
  const [loadingJobLog, setLoadingJobLog] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [activeTab, setActiveTab] = useState<'logs' | 'resources'>('logs')
  const [metrics, setMetrics] = useState<MetricSample[]>([])
  const [stepsWithMetrics, setStepsWithMetrics] = useState<RunStep[]>([])
  const [metricsFilter, setMetricsFilter] = useState<{ jobName?: string; stepName?: string }>({})
  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const [jobGraph, setJobGraph] = useState<JobGraphNode[]>([])
  const [rawJobs, setRawJobs] = useState<RunJob[]>([])

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null

  // ── Reset + load when opened ───────────────────────────────────────────────
  useEffect(() => {
    if (!open || !run) return
    setJobs([])
    setSelectedJobId(null)
    setExpandedSteps(new Set())
    setStepLogs(new Map())
    setJobLogCache(new Map())
    setHasError(false)
    setLoadingJobs(true)
    setActiveTab('logs')
    setMetrics([])
    setStepsWithMetrics([])
    setMetricsFilter({})
    setJobGraph([])
    setRawJobs([])

    if (source === 'github') {
      const ghRun = run as GitHubRun
      electron.runs.listGitHubRunJobs(repoId, ghRun.id)
        .then((ghJobs) => {
          const internal = ghJobs.map((j) => ({
            id: j.id,
            name: j.name,
            status: j.status,
            conclusion: j.conclusion,
            startedAt: j.startedAt,
            completedAt: j.completedAt,
            steps: j.steps.map((s) => ({
              id: `${j.id}:${s.number}`,
              name: s.name,
              status: s.status,
              conclusion: s.conclusion,
              number: s.number,
              startedAt: s.startedAt,
              completedAt: s.completedAt
            }))
          }))
          setJobs(internal)
          if (internal.length > 0) setSelectedJobId(internal[0].id)
        })
        .catch(() => setHasError(true))
        .finally(() => setLoadingJobs(false))
    } else {
      const orbitRun = run as Run
      Promise.all([
        electron.runs.getJobs(orbitRun.id),
        electron.runs.getSteps(orbitRun.id),
        electron.runs.getLogs(orbitRun.id),
        electron.runs.getJobGraph(orbitRun.id)
      ])
        .then(([fetchedJobs, rawSteps, rawLogs, graph]) => {
          setRawJobs(fetchedJobs)
          setJobGraph(graph)
          const rawJobs = fetchedJobs
          const logsMap = new Map<string, string[]>()
          for (const log of rawLogs) {
            const key = `${log.jobName ?? ''}::${log.stepName ?? ''}`
            const b = logsMap.get(key) ?? []
            b.push(log.message)
            logsMap.set(key, b)
          }

          const internal: InternalJob[] = rawJobs.map((j) => {
            const jobSteps = rawSteps
              .filter((s) => s.jobId === j.id)
              .sort((a, b) => a.stepIndex - b.stepIndex)
            return {
              id: j.id,
              name: j.jobName,
              status: j.status,
              conclusion: null,
              startedAt: j.startedAt,
              completedAt: j.finishedAt,
              steps: jobSteps.map((s, idx) => ({
                id: `${j.id}:${s.id}`,
                name: s.stepName ?? `Passo ${idx + 1}`,
                status: s.status,
                conclusion: null,
                number: s.stepIndex,
                startedAt: s.startedAt,
                completedAt: s.finishedAt
              }))
            }
          })

          const stepLogsOut = new Map<string, string[]>()
          for (const job of internal) {
            for (const step of job.steps) {
              stepLogsOut.set(step.id, logsMap.get(`${job.name}::${step.name}`) ?? [])
            }
          }

          setJobs(internal)
          setStepLogs(stepLogsOut)
          if (internal.length > 0) setSelectedJobId(internal[0].id)

          // Auto-expand first failed step
          const firstJob = internal[0]
          if (firstJob) {
            const failed = firstJob.steps.filter((s) => isFailed(s.status, s.conclusion))
            if (failed.length > 0) setExpandedSteps(new Set([failed[0].id]))
          }
        })
        .catch(() => setHasError(true))
        .finally(() => setLoadingJobs(false))
    }
  }, [open, (run as Run | null)?.id ?? (run as GitHubRun | null)?.id, source])

  // ── Fetch GitHub job logs when job is selected ─────────────────────────────
  useEffect(() => {
    if (source !== 'github' || !selectedJobId || !open || loadingJobs) return
    const job = jobs.find((j) => j.id === selectedJobId)
    if (!job) return

    if (jobLogCache.has(selectedJobId)) {
      const parsed = jobLogCache.get(selectedJobId)!
      setStepLogs((prev) => {
        const out = new Map(prev)
        for (const step of job.steps) out.set(step.id, parsed.get(step.number) ?? [])
        return out
      })
      // Auto-expand first failed step
      const failed = job.steps.filter((s) => isFailed(s.status, s.conclusion))
      if (failed.length > 0) setExpandedSteps(new Set([failed[0].id]))
      return
    }

    setLoadingJobLog(true)
    electron.runs.getGitHubJobLogs(repoId, selectedJobId as number)
      .then((rawLog) => {
        const parsed = parseGitHubLogs(rawLog)
        setJobLogCache((prev) => new Map(prev).set(selectedJobId, parsed))
        setStepLogs((prev) => {
          const out = new Map(prev)
          for (const step of job.steps) out.set(step.id, parsed.get(step.number) ?? [])
          return out
        })
        // Auto-expand first failed step after logs load
        const failed = job.steps.filter((s) => isFailed(s.status, s.conclusion))
        if (failed.length > 0) setExpandedSteps(new Set([failed[0].id]))
      })
      .catch(() => {})
      .finally(() => setLoadingJobLog(false))
  }, [selectedJobId, source, open, loadingJobs])

  // ── Load metrics when Resources tab is active ────────────────────────────
  useEffect(() => {
    if (!open || !run || source !== 'orbit' || activeTab !== 'resources') return
    const orbitRun = run as Run
    setLoadingMetrics(true)
    Promise.all([
      electron.runs.getMetrics(orbitRun.id, metricsFilter.jobName, metricsFilter.stepName),
      electron.runs.getSteps(orbitRun.id)
    ])
      .then(([samples, steps]) => {
        setMetrics(samples)
        setStepsWithMetrics(steps)
      })
      .catch(() => {})
      .finally(() => setLoadingMetrics(false))
  }, [open, (run as Run | null)?.id, activeTab, source, metricsFilter.jobName, metricsFilter.stepName])

  const toggleStep = useCallback((stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      next.has(stepId) ? next.delete(stepId) : next.add(stepId)
      return next
    })
  }, [])

  const handleCancel = () => {
    if (!run || source !== 'orbit') return
    setConfirmCancel(true)
  }

  const executeCancel = async () => {
    if (!run || source !== 'orbit') return
    setCancelling(true)
    try { await electron.runs.cancel((run as Run).id) } finally { setCancelling(false) }
  }

  const handleRerun = async () => {
    if (!run || source !== 'orbit') return
    const orbitRun = run as Run
    setRerunning(true)
    try {
      await electron.workflows.run(repoId, orbitRun.workflowFile)
    } finally {
      setRerunning(false)
    }
  }

  if (!run) return null

  const isGitHub = source === 'github'
  const ghRun = isGitHub ? (run as GitHubRun) : null
  const orbitRun = !isGitHub ? (run as Run) : null

  const runTitle = isGitHub ? ghRun!.displayTitle : (orbitRun!.workflowName ?? orbitRun!.workflowFile)
  const runStatus = isGitHub ? ghRun!.status : orbitRun!.status
  const runConclusion = isGitHub ? ghRun!.conclusion : null
  const runBranch = isGitHub ? ghRun!.headBranch : orbitRun!.gitBranch
  const runCreatedAt = run.createdAt
  const isOrbitRunning = !isGitHub && orbitRun!.status === 'running'

  return (
    <>
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content className={cn(
          'fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]',
          'w-[95vw] max-w-5xl h-[88vh] flex flex-col',
          'bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'overflow-hidden'
        )}>

          {/* ── Header ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#30363d] shrink-0 min-w-0">
            <StatusIcon status={runStatus} conclusion={runConclusion} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate leading-snug">{runTitle}</p>
              <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#8b949e] flex-wrap">
                {runBranch && (
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />{runBranch}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />{fmtRelative(runCreatedAt, t)}
                </span>
                {isGitHub && ghRun!.actor && (
                  <span className="flex items-center gap-1.5">
                    <img src={ghRun!.actor.avatarUrl} className="h-3.5 w-3.5 rounded-full" alt="" />
                    {ghRun!.actor.login}
                  </span>
                )}
                {isGitHub && ghRun!.runNumber && (
                  <span className="text-[#8b949e]/60">#{ghRun!.runNumber}</span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              <StatusBadge status={runStatus} conclusion={runConclusion} />

              {/* Orbit: cancel if running */}
              {isOrbitRunning && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[#f85149] hover:bg-[#f85149]/10 border border-[#f85149]/30 transition-colors disabled:opacity-50"
                >
                  {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <StopCircle className="h-3 w-3" />}
                  {t('common.cancel', 'Cancel')}
                </button>
              )}

              {/* Orbit: re-run if completed */}
              {!isGitHub && !isOrbitRunning && (
                <button
                  onClick={handleRerun}
                  disabled={rerunning}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[#8b949e] hover:bg-[#21262d] border border-[#30363d] transition-colors disabled:opacity-50"
                >
                  {rerunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {t('common.rerun', 'Re-run')}
                </button>
              )}

              {/* GitHub: open in browser */}
              {isGitHub && ghRun!.htmlUrl && (
                <button
                  onClick={() => electron.shell.openExternal(ghRun!.htmlUrl)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[#8b949e] hover:bg-[#21262d] border border-[#30363d] transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('common.view_github', 'View on GitHub')}
                </button>
              )}

              {/* Close */}
              <DialogClose asChild>
                <button className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-white transition-colors ml-1">
                  <X className="h-4 w-4" />
                </button>
              </DialogClose>
            </div>
          </div>

          {/* ── Tab bar ──────────────────────────────────────────────── */}
          {source === 'orbit' && (
            <div className="flex items-center gap-0 border-b border-[#30363d] px-5 shrink-0 bg-[#0d1117]">
              <button
                onClick={() => setActiveTab('logs')}
                className={cn(
                  'px-4 py-2 text-xs font-medium border-b-2 transition-colors',
                  activeTab === 'logs'
                    ? 'border-primary text-white'
                    : 'border-transparent text-[#8b949e] hover:text-[#c9d1d9]'
                )}
              >
                {t('common.logs', 'Logs')}
              </button>
              <button
                onClick={() => setActiveTab('resources')}
                className={cn(
                  'px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
                  activeTab === 'resources'
                    ? 'border-primary text-white'
                    : 'border-transparent text-[#8b949e] hover:text-[#c9d1d9]'
                )}
              >
                <Cpu className="h-3 w-3" />
                {t('common.resources', 'Resources')}
              </button>
            </div>
          )}

          {/* ── Workflow Graph ────────────────────────────────────────── */}
          {jobGraph.length > 1 && activeTab === 'logs' && (
            <div className="border-b border-[#30363d] bg-[#0d1117] px-4 py-3 shrink-0">
              <WorkflowGraph
                graph={jobGraph}
                jobs={rawJobs}
                selectedJob={selectedJob?.name ?? null}
                onJobClick={(jobName) => {
                  const job = jobs.find((j) => j.name === jobName)
                  if (job) setSelectedJobId(job.id)
                }}
                className="max-h-[140px]"
              />
            </div>
          )}

          {/* ── Body ──────────────────────────────────────────────────── */}
          {activeTab === 'resources' && source === 'orbit' ? (
            <ResourcesPanel
              metrics={metrics}
              steps={stepsWithMetrics}
              loading={loadingMetrics}
              run={run as Run}
              filter={metricsFilter}
              onFilterChange={setMetricsFilter}
            />
          ) : (
          <div className="flex flex-1 min-h-0">

            {/* Sidebar: jobs */}
            <div className="w-56 shrink-0 border-r border-[#30363d] flex flex-col bg-[#0d1117]">
              <div className="px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#8b949e]/70 border-b border-[#30363d]/60">
                {t('workspace.runs.jobs_label', 'Jobs')}
              </div>
              <ScrollArea className="flex-1">
                {loadingJobs ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-4 w-4 animate-spin text-[#8b949e]" />
                  </div>
                ) : hasError ? (
                  <div className="px-3.5 py-4 text-xs text-[#f85149]">
                    {t('workspace.runs.error_load_jobs', 'Error loading jobs')}
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="px-3.5 py-4 text-xs text-[#8b949e]">{t('workspace.runs.no_jobs_found', 'No jobs found')}</div>
                ) : (
                  <div className="py-1.5">
                    {jobs.map((job) => {
                      const sel = selectedJobId === job.id
                      const failed = isFailed(job.status, job.conclusion)
                      return (
                        <button
                          key={String(job.id)}
                          onClick={() => setSelectedJobId(job.id)}
                          className={cn(
                            'w-full text-left px-3.5 py-2.5 flex items-start gap-2.5 text-xs transition-colors border-l-2',
                            sel
                              ? 'bg-[#161b22] border-l-primary text-white'
                              : 'border-l-transparent text-[#8b949e] hover:bg-[#161b22]/70 hover:text-[#c9d1d9]'
                          )}
                        >
                          <StatusIcon status={job.status} conclusion={job.conclusion} />
                          <span className="flex-1 min-w-0 break-words leading-tight pt-0.5 font-medium">{job.name}</span>
                          {job.startedAt && job.completedAt && (
                            <span className={cn('shrink-0 pt-0.5 tabular-nums text-[10px]', failed ? 'text-[#f85149]/70' : 'text-[#8b949e]/60')}>
                              {fmtDuration(job.startedAt, job.completedAt)}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Main: steps + logs */}
            <div className="flex-1 min-w-0 flex flex-col">
              {!selectedJob && !loadingJobs ? (
                <div className="flex flex-col items-center justify-center flex-1 gap-2 text-[#8b949e]">
                  {hasError ? (
                    <>
                      <AlertCircle className="h-8 w-8 text-[#f85149]/50" />
                      <p className="text-sm">{t('workspace.runs.error_load_details', 'Failed to load details')}</p>
                      <button
                        onClick={() => {}}
                        className="text-xs text-primary underline underline-offset-2"
                      >
                        {t('common.try_again', 'Try again')}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm">{t('workspace.runs.select_job_prompt', 'Select a job')}</p>
                  )}
                </div>
              ) : loadingJobs ? (
                <div className="flex items-center justify-center flex-1">
                  <Loader2 className="h-5 w-5 animate-spin text-[#8b949e]" />
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <div className="py-2">
                    {loadingJobLog && (
                      <div className="flex items-center gap-2 px-4 py-2 text-[11px] text-[#8b949e]/70">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t('workspace.runs.loading_logs', 'Loading logs…')}
                      </div>
                    )}
                    {selectedJob!.steps.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-[#8b949e]">{t('workspace.runs.no_steps_found', 'No steps recorded')}</div>
                    ) : (
                      selectedJob!.steps.map((step) => {
                        const expanded = expandedSteps.has(step.id)
                        const lines = stepLogs.get(step.id) ?? []
                        const hasLogs = lines.length > 0
                        const failed = isFailed(step.status, step.conclusion)
                        const succeeded = isSuccess(step.status, step.conclusion)
                        const running = isRunning(step.status)
                        const skipped = step.status === 'skipped' || step.conclusion === 'skipped'

                        return (
                          <div key={step.id} className={cn(
                            'border-b border-[#21262d] last:border-0',
                            expanded && 'bg-[#0d1117]'
                          )}>
                            {/* Step header row */}
                            <button
                              onClick={() => (hasLogs || running) && toggleStep(step.id)}
                              className={cn(
                                'w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-left transition-colors',
                                (hasLogs || running) ? 'cursor-pointer hover:bg-[#161b22]' : 'cursor-default',
                                expanded && 'bg-[#161b22]',
                                failed && 'border-l-2 border-l-[#f85149]',
                                succeeded && !failed && 'border-l-2 border-l-transparent',
                                running && 'border-l-2 border-l-[#e3b341]',
                              )}
                            >
                              {(hasLogs || running) ? (
                                expanded
                                  ? <ChevronDown className="h-3.5 w-3.5 text-[#8b949e] shrink-0" />
                                  : <ChevronRight className="h-3.5 w-3.5 text-[#8b949e] shrink-0" />
                              ) : (
                                <span className="w-3.5 shrink-0" />
                              )}
                              <StatusIcon status={step.status} conclusion={step.conclusion} />
                              <span className={cn(
                                'flex-1 font-medium',
                                failed ? 'text-[#f85149]/90'
                                  : running ? 'text-[#e3b341]/90'
                                  : skipped ? 'text-[#8b949e]/60'
                                  : 'text-[#c9d1d9]'
                              )}>
                                {step.name}
                                {skipped && <span className="ml-2 text-[10px] font-normal text-[#8b949e]/50">{t('workspace.status.skipped', 'skipped')}</span>}
                              </span>
                              {step.startedAt && step.completedAt && (
                                <span className="text-[10px] tabular-nums text-[#8b949e]/60 shrink-0">
                                  {fmtDuration(step.startedAt, step.completedAt)}
                                </span>
                              )}
                            </button>

                            {/* Log lines */}
                            {expanded && (
                              <div className="bg-[#010409] border-t border-[#21262d] overflow-x-auto">
                                {lines.length === 0 ? (
                                  <p className="px-12 py-3 text-[11px] text-[#8b949e]/50 font-mono">{t('workspace.runs.no_logs_found', 'No logs available')}</p>
                                ) : (
                                  lines.map((line, i) => <LogLine key={i} line={line} index={i} />)
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>

    <ConfirmDialog
      open={confirmCancel}
      onOpenChange={setConfirmCancel}
      title={t('workspace.runs.cancel_title', 'Cancel execution')}
      description={t('workspace.runs.cancel_desc', { workflow: orbitRun?.workflowName ?? orbitRun?.workflowFile ?? 'workflow', defaultValue: `Are you sure you want to cancel the execution of "${orbitRun?.workflowName ?? orbitRun?.workflowFile ?? 'workflow'}"?` })}
      consequences={[
        t('workspace.runs.cancel_cons1', 'The execution will be stopped immediately'),
        t('workspace.runs.cancel_cons2', 'In-progress jobs will finish with "cancelled" status'),
        t('workspace.runs.cancel_cons3', 'Partial changes made by the run will not be reverted')
      ]}
      confirmLabel={t('workspace.runs.cancel_btn', 'Cancel execution')}
      variant="destructive"
      onConfirm={executeCancel}
    />
    </>
  )
}

// ─── Resources panel ─────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function ResourcesPanel({ metrics, steps, loading, run, filter, onFilterChange }: {
  metrics: MetricSample[]
  steps: RunStep[]
  loading: boolean
  run: Run
  filter: { jobName?: string; stepName?: string }
  onFilterChange: (f: { jobName?: string; stepName?: string }) => void
}) {
  const { t } = useTranslation()

  const stepsWithPeaks = useMemo(() =>
    steps.filter((s) => s.peakCpuPercent != null || s.peakRamBytes != null),
    [steps]
  )

  const uniqueStepNames = useMemo(() => {
    const names = new Set<string>()
    for (const s of steps) {
      if (s.stepName) names.add(s.stepName)
    }
    return Array.from(names)
  }, [steps])

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="h-5 w-5 animate-spin text-[#8b949e]" />
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-5 space-y-5">
        {/* Run-level peak cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 flex items-center gap-2.5">
            <Cpu className="h-4 w-4 text-blue-400 shrink-0" />
            <div>
              <p className="text-[10px] text-[#8b949e] uppercase tracking-wide">{t('workspace.runs.peak_cpu', 'Peak CPU')}</p>
              <p className="text-base font-bold text-white tabular-nums">
                {run.peakCpuPercent != null ? `${run.peakCpuPercent.toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 flex items-center gap-2.5">
            <MemoryStick className="h-4 w-4 text-green-400 shrink-0" />
            <div>
              <p className="text-[10px] text-[#8b949e] uppercase tracking-wide">{t('workspace.runs.peak_ram', 'Peak RAM')}</p>
              <p className="text-base font-bold text-white tabular-nums">
                {run.peakRamBytes != null ? formatBytes(run.peakRamBytes) : '—'}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 flex items-center gap-2.5">
            <Monitor className="h-4 w-4 text-purple-400 shrink-0" />
            <div>
              <p className="text-[10px] text-[#8b949e] uppercase tracking-wide">{t('workspace.runs.peak_gpu', 'Peak GPU')}</p>
              <p className="text-base font-bold text-white tabular-nums">
                {run.peakGpuPercent != null ? `${run.peakGpuPercent.toFixed(1)}%` : 'N/A'}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 flex items-center gap-2.5">
            <Monitor className="h-4 w-4 text-purple-400 shrink-0" />
            <div>
              <p className="text-[10px] text-[#8b949e] uppercase tracking-wide">{t('workspace.runs.peak_vram', 'Peak VRAM')}</p>
              <p className="text-base font-bold text-white tabular-nums">
                {run.peakGpuMemBytes != null ? formatBytes(run.peakGpuMemBytes) : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        {/* Filter by step */}
        {uniqueStepNames.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-[#8b949e] uppercase tracking-wide font-semibold">{t('common.filter', 'Filter')}:</span>
            <button
              onClick={() => onFilterChange({})}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border',
                !filter.stepName
                  ? 'bg-primary/20 text-primary border-primary/40'
                  : 'text-[#8b949e] border-[#30363d] hover:text-white hover:border-[#8b949e]/40'
              )}
            >
              {t('workspace.runs.full_run_label', 'Full run')}
            </button>
            {uniqueStepNames.map((name) => (
              <button
                key={name}
                onClick={() => onFilterChange({ stepName: name })}
                className={cn(
                  'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border truncate max-w-[150px]',
                  filter.stepName === name
                    ? 'bg-primary/20 text-primary border-primary/40'
                    : 'text-[#8b949e] border-[#30363d] hover:text-white hover:border-[#8b949e]/40'
                )}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* Timeline chart */}
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
          <h3 className="text-xs font-semibold text-white mb-3">
            {t('workspace.runs.resources_timeline_title', 'Resources timeline')}
            {filter.stepName && <span className="text-[#8b949e] font-normal ml-2">— {filter.stepName}</span>}
          </h3>
          <ResourceChart samples={metrics} height={220} />
        </div>

        {/* Per-step peaks table */}
        {stepsWithPeaks.length > 0 && (
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#30363d]">
              <h3 className="text-xs font-semibold text-white">{t('workspace.runs.peak_per_step_title', 'Peak per step')}</h3>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#21262d] bg-[#0d1117]/50">
                  {['Step', 'CPU', 'RAM', 'GPU', 'VRAM'].map((h) => (
                    <th key={h} className={cn(
                      'px-4 py-2 text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider',
                      h === 'Step' ? 'text-left' : 'text-right'
                    )}>{h === 'Step' ? t('common.step', 'Step') : h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#21262d]">
                {stepsWithPeaks.map((step) => (
                  <tr
                    key={step.id}
                    className={cn(
                      'hover:bg-[#161b22] transition-colors cursor-pointer',
                      filter.stepName === step.stepName && 'bg-primary/5'
                    )}
                    onClick={() => onFilterChange(
                      filter.stepName === step.stepName ? {} : { stepName: step.stepName ?? undefined }
                    )}
                  >
                    <td className="px-4 py-2 text-xs text-[#c9d1d9] font-medium truncate max-w-[200px]">
                      {step.stepName ?? `Step ${step.stepIndex}`}
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-blue-400">
                      {step.peakCpuPercent != null ? `${step.peakCpuPercent.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-green-400">
                      {step.peakRamBytes != null ? formatBytes(step.peakRamBytes) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-purple-400">
                      {step.peakGpuPercent != null ? `${step.peakGpuPercent.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-purple-400">
                      {step.peakGpuMemBytes != null ? formatBytes(step.peakGpuMemBytes) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state */}
        {metrics.length === 0 && stepsWithPeaks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Cpu className="h-8 w-8 text-[#8b949e]/30 mb-3" />
            <p className="text-sm text-[#8b949e]">{t('workspace.runs.no_resource_data_title', 'No resource data')}</p>
            <p className="text-[11px] text-[#8b949e]/60 mt-1">
              {t('workspace.runs.no_resource_data_desc', 'Metrics will be collected automatically in future runs')}
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
