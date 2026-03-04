import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Square, CheckCircle2, XCircle, Loader2, Clock, GitBranch, Play } from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRunsStore } from '@/store'
import { useRunLogs } from '@/hooks/useRunLogs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LogViewer } from '@/components/LogViewer'
import { cn, formatDuration, formatDate } from '@/lib/utils'
import type { Run, RunJob } from '@shared/types'

function JobStatusIcon({ status }: { status: string }): JSX.Element {
  switch (status) {
    case 'success': return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    case 'failure': return <XCircle className="h-4 w-4 text-red-400" />
    case 'running': return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
    default: return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

export function RunDetail(): JSX.Element {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const { runs, runLogs, runJobs, setRunJobs } = useRunsStore()

  const [run, setRun] = useState<Run | null>(null)
  const [jobs, setJobs] = useState<RunJob[]>([])
  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)

  useRunLogs(runId ?? null)

  useEffect(() => {
    if (!runId) return
    loadRun()
  }, [runId])

  const loadRun = async () => {
    if (!runId) return
    const [runData, jobsData] = await Promise.all([
      electron.runs.get(runId),
      electron.runs.getJobs(runId)
    ])
    setRun(runData)
    setJobs(jobsData)
    setRunJobs(runId, jobsData)
  }

  const handleCancel = async () => {
    if (!runId) return
    setIsCancelling(true)
    try {
      await electron.runs.cancel(runId)
      await loadRun()
    } finally {
      setIsCancelling(false)
    }
  }

  const logs = runId ? (runLogs[runId] ?? []) : []
  const filteredLogs = selectedJob
    ? logs.filter((l) => l.jobName === selectedJob)
    : logs

  // Get updated run from store
  const storeRun = runs.find((r) => r.id === runId)
  const currentRun = storeRun ?? run

  const statusConfig = {
    success: { label: 'Sucesso', icon: CheckCircle2, color: 'text-emerald-400' },
    failure: { label: 'Falhou', icon: XCircle, color: 'text-red-400' },
    running: { label: 'Executando', icon: Loader2, color: 'text-blue-400' },
    pending: { label: 'Pendente', icon: Clock, color: 'text-muted-foreground' },
    cancelled: { label: 'Cancelado', icon: Square, color: 'text-amber-400' }
  }
  const statusInfo = statusConfig[currentRun?.status ?? 'pending']

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                {statusInfo && (
                  <statusInfo.icon className={cn('h-5 w-5', statusInfo.color, currentRun?.status === 'running' && 'animate-spin')} />
                )}
                <h1 className="text-xl font-bold">
                  {currentRun?.workflowName ?? currentRun?.workflowFile ?? 'Run'}
                </h1>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                <span>#{runId?.slice(0, 8)}</span>
                {currentRun?.trigger && <Badge variant="secondary">{currentRun.trigger}</Badge>}
                {currentRun?.gitBranch && (
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3.5 w-3.5" />
                    {currentRun.gitBranch}
                  </span>
                )}
                {currentRun?.startedAt && <span>{formatDate(currentRun.startedAt)}</span>}
                {currentRun?.durationMs && <span>{formatDuration(currentRun.durationMs)}</span>}
              </div>
            </div>
          </div>

          {currentRun?.status === 'running' && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancel}
              disabled={isCancelling}
            >
              {isCancelling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Jobs panel */}
        <div className="w-52 border-r border-border p-3 space-y-1 overflow-auto flex-shrink-0">
          <button
            className={cn(
              'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
              !selectedJob
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50 text-muted-foreground'
            )}
            onClick={() => setSelectedJob(null)}
          >
            Todos os logs
          </button>

          {jobs.map((job) => (
            <button
              key={job.id}
              className={cn(
                'w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                selectedJob === job.jobName
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50 text-muted-foreground'
              )}
              onClick={() => setSelectedJob(job.jobName)}
            >
              <JobStatusIcon status={job.status ?? 'pending'} />
              <span className="truncate">{job.jobName}</span>
            </button>
          ))}
        </div>

        {/* Logs */}
        <div className="flex-1 p-4 overflow-hidden">
          <LogViewer
            logs={filteredLogs}
            autoScroll={currentRun?.status === 'running'}
            className="h-full"
          />
        </div>
      </div>
    </div>
  )
}
