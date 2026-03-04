import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play, FolderOpen, ExternalLink, Plus, GitBranch,
  Clock, GitCommit, FileCode, ChevronRight, Github, ArrowUp, ArrowDown
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore, useRunsStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusIcon } from '@/components/shared/StatusIcon'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils'
import { WorkflowDispatchDialog } from '@/components/WorkflowDispatchDialog'
import { useRepoDetail } from './RepoDetail'
import type { WorkflowFile, GitCommit as GitCommitType } from '@shared/types'

export function RepoOverview(): JSX.Element {
  const { repoId, gitStatus } = useRepoDetail()
  const navigate = useNavigate()
  const { repos } = useRepoStore()
  const { runs } = useRunsStore()
  const repo = repos.find((r) => r.id === repoId)

  const [workflows, setWorkflows] = useState<WorkflowFile[]>([])
  const [commits, setCommits] = useState<GitCommitType[]>([])
  const [dispatchWorkflow, setDispatchWorkflow] = useState<WorkflowFile | null>(null)

  const repoRuns = runs.filter((r) => r.repoId === repoId)
  const lastRun = repoRuns[0] ?? null

  useEffect(() => {
    if (!repoId) return
    electron.workflows.list(repoId).then(setWorkflows).catch(() => {})
    if (repo?.localPath) {
      electron.git.log(repoId, 5).then(setCommits).catch(() => {})
    }
  }, [repoId, repo?.localPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunWorkflow = (wf: WorkflowFile) => {
    if (wf.triggers.includes('workflow_dispatch')) {
      setDispatchWorkflow(wf)
    } else {
      runWorkflow(wf.file, {})
    }
  }

  const runWorkflow = async (file: string, inputs: Record<string, string>) => {
    const runId = await electron.workflows.run(repoId, file, inputs)
    navigate(`/run/${runId}`)
  }

  const totalChanges = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0

  if (!repo) return <div />

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-5 space-y-5">

        {/* ── Last run status ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Última execução
          </h2>
          {lastRun ? (
            <div
              className="flex items-center gap-3 p-3.5 rounded-lg border border-border bg-card cursor-pointer hover:bg-accent/30 transition-colors"
              onClick={() => navigate(`/run/${lastRun.id}`)}
            >
              <StatusIcon status={lastRun.status} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[13px] text-foreground">
                    {lastRun.workflowName ?? lastRun.workflowFile}
                  </span>
                  <StatusBadge status={lastRun.status} />
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[12px] text-muted-foreground">
                  <span>{formatRelativeTime(lastRun.createdAt)}</span>
                  {lastRun.durationMs != null && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(lastRun.durationMs)}
                    </span>
                  )}
                  {lastRun.gitBranch && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {lastRun.gitBranch}
                    </span>
                  )}
                  {lastRun.gitSha && (
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <GitCommit className="h-3 w-3" />
                      {lastRun.gitSha.slice(0, 7)}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
            </div>
          ) : (
            <div className="p-3.5 rounded-lg border border-dashed border-border text-center">
              <p className="text-[13px] text-muted-foreground">Nenhuma execução ainda</p>
            </div>
          )}
        </section>

        {/* ── Branch info + Changes summary ────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          {/* Branch info */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Branch
            </h2>
            {gitStatus ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[#58a6ff] shrink-0" />
                  <span className="text-[13px] font-medium text-[#58a6ff]">{gitStatus.branch}</span>
                  {gitStatus.tracking && (
                    <span className="text-[11px] text-muted-foreground">→ {gitStatus.tracking}</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-[12px]">
                  <div className={cn('flex items-center gap-1', gitStatus.ahead > 0 ? 'text-[#3fb950]' : 'text-muted-foreground')}>
                    <ArrowUp className="h-3 w-3" />
                    <span>{gitStatus.ahead} à frente</span>
                  </div>
                  <div className={cn('flex items-center gap-1', gitStatus.behind > 0 ? 'text-[#d29922]' : 'text-muted-foreground')}>
                    <ArrowDown className="h-3 w-3" />
                    <span>{gitStatus.behind} atrás</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <GitBranch className="h-4 w-4" />
                <span>{repo.defaultBranch}</span>
              </div>
            )}
          </section>

          {/* Changes summary */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Alterações
              </h2>
              {totalChanges > 0 && (
                <button
                  onClick={() => navigate(`/repo/${encodeURIComponent(repoId)}/changes`)}
                  className="text-[11px] text-primary hover:underline"
                >
                  Ver todas
                </button>
              )}
            </div>
            {gitStatus ? (
              <div className="space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Staged</span>
                  <Badge
                    variant={gitStatus.staged.length > 0 ? 'secondary' : 'outline'}
                    className="text-[10px] h-4 px-1.5"
                  >
                    {gitStatus.staged.length}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Modificados</span>
                  <Badge
                    variant={gitStatus.unstaged.length > 0 ? 'secondary' : 'outline'}
                    className="text-[10px] h-4 px-1.5"
                  >
                    {gitStatus.unstaged.length}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Não rastreados</span>
                  <Badge
                    variant={gitStatus.untracked.length > 0 ? 'secondary' : 'outline'}
                    className="text-[10px] h-4 px-1.5"
                  >
                    {gitStatus.untracked.length}
                  </Badge>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">Sem pasta local</p>
            )}
          </section>
        </div>

        {/* ── Last 5 commits ───────────────────────────────────────────────── */}
        {commits.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Commits recentes
              </h2>
              <button
                onClick={() => navigate(`/repo/${encodeURIComponent(repoId)}/history`)}
                className="text-[11px] text-primary hover:underline"
              >
                Ver histórico
              </button>
            </div>
            <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
              {commits.map((commit) => (
                <div key={commit.hash} className="flex items-start gap-3 px-4 py-2.5 group hover:bg-accent/20 transition-colors">
                  <GitCommit className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-foreground truncate leading-snug">{commit.message}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                      <span className="font-mono text-primary/70">{commit.hash.slice(0, 7)}</span>
                      <span>{commit.author}</span>
                      <span>{formatRelativeTime(commit.date)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Workflows list ───────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Workflows
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/repo/${encodeURIComponent(repoId)}/workflows`)}
                className="text-[11px] text-primary hover:underline"
              >
                Ver todos
              </button>
            </div>
          </div>
          {workflows.length === 0 ? (
            <EmptyState
              icon={FileCode}
              title="Nenhum workflow"
              description="Crie um arquivo YAML em .orbit/workflows/"
              action={{
                label: 'Criar workflow',
                onClick: () => navigate(`/editor/${encodeURIComponent(repoId)}`)
              }}
              className="py-8 rounded-lg border border-dashed border-border"
            />
          ) : (
            <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
              {workflows.slice(0, 5).map((wf) => (
                <div key={wf.file} className="flex items-center gap-3 px-4 py-2.5 group hover:bg-accent/20 transition-colors">
                  <FileCode className="h-4 w-4 text-primary/70 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium">{wf.name}</span>
                      {wf.triggers.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{wf.file}</p>
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-[12px] px-2.5 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleRunWorkflow(wf)}
                  >
                    <Play className="h-3 w-3" />
                    Executar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Quick actions ────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Ações rápidas
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            {repo.localPath && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[12px] gap-1.5"
                onClick={() => electron.repos.openFolder(repo.localPath!)}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Abrir pasta
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[12px] gap-1.5"
              onClick={() => electron.shell.openExternal(`https://github.com/${repo.fullName}`)}
            >
              <Github className="h-3.5 w-3.5" />
              Ver no GitHub
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[12px] gap-1.5"
              onClick={() => navigate(`/editor/${encodeURIComponent(repoId)}`)}
            >
              <Plus className="h-3.5 w-3.5" />
              Novo Workflow
            </Button>
          </div>
        </section>
      </div>

      {/* Workflow dispatch dialog */}
      {dispatchWorkflow && (
        <WorkflowDispatchDialog
          workflow={dispatchWorkflow}
          open={!!dispatchWorkflow}
          onClose={() => setDispatchWorkflow(null)}
          onRun={(inputs) => {
            runWorkflow(dispatchWorkflow.file, inputs)
            setDispatchWorkflow(null)
          }}
        />
      )}
    </div>
  )
}
