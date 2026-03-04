import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Save, Play, ArrowLeft, FileCode, Plus, Loader2 } from 'lucide-react'
import { electron } from '@/lib/electron'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'

const WORKFLOW_TEMPLATE = `name: Meu Workflow

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Ambiente'
        required: false
        default: 'development'
        type: choice
        options: [development, staging, production]

env:
  NODE_ENV: production

jobs:
  build:
    name: Build
    steps:
      - name: Instalar dependências
        run: npm ci

      - name: Rodar testes
        run: npm test

      - name: Build
        run: npm run build

  deploy:
    name: Deploy
    needs: build
    steps:
      - name: Notificar
        OrbitCI: notify/desktop
        with:
          title: "✅ Deploy concluído!"
          body: "Ambiente: \${{ inputs.environment }}"
`

export function Editor(): JSX.Element {
  const { repoId, file } = useParams<{ repoId: string; file?: string }>()
  const navigate = useNavigate()
  const decodedId = decodeURIComponent(repoId ?? '')

  const [content, setContent] = useState(WORKFLOW_TEMPLATE)
  const [fileName, setFileName] = useState(file ?? 'workflow.yml')
  const [isNew, setIsNew] = useState(!file)
  const [isSaving, setIsSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    if (file) {
      loadWorkflow()
    }
  }, [file, repoId])

  const loadWorkflow = async () => {
    try {
      const content = await electron.workflows.get(decodedId, file!)
      setContent(content)
      setFileName(file!)
      setIsNew(false)
    } catch (err) {
      notify('failure', 'Erro', 'Não foi possível carregar o workflow')
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const name = fileName.endsWith('.yml') || fileName.endsWith('.yaml') ? fileName : `${fileName}.yml`
      if (isNew) {
        await electron.workflows.create(decodedId, name, content)
      } else {
        await electron.workflows.save(decodedId, name, content)
      }
      notify('success', 'Workflow salvo!', name)
      navigate(`/dashboard/${repoId}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar'
      notify('failure', 'Erro ao salvar', msg)
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveAndRun = async () => {
    setIsRunning(true)
    try {
      await handleSave()
      const name = fileName.endsWith('.yml') || fileName.endsWith('.yaml') ? fileName : `${fileName}.yml`
      const runId = await electron.workflows.run(decodedId, name)
      navigate(`/run/${runId}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro', msg)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <FileCode className="h-5 w-5 text-primary flex-shrink-0" />
            {isNew ? (
              <div className="flex items-center gap-2 min-w-0">
                <Label htmlFor="filename" className="text-sm text-muted-foreground whitespace-nowrap">
                  Nome do arquivo:
                </Label>
                <Input
                  id="filename"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="h-7 w-48"
                  placeholder="workflow.yml"
                />
              </div>
            ) : (
              <span className="font-mono text-sm font-medium truncate">{fileName}</span>
            )}
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={handleSave} disabled={isSaving || isRunning}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </Button>
            <Button size="sm" onClick={handleSaveAndRun} disabled={isSaving || isRunning}>
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Salvar e Executar
            </Button>
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="flex flex-1 overflow-hidden">
        {/* Code editor */}
        <div className="flex-1 overflow-hidden">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-full w-full resize-none bg-[#060610] p-4 font-mono text-sm text-slate-200 focus:outline-none leading-relaxed"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {/* Quick reference */}
        <div className="w-64 border-l border-border overflow-auto p-4 flex-shrink-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Referência Rápida
          </h3>

          <div className="space-y-4 text-xs">
            <div>
              <p className="font-medium mb-1.5">Triggers</p>
              <div className="space-y-1 text-muted-foreground">
                {['push', 'pull_request', 'workflow_dispatch', 'schedule'].map((t) => (
                  <div key={t}><code className="text-foreground/70">{t}</code></div>
                ))}
              </div>
            </div>

            <div>
              <p className="font-medium mb-1.5">Actions OrbitCI</p>
              <div className="space-y-1 text-muted-foreground">
                {[
                  'git/commit', 'git/push', 'git/tag', 'git/release',
                  'github/create-release', 'github/upload-asset',
                  'version/bump', 'changelog/generate',
                  'file/write', 'file/template',
                  'notify/desktop', 'http/request', 'npm/run'
                ].map((a) => (
                  <div key={a}><code className="text-cyan-400">{a}</code></div>
                ))}
              </div>
            </div>

            <div>
              <p className="font-medium mb-1.5">Contextos</p>
              <div className="space-y-1 text-muted-foreground font-mono">
                {[
                  '${{ github.sha }}',
                  '${{ github.ref_name }}',
                  '${{ github.repository }}',
                  '${{ inputs.meu-input }}',
                  '${{ env.MINHA_VAR }}',
                  '${{ secrets.API_KEY }}',
                  '${{ OrbitCI.run_id }}'
                ].map((c) => (
                  <div key={c} className="text-foreground/60 text-[10px]">{c}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
