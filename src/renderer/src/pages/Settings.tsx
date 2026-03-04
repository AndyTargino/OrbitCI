import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings as SettingsIcon, LogOut, Container, Bell, RefreshCw, Save, Loader2, Github, Download, ArrowDownToLine } from 'lucide-react'
import { electron } from '@/lib/electron'
import { useAuthStore, useSettingsStore, useDockerStore, useUpdaterStore } from '@/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { notify } from '@/lib/notify'

export function Settings(): JSX.Element {
  const navigate = useNavigate()
  const { user, setUser } = useAuthStore()
  const { settings, setSettings } = useSettingsStore()
  const { status: dockerStatus, setStatus } = useDockerStore()
  const [isSaving, setIsSaving] = useState(false)
  const [isCheckingDocker, setIsCheckingDocker] = useState(false)
  const [isInstallingDocker, setIsInstallingDocker] = useState(false)
  const [imageMenuOpen, setImageMenuOpen] = useState(false)
  const [form, setForm] = useState({
    githubClientId: '',
    githubClientSecret: '',
    defaultPollInterval: 60,
    maxConcurrentRuns: 1,
    jobTimeoutMinutes: 60,
    dockerEnabled: false,
    defaultDockerImage: 'ubuntu:22.04',
    notifications: true,
    autoUpdate: false
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
        autoUpdate: settings.autoUpdate
      })
    }
  }, [settings])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await electron.settings.update(form)
      const updated = await electron.settings.get()
      setSettings(updated)
      notify('success', 'Configurações salvas!')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao salvar configurações', msg)
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
    setIsInstallingDocker(true)
    try {
      const result = await electron.docker.install()
      if (result.status === 'success') {
        notify('success', 'Docker instalado!', 'Verificando disponibilidade...')
        // Auto-refresh docker status after successful install
        const status = await electron.docker.status()
        setStatus(status)
        if (!status.available) {
          notify('warning', 'Docker instalado', 'Pode ser necessário reiniciar o computador para ativar o Docker.')
        }
      } else if (result.status === 'opened_browser') {
        notify('info', 'Instalador aberto', 'Siga as instruções no navegador e depois clique em Verificar.')
      }
    } catch {
      notify('failure', 'Erro ao instalar Docker', 'Não foi possível iniciar a instalação.')
    } finally {
      setIsInstallingDocker(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-primary" />
          Configurações
        </h1>
        <p className="text-muted-foreground">Gerencie as preferências do OrbitCI</p>
      </div>

      {/* GitHub Account */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conta GitHub</CardTitle>
          <CardDescription>Informações da conta conectada</CardDescription>
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
                <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 bg-emerald-400/10">Conectado</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                Sair
              </Button>
            </div>
          ) : (
            <Button onClick={() => navigate('/login')}>Conectar ao GitHub</Button>
          )}
        </CardContent>
      </Card>

      {/* GitHub OAuth */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Github className="h-4 w-4" />
            OAuth App (Login com GitHub)
          </CardTitle>
          <CardDescription>
            Configure o Client ID para login via OAuth Device Flow
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="githubClientId">Client ID</Label>
            <Input
              id="githubClientId"
              placeholder="Ov23liXXXXXXXXXXXXXX"
              value={form.githubClientId}
              onChange={(e) => setForm((f) => ({ ...f, githubClientId: e.target.value }))}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="githubClientSecret">Client Secret</Label>
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
            Crie em{' '}
            <a
              href="https://github.com/settings/developers"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              GitHub → Settings → Developer settings → OAuth Apps
            </a>
            {' '}— use <code className="text-primary">orbitci://callback</code> como Callback URL
          </p>
        </CardContent>
      </Card>

      {/* Sync Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sincronização</CardTitle>
          <CardDescription>Configure o polling e execução automática</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Intervalo de polling (segundos)</Label>
              <Input
                type="number"
                min={30}
                value={form.defaultPollInterval}
                onChange={(e) => setForm((f) => ({ ...f, defaultPollInterval: parseInt(e.target.value) || 60 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Timeout por job (minutos)</Label>
              <Input
                type="number"
                min={1}
                value={form.jobTimeoutMinutes}
                onChange={(e) => setForm((f) => ({ ...f, jobTimeoutMinutes: parseInt(e.target.value) || 60 }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Runs simultâneos por repositório</Label>
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
            Docker
            {dockerStatus?.available ? (
              <Badge variant="outline" className="text-[#3fb950] border-[#3fb950]/30 bg-[#3fb950]/10">
                v{dockerStatus.version}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[#f85149] border-[#f85149]/30 bg-[#f85149]/10">
                Indisponível
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Configure a integração com Docker para executar workflows em containers isolados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Not available — install prompt */}
          {!dockerStatus?.available && (
            <div className="rounded-md border border-[#d29922]/30 bg-[#d29922]/5 p-3 space-y-2">
              <p className="text-[13px] font-medium text-[#d29922]">Docker não encontrado</p>
              <p className="text-[12px] text-muted-foreground">
                O Docker Desktop é necessário para executar containers. Instale automaticamente
                ou baixe o instalador oficial.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" className="h-7 text-[12px]" onClick={handleInstallDocker} disabled={isInstallingDocker}>
                  {isInstallingDocker
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Download className="h-3.5 w-3.5" />
                  }
                  {isInstallingDocker ? 'Instalando...' : 'Instalar Docker'}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={handleCheckDocker} disabled={isCheckingDocker}>
                  {isCheckingDocker ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Verificar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground/60">
                Windows: winget · macOS: Homebrew · Linux: script oficial
              </p>
            </div>
          )}

          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Habilitar Docker</p>
              <p className="text-xs text-muted-foreground">Permite usar containers nos workflows</p>
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

              {/* Curated image picker */}
              <div className="space-y-2">
                <Label>Imagem padrão</Label>
                <p className="text-xs text-muted-foreground">
                  Selecione uma imagem ou digite manualmente
                </p>

                {/* Custom input */}
                <Input
                  value={form.defaultDockerImage}
                  onChange={(e) => setForm((f) => ({ ...f, defaultDockerImage: e.target.value }))}
                  placeholder="ex: ubuntu:22.04"
                  className="font-mono text-[13px]"
                />

                {/* Categorized presets */}
                <div className="space-y-3 pt-1">
                  {([
                    {
                      category: 'Geral',
                      images: [
                        { label: 'Ubuntu 24.04 LTS', value: 'ubuntu:24.04' },
                        { label: 'Ubuntu 22.04 LTS', value: 'ubuntu:22.04' },
                        { label: 'Debian Bookworm Slim', value: 'debian:bookworm-slim' },
                        { label: 'Alpine 3.20 (mínimo)', value: 'alpine:3.20' },
                      ]
                    },
                    {
                      category: 'Node.js',
                      images: [
                        { label: 'Node.js 22 LTS', value: 'node:22-bookworm' },
                        { label: 'Node.js 20 LTS', value: 'node:20-bookworm' },
                        { label: 'Node.js 20 Alpine', value: 'node:20-alpine' },
                        { label: 'Node.js 18 LTS', value: 'node:18-bullseye' },
                      ]
                    },
                    {
                      category: 'Electron — compilação multiplataforma',
                      images: [
                        { label: 'Linux (Node 20)', value: 'electronuserland/builder:20' },
                        { label: 'Linux + Wine/Windows .exe (Node 20)', value: 'electronuserland/builder:20-wine' },
                        { label: 'Linux (Node 18)', value: 'electronuserland/builder:18' },
                        { label: 'Linux + Wine/Windows .exe (Node 18)', value: 'electronuserland/builder:18-wine' },
                        { label: 'Docker OSX Ventura (macOS-like, requer KVM)', value: 'sickcodes/docker-osx:ventura' },
                      ]
                    },
                    {
                      category: 'Python',
                      images: [
                        { label: 'Python 3.12 Slim', value: 'python:3.12-slim' },
                        { label: 'Python 3.11 Slim', value: 'python:3.11-slim' },
                      ]
                    },
                    {
                      category: 'Go / Rust',
                      images: [
                        { label: 'Go 1.22', value: 'golang:1.22-bookworm' },
                        { label: 'Rust Latest Slim', value: 'rust:slim' },
                      ]
                    },
                  ] as const).map(({ category, images }) => (
                    <div key={category}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1">
                        {category}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {images.map((img) => (
                          <button
                            key={img.value}
                            onClick={() => setForm((f) => ({ ...f, defaultDockerImage: img.value }))}
                            className={cn(
                              'rounded px-2 py-1 text-[11px] font-mono border transition-colors',
                              form.defaultDockerImage === img.value
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                            )}
                          >
                            {img.value}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* macOS note */}
                {form.defaultDockerImage.includes('docker-osx') && (
                  <div className="rounded border border-[#58a6ff]/20 bg-[#58a6ff]/5 px-3 py-2 text-[11px] text-[#58a6ff]/80">
                    ℹ Docker OSX requer suporte a KVM no host. Em máquinas sem virtualização aninhada esta imagem não funcionará. Para builds macOS reais é necessário hardware Apple.
                  </div>
                )}
                {form.defaultDockerImage.includes('wine') && (
                  <div className="rounded border border-[#3fb950]/20 bg-[#3fb950]/5 px-3 py-2 text-[11px] text-[#3fb950]/80">
                    ✓ Esta imagem inclui Wine, permitindo compilar instaladores .exe para Windows diretamente do Linux.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Verify button (when docker is available) */}
          {dockerStatus?.available && (
            <Button variant="outline" size="sm" onClick={handleCheckDocker} disabled={isCheckingDocker}>
              {isCheckingDocker ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Verificar Docker
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notificações
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Notificações desktop</p>
              <p className="text-xs text-muted-foreground">Avisos quando runs terminam</p>
            </div>
            <Switch
              checked={form.notifications}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, notifications: checked }))}
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">Testar notificações</p>
            <p className="text-xs text-muted-foreground">
              Clique em cada tipo para visualizar como as notificações aparecem
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(
                [
                  { type: 'success',  label: 'Sucesso',    title: 'Workflow concluído',    body: 'O pipeline executou com sucesso.',              duration: 6000 },
                  { type: 'failure',  label: 'Falha',      title: 'Workflow falhou',       body: 'Erro na etapa "Build". Clique para ver logs.', duration: 0    },
                  { type: 'running',  label: 'Executando', title: 'Workflow iniciado',     body: 'Aguardando conclusão do pipeline.',            duration: 3000 },
                  { type: 'warning',  label: 'Aviso',      title: 'Atenção necessária',    body: 'Erro de sincronização com o repositório.',     duration: 6000 },
                  { type: 'info',     label: 'Info',       title: 'Novo commit detectado', body: 'feat: adiciona suporte a Docker multi-stage.', duration: 4000 },
                ] as const
              ).map(({ type, label, title, body, duration }) => (
                <button
                  key={type}
                  onClick={() => electron.notify.test({ type, title, body, duration })}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] font-medium transition-colors text-left',
                    type === 'success' && 'border-[#3fb950]/30 text-[#3fb950] hover:bg-[#3fb950]/5',
                    type === 'failure' && 'border-[#f85149]/30 text-[#f85149] hover:bg-[#f85149]/5',
                    type === 'running' && 'border-[#58a6ff]/30 text-[#58a6ff] hover:bg-[#58a6ff]/5',
                    type === 'warning' && 'border-[#d29922]/30 text-[#d29922] hover:bg-[#d29922]/5',
                    type === 'info'    && 'border-border text-muted-foreground hover:bg-muted/30'
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0',
                    type === 'success' && 'bg-[#3fb950]',
                    type === 'failure' && 'bg-[#f85149]',
                    type === 'running' && 'bg-[#58a6ff]',
                    type === 'warning' && 'bg-[#d29922]',
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
            Atualizações
          </CardTitle>
          <CardDescription>Configure o comportamento de atualização automática do OrbitCI</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Atualizar automaticamente</p>
              <p className="text-xs text-muted-foreground">
                Verifica e instala atualizações automaticamente ao iniciar
              </p>
            </div>
            <Switch
              checked={form.autoUpdate}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, autoUpdate: checked }))}
            />
          </div>
          {!form.autoUpdate && (
            <p className="text-[11px] text-muted-foreground/60">
              Quando desativado, você pode verificar manualmente no menu do usuário na sidebar.
            </p>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={isSaving}>
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Salvar Configurações
      </Button>
    </div>
  )
}
