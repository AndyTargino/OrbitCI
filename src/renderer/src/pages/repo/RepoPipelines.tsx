import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Play, FileCode, Loader2, Import, Plus, Github
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import { WorkflowDispatchDialog } from '@/components/WorkflowDispatchDialog'
import { notify } from '@/lib/notify'
import { useRepoDetail } from './RepoDetail'
import type { WorkflowFile } from '@shared/types'

export function RepoPipelines(): JSX.Element {
  const { t } = useTranslation()
  const { repoId } = useRepoDetail()
  const navigate = useNavigate()
  const { repos } = useRepoStore()
  const repo = repos.find((r) => r.id === repoId)

  const [workflows, setWorkflows] = useState<WorkflowFile[]>([])
  const [githubWorkflows, setGithubWorkflows] = useState<{ file: string; path: string }[]>([])
  const [importingFile, setImportingFile] = useState<string | null>(null)
  const [dispatchWorkflow, setDispatchWorkflow] = useState<WorkflowFile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const importedFileSet = new Set(workflows.map((w) => w.file))
  const allImported = githubWorkflows.length > 0 && githubWorkflows.every((w) => importedFileSet.has(w.file))
  const newCount = githubWorkflows.filter((w) => !importedFileSet.has(w.file)).length

  useEffect(() => {
    if (!repoId) return
    loadData()
  }, [repoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    setIsLoading(true)
    try {
      const wfs = await electron.workflows.list(repoId)
      setWorkflows(wfs)
    } catch { /* ignored */ } finally {
      setIsLoading(false)
    }

    if (repo?.localPath) {
      try {
        const ghWfs = await electron.repos.listGithubWorkflows(repo.localPath)
        setGithubWorkflows(ghWfs)
      } catch { /* no .github/workflows */ }
    }
  }

  const handleRunWorkflow = (wf: WorkflowFile) => {
    if (wf.triggers.includes('workflow_dispatch')) {
      setDispatchWorkflow(wf)
    } else {
      runWorkflow(wf.file, {})
    }
  }

  const runWorkflow = async (file: string, inputs: Record<string, string>) => {
    const { runId } = await electron.workflows.run(repoId, file, inputs)
    navigate(`/run/${runId}`)
  }

  const handleImport = async (file: string) => {
    if (!repo?.localPath) return
    setImportingFile(file)
    try {
      const result = await electron.repos.importGithubWorkflows(repo.localPath)
      const isAll = file === 'all'
      notify(
        'success',
        isAll ? t('workspace.pipelines.import_success_title', 'Workflows imported!') : t('workspace.pipelines.import_single_success_title', 'Workflow imported!'),
        isAll
          ? t('workspace.pipelines.import_success_desc_plural', { count: result.count, defaultValue: '{{count}} files copied to .orbit/workflows/' })
          : t('workspace.pipelines.import_success_desc_singular', { file, defaultValue: '{{file}} copied to .orbit/workflows/' })
      )
      const wfs = await electron.workflows.list(repoId)
      setWorkflows(wfs)
    } catch (err: unknown) {
      notify('failure', t('workspace.pipelines.import_error_title', 'Error importing'), err instanceof Error ? err.message : t('common.error', 'Error'))
    } finally {
      setImportingFile(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-[13px]">{t('common.loading', 'Loading...')}</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      {/* ── OrbitCI Workflows ─────────────────────────────────────────── */}
      <section>
        <div className="px-6 py-3 border-b border-border/50 bg-card/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode className="h-3.5 w-3.5 text-[#8b5cf6]" />
            <span className="text-[12px] font-semibold text-foreground">{t('workspace.sections.orbit_ci', 'OrbitCI')}</span>
            <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">{workflows.length}</span>
          </div>
          <Button
            size="sm"
            className="h-7 text-[12px] px-2.5 gap-1.5"
            onClick={() => navigate(`/editor/${encodeURIComponent(repoId)}`)}
          >
            <Plus className="h-3 w-3" />
            {t('workspace.pipelines.new_workflow_btn', 'New Workflow')}
          </Button>
        </div>

        {workflows.length === 0 ? (
          <EmptyState
            icon={FileCode}
            title={t('workspace.pipelines.no_workflows', 'No workflows')}
            description={t('workspace.pipelines.create_help', 'Create a YAML file in .orbit/workflows/ to start')}
            action={{
              label: t('workspace.pipelines.create_workflow_btn', 'Create workflow'),
              onClick: () => navigate(`/editor/${encodeURIComponent(repoId)}`)
            }}
          />
        ) : (
          <div className="divide-y divide-border">
            {workflows.map((wf) => (
              <div key={wf.file} className="gh-row group">
                <FileCode className="h-4 w-4 text-primary/70 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[13px]">{wf.name}</span>
                    {wf.triggers.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{wf.file}</p>
                </div>
                <div className="flex gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[12px] px-2.5"
                    onClick={() => navigate(`/editor/${encodeURIComponent(repoId)}/${wf.file}`)}
                  >
                    {t('common.edit', 'Edit')}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-[12px] px-2.5 gap-1.5"
                    onClick={() => handleRunWorkflow(wf)}
                  >
                    <Play className="h-3 w-3" />
                    {t('common.run', 'Run')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── GitHub Actions Workflows ──────────────────────────────────── */}
      {githubWorkflows.length > 0 && (
        <section className="border-t border-border">
          <div className="px-6 py-3 border-b border-border/50 bg-card/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Github className="h-3.5 w-3.5" />
              <span className="text-[12px] font-semibold text-foreground">{t('common.github_actions', 'GitHub Actions')}</span>
              <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">{githubWorkflows.length}</span>
              {newCount > 0 && (
                <span className="text-[10px] text-[#d29922] font-medium">
                  {t('workspace.pipelines.new_count', { count: newCount, defaultValue: `${newCount} new` })}
                </span>
              )}
              {allImported && (
                <span className="text-[10px] text-[#3fb950]">— {t('workspace.pipelines.all_synced_label', 'all synced')}</span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[12px] px-2.5 gap-1.5"
              onClick={() => handleImport('all')}
              disabled={importingFile !== null}
            >
              {importingFile === 'all' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Import className="h-3.5 w-3.5" />
              )}
              {allImported ? t('workspace.pipelines.reimport_all_btn', 'Reimport all') : t('workspace.pipelines.import_all_btn', 'Import all')}
            </Button>
          </div>

          <div className="divide-y divide-border">
            {githubWorkflows.map((wf) => {
              const isImported = importedFileSet.has(wf.file)
              return (
                <div key={wf.file} className="gh-row group">
                  <FileCode
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isImported ? 'text-[#3fb950]/70' : 'text-[#d29922]/70'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[13px]">{wf.file}</span>
                      {isImported ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-4 text-[#3fb950] border-[#3fb950]/30 bg-[#3fb950]/10"
                        >
                          {t('workspace.pipelines.synced_label', 'synced')}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-4 text-[#e3b341] border-[#e3b341]/30 bg-[#e3b341]/10"
                        >
                          {t('workspace.pipelines.not_imported_label', 'not imported')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                      {wf.path}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'flex gap-1.5 shrink-0 transition-opacity',
                      isImported ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
                    )}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[12px] px-2.5 gap-1.5"
                      onClick={() => handleImport(wf.file)}
                      disabled={importingFile !== null}
                    >
                      {importingFile === wf.file ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Import className="h-3.5 w-3.5" />
                      )}
                      {isImported ? t('common.reimport', 'Reimport') : t('common.import', 'Import')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

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
