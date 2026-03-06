import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Settings as SettingsIcon, LogOut, Container, Bell, RefreshCw, Save, Loader2, Github,
  Download, ArrowDownToLine, Terminal, CheckCircle2, XCircle, Shield,
  Plus, Trash2, Edit, Eye, EyeOff, X, AlertTriangle, FileCode, ArrowLeft, Languages
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useAuthStore, useSettingsStore, useDockerStore, useRepoStore } from '@/store'
import { IPC_CHANNELS } from '@shared/constants'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { notify } from '@/lib/notify'
import { formatDate } from '@/lib/utils'
import type { Secret, GitHubUser, DockerStatus } from '@shared/types'

export function Settings(): JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { user, setUser } = useAuthStore()
  const { settings, setSettings } = useSettingsStore()
  const { status: dockerStatus, setStatus, installing: isInstallingDocker, setInstalling, installLogs, addInstallLog, clearInstallLogs } = useDockerStore()
  const [isSaving, setIsSaving] = useState(false)
  const [isCheckingDocker, setIsCheckingDocker] = useState(false)
  const installLogRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<'general' | 'secrets'>('general')
  const [form, setForm] = useState({
    githubClientId: '',
    githubClientSecret: '',
    defaultPollInterval: 60,
    maxConcurrentRuns: 1,
    jobTimeoutMinutes: 60,
    dockerEnabled: false,
    defaultDockerImage: 'ubuntu:22.04',
    notifications: true,
    autoUpdate: false,
    language: 'en'
  })

  useEffect(() => {
    if (settings) {
      setForm({
        githubClientId: settings.githubClientId ?? '',
        githubClientSecret: settings.githubClientSecret ?? '',
        defaultPollInterval: settings.defaultPollInterval,
        maxConcurrentRuns: settings.maxConcurrentRuns,
        jobTimeoutMinutes: settings.jobTimeoutMinutes,
        dockerEnabled: settings.dockerEnabled,
        defaultDockerImage: settings.defaultDockerImage,
        notifications: settings.notifications,
        autoUpdate: settings.autoUpdate,
        language: settings.language ?? (i18n.language.startsWith('pt') ? 'pt' : 'en')
      })
    }
  }, [settings, i18n.language])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await electron.settings.update(form)
      const updated = await electron.settings.get()
      setSettings(updated)
      
      if (form.language !== i18n.language) {
        await i18n.changeLanguage(form.language)
      }
      
      notify('success', t('common.success', 'Success'), t('settings.notifications.saved', 'Settings saved!'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.error', 'Error')
      notify('failure', t('settings.notifications.save_error', 'Save error'), msg)
    } finally {
      setIsSaving(false)
    }
  }

  const handleLogout = async () => {
    await electron.auth.logout()
    setUser(null)
    navigate('/login')
  }

  const handleCheckDocker = async () => {
    setIsCheckingDocker(true)
    try {
      const status = await electron.docker.status()
      setStatus(status)
    } finally {
      setIsCheckingDocker(false)
    }
  }

  const handleInstallDocker = async () => {
    if (isInstallingDocker) return
    setInstalling(true)
    clearInstallLogs()

    // Subscribe to install progress events
    const unsub = electron.on(IPC_CHANNELS.EVENT_DOCKER_INSTALL, (data: unknown) => {
      const { message, type } = data as { message: string; type: string }
      addInstallLog({ message, type })
      // Auto-scroll
      setTimeout(() => {
        installLogRef.current?.scrollTo({ top: installLogRef.current.scrollHeight })
      }, 50)
    })

    try {
      const result = await electron.docker.install()
      if (result.status === 'success') {
        const status = await electron.docker.status()
        setStatus(status)
        if (!status.available) {
          addInstallLog({ message: 'Docker instalado, mas pode ser necessário reiniciar o computador ou iniciar o Docker Desktop.', type: 'error' })
        }
      } else if (result.status === 'opened_browser') {
        addInstallLog({ message: 'Instalador aberto no navegador. Após instalar, clique em "Verificar".', type: 'step' })
      }
    } catch {
      addInstallLog({ message: 'Erro inesperado durante a instalação.', type: 'error' })
    } finally {
      unsub()
      setInstalling(false)
    }
  }

  // Auto-scroll when logs update from another source (e.g. sidebar triggered install)
  useEffect(() => {
    if (installLogs.length > 0) {
      setTimeout(() => {
        installLogRef.current?.scrollTo({ top: installLogRef.current.scrollHeight })
      }, 50)
    }
  }, [installLogs.length])

  return (
    <div className="h-full flex flex-col">
      {/* Header + tabs */}
      <div className="border-b border-border px-6 pt-4 pb-0 shrink-0">
        <div className="mb-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">Settings</h1>
            <p className="text-[12px] text-muted-foreground">Manage OrbitCI preferences</p>
          </div>
        </div>
        <div className="flex items-end gap-0">
          {([
            { key: 'general' as const, label: 'Geral', icon: SettingsIcon },
            { key: 'secrets' as const, label: 'Secrets', icon: Shield }
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-[13px] border-b-2 transition-colors',
                activeTab === key
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'general' ? (
          <GeneralSettings
            user={user}
            form={form}
            setForm={setForm}
            isSaving={isSaving}
            handleSave={handleSave}
            handleLogout={handleLogout}
            dockerStatus={dockerStatus}
            isCheckingDocker={isCheckingDocker}
            handleCheckDocker={handleCheckDocker}
            isInstallingDocker={isInstallingDocker}
            handleInstallDocker={handleInstallDocker}
            installLogs={installLogs}
            installLogRef={installLogRef}
            navigate={navigate}
          />
        ) : (
          <SecretsTab />
        )}
      </div>
    </div>
  )
}

// ── Secrets Tab ──────────────────────────────────────────────────────────────

interface DetectedSecret {
  name: string
  usedIn: string[]
}

interface SecretForm {
  key: string
  value: string
}

function SecretsTab(): JSX.Element {
  const { t } = useTranslation()
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
    if (scope === 'global') {
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
            } catch { /* skip */ }
          })
        )
        setDetectedSecrets(
          Array.from(merged.entries())
            .map(([name, usedIn]) => ({ name, usedIn }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      } finally { setIsScanning(false) }
    } else {
      const repo = repos.find((r) => r.id === scope)
      if (!repo?.localPath) { setDetectedSecrets([]); return }
      setIsScanning(true)
      try {
        const found = await electron.workflows.scanSecrets(scope)
        setDetectedSecrets(found)
      } catch { setDetectedSecrets([]) }
      finally { setIsScanning(false) }
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
      notify('success', t('settings.secrets.notifications.saved', 'Secret saved!'), form.key)
      setForm({ key: '', value: '' })
      setShowAddForm(false)
      setEditingKey(null)
      await loadSecrets()
    } catch (err: unknown) {
      notify('failure', t('settings.secrets.notifications.save_error', 'Error saving secret'), err instanceof Error ? err.message : t('common.error'))
    } finally { setIsSaving(false) }
  }

  const handleDelete = async (key: string) => {
    try {
      await electron.secrets.delete(scope, key)
      notify('success', t('settings.secrets.notifications.removed', 'Secret removed'), key)
      await loadSecrets()
    } catch (err: unknown) {
      notify('failure', t('settings.secrets.notifications.remove_error', 'Error removing secret'), err instanceof Error ? err.message : t('common.error'))
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
  const missingSecrets = detectedSecrets.filter((d) => !configuredKeys.has(d.name))
  const syncedSecrets = detectedSecrets.filter((d) => configuredKeys.has(d.name))

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Scope selector */}
      <div className="flex items-center gap-3">
        <Label>{t('settings.secrets.scope_label', 'Scope:')}</Label>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">{t('settings.secrets.scope_global', 'Global (all repos)')}</SelectItem>
            {repos.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary">{secrets.length} {t('settings.secrets.configured_count', { count: secrets.length, defaultValue: 'configured' })}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 ml-auto"
          onClick={() => { loadSecrets(); scanWorkflowSecrets() }}
          title={t('common.refresh', 'Refresh')}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', (isLoading || isScanning) && 'animate-spin')} />
        </Button>
      </div>

      {/* Detected in workflows */}
      {isScanning ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('settings.secrets.scanning', 'Scanning workflow files...')}
        </div>
      ) : detectedSecrets.length > 0 && (
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-[13px] font-semibold flex items-center gap-2">
              <FileCode className="h-4 w-4 text-primary" />
              {t('settings.secrets.detected_title', 'Detected in workflows')}
              <Badge variant="secondary" className="text-[10px]">{detectedSecrets.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1.5">
            {missingSecrets.length > 0 && (
              <>
                <p className="text-[11px] font-medium text-[#facc15] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {t('settings.secrets.missing_label', 'Missing — not configured')}
                </p>
                {missingSecrets.map((d) => (
                  <div key={d.name} className="flex items-center gap-3 rounded-md border border-[#facc15]/20 bg-[#facc15]/5 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <code className="text-[13px] font-mono font-medium text-[#facc15]">{d.name}</code>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{d.usedIn.join(', ')}</p>
                    </div>
                    <Button size="sm" className="h-7 text-[12px] px-2.5 shrink-0" onClick={() => handleQuickAdd(d.name)}>
                      <Plus className="h-3.5 w-3.5" />
                      {t('common.configure', 'Configure')}
                    </Button>
                  </div>
                ))}
              </>
            )}
            {syncedSecrets.length > 0 && (
              <>
                {missingSecrets.length > 0 && <Separator className="my-3" />}
                <p className="text-[11px] font-medium text-[#4ade80] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('settings.secrets.configured_label', 'Configured')}
                </p>
                {syncedSecrets.map((d) => (
                  <div key={d.name} className="flex items-center gap-3 rounded-md border border-[#4ade80]/20 bg-[#4ade80]/5 px-3 py-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#4ade80] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <code className="text-[13px] font-mono font-medium">{d.name}</code>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{d.usedIn.join(', ')}</p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add / edit form */}
      {showAddForm ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{editingKey ? t('settings.secrets.form.update_title', { key: editingKey }) : t('settings.secrets.form.new_title', 'New Secret')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('settings.secrets.form.name_label', 'Name')}</Label>
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
              <Label>{t('settings.secrets.form.value_label', 'Value')}</Label>
              <div className="relative">
                <Input
                  type={showValue ? 'text' : 'password'}
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder={editingKey ? t('settings.secrets.form.value_placeholder_update', 'New value') : t('settings.secrets.form.value_placeholder_new', 'Secret value')}
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
                {editingKey ? t('common.update', 'Update') : t('common.save', 'Save')}
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                <X className="h-4 w-4" />
                {t('common.cancel', 'Cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4" />
          {t('settings.secrets.add_btn', 'Add Secret')}
        </Button>
      )}

      {/* Configured secrets list */}
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {t('settings.secrets.list_title', 'Configured secrets')}
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : secrets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border rounded-lg">
            <Shield className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="font-semibold">{t('settings.secrets.empty_title', 'No secrets configured')}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t('settings.secrets.empty_desc', 'Use {{prefix}} in workflows', { prefix: '${{ secrets.NOME }}' })}
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
                        <Badge variant="outline" className="text-[10px] px-1.5 h-4 text-[#4ade80] border-[#4ade80]/30 bg-[#4ade80]/10">
                          {t('settings.secrets.in_use', 'in use')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('settings.secrets.updated_at', { date: formatDate(secret.updatedAt), defaultValue: `Updated on ${formatDate(secret.updatedAt)}` })}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(secret)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(secret.key)}>
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

// ── General Settings Tab ─────────────────────────────────────────────────────

function GeneralSettings({
  user, form, setForm, isSaving, handleSave, handleLogout,
  dockerStatus, isCheckingDocker, handleCheckDocker,
  isInstallingDocker, handleInstallDocker, installLogs, installLogRef, navigate
}: {
  user: GitHubUser | null
  form: any
  setForm: any
  isSaving: boolean
  handleSave: () => void
  handleLogout: () => void
  dockerStatus: DockerStatus | null
  isCheckingDocker: boolean
  handleCheckDocker: () => void
  isInstallingDocker: boolean
  handleInstallDocker: () => void
  installLogs: { message: string; type: string }[]
  installLogRef: React.RefObject<HTMLDivElement>
  navigate: ReturnType<typeof useNavigate>
}): JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Languages className="h-4 w-4" />
            {t('settings.language.label', 'Language')}
          </CardTitle>
          <CardDescription>
            {t('settings.language.description', 'Choose the interface language')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={form.language}
            onValueChange={(val) => {
              setForm((f) => ({ ...f, language: val }))
              i18n.changeLanguage(val)
              electron.settings.update({ language: val })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-5 rounded-[2px] shrink-0 overflow-hidden" viewBox="0 0 640 480" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#bd3d44" d="M0 0h640v480H0"/>
                    <path stroke="#fff" strokeWidth="37" d="M0 55.3h640M0 129h640M0 203h640M0 277h640M0 351h640M0 425h640"/>
                    <path fill="#192f5d" d="M0 0h364.8v258.5H0"/>
                  </svg>
                  {t('settings.language.en')}
                </span>
              </SelectItem>
              <SelectItem value="pt">
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-5 rounded-[2px] shrink-0 overflow-hidden" viewBox="0 0 640 480" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#229e45" d="M0 0h640v480H0z"/>
                    <path fill="#f8e509" d="m321.4 436 301.5-195.7L319.6 44 17.1 240.7z"/>
                    <path fill="#2b49a3" d="M452.8 240c0 70.3-57.1 127.3-127.6 127.3A127.4 127.4 0 1 1 452.8 240"/>
                    <path fill="#ffffef" d="M444.4 285.8a125 125 0 0 0 5.8-19.8c-67.8-59.5-143.3-90-238.7-83.7a125 125 0 0 0-8.5 20.9c113-10.8 196 39.2 241.4 82.6"/>
                  </svg>
                  {t('settings.language.pt')}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* GitHub Account */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.account.title', 'GitHub Account')}</CardTitle>
          <CardDescription>{t('settings.account.description', 'Connected account information')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src={user.avatarUrl} alt={user.login} className="h-10 w-10 rounded-full" />
                <div>
                  <p className="font-medium">{user.name ?? user.login}</p>
                  <p className="text-sm text-muted-foreground">@{user.login}</p>
                </div>
                <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 bg-emerald-400/10">{t('common.connected', 'Connected')}</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                {t('common.sign_out', 'Sign out')}
              </Button>
            </div>
          ) : (
            <Button onClick={() => navigate('/login')}>{t('settings.account.connect', 'Connect to GitHub')}</Button>
          )}
        </CardContent>
      </Card>

      {/* GitHub OAuth */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Github className="h-4 w-4" />
            {t('settings.oauth.title', 'OAuth App (Login with GitHub)')}
          </CardTitle>
          <CardDescription>
            {t('settings.oauth.description', 'Configure Client ID for OAuth Device Flow login')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="githubClientId">{t('settings.oauth.client_id', 'Client ID')}</Label>
            <Input
              id="githubClientId"
              placeholder="Ov23liXXXXXXXXXXXXXX"
              value={form.githubClientId}
              onChange={(e) => setForm((f) => ({ ...f, githubClientId: e.target.value }))}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="githubClientSecret">{t('settings.oauth.client_secret', 'Client Secret')}</Label>
            <Input
              id="githubClientSecret"
              type="password"
              placeholder="••••••••••••••••••••••••••••••••••••••••"
              value={form.githubClientSecret}
              onChange={(e) => setForm((f) => ({ ...f, githubClientSecret: e.target.value }))}
              className="font-mono"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('settings.oauth.help', 'Create at')} {' '}
            <a
              href="https://github.com/settings/developers"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              GitHub → Settings → Developer settings → OAuth Apps
            </a>
            {' '}— {t('settings.oauth.callback_help', 'use orbitci://callback as Callback URL')}
          </p>
        </CardContent>
      </Card>

      {/* Sync Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.sync.title', 'Synchronization')}</CardTitle>
          <CardDescription>{t('settings.sync.description', 'Configure polling and auto-execution')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('settings.sync.poll_interval', 'Polling interval (seconds)')}</Label>
              <Input
                type="number"
                min={30}
                value={form.defaultPollInterval}
                onChange={(e) => setForm((f) => ({ ...f, defaultPollInterval: parseInt(e.target.value) || 60 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.sync.timeout', 'Job timeout (minutes)')}</Label>
              <Input
                type="number"
                min={1}
                value={form.jobTimeoutMinutes}
                onChange={(e) => setForm((f) => ({ ...f, jobTimeoutMinutes: parseInt(e.target.value) || 60 }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('settings.sync.concurrent_runs', 'Simultaneous runs per repository')}</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={form.maxConcurrentRuns}
              onChange={(e) => setForm((f) => ({ ...f, maxConcurrentRuns: parseInt(e.target.value) || 1 }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Docker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Container className="h-4 w-4" />
            {t('settings.docker.title', 'Docker')}
            {dockerStatus?.available ? (
              <Badge variant="outline" className="text-[#4ade80] border-[#4ade80]/30 bg-[#4ade80]/10">
                v{dockerStatus.version}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[#f87171] border-[#f87171]/30 bg-[#f87171]/10">
                {t('settings.docker.unavailable', 'Unavailable')}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {t('settings.docker.description', 'Configure Docker integration to run workflows in isolated containers')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Not available — install prompt */}
          {!dockerStatus?.available && (
            <div className="space-y-3">
              <div className="rounded-md border border-[#facc15]/30 bg-[#facc15]/5 p-3 space-y-2">
                <p className="text-[13px] font-medium text-[#facc15]">{t('settings.docker.not_found', 'Docker not found')}</p>
                <p className="text-[12px] text-muted-foreground">
                  {t('settings.docker.install_help', 'Docker is required to run containers. Installation is automatic — just click the button below.')}
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" className="h-7 text-[12px]" onClick={handleInstallDocker} disabled={isInstallingDocker}>
                    {isInstallingDocker
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.installing', 'Installing...')}</>
                      : <><Download className="h-3.5 w-3.5" /> {t('settings.docker.install_btn', 'Install Docker')}</>
                    }
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={handleCheckDocker} disabled={isCheckingDocker}>
                    {isCheckingDocker ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {t('common.verify', 'Verify')}
                  </Button>
                </div>
              </div>

              {/* Live install terminal */}
              {installLogs.length > 0 && (
                <div className="rounded-md border border-border bg-[#0d1117] overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-[#161b22]">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-medium text-muted-foreground">{t('settings.docker.install_logs', 'Docker Installation')}</span>
                    {isInstallingDocker && <Loader2 className="h-3 w-3 animate-spin text-[#60a5fa] ml-auto" />}
                    {!isInstallingDocker && installLogs.some((l) => l.type === 'success') && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#4ade80] ml-auto" />
                    )}
                  </div>
                  <div
                    ref={installLogRef}
                    className="p-3 max-h-[280px] overflow-y-auto font-mono text-[11px] leading-[1.6] space-y-0.5 scrollbar-thin"
                  >
                    {installLogs.map((log, i) => (
                      <div
                        key={i}
                        className={cn(
                          log.type === 'step' && 'text-[#60a5fa] font-semibold mt-1',
                          log.type === 'success' && 'text-[#4ade80] font-semibold mt-1',
                          log.type === 'error' && 'text-[#f87171]',
                          log.type === 'output' && 'text-[#8b949e]'
                        )}
                      >
                        {log.type === 'success' && '✓ '}
                        {log.type === 'error' && '✗ '}
                        {log.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t('settings.docker.enable_label', 'Enable Docker')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.docker.enable_desc', 'Allows using containers in workflows')}</p>
            </div>
            <Switch
              checked={form.dockerEnabled}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, dockerEnabled: checked }))}
              disabled={!dockerStatus?.available}
            />
          </div>

          {form.dockerEnabled && dockerStatus?.available && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>{t('settings.docker.default_image', 'Default image')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('settings.docker.image_help', 'Select an image or type manually')}
                </p>
                <Input
                  value={form.defaultDockerImage}
                  onChange={(e) => setForm((f) => ({ ...f, defaultDockerImage: e.target.value }))}
                  placeholder="ex: ubuntu:22.04"
                  className="font-mono text-[13px]"
                />
              </div>
            </>
          )}

          {/* Verify button (when docker is available) */}
          {dockerStatus?.available && (
            <Button variant="outline" size="sm" onClick={handleCheckDocker} disabled={isCheckingDocker}>
              {isCheckingDocker ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('settings.docker.verify_btn', 'Verify Docker')}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" />
            {t('settings.notifications.title', 'Notifications')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t('settings.notifications.enable_label', 'Desktop notifications')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.notifications.enable_desc', 'Alerts when runs finish')}</p>
            </div>
            <Switch
              checked={form.notifications}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, notifications: checked }))}
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">{t('settings.notifications.test_label', 'Test notifications')}</p>
            <p className="text-xs text-muted-foreground">
              {t('settings.notifications.test_desc', 'Click each type to see how notifications appear')}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(
                [
                  { type: 'success',  label: t('common.success'),    title: t('settings.notifications.test.success.title'),    body: t('settings.notifications.test.success.body'),              duration: 6000 },
                  { type: 'failure',  label: t('common.failure'),    title: t('settings.notifications.test.failure.title'),       body: t('settings.notifications.test.failure.body'), duration: 0    },
                  { type: 'running',  label: t('common.running'), title: t('settings.notifications.test.running.title'),     body: t('settings.notifications.test.running.body'),            duration: 3000 },
                  { type: 'warning',  label: t('common.warning'),    title: t('settings.notifications.test.warning.title'),    body: t('settings.notifications.test.warning.body'),     duration: 6000 },
                  { type: 'info',     label: t('common.info'),       title: t('settings.notifications.test.info.title'), body: t('settings.notifications.test.info.body'), duration: 4000 },
                ] as const
              ).map(({ type, label, title, body, duration }) => (
                <button
                  key={type}
                  onClick={() => electron.notify.test({ type, title, body, duration })}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] font-medium transition-colors text-left',
                    type === 'success' && 'border-[#4ade80]/30 text-[#4ade80] hover:bg-[#4ade80]/5',
                    type === 'failure' && 'border-[#f87171]/30 text-[#f87171] hover:bg-[#f87171]/5',
                    type === 'running' && 'border-[#60a5fa]/30 text-[#60a5fa] hover:bg-[#60a5fa]/5',
                    type === 'warning' && 'border-[#facc15]/30 text-[#facc15] hover:bg-[#facc15]/5',
                    type === 'info'    && 'border-border text-muted-foreground hover:bg-muted/30'
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0',
                    type === 'success' && 'bg-[#4ade80]',
                    type === 'failure' && 'bg-[#f87171]',
                    type === 'running' && 'bg-[#60a5fa]',
                    type === 'warning' && 'bg-[#facc15]',
                    type === 'info'    && 'bg-muted-foreground'
                  )} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Auto-update */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowDownToLine className="h-4 w-4" />
            {t('settings.updates.title', 'Updates')}
          </CardTitle>
          <CardDescription>{t('settings.updates.description', 'Configure OrbitCI auto-update behavior')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t('settings.updates.auto_label', 'Auto update')}</p>
              <p className="text-xs text-muted-foreground">
                {t('settings.updates.auto_desc', 'Automatically check and install updates on startup')}
              </p>
            </div>
            <Switch
              checked={form.autoUpdate}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, autoUpdate: checked }))}
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={isSaving}>
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t('settings.save_btn', 'Save Settings')}
      </Button>
    </div>
  )
}

