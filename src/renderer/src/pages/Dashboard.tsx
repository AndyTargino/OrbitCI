import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Play, RefreshCw, GitBranch, Clock,
  CheckCircle2, XCircle, Loader2, FileCode,
  Plus, ChevronRight, Circle, AlertCircle, GitCommit, Import,
  MoreHorizontal, FolderOpen, Unlink, Settings2, ExternalLink, Github
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore, useRunsStore } from '@/store'
import { useGlobalEvents } from '@/hooks/useSync'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils'
import { WorkflowDispatchDialog } from '@/components/WorkflowDispatchDialog'
import { GitPanel } from '@/components/GitPanel'
import { RunDetailModal } from '@/components/RunDetailModal'
import { notify } from '@/lib/notify'
import type { WorkflowFile, Run, GitStatus, RunStatus, GitHubRun } from '@shared/types'

type GhFilter = 'all' | 'success' | 'failure' | 'in_progress' | 'cancelled'

// ── Owner avatar ───────────────────────────────────────────────────────────────
function OwnerAvatar({ owner, className }: { owner: string; className?: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  const url = !failed ? `https://github.com/${owner}.png?size=64` : null
  if (!url) {
    return (
      <span className={cn('rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center font-bold text-primary shrink-0', className)}>
        {owner[0]?.toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt={owner}
      className={cn('rounded-full object-cover shrink-0', className)}
      onError={() => setFailed(true)}
    />
  )
}

// ── Status components — GitHub Actions style ──────────────────────────────────
function StatusIcon({ status }: { status: RunStatus }): JSX.Element {
  switch (status) {
    case 'success':   return <CheckCircle2 className="h-4 w-4 text-[#3fb950]" />
    case 'failure':   return <XCircle      className="h-4 w-4 text-[#f85149]" />
    case 'running':   return <Loader2      className="h-4 w-4 text-[#58a6ff] animate-spin" />
    case 'cancelled': return <AlertCircle  className="h-4 w-4 text-[#d29922]" />
    default:          return <Circle       className="h-4 w-4 text-muted-foreground" />
  }
}

function StatusBadge({ status }: { status: RunStatus }): JSX.Element {
  const styles: Record<RunStatus, string> = {
    success:   'text-[#3fb950] border-[#3fb950]/25 bg-[#3fb950]/10',
    failure:   'text-[#f85149] border-[#f85149]/25 bg-[#f85149]/10',
    running:   'text-[#58a6ff] border-[#58a6ff]/25 bg-[#58a6ff]/10',
    cancelled: 'text-[#d29922] border-[#d29922]/25 bg-[#d29922]/10',
    pending:   'text-muted-foreground border-border bg-muted/50'
  }
  const labels: Record<RunStatus, string> = {
    success: 'concluído', failure: 'falhou', running: 'executando',
    cancelled: 'cancelado', pending: 'aguardando'
  }
  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium', styles[status])}>
      {labels[status]}
    </Badge>
  )
}

// ── Run row — GitHub Actions-like ─────────────────────────────────────────────
function RunRow({ run, onClick }: { run: Run; onClick: () => void }): JSX.Element {
  return (
    <div
      onClick={onClick}
      className="gh-row cursor-pointer group"
    >
      <StatusIcon status={run.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[13px] text-foreground truncate">
            {run.workflowName ?? run.workflowFile}
          </span>
          <StatusBadge status={run.status} />
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[12px] text-muted-foreground">
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
            <span className="flex items-center gap-1 font-mono text-[11px]">
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

// ── GitHub Actions run row ────────────────────────────────────────────────────
function ghRunVisual(run: GitHubRun): { icon: JSX.Element; badge: string; badgeCls: string } {
  if (run.status === 'in_progress') return {
    icon: <Loader2 className="h-4 w-4 text-[#58a6ff] animate-spin" />,
    badge: 'executando', badgeCls: 'text-[#58a6ff] border-[#58a6ff]/25 bg-[#58a6ff]/10'
  }
  if (run.status !== 'completed') return {
    icon: <Circle className="h-4 w-4 text-muted-foreground" />,
    badge: 'aguardando', badgeCls: 'text-muted-foreground border-border bg-muted/50'
  }
  switch (run.conclusion) {
    case 'success':    return { icon: <CheckCircle2 className="h-4 w-4 text-[#3fb950]" />, badge: 'sucesso', badgeCls: 'text-[#3fb950] border-[#3fb950]/25 bg-[#3fb950]/10' }
    case 'failure':    return { icon: <XCircle className="h-4 w-4 text-[#f85149]" />, badge: 'falhou', badgeCls: 'text-[#f85149] border-[#f85149]/25 bg-[#f85149]/10' }
    case 'cancelled':  return { icon: <AlertCircle className="h-4 w-4 text-[#d29922]" />, badge: 'cancelado', badgeCls: 'text-[#d29922] border-[#d29922]/25 bg-[#d29922]/10' }
    case 'timed_out':  return { icon: <XCircle className="h-4 w-4 text-[#f85149]" />, badge: 'timeout', badgeCls: 'text-[#f85149] border-[#f85149]/25 bg-[#f85149]/10' }
    case 'skipped':    return { icon: <Circle className="h-4 w-4 text-muted-foreground" />, badge: 'ignorado', badgeCls: 'text-muted-foreground border-border bg-muted/50' }
    default:           return { icon: <Circle className="h-4 w-4 text-muted-foreground" />, badge: run.conclusion ?? 'neutro', badgeCls: 'text-muted-foreground border-border bg-muted/50' }
  }
}

function GitHubRunRow({ run, onClick }: { run: GitHubRun; onClick: () => void }): JSX.Element {
  const { icon, badge, badgeCls } = ghRunVisual(run)
  const workflowFile = run.workflowPath.split('/').pop() ?? run.workflowPath
  return (
    <div className="gh-row cursor-pointer group" onClick={onClick}>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[13px] text-foreground truncate">{run.displayTitle}</span>
          <Badge variant="outline" className={cn('text-[11px] font-medium shrink-0', badgeCls)}>{badge}</Badge>
          <span className="text-[11px] text-muted-foreground shrink-0">#{run.runNumber}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
          <span className="font-mono text-muted-foreground/70">{workflowFile}</span>
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />{run.headBranch}
          </span>
          <span className="flex items-center gap-1 font-mono">
            <GitCommit className="h-3 w-3" />{run.headSha.slice(0, 7)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />{formatRelativeTime(run.createdAt)}
          </span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{run.event}</Badge>
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

// ── Workflow row ──────────────────────────────────────────────────────────────
function WorkflowRow({
  wf,
  onRun,
  onEdit
}: {
  wf: WorkflowFile
  onRun: () => void
  onEdit: () => void
}): JSX.Element {
  return (
    <div className="gh-row group">
      <FileCode className="h-4 w-4 text-primary/70 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-[13px]">{wf.name}</span>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground font-mono">{wf.file}</span>
          {wf.triggers.map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
              {t}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="outline" size="sm" className="h-7 text-[12px] px-2.5" onClick={onEdit}>
          Editar
        </Button>
        <Button size="sm" className="h-7 text-[12px] px-2.5" onClick={onRun}>
          <Play className="h-3 w-3" />
          Executar
        </Button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function Dashboard(): JSX.Element {
  const { repoId } = useParams<{ repoId: string }>()
  const navigate = useNavigate()
  const decodedId = decodeURIComponent(repoId ?? '')
  const { repos, syncEvents } = useRepoStore()
  const { runs, setRuns } = useRunsStore()
  const repo = repos.find((r) => r.id === decodedId)

  const [workflows, setWorkflows] = useState<WorkflowFile[]>([])
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [dispatchWorkflow, setDispatchWorkflow] = useState<WorkflowFile | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [githubWorkflows, setGithubWorkflows] = useState<{ file: string; path: string }[]>([])
  const [importingFile, setImportingFile] = useState<string | null>(null)
  const [githubRuns, setGithubRuns] = useState<GitHubRun[]>([])
  const [isLoadingGithubRuns, setIsLoadingGithubRuns] = useState(false)
  const [ghFilter, setGhFilter] = useState<GhFilter>('all')
  const [ghPage, setGhPage] = useState(1)
  const [ghHasMore, setGhHasMore] = useState(true)
  const [detailRun, setDetailRun] = useState<GitHubRun | Run | null>(null)
  const [detailSource, setDetailSource] = useState<'github' | 'orbit'>('orbit')
  const [workflowSubTab, setWorkflowSubTab] = useState<'orbit' | 'github'>('orbit')

  useGlobalEvents()

  useEffect(() => {
    if (!decodedId) return
    loadData()
  }, [decodedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    try {
      const [wfs, repoRuns] = await Promise.all([
        electron.workflows.list(decodedId),
        electron.runs.list({ repoId: decodedId, limit: 15 })
      ])
      setWorkflows(wfs)
      setRuns(repoRuns)
    } catch { /* ignored */ }

    if (repo?.localPath) {
      try {
        const status = await electron.git.status(decodedId)
        setGitStatus(status)
      } catch { /* git not available */ }

      try {
        const ghWfs = await electron.repos.listGithubWorkflows(repo.localPath)
        setGithubWorkflows(ghWfs)
      } catch { /* no .github/workflows */ }
    }
  }

  const PER_PAGE = 30

  const loadGitHubRuns = async (reset = true, filter: GhFilter = ghFilter) => {
    const nextPage = reset ? 1 : ghPage + 1
    if (!reset && !ghHasMore) return
    setIsLoadingGithubRuns(true)
    try {
      const statusParam = filter !== 'all' ? filter : undefined
      const list = await electron.runs.listGitHub(decodedId, PER_PAGE, nextPage, statusParam)
      setGithubRuns((prev) => (reset ? list : [...prev, ...list]))
      setGhPage(reset ? 1 : nextPage)
      setGhHasMore(list.length === PER_PAGE)
    } catch { /* API unavailable */ }
    finally { setIsLoadingGithubRuns(false) }
  }

  const handleSync = async () => {
    setIsSyncing(true)
    try { await electron.repos.sync(decodedId) }
    finally { setIsSyncing(false); loadData() }
  }

  const handleRunWorkflow = (wf: WorkflowFile) => {
    if (wf.triggers.includes('workflow_dispatch')) {
      setDispatchWorkflow(wf)
    } else {
      runWorkflow(wf.file, {})
    }
  }

  const runWorkflow = async (file: string, inputs: Record<string, string>) => {
    const runId = await electron.workflows.run(decodedId, file, inputs)
    navigate(`/run/${runId}`)
  }

  const handleUnlink = async () => {
    try {
      const updated = await electron.repos.update(decodedId, { localPath: null })
      useRepoStore.getState().updateRepo(decodedId, updated)
      notify('success', 'Pasta desvinculada', `${repo?.fullName} desvinculado da pasta local`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao desvincular', msg)
    }
  }

  const handleImportSingleWorkflow = async (file: string) => {
    if (!repo?.localPath) return
    setImportingFile(file)
    try {
      const result = await electron.repos.importGithubWorkflows(repo.localPath)
      const isAll = file === 'all'
      notify(
        'success',
        isAll ? 'Workflows importados!' : 'Workflow importado!',
        isAll
          ? `${result.count} arquivo${result.count !== 1 ? 's' : ''} copiado${result.count !== 1 ? 's' : ''} para .orbit/workflows/`
          : `${file} copiado para .orbit/workflows/`
      )
      const wfs = await electron.workflows.list(decodedId)
      setWorkflows(wfs)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao importar', msg)
    } finally {
      setImportingFile(null)
    }
  }

  // Which github workflow files are already in .orbit/workflows/
  const importedFileSet = new Set(workflows.map((w) => w.file))
  const allImported = githubWorkflows.length > 0 && githubWorkflows.every((w) => importedFileSet.has(w.file))

  const repoRuns = runs.filter((r) => r.repoId === decodedId)
  const syncEvent = syncEvents[decodedId]

  if (!repo) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Repositório não encontrado</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="border-b border-border px-6 py-4 bg-card/30">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex items-start gap-3">
            <OwnerAvatar owner={repo.owner} className="h-10 w-10 ring-1 ring-border mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground mb-0.5">
                <button
                  onClick={() => navigate('/repos')}
                  className="hover:text-foreground transition-colors"
                >
                  {repo.owner}
                </button>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground font-medium">{repo.name}</span>
                {gitStatus && (
                  <>
                    <span className="text-border mx-0.5">·</span>
                    <GitBranch className="h-3 w-3 text-[#58a6ff]" />
                    <span className="text-[#58a6ff]">{gitStatus.branch}</span>
                    {gitStatus.ahead > 0 && (
                      <span className="text-[#3fb950]">↑{gitStatus.ahead}</span>
                    )}
                    {gitStatus.behind > 0 && (
                      <span className="text-[#d29922]">↓{gitStatus.behind}</span>
                    )}
                  </>
                )}
              </div>
              <h1 className="text-[18px] font-semibold text-foreground">{repo.name}</h1>
              {syncEvent && (
                <p className="text-[12px] text-muted-foreground mt-0.5">{syncEvent.message}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}
              className="h-8 text-[13px]">
              <RefreshCw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
              Sincronizar
            </Button>
            <Button size="sm" onClick={() => navigate(`/editor/${encodeURIComponent(decodedId)}`)}
              className="h-8 text-[13px]">
              <Plus className="h-3.5 w-3.5" />
              Novo Workflow
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 text-[13px]">
                {repo.localPath && (
                  <DropdownMenuItem onClick={() => electron.repos.openFolder(repo.localPath!)}>
                    <FolderOpen className="h-3.5 w-3.5 mr-2" />
                    Abrir pasta
                  </DropdownMenuItem>
                )}
                {repo.localPath && (
                  <DropdownMenuItem onClick={handleUnlink}>
                    <Unlink className="h-3.5 w-3.5 mr-2" />
                    Desvincular pasta
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/repos')}>
                  <Settings2 className="h-3.5 w-3.5 mr-2" />
                  Repositórios
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs defaultValue="workflows" className="flex-1 flex flex-col min-h-0">
          <div className="border-b border-border px-6 bg-card/20">
            <TabsList className="h-auto p-0 bg-transparent gap-0 rounded-none">
              <TabsTrigger
                value="workflows"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-[13px]"
              >
                <FileCode className="h-3.5 w-3.5 mr-1.5" />
                Workflows
                <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 h-4">
                  {workflows.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="runs"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-[13px]"
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Execuções
                <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 h-4">
                  {repoRuns.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="git"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-[13px]"
              >
                <GitBranch className="h-3.5 w-3.5 mr-1.5" />
                Git
              </TabsTrigger>
              <TabsTrigger
                value="gh-runs"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-[13px]"
                onClick={() => { if (githubRuns.length === 0 && !isLoadingGithubRuns) loadGitHubRuns(true) }}
              >
                <Github className="h-3.5 w-3.5 mr-1.5" />
                GitHub
                {githubRuns.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 h-4">
                    {githubRuns.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Workflows */}
          <TabsContent value="workflows" className="flex-1 mt-0 flex flex-col min-h-0 overflow-hidden">
            {/* Internal sub-tabs — only shown when github workflows exist */}
            {githubWorkflows.length > 0 && (
              <div className="border-b border-border/50 px-6 flex shrink-0 bg-card/10">
                {(['orbit', 'github'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setWorkflowSubTab(tab)}
                    className={cn(
                      'flex items-center gap-1.5 text-[12px] py-2.5 px-1 mr-6 border-b-2 transition-colors',
                      workflowSubTab === tab
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tab === 'orbit' ? (
                      <>
                        <FileCode className="h-3 w-3" />
                        OrbitCI
                        <span className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded-full">{workflows.length}</span>
                      </>
                    ) : (
                      <>
                        <Github className="h-3 w-3" />
                        GitHub Actions
                        <span className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded-full">{githubWorkflows.length}</span>
                        {!allImported && (
                          <span className="text-[10px] text-[#e3b341] font-medium">
                            {githubWorkflows.length - githubWorkflows.filter(w => importedFileSet.has(w.file)).length} novo{githubWorkflows.length - githubWorkflows.filter(w => importedFileSet.has(w.file)).length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-auto">
              {/* OrbitCI workflows */}
              {(workflowSubTab === 'orbit' || githubWorkflows.length === 0) && (
                workflows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
                      <FileCode className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold text-foreground">Nenhum workflow</h3>
                    <p className="text-[13px] text-muted-foreground mt-1 max-w-xs">
                      Crie um arquivo YAML em{' '}
                      <code className="text-primary font-mono text-[12px]">.orbit/workflows/</code>
                    </p>
                    <Button
                      className="mt-5 h-8 text-[13px]"
                      onClick={() => navigate(`/editor/${encodeURIComponent(decodedId)}`)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Criar Workflow
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {workflows.map((wf) => (
                      <WorkflowRow
                        key={wf.file}
                        wf={wf}
                        onRun={() => handleRunWorkflow(wf)}
                        onEdit={() => navigate(`/editor/${encodeURIComponent(decodedId)}/${wf.file}`)}
                      />
                    ))}
                  </div>
                )
              )}

              {/* GitHub Actions workflows */}
              {workflowSubTab === 'github' && githubWorkflows.length > 0 && (
                <>
                  <div className="px-6 py-2.5 border-b border-border bg-muted/10 flex items-center justify-between">
                    <span className="text-[12px] text-muted-foreground">
                      Workflows em{' '}
                      <code className="text-primary font-mono text-[11px]">.github/workflows/</code>
                      {allImported && <span className="ml-2 text-[#3fb950]">— todos sincronizados</span>}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[12px] px-2.5"
                      onClick={() => handleImportSingleWorkflow('all')}
                      disabled={importingFile !== null}
                    >
                      {importingFile === 'all'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Import className="h-3.5 w-3.5" />
                      }
                      {allImported ? 'Reimportar todos' : 'Importar todos'}
                    </Button>
                  </div>
                  <div className="divide-y divide-border">
                    {githubWorkflows.map((wf) => {
                      const isImported = importedFileSet.has(wf.file)
                      return (
                        <div key={wf.file} className="gh-row group">
                          <FileCode className={cn('h-4 w-4 shrink-0', isImported ? 'text-[#3fb950]/70' : 'text-[#d29922]/70')} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[13px]">{wf.file}</span>
                              {isImported ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-[#3fb950] border-[#3fb950]/30 bg-[#3fb950]/10">
                                  sincronizado
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-[#e3b341] border-[#e3b341]/30 bg-[#e3b341]/10">
                                  não importado
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{wf.path}</p>
                          </div>
                          <div className={cn('flex gap-1.5 shrink-0 transition-opacity', isImported ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[12px] px-2.5"
                              onClick={() => handleImportSingleWorkflow(wf.file)}
                              disabled={importingFile !== null}
                            >
                              {importingFile === wf.file
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Import className="h-3.5 w-3.5" />
                              }
                              {isImported ? 'Reimportar' : 'Importar'}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Runs */}
          <TabsContent value="runs" className="flex-1 mt-0 overflow-auto">
            {repoRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
                  <Play className="h-7 w-7 text-muted-foreground" />
                </div>
                <h3 className="font-semibold">Nenhuma execução</h3>
                <p className="text-[13px] text-muted-foreground mt-1">
                  Execute um workflow para ver o histórico aqui
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {repoRuns.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    onClick={() => { setDetailSource('orbit'); setDetailRun(run) }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Git */}
          <TabsContent value="git" className="flex-1 mt-0 overflow-hidden">
            {repo.localPath ? (
              <GitPanel repoId={decodedId} gitStatus={gitStatus} onRefresh={loadData} />
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-[13px]">
                Sem pasta local configurada
              </div>
            )}
          </TabsContent>

          {/* GitHub Actions history */}
          <TabsContent value="gh-runs" className="flex-1 mt-0 overflow-auto">
            {/* Filter + toolbar */}
            <div className="px-6 py-2.5 border-b border-border bg-card/20 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                {(['all', 'success', 'failure', 'in_progress', 'cancelled'] as GhFilter[]).map((f) => {
                  const labels: Record<GhFilter, string> = {
                    all: 'Todos', success: 'Sucesso', failure: 'Falhou',
                    in_progress: 'Em progresso', cancelled: 'Cancelado'
                  }
                  return (
                    <button
                      key={f}
                      onClick={() => {
                        setGhFilter(f)
                        if (githubRuns.length > 0 || isLoadingGithubRuns) loadGitHubRuns(true, f)
                      }}
                      className={cn(
                        'text-[11px] px-2.5 py-1 rounded-full border transition-colors',
                        ghFilter === f
                          ? 'bg-primary/15 border-primary/40 text-primary'
                          : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
                      )}
                    >
                      {labels[f]}
                    </button>
                  )
                })}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px] px-2.5 shrink-0"
                onClick={() => loadGitHubRuns(true)}
                disabled={isLoadingGithubRuns}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isLoadingGithubRuns && 'animate-spin')} />
                Atualizar
              </Button>
            </div>

            {isLoadingGithubRuns && githubRuns.length === 0 ? (
              <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-[13px]">Carregando histórico do GitHub...</span>
              </div>
            ) : githubRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
                  <Github className="h-7 w-7 text-muted-foreground" />
                </div>
                <h3 className="font-semibold">Nenhuma execução encontrada</h3>
                <p className="text-[13px] text-muted-foreground mt-1 max-w-xs">
                  Clique em <strong>Atualizar</strong> para carregar o histórico do GitHub Actions
                </p>
                <Button className="mt-5 h-8 text-[13px]" onClick={() => loadGitHubRuns(true)}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Carregar histórico
                </Button>
              </div>
            ) : (
              <>
                <div className="divide-y divide-border">
                  {githubRuns.map((run) => (
                    <GitHubRunRow
                      key={run.id}
                      run={run}
                      onClick={() => { setDetailSource('github'); setDetailRun(run) }}
                    />
                  ))}
                </div>
                {/* Pagination footer */}
                <div className="flex items-center justify-center py-4 border-t border-border/30">
                  {isLoadingGithubRuns ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : ghHasMore ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[12px] px-4"
                      onClick={() => loadGitHubRuns(false)}
                    >
                      Carregar mais
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground/50">
                      {githubRuns.length} execuções carregadas
                    </span>
                  )}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Run detail modal */}
      <RunDetailModal
        open={detailRun !== null}
        onClose={() => setDetailRun(null)}
        source={detailSource}
        run={detailRun}
        repoId={decodedId}
      />

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
