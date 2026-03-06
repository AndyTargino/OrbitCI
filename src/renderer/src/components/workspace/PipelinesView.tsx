import { useCallback, useEffect, useState, useMemo } from 'react'
import {
  Play,
  Plus,
  FileCode2,
  Download,
  Pencil,
  Loader2,
  FileText,
  Workflow,
  GitBranch,
  Zap,
  CheckCircle2,
  Circle,
  Github,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Terminal,
  Package
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { electron } from '@/lib/electron'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '@/components/ui/tooltip'
import type { WorkflowFile, WorkflowInput } from '@shared/types'
import jsYaml from 'js-yaml'
import { useTranslation } from 'react-i18next'

interface Props {
  repoId: string
  localPath?: string
}

type SourceTab = 'orbit' | 'github'

const DEFAULT_WORKFLOW = `name: My Workflow
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: local
    steps:
      - name: Hello
        run: echo "Hello from OrbitCI!"
`

// ── YAML parser for visual preview ──────────────────────────────────────────

interface WorkflowJob {
  id: string
  name: string
  runsOn: string
  needs: string[]
  steps: { name: string; run?: string; uses?: string }[]
}

interface ParsedWorkflow {
  name: string
  triggers: string[]
  jobs: WorkflowJob[]
}

function parseWorkflowYaml(yaml: string): ParsedWorkflow | null {
  try {
    const doc = jsYaml.load(yaml) as Record<string, unknown>
    if (!doc || typeof doc !== 'object') return null

    const name = (doc.name as string) ?? 'Unnamed Workflow'
    const on = doc.on ?? doc.true
    let triggers: string[] = []
    if (typeof on === 'string') triggers = [on]
    else if (Array.isArray(on)) triggers = on.map(String)
    else if (on && typeof on === 'object') triggers = Object.keys(on as object)

    const jobsRaw = (doc.jobs ?? {}) as Record<string, Record<string, unknown>>
    const jobs: WorkflowJob[] = Object.entries(jobsRaw).map(([id, job]) => {
      const needs = Array.isArray(job.needs) ? job.needs.map(String) : job.needs ? [String(job.needs)] : []
      const stepsRaw = (job.steps ?? []) as Record<string, unknown>[]
      const steps = stepsRaw.map((s) => ({
        name: (s.name as string) ?? (s.run ? 'Run script' : (s.uses as string) ?? 'Step'),
        run: s.run as string | undefined,
        uses: s.uses as string | undefined
      }))
      return {
        id,
        name: (job.name as string) ?? id,
        runsOn: (job['runs-on'] as string) ?? 'unknown',
        needs,
        steps
      }
    })

    return { name, triggers, jobs }
  } catch {
    return null
  }
}

// ── Trigger badge color ─────────────────────────────────────────────────────

const TRIGGER_COLORS: Record<string, string> = {
  push: 'bg-green-500/15 text-green-400 border-green-500/30',
  pull_request: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  workflow_dispatch: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  schedule: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  release: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

function getTriggerClass(trigger: string): string {
  return TRIGGER_COLORS[trigger] ?? 'bg-muted text-muted-foreground border-border'
}

// ── GitHub Actions-style pipeline graph ─────────────────────────────────────

function WorkflowGraph({ workflow }: { workflow: ParsedWorkflow }): JSX.Element {
  // Topological sort into levels
  const levels: WorkflowJob[][] = []
  const placed = new Set<string>()

  let remaining = [...workflow.jobs]
  while (remaining.length > 0) {
    const level = remaining.filter((j) =>
      j.needs.length === 0 || j.needs.every((n) => placed.has(n))
    )
    if (level.length === 0) {
      levels.push(remaining)
      break
    }
    levels.push(level)
    level.forEach((j) => placed.add(j.id))
    remaining = remaining.filter((j) => !placed.has(j.id))
  }

  // Calculate positions for SVG connectors
  const NODE_W = 180
  const NODE_H = 40
  const GAP_X = 60
  const GAP_Y = 16
  const LEVEL_W = NODE_W + GAP_X

  // Map job id → { level, index within level }
  const jobPositions = new Map<string, { x: number; y: number; level: number }>()
  let maxRows = 0
  levels.forEach((level, li) => {
    if (level.length > maxRows) maxRows = level.length
    level.forEach((job, ji) => {
      jobPositions.set(job.id, {
        x: li * LEVEL_W,
        y: ji * (NODE_H + GAP_Y),
        level: li
      })
    })
  })

  const totalW = levels.length * LEVEL_W - GAP_X
  const totalH = maxRows * (NODE_H + GAP_Y) - GAP_Y

  // Build connector lines
  const connectors: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const job of workflow.jobs) {
    const toPos = jobPositions.get(job.id)
    if (!toPos) continue
    for (const need of job.needs) {
      const fromPos = jobPositions.get(need)
      if (!fromPos) continue
      connectors.push({
        x1: fromPos.x + NODE_W,
        y1: fromPos.y + NODE_H / 2,
        x2: toPos.x,
        y2: toPos.y + NODE_H / 2
      })
    }
  }

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width: totalW, height: totalH, minWidth: totalW }}>
        {/* SVG connectors */}
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
                stroke="hsl(var(--muted-foreground) / 0.3)"
                strokeWidth="2"
                strokeDasharray="none"
              />
            )
          })}
        </svg>

        {/* Job nodes */}
        {workflow.jobs.map((job) => {
          const pos = jobPositions.get(job.id)
          if (!pos) return null
          return (
            <div
              key={job.id}
              className="absolute flex items-center gap-2.5 rounded-lg border border-border bg-card hover:border-muted-foreground/40 transition-colors px-3 cursor-default"
              style={{
                left: pos.x,
                top: pos.y,
                width: NODE_W,
                height: NODE_H
              }}
            >
              <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 flex items-center justify-center shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium truncate leading-tight">{job.name}</p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">{job.runsOn}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Expandable Job Card (GitHub Actions style) ──────────────────────────────

function JobCard({ job, defaultExpanded }: { job: WorkflowJob; defaultExpanded: boolean }): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Job header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-accent/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/40 flex items-center justify-center shrink-0">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
        </div>
        <span className="text-[13px] font-semibold flex-1 text-left truncate">{job.name}</span>
        <Badge variant="outline" className="text-[10px] h-5 font-normal shrink-0">
          {job.runsOn}
        </Badge>
        {job.needs.length > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {t('workspace.pipelines.needs_label', 'needs:')} {job.needs.join(', ')}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground shrink-0">
          {t('workspace.pipelines.steps_count', { count: job.steps.length, defaultValue: `${job.steps.length} step${job.steps.length !== 1 ? 's' : ''}` })}
        </span>
      </button>

      {/* Steps list */}
      {expanded && (
        <div className="border-t border-border">
          {job.steps.map((step, si) => {
            const isExpanded = expandedSteps.has(si)
            const hasDetails = !!(step.run || step.uses)
            return (
              <div key={si} className="border-b border-border/50 last:border-b-0">
                <button
                  onClick={() => hasDetails && toggleStep(si)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-4 py-2 pl-12 transition-colors text-left',
                    hasDetails && 'hover:bg-accent/20 cursor-pointer',
                    !hasDetails && 'cursor-default'
                  )}
                >
                  {hasDetails ? (
                    isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    )
                  ) : (
                    <div className="w-3" />
                  )}
                  <div className="w-4 h-4 rounded-full border border-muted-foreground/30 flex items-center justify-center shrink-0">
                    <Circle className="h-2 w-2 text-muted-foreground/40" />
                  </div>
                  <span className="text-[12px] truncate flex-1">{step.name}</span>
                  {step.uses && (
                    <span className="text-[10px] text-blue-400/70 shrink-0 flex items-center gap-1">
                      <Package className="h-2.5 w-2.5" />
                      {step.uses.split('@')[0].split('/').slice(-1)[0]}
                    </span>
                  )}
                </button>

                {/* Step details */}
                {isExpanded && hasDetails && (
                  <div className="mx-4 ml-[72px] mb-2 rounded-md bg-black/30 border border-border/50 overflow-hidden">
                    {step.uses && (
                      <div className="px-3 py-2 border-b border-border/30">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('workspace.pipelines.uses_label', 'Uses')}</span>
                        <p className="text-[11px] text-blue-400 font-mono mt-0.5">{step.uses}</p>
                      </div>
                    )}
                    {step.run && (
                      <div className="px-3 py-2">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('workspace.pipelines.run_label', 'Run')}</span>
                        <pre className="text-[11px] text-green-400/80 font-mono mt-0.5 whitespace-pre-wrap break-all leading-relaxed">
                          {step.run}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── GitHub workflow item (for sidebar) ──────────────────────────────────────

interface GhWorkflowItem {
  file: string
  name: string
  triggers: string[]
  content: string
}

function parseGhWorkflowItem(file: string, content: string): GhWorkflowItem {
  const parsed = parseWorkflowYaml(content)
  return {
    file,
    name: parsed?.name ?? file,
    triggers: parsed?.triggers ?? [],
    content
  }
}

// ── Main component ──────────────────────────────────────────────────────────

export function PipelinesView({ repoId, localPath }: Props): JSX.Element {
  const { t } = useTranslation()
  const [sourceTab, setSourceTab] = useState<SourceTab>('orbit')

  // ── OrbitCI state ─────────────────────────────────────────────────────────
  const [workflows, setWorkflows] = useState<WorkflowFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [yamlContent, setYamlContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadingYaml, setLoadingYaml] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newFilename, setNewFilename] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [showDispatch, setShowDispatch] = useState(false)
  const [dispatchInputs, setDispatchInputs] = useState<Record<string, string>>({})
  const [viewMode, setViewMode] = useState<'visual' | 'yaml'>('visual')

  // ── GitHub state ──────────────────────────────────────────────────────────
  const [ghFiles, setGhFiles] = useState<string[]>([])
  const [ghWorkflows, setGhWorkflows] = useState<GhWorkflowItem[]>([])
  const [ghLoading, setGhLoading] = useState(false)
  const [ghSelected, setGhSelected] = useState<string | null>(null)
  const [ghYamlContent, setGhYamlContent] = useState<string>('')
  const [ghLoadingYaml, setGhLoadingYaml] = useState(false)
  const [ghViewMode, setGhViewMode] = useState<'visual' | 'yaml'>('visual')

  // ── Import state ──────────────────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false)
  const [importSelection, setImportSelection] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  const hasOrbitWorkflows = workflows.length > 0
  const selectedWorkflow = workflows.find((w) => w.file === selected) ?? null
  const ghSelectedItem = ghWorkflows.find((w) => w.file === ghSelected) ?? null

  const parsedWorkflow = useMemo(() => {
    if (sourceTab === 'orbit' && yamlContent) return parseWorkflowYaml(yamlContent)
    if (sourceTab === 'github' && ghYamlContent) return parseWorkflowYaml(ghYamlContent)
    return null
  }, [sourceTab, yamlContent, ghYamlContent])

  const activeYaml = sourceTab === 'orbit' ? yamlContent : ghYamlContent
  const activeViewMode = sourceTab === 'orbit' ? viewMode : ghViewMode
  const setActiveViewMode = sourceTab === 'orbit' ? setViewMode : setGhViewMode

  // ── Load OrbitCI workflows ────────────────────────────────────────────────

  const loadWorkflows = useCallback(async () => {
    try {
      setLoading(true)
      const wfs = await electron.workflows.list(repoId)
      setWorkflows(wfs)
      if (wfs.length > 0 && !selected) {
        setSelected(wfs[0].file)
      }
    } catch {
      notify('failure', t('workspace.pipelines.error_load', 'Failed to load workflows'))
    } finally {
      setLoading(false)
    }
  }, [repoId, selected])

  // ── Load GitHub workflows ─────────────────────────────────────────────────

  const loadGhWorkflows = useCallback(async () => {
    if (!localPath) return
    try {
      setGhLoading(true)
      const result = await electron.repos.listGithubWorkflows(localPath)
      if (result.length === 0) {
        setGhFiles([])
        setGhWorkflows([])
        return
      }
      setGhFiles(result.map((r) => r.file))
      const items = result.map((r) =>
        parseGhWorkflowItem(r.file, r.content ?? '')
      )
      setGhWorkflows(items)
      if (items.length > 0 && !ghSelected) {
        setGhSelected(items[0].file)
      }
    } catch {
      // ignore
    } finally {
      setGhLoading(false)
    }
  }, [localPath, ghSelected])

  useEffect(() => {
    setSelected(null)
    setGhSelected(null)
    setYamlContent('')
    setGhYamlContent('')
    setShowNewForm(false)
    setShowImport(false)
    loadWorkflows()
    loadGhWorkflows()
  }, [repoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load selected OrbitCI workflow content ────────────────────────────────

  useEffect(() => {
    if (sourceTab !== 'orbit' || !selected) {
      if (sourceTab === 'orbit') setYamlContent('')
      return
    }
    let cancelled = false
    setLoadingYaml(true)
    electron.workflows
      .get(repoId, selected)
      .then((content) => { if (!cancelled) setYamlContent(content) })
      .catch(() => { if (!cancelled) setYamlContent('# Failed to load workflow file') })
      .finally(() => { if (!cancelled) setLoadingYaml(false) })
    return () => { cancelled = true }
  }, [repoId, selected, sourceTab])

  // ── Load selected GitHub workflow content (from cached data) ────────────────

  useEffect(() => {
    if (sourceTab !== 'github' || !ghSelected) {
      if (sourceTab === 'github') setGhYamlContent('')
      return
    }
    const item = ghWorkflows.find((w) => w.file === ghSelected)
    setGhYamlContent(item?.content ?? '')
    setGhLoadingYaml(false)
  }, [ghSelected, sourceTab, ghWorkflows])

  // ── Run OrbitCI workflow ──────────────────────────────────────────────────

  const handleRun = async (file: string) => {
    const wf = workflows.find((w) => w.file === file)
    if (wf?.triggers.includes('workflow_dispatch') && wf.inputs && Object.keys(wf.inputs).length > 0) {
      setSelected(file)
      setShowDispatch(true)
      const defaults: Record<string, string> = {}
      for (const [key, input] of Object.entries(wf.inputs)) {
        defaults[key] = input.default ?? ''
      }
      setDispatchInputs(defaults)
      return
    }
    await executeRun(file)
  }

  const executeRun = async (file: string, inputs?: Record<string, string>) => {
    try {
      setRunning(file)
      const runId = await electron.workflows.run(repoId, file, inputs)
      notify('success', t('workspace.pipelines.workflow_started', 'Workflow started'), `${t('common.run_id', 'Run ID')}: ${runId.slice(0, 8)}`)
      setShowDispatch(false)
    } catch (err) {
      notify('failure', t('workspace.pipelines.run_failed', 'Run failed'), err instanceof Error ? err.message : t('common.error_unknown', 'Unknown error'))
    } finally {
      setRunning(null)
    }
  }

  // ── Import from GitHub ────────────────────────────────────────────────────

  const handleOpenImport = () => {
    setImportSelection(new Set(ghFiles))
    setShowImport(true)
  }

  const toggleImportFile = (file: string) => {
    setImportSelection((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  const handleImport = async () => {
    if (!localPath || importSelection.size === 0) return
    try {
      setImporting(true)
      let result: { count: number }
      if (typeof electron.repos.importGithubWorkflowsSelective === 'function') {
        result = await electron.repos.importGithubWorkflowsSelective(localPath, Array.from(importSelection))
      } else {
        // Fallback: import all (existing API)
        result = await electron.repos.importGithubWorkflows(localPath)
      }
      notify('success', t('workspace.pipelines.imported_success', 'Workflows importados'), t('workspace.pipelines.imported_desc', { count: result.count, defaultValue: `${result.count} file(s) imported to .orbit/workflows/` }))
      setShowImport(false)
      await loadWorkflows()
      setSourceTab('orbit')
    } catch {
      notify('failure', t('workspace.pipelines.import_failed', 'Import failed'))
    } finally {
      setImporting(false)
    }
  }

  // ── Create new workflow ───────────────────────────────────────────────────

  const handleCreateNew = async () => {
    const filename = newFilename.trim()
    if (!filename) return
    const file = filename.endsWith('.yml') || filename.endsWith('.yaml') ? filename : `${filename}.yml`
    try {
      setCreatingNew(true)
      await electron.workflows.create(repoId, file, DEFAULT_WORKFLOW)
      notify('success', t('workspace.pipelines.workflow_created', 'Workflow created'), file)
      setShowNewForm(false)
      setNewFilename('')
      await loadWorkflows()
      setSelected(file)
    } catch {
      notify('failure', t('workspace.pipelines.create_failed', 'Failed to create workflow'))
    } finally {
      setCreatingNew(false)
    }
  }

  const isLoadingContent = sourceTab === 'orbit' ? loadingYaml : ghLoadingYaml
  const lines = activeYaml.split('\n')

  const showSetupPrompt = sourceTab === 'orbit' && !loading && !hasOrbitWorkflows && ghFiles.length > 0 && !showNewForm

  return (
    <TooltipProvider delayDuration={400}>
      <>
        {/* Left sidebar */}
        <div className="w-[300px] shrink-0 flex flex-col border-r border-border">
          {/* Source toggle */}
          <div className="px-3 py-2 border-b border-border">
            <div className="flex gap-1">
              <button
                onClick={() => setSourceTab('orbit')}
                className={cn(
                  'flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors',
                  sourceTab === 'orbit'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                OrbitCI
              </button>
              <button
                onClick={() => setSourceTab('github')}
                className={cn(
                  'flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors flex items-center justify-center gap-1',
                  sourceTab === 'github'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <Github className="h-3 w-3" />
                GitHub Actions
              </button>
            </div>
          </div>

          {/* Workflow list */}
          <ScrollArea className="flex-1">
            {sourceTab === 'orbit' ? (
              <>
                {loading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-[13px]">Loading...</span>
                  </div>
                ) : showSetupPrompt ? (
                  <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                    <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3">
                      <Workflow className="h-6 w-6 text-violet-400" />
                    </div>
                    <p className="text-[13px] font-medium mb-1">{t('workspace.pipelines.empty_title', 'No OrbitCI workflows')}</p>
                    <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
                      {t('workspace.pipelines.empty_setup_desc', { count: ghFiles.length, defaultValue: `We detected ${ghFiles.length} GitHub Actions workflow(s) in this repository. Import them to run locally with OrbitCI.` })}
                    </p>
                    <Button
                      size="sm"
                      className="h-8 text-[12px] px-4 gap-1.5"
                      onClick={handleOpenImport}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('workspace.pipelines.import_github_btn', 'Import from GitHub')}
                    </Button>
                    <button
                      onClick={() => setShowNewForm(true)}
                      className="text-[11px] text-muted-foreground hover:text-foreground mt-3 transition-colors"
                    >
                      {t('workspace.pipelines.create_new_link', 'or create a new workflow')}
                    </button>
                  </div>
                ) : workflows.length === 0 && !showNewForm ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <Workflow className="h-8 w-8 text-muted-foreground/50 mb-3" />
                    <p className="text-[13px] text-muted-foreground mb-1">{t('workspace.pipelines.no_workflows', 'No workflows found')}</p>
                    <p className="text-[12px] text-muted-foreground/70 mb-4">
                      {t('workspace.pipelines.create_help', 'Create a workflow in .orbit/workflows/')}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {workflows.map((wf) => (
                      <button
                        key={wf.file}
                        onClick={() => {
                          setSelected(wf.file)
                          setShowDispatch(false)
                        }}
                        className={cn(
                          'flex items-start gap-2 px-3 py-2.5 text-left border-b border-border transition-colors',
                          'hover:bg-accent/50',
                          selected === wf.file && 'bg-accent'
                        )}
                      >
                        <FileCode2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium truncate">{wf.name || wf.file}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{wf.file}</p>
                          {wf.triggers.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {wf.triggers.map((t) => (
                                <span
                                  key={t}
                                  className={cn(
                                    'text-[10px] px-1.5 py-0 h-4 leading-4 rounded-md border font-normal inline-block',
                                    getTriggerClass(t)
                                  )}
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 shrink-0"
                              disabled={running === wf.file}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRun(wf.file)
                              }}
                            >
                              {running === wf.file ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('workspace.pipelines.run_tooltip', 'Run workflow')}</TooltipContent>
                        </Tooltip>
                      </button>
                    ))}
                  </div>
                )}

                {/* New workflow form */}
                {showNewForm && (
                  <div className="p-3 border-b border-border">
                    <Label className="text-[12px] text-muted-foreground mb-1.5 block">{t('workspace.pipelines.filename_label', 'Filename')}</Label>
                    <div className="flex gap-1.5">
                      <Input
                        value={newFilename}
                        onChange={(e) => setNewFilename(e.target.value)}
                        placeholder="my-workflow.yml"
                        className="h-7 text-[12px]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateNew()
                          if (e.key === 'Escape') setShowNewForm(false)
                        }}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        className="h-7 text-[12px] px-2"
                        disabled={!newFilename.trim() || creatingNew}
                        onClick={handleCreateNew}
                      >
                        {creatingNew ? <Loader2 className="h-3 w-3 animate-spin" /> : t('common.create', 'Create')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Import from GitHub when orbit has workflows */}
                {hasOrbitWorkflows && ghFiles.length > 0 && (
                  <div className="p-3 border-b border-border">
                    <p className="text-[11px] text-muted-foreground mb-2">
                      {t('workspace.pipelines.gh_detected_count', { count: ghFiles.length, defaultValue: `${ghFiles.length} GitHub Actions workflow(s) detected` })}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-7 text-[12px]"
                      onClick={handleOpenImport}
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      {t('workspace.pipelines.import_github_btn', 'Import from GitHub')}
                    </Button>

                  </div>
                )}
              </>
            ) : (
              /* GitHub Actions tab */
              <>
                {ghLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-[13px]">Loading...</span>
                  </div>
                ) : ghWorkflows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <Github className="h-8 w-8 text-muted-foreground/50 mb-3" />
                    <p className="text-[13px] text-muted-foreground mb-1">{t('workspace.pipelines.no_gh_workflows', 'No GitHub Actions workflows')}</p>
                    <p className="text-[12px] text-muted-foreground/70">
                      {t('workspace.pipelines.no_gh_desc', 'No .github/workflows/ found in this repo')}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {ghWorkflows.map((wf) => (
                      <button
                        key={wf.file}
                        onClick={() => setGhSelected(wf.file)}
                        className={cn(
                          'flex items-start gap-2 px-3 py-2.5 text-left border-b border-border transition-colors',
                          'hover:bg-accent/50',
                          ghSelected === wf.file && 'bg-accent'
                        )}
                      >
                        <Github className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium truncate">{wf.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{wf.file}</p>
                          {wf.triggers.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {wf.triggers.map((t) => (
                                <span
                                  key={t}
                                  className={cn(
                                    'text-[10px] px-1.5 py-0 h-4 leading-4 rounded-md border font-normal inline-block',
                                    getTriggerClass(t)
                                  )}
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </ScrollArea>

          {/* Bottom actions */}
          <div className="p-2 border-t border-border">
            {sourceTab === 'orbit' ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-[12px]"
                onClick={() => {
                  setShowNewForm(true)
                  setNewFilename('')
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {t('workspace.pipelines.new_workflow_btn', 'New Workflow')}
              </Button>
            ) : ghWorkflows.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-[12px]"
                onClick={handleOpenImport}
              >
                <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                {t('workspace.pipelines.import_to_orbit_btn', 'Import to OrbitCI')}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Right content */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {/* Import dialog overlay */}
          {showImport && (
            <div className="flex-1 flex flex-col">
              <div className="px-4 py-3 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-violet-400" />
                  <h3 className="text-[14px] font-semibold">{t('workspace.pipelines.import_dialog_title', 'Import GitHub Actions Workflows')}</h3>
                </div>
                <p className="text-[12px] text-muted-foreground mt-1">
                  {t('workspace.pipelines.import_dialog_desc', 'Select which workflows to copy from .github/workflows/ to .orbit/workflows/')}
                </p>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px] px-2"
                      onClick={() => setImportSelection(new Set(ghFiles))}
                    >
                      {t('common.select_all', 'Select all')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px] px-2"
                      onClick={() => setImportSelection(new Set())}
                    >
                      {t('common.select_none', 'Select none')}
                    </Button>
                    <span className="text-[11px] text-muted-foreground ml-auto">
                      {t('common.selected_count', { count: importSelection.size, total: ghFiles.length, defaultValue: `${importSelection.size} of ${ghFiles.length} selected` })}
                    </span>
                  </div>

                  {ghFiles.map((file) => {
                    const isChecked = importSelection.has(file)
                    const meta = ghWorkflows.find((w) => w.file === file)
                    return (
                      <button
                        key={file}
                        onClick={() => toggleImportFile(file)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left',
                          isChecked
                            ? 'border-violet-500/40 bg-violet-500/5'
                            : 'border-border hover:bg-accent/50'
                        )}
                      >
                        <div className={cn(
                          'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                          isChecked
                            ? 'border-violet-500 bg-violet-500'
                            : 'border-muted-foreground/30'
                        )}>
                          {isChecked && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <FileCode2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium truncate">{meta?.name ?? file}</p>
                          <p className="text-[11px] text-muted-foreground truncate">.github/workflows/{file}</p>
                          {meta && meta.triggers.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {meta.triggers.map((t) => (
                                <span
                                  key={t}
                                  className={cn(
                                    'text-[10px] px-1.5 py-0 h-4 leading-4 rounded-md border font-normal inline-block',
                                    getTriggerClass(t)
                                  )}
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
              <div className="px-4 py-3 border-t border-border flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  className="h-8 text-[12px] px-4 gap-1.5"
                  disabled={importSelection.size === 0 || importing}
                  onClick={handleImport}
                >
                  {importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {t('workspace.pipelines.import_count_btn', { count: importSelection.size, defaultValue: `Import ${importSelection.size} workflow(s)` })}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-[12px] px-3"
                  onClick={() => setShowImport(false)}
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          )}

          {/* Normal content */}
          {!showImport && (
            <>
              {((sourceTab === 'orbit' && !selectedWorkflow) || (sourceTab === 'github' && !ghSelectedItem)) ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                  <FileText className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-[13px]">{t('workspace.pipelines.select_workflow_prompt', 'Select a workflow to view')}</p>
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {sourceTab === 'orbit' ? (
                        <FileCode2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <Github className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="min-w-0">
                        <h3 className="text-[13px] font-semibold truncate">
                          {sourceTab === 'orbit'
                            ? (selectedWorkflow?.name || selectedWorkflow?.file)
                            : (ghSelectedItem?.name || ghSelectedItem?.file)
                          }
                        </h3>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {sourceTab === 'orbit'
                            ? `.orbit/workflows/${selectedWorkflow?.file}`
                            : `.github/workflows/${ghSelectedItem?.file}`
                          }
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center rounded-md border border-border overflow-hidden">
                        <button
                          onClick={() => setActiveViewMode('visual')}
                          className={cn(
                            'px-2.5 py-1 text-[11px] font-medium transition-colors',
                            activeViewMode === 'visual'
                              ? 'bg-foreground text-background'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {t('workspace.pipelines.view_visual', 'Visual')}
                        </button>
                        <button
                          onClick={() => setActiveViewMode('yaml')}
                          className={cn(
                            'px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-border',
                            activeViewMode === 'yaml'
                              ? 'bg-foreground text-background'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {t('workspace.pipelines.view_yaml', 'YAML')}
                        </button>
                      </div>
                      {sourceTab === 'orbit' && selectedWorkflow && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[12px] px-2"
                            onClick={() => notify('info', t('workspace.pipelines.edit_info_msg', 'Edit in the Editor tab'))}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            {t('common.edit', 'Edit')}
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-[12px] px-3"
                            disabled={running === selectedWorkflow.file}
                            onClick={() => handleRun(selectedWorkflow.file)}
                          >
                            {running === selectedWorkflow.file ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                            ) : (
                              <Play className="h-3.5 w-3.5 mr-1.5" />
                            )}
                            {t('common.run', 'Run')}
                          </Button>
                        </>
                      )}
                      {sourceTab === 'github' && ghSelectedItem && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[12px] px-3 gap-1.5"
                          onClick={handleOpenImport}
                        >
                          <ArrowRight className="h-3 w-3" />
                          {t('workspace.pipelines.import_to_orbit_btn', 'Import to OrbitCI')}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Dispatch form */}
                  {sourceTab === 'orbit' && showDispatch && selectedWorkflow?.inputs && Object.keys(selectedWorkflow.inputs).length > 0 && (
                    <div className="border-b border-border px-4 py-3 shrink-0 bg-accent/30">
                      <p className="text-[12px] font-medium mb-2">Workflow Dispatch Inputs</p>
                      <div className="grid gap-2.5 max-w-lg">
                        {Object.entries(selectedWorkflow.inputs).map(([key, input]: [string, WorkflowInput]) => (
                          <div key={key}>
                            <Label className="text-[11px] text-muted-foreground mb-1 block">
                              {key}
                              {input.required && <span className="text-red-400 ml-0.5">*</span>}
                              {input.description && (
                                <span className="ml-1.5 font-normal opacity-70">{input.description}</span>
                              )}
                            </Label>
                            {input.type === 'boolean' ? (
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={dispatchInputs[key] === 'true'}
                                  onChange={(e) =>
                                    setDispatchInputs((prev) => ({
                                      ...prev,
                                      [key]: e.target.checked ? 'true' : 'false'
                                    }))
                                  }
                                  className="rounded border-border"
                                />
                                <span className="text-[12px]">{dispatchInputs[key] === 'true' ? 'true' : 'false'}</span>
                              </label>
                            ) : input.type === 'choice' && input.options ? (
                              <select
                                value={dispatchInputs[key] ?? ''}
                                onChange={(e) =>
                                  setDispatchInputs((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                                className="w-full h-7 rounded-md border border-border bg-background px-2 text-[12px]"
                              >
                                {input.options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <Input
                                value={dispatchInputs[key] ?? ''}
                                onChange={(e) =>
                                  setDispatchInputs((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                                placeholder={input.default ?? ''}
                                className="h-7 text-[12px]"
                                type={input.type === 'number' ? 'number' : 'text'}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button
                          size="sm"
                          className="h-7 text-[12px] px-3"
                          disabled={running === selectedWorkflow.file}
                          onClick={() => executeRun(selectedWorkflow.file, dispatchInputs)}
                        >
                          {running === selectedWorkflow.file ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          Run workflow
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[12px] px-2"
                          onClick={() => setShowDispatch(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Content area */}
                  <ScrollArea className="flex-1">
                    {isLoadingContent ? (
                      <div className="flex items-center justify-center py-12 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        <span className="text-[12px]">Loading...</span>
                      </div>
                    ) : activeViewMode === 'visual' && parsedWorkflow ? (
                      <div className="p-4 space-y-5">
                        {/* Workflow summary header */}
                        <div className="flex items-center gap-3 pb-4 border-b border-border">
                          <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                            <Workflow className="h-5 w-5 text-violet-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="text-[15px] font-semibold">{parsedWorkflow.name}</h4>
                              {sourceTab === 'github' && (
                                <Badge variant="outline" className="text-[10px] h-5 font-normal gap-1">
                                  <Github className="h-2.5 w-2.5" />
                                  GitHub
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                                <CheckCircle2 className="h-3 w-3" />
                                {parsedWorkflow.jobs.length} job{parsedWorkflow.jobs.length !== 1 ? 's' : ''}
                              </span>
                              <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                                <GitBranch className="h-3 w-3" />
                                {parsedWorkflow.jobs.reduce((sum, j) => sum + j.steps.length, 0)} steps
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Triggers */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-[12px] font-medium text-muted-foreground">Triggers</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {parsedWorkflow.triggers.map((t) => (
                              <span
                                key={t}
                                className={cn(
                                  'text-[11px] px-2.5 py-0.5 rounded-md border font-medium',
                                  getTriggerClass(t)
                                )}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Pipeline graph */}
                        {parsedWorkflow.jobs.length > 1 && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-2">
                              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-[12px] font-medium text-muted-foreground">Pipeline</span>
                            </div>
                            <div className="rounded-lg border border-border bg-card/50 p-4 overflow-x-auto">
                              <WorkflowGraph workflow={parsedWorkflow} />
                            </div>
                          </div>
                        )}

                        {/* Jobs - expandable cards */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-[12px] font-medium text-muted-foreground">Jobs</span>
                          </div>
                          <div className="space-y-2">
                            {parsedWorkflow.jobs.map((job, ji) => (
                              <JobCard
                                key={job.id}
                                job={job}
                                defaultExpanded={ji === 0}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      // YAML viewer
                      <div className="bg-background min-h-full">
                        <table className="w-full border-collapse">
                          <tbody>
                            {lines.map((line, i) => (
                              <tr key={i} className="hover:bg-accent/30">
                                <td className="px-3 py-0 text-right select-none text-[12px] text-muted-foreground/50 font-mono w-[1%] whitespace-nowrap align-top leading-5">
                                  {i + 1}
                                </td>
                                <td className="px-3 py-0 text-[12px] font-mono whitespace-pre leading-5">
                                  {line}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </ScrollArea>
                </>
              )}
            </>
          )}
        </div>
      </>
    </TooltipProvider>
  )
}
