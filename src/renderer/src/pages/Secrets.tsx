import { useEffect, useState, useCallback } from 'react'
import {
  Shield, Plus, Trash2, Edit, Eye, EyeOff, Loader2, Save, X,
  AlertTriangle, CheckCircle2, FileCode, RefreshCw
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { notify } from '@/lib/notify'
import { cn, formatDate } from '@/lib/utils'
import type { Secret } from '@shared/types'

interface DetectedSecret {
  name: string
  usedIn: string[]
}

interface SecretForm {
  key: string
  value: string
}

export function Secrets(): JSX.Element {
  const { repos } = useRepoStore()
  const [scope, setScope] = useState('global')
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [detectedSecrets, setDetectedSecrets] = useState<DetectedSecret[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [form, setForm] = useState<SecretForm>({ key: '', value: '' })
  const [showValue, setShowValue] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const loadSecrets = useCallback(async () => {
    setIsLoading(true)
    try {
      const list = await electron.secrets.list(scope)
      setSecrets(list)
    } finally {
      setIsLoading(false)
    }
  }, [scope])

  const scanWorkflowSecrets = useCallback(async () => {
    // Only scan when a specific repo is selected and it has a local path
    if (scope === 'global') {
      // Scan all repos with local paths and merge results
      const reposWithPath = repos.filter((r) => r.localPath)
      if (reposWithPath.length === 0) { setDetectedSecrets([]); return }

      setIsScanning(true)
      try {
        const merged = new Map<string, string[]>()
        await Promise.all(
          reposWithPath.map(async (r) => {
            try {
              const found = await electron.workflows.scanSecrets(r.id)
              for (const { name, usedIn } of found) {
                const existing = merged.get(name) ?? []
                merged.set(name, [...existing, ...usedIn.map((f) => `${r.name}: ${f}`)])
              }
            } catch { /* skip repos that fail */ }
          })
        )
        setDetectedSecrets(
          Array.from(merged.entries())
            .map(([name, usedIn]) => ({ name, usedIn }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      } finally {
        setIsScanning(false)
      }
    } else {
      const repo = repos.find((r) => r.id === scope)
      if (!repo?.localPath) { setDetectedSecrets([]); return }

      setIsScanning(true)
      try {
        const found = await electron.workflows.scanSecrets(scope)
        setDetectedSecrets(found)
      } catch {
        setDetectedSecrets([])
      } finally {
        setIsScanning(false)
      }
    }
  }, [scope, repos])

  useEffect(() => {
    loadSecrets()
    scanWorkflowSecrets()
  }, [scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!form.key.trim() || !form.value.trim()) return
    setIsSaving(true)
    try {
      await electron.secrets.set(scope, form.key.trim(), form.value.trim())
      notify('success', 'Secret salvo!', form.key)
      setForm({ key: '', value: '' })
      setShowAddForm(false)
      setEditingKey(null)
      await loadSecrets()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar'
      notify('failure', 'Erro ao salvar secret', msg)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (key: string) => {
    try {
      await electron.secrets.delete(scope, key)
      notify('success', 'Secret removido', key)
      await loadSecrets()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao remover secret', msg)
    }
  }

  const handleEdit = (secret: Secret) => {
    setEditingKey(secret.key)
    setForm({ key: secret.key, value: '' })
    setShowAddForm(true)
  }

  const handleCancel = () => {
    setShowAddForm(false)
    setEditingKey(null)
    setForm({ key: '', value: '' })
    setShowValue(false)
  }

  const handleQuickAdd = (name: string) => {
    setForm({ key: name, value: '' })
    setShowAddForm(true)
    setEditingKey(null)
  }

  const configuredKeys = new Set(secrets.map((s) => s.key))

  // Separate detected into: missing (not configured) and configured
  const missingSecrets = detectedSecrets.filter((d) => !configuredKeys.has(d.name))
  const syncedSecrets = detectedSecrets.filter((d) => configuredKeys.has(d.name))

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          Secrets
        </h1>
        <p className="text-muted-foreground text-sm">Variáveis de ambiente criptografadas para seus workflows</p>
      </div>

      {/* Scope selector */}
      <div className="flex items-center gap-3">
        <Label>Escopo:</Label>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Global (todos os repos)</SelectItem>
            {repos.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary">{secrets.length} configurado{secrets.length !== 1 ? 's' : ''}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 ml-auto"
          onClick={() => { loadSecrets(); scanWorkflowSecrets() }}
          title="Atualizar"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', (isLoading || isScanning) && 'animate-spin')} />
        </Button>
      </div>

      {/* ── Detected in workflows ─────────────────────────────────────────── */}
      {isScanning ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Escaneando arquivos de workflow...
        </div>
      ) : detectedSecrets.length > 0 && (
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-[13px] font-semibold flex items-center gap-2">
              <FileCode className="h-4 w-4 text-primary" />
              Detectados nos workflows
              <Badge variant="secondary" className="text-[10px]">
                {detectedSecrets.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1.5">
            {/* Missing secrets (not yet configured) */}
            {missingSecrets.length > 0 && (
              <>
                <p className="text-[11px] font-medium text-[#d29922] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Ausentes — não configurados
                </p>
                {missingSecrets.map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center gap-3 rounded-md border border-[#d29922]/20 bg-[#d29922]/5 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <code className="text-[13px] font-mono font-medium text-[#d29922]">{d.name}</code>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {d.usedIn.join(', ')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-[12px] px-2.5 shrink-0"
                      onClick={() => handleQuickAdd(d.name)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Configurar
                    </Button>
                  </div>
                ))}
              </>
            )}

            {/* Configured secrets */}
            {syncedSecrets.length > 0 && (
              <>
                {missingSecrets.length > 0 && <Separator className="my-3" />}
                <p className="text-[11px] font-medium text-[#3fb950] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Configurados
                </p>
                {syncedSecrets.map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center gap-3 rounded-md border border-[#3fb950]/20 bg-[#3fb950]/5 px-3 py-2"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#3fb950] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <code className="text-[13px] font-mono font-medium">{d.name}</code>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {d.usedIn.join(', ')}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Add / edit form ───────────────────────────────────────────────── */}
      {showAddForm ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {editingKey ? `Atualizar: ${editingKey}` : 'Novo Secret'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={form.key}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase().replace(/\s/g, '_') }))}
                placeholder="MINHA_VARIAVEL"
                disabled={!!editingKey}
                className="font-mono"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <div className="relative">
                <Input
                  type={showValue ? 'text' : 'password'}
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder={editingKey ? 'Novo valor (deixe vazio para manter)' : 'Valor do secret'}
                  className="font-mono pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowValue((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={isSaving || !form.key.trim()}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editingKey ? 'Atualizar' : 'Salvar'}
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                <X className="h-4 w-4" />
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4" />
          Adicionar Secret
        </Button>
      )}

      {/* ── Configured secrets list ───────────────────────────────────────── */}
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Secrets configurados
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : secrets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border rounded-lg">
            <Shield className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="font-semibold">Nenhum secret configurado</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Use <code className="text-primary">${'{{ secrets.NOME }}'}</code> nos workflows para referenciar secrets
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            {secrets.map((secret, idx) => (
              <div key={secret.key}>
                {idx > 0 && <Separator />}
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="font-mono font-medium text-[13px]">{secret.key}</code>
                      {syncedSecrets.some((d) => d.name === secret.key) && (
                        <Badge variant="outline" className="text-[10px] px-1.5 h-4 text-[#3fb950] border-[#3fb950]/30 bg-[#3fb950]/10">
                          em uso
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Atualizado em {formatDate(secret.updatedAt)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(secret)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(secret.key)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
