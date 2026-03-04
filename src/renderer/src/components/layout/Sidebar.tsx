import { useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  History, Settings, Plus, Search, LayoutDashboard,
  Loader2, XCircle, UserCircle2,
  ChevronDown, LogOut, ArrowUp, ArrowDown, GitBranch,
  Download, RotateCcw, RefreshCw, Container
} from 'lucide-react'
import orbitIcon from '@/assets/icon.png'
import { cn } from '@/lib/utils'
import { useRepoStore, useRunsStore, useAuthStore, useUpdaterStore, useDockerStore } from '@/store'
import type { GitSummary } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { electron } from '@/lib/electron'
import { IPC_CHANNELS } from '@shared/constants'
import type { RunStatus } from '@shared/types'
import { OwnerAvatar } from '@/components/shared/OwnerAvatar'
import { StatusIcon } from '@/components/shared/StatusIcon'

export function Sidebar(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { repos, selectedRepoId, selectRepo, gitSummaries, setGitSummary } = useRepoStore()
  const { runs } = useRunsStore()
  const { user, setUser } = useAuthStore()
  const updater = useUpdaterStore()
  const dockerStatus = useDockerStore((s) => s.status)
  const setDockerStatus = useDockerStore((s) => s.setStatus)
  const dockerInstalling = useDockerStore((s) => s.installing)
  const setDockerInstalling = useDockerStore((s) => s.setInstalling)
  const addDockerInstallLog = useDockerStore((s) => s.addInstallLog)
  const clearDockerInstallLogs = useDockerStore((s) => s.clearInstallLogs)
  const dockerInstallLogs = useDockerStore((s) => s.installLogs)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [search, setSearch] = useState('')

  // Subscribe to updater events from main process
  useEffect(() => {
    electron.updater.getVersion().then((v) => updater.setCurrentVersion(v))
    const unsub = electron.on(IPC_CHANNELS.EVENT_UPDATER, (event: unknown) => {
      updater.handleEvent(event as { type: string; version?: string; percent?: number; message?: string })
    })
    return () => { unsub() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCheckUpdate = async () => {
    updater.setStatus('checking')
    await electron.updater.check()
  }

  const handleDownloadUpdate = async () => {
    updater.setStatus('downloading')
    await electron.updater.download()
  }

  const handleInstallUpdate = () => {
    electron.updater.install()
  }

  // Periodically re-check Docker availability
  useEffect(() => {
    const check = () => electron.docker.status().then(setDockerStatus).catch(() => {})
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch git summary for all repos that have a local path
  const fetchSummaries = async () => {
    for (const repo of repos) {
      if (!repo.localPath) continue
      try {
        const s = await electron.git.status(repo.id)
        setGitSummary(repo.id, {
          branch: s.branch,
          ahead: s.ahead,
          behind: s.behind,
          changes: s.staged.length + s.unstaged.length + s.untracked.length
        })
      } catch {
        // repo might not be a git repo — skip silently
      }
    }
  }

  useEffect(() => {
    if (repos.length === 0) return
    fetchSummaries()
    pollRef.current = setInterval(fetchSummaries, 30_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos.length])

  const getRepoStatus = (repoId: string): RunStatus | null => {
    const repoRuns = runs.filter((r) => r.repoId === repoId)
    const active = repoRuns.find((r) => r.status === 'running')
    if (active) return 'running'
    const last = repoRuns.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0]
    return (last?.status ?? null) as RunStatus | null
  }

  const handleSelectRepo = (repoId: string) => {
    selectRepo(repoId)
    navigate(`/repo/${encodeURIComponent(repoId)}`)
  }

  const handleSync = async (e: React.MouseEvent, repoId: string) => {
    e.stopPropagation()
    try { await electron.repos.sync(repoId) } catch { /* ignored */ }
  }

  const handleLogout = async () => {
    await electron.auth.logout()
    setUser(null)
    navigate('/login')
  }

  const handleSidebarDockerInstall = async () => {
    navigate('/settings')

    if (dockerInstalling) return
    setDockerInstalling(true)
    clearDockerInstallLogs()

    const unsub = electron.on(IPC_CHANNELS.EVENT_DOCKER_INSTALL, (data: unknown) => {
      const { message, type } = data as { message: string; type: string }
      addDockerInstallLog({ message, type })
    })

    try {
      const result = await electron.docker.install()
      if (result.status === 'success') {
        const status = await electron.docker.status()
        setDockerStatus(status)
        if (!status.available) {
          addDockerInstallLog({ message: 'Docker instalado, mas pode ser necessário reiniciar o computador ou iniciar o Docker Desktop.', type: 'error' })
        }
      } else if (result.status === 'opened_browser') {
        addDockerInstallLog({ message: 'Instalador aberto no navegador. Após instalar, clique em "Verificar".', type: 'step' })
      }
    } catch {
      addDockerInstallLog({ message: 'Erro inesperado durante a instalação.', type: 'error' })
    } finally {
      unsub()
      setDockerInstalling(false)
    }
  }

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  )

  const isDashboardActive = location.pathname === '/'
  const isActivityActive = location.pathname === '/history'
  const isSettingsActive = location.pathname === '/settings'

  return (
    <nav className="flex h-full w-[220px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar-background">

      {/* ── Brand ─────────────────────────────────────────────────────────── */}
      <div className="flex h-12 items-center gap-2.5 px-4 titlebar-drag border-b border-sidebar-border select-none shrink-0">
        <img
          src={orbitIcon}
          alt="OrbitCI"
          className="h-7 w-7 shrink-0 rounded-md object-cover"
          style={{ filter: 'brightness(1.1) contrast(1.05)' }}
        />
        <span className="text-[15px] font-semibold tracking-tight text-sidebar-accent-foreground">
          OrbitCI
        </span>
      </div>

      {/* ── Search + Add ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 pt-2.5 pb-1.5 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-sidebar-foreground/35" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter repos..."
            className={cn(
              'no-drag w-full rounded-[5px] bg-sidebar-accent/40 pl-6 pr-2 py-[5px]',
              'text-[12px] text-sidebar-foreground/80 placeholder:text-sidebar-foreground/30',
              'border border-sidebar-border/60 focus:border-primary/40 focus:outline-none focus:ring-0',
              'transition-colors'
            )}
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate('/repos')}
              className={cn(
                'no-drag flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[5px]',
                'bg-sidebar-accent/40 border border-sidebar-border/60',
                'text-sidebar-foreground/45 hover:text-sidebar-foreground hover:bg-sidebar-accent/70',
                'transition-colors'
              )}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">Adicionar repositório</TooltipContent>
        </Tooltip>
      </div>

      {/* ── REPOS section label ───────────────────────────────────────────── */}
      <div className="px-3.5 pt-1 pb-1 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">
          Repos
        </span>
      </div>

      {/* ── Repo list (scrollable) ────────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-2 pb-1">
        <div className="space-y-0.5">
          {filteredRepos.map((repo) => {
            const ciStatus = getRepoStatus(repo.id)
            const git: GitSummary | undefined = gitSummaries[repo.id]
            const isSelected = selectedRepoId === repo.id

            return (
              <div
                key={repo.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectRepo(repo.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleSelectRepo(repo.id)
                  }
                }}
                className={cn(
                  'no-drag group flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left transition-colors cursor-pointer',
                  isSelected
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                {/* Owner avatar */}
                <div className="relative shrink-0">
                  <OwnerAvatar
                    owner={repo.owner}
                    size={32}
                    className="h-5 w-5 ring-1 ring-sidebar-border"
                  />
                </div>

                {/* Repo name (primary) + branch (secondary) */}
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="truncate text-[12.5px] font-medium leading-snug flex-1">
                      {repo.name}
                    </span>
                    {/* ahead / behind indicators */}
                    {git && (git.ahead > 0 || git.behind > 0) && (
                      <span className="flex items-center gap-0.5 shrink-0">
                        {git.ahead > 0 && (
                          <span className="flex items-center text-[10px] text-[#3fb950] font-medium">
                            <ArrowUp className="h-2.5 w-2.5" />{git.ahead}
                          </span>
                        )}
                        {git.behind > 0 && (
                          <span className="flex items-center text-[10px] text-[#d29922] font-medium">
                            <ArrowDown className="h-2.5 w-2.5" />{git.behind}
                          </span>
                        )}
                      </span>
                    )}
                    {/* CI status */}
                    <span className="shrink-0">
                      <StatusIcon status={ciStatus} size="xs" />
                    </span>
                  </div>

                  {/* Branch row */}
                  <div className="flex items-center gap-1 min-w-0">
                    {git ? (
                      <>
                        <GitBranch className="h-2.5 w-2.5 shrink-0 text-sidebar-foreground/30" />
                        <span className="truncate text-[10px] leading-tight text-sidebar-foreground/40">
                          {git.branch}
                        </span>
                        {git.changes > 0 && (
                          <span className="ml-auto shrink-0 text-[10px] text-[#d29922] font-medium leading-tight">
                            ●{git.changes}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="truncate text-[10px] leading-tight text-sidebar-foreground/30">
                        {repo.owner}
                      </span>
                    )}
                  </div>
                </div>

                {/* Sync button — visible on hover */}
                <button
                  onClick={(e) => handleSync(e, repo.id)}
                  className="no-drag shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Sincronizar"
                >
                  <RefreshCw className="h-3 w-3 text-sidebar-foreground/50 hover:text-sidebar-foreground" />
                </button>
              </div>
            )
          })}

          {repos.length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-[12px] text-sidebar-foreground/35">Nenhum repositório</p>
              <button
                className="no-drag mt-1.5 text-[12px] text-primary hover:underline underline-offset-2"
                onClick={() => navigate('/repos')}
              >
                Adicionar
              </button>
            </div>
          )}

          {repos.length > 0 && filteredRepos.length === 0 && (
            <div className="px-3 py-4 text-center">
              <p className="text-[11px] text-sidebar-foreground/35">Sem resultados para "{search}"</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ── GLOBAL section ────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-sidebar-border pt-1.5 pb-1 px-2">
        <div className="px-1.5 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">
            Global
          </span>
        </div>
        <div className="space-y-0.5">
          <button
            onClick={() => navigate('/')}
            className={cn(
              'no-drag flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-[7px] text-[13px] font-medium transition-colors',
              isDashboardActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            )}
          >
            <LayoutDashboard className={cn('h-4 w-4 shrink-0', isDashboardActive ? 'text-primary' : 'opacity-60')} />
            Dashboard
          </button>
          <button
            onClick={() => navigate('/history')}
            className={cn(
              'no-drag flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-[7px] text-[13px] font-medium transition-colors',
              isActivityActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            )}
          >
            <History className={cn('h-4 w-4 shrink-0', isActivityActive ? 'text-primary' : 'opacity-60')} />
            Activity
          </button>
          <button
            onClick={() => navigate('/settings')}
            className={cn(
              'no-drag flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-[7px] text-[13px] font-medium transition-colors',
              isSettingsActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            )}
          >
            <Settings className={cn('h-4 w-4 shrink-0', isSettingsActive ? 'text-primary' : 'opacity-60')} />
            Settings
          </button>
        </div>
      </div>

      {/* ── Docker warning ────────────────────────────────────────────────── */}
      {dockerStatus && !dockerStatus.available && (
        <div className="shrink-0 border-t border-sidebar-border px-3 py-2">
          {dockerInstalling ? (
            <button
              onClick={() => navigate('/settings')}
              className="no-drag flex w-full items-start gap-2 rounded-[5px] px-2 py-2 bg-[#58a6ff]/8 hover:bg-[#58a6ff]/12 transition-colors text-left"
            >
              <Loader2 className="h-4 w-4 text-[#58a6ff] shrink-0 mt-0.5 animate-spin" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-[#58a6ff] leading-tight">
                  Instalando Docker...
                </p>
                <p className="text-[10px] text-sidebar-foreground/45 leading-snug mt-0.5 truncate">
                  {dockerInstallLogs.length > 0
                    ? dockerInstallLogs[dockerInstallLogs.length - 1].message
                    : 'Aguardando...'}
                </p>
              </div>
            </button>
          ) : (
            <button
              onClick={handleSidebarDockerInstall}
              className="no-drag flex w-full items-start gap-2 rounded-[5px] px-2 py-2 bg-[#d29922]/8 hover:bg-[#d29922]/12 transition-colors text-left"
            >
              <Container className="h-4 w-4 text-[#d29922] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-[#d29922] leading-tight">
                  Docker não detectado
                </p>
                <p className="text-[10px] text-sidebar-foreground/45 leading-snug mt-0.5">
                  Clique para instalar Docker
                </p>
              </div>
            </button>
          )}
        </div>
      )}

      {/* ── Updater widget ────────────────────────────────────────────────── */}
      {updater.status !== 'idle' && updater.status !== 'not-available' && (
        <div className="shrink-0 border-t border-sidebar-border px-3 py-2">
          {updater.status === 'checking' && (
            <div className="flex items-center gap-2 text-[11px] text-sidebar-foreground/50">
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              <span>Verificando atualizações...</span>
            </div>
          )}

          {updater.status === 'available' && (
            <button
              onClick={handleDownloadUpdate}
              className="no-drag flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left hover:bg-[#8b5cf6]/10 transition-colors"
            >
              <Download className="h-3.5 w-3.5 text-[#8b5cf6] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-[#8b5cf6]">
                  v{updater.version} disponível
                </p>
                <p className="text-[10px] text-sidebar-foreground/40">Clique para baixar</p>
              </div>
            </button>
          )}

          {updater.status === 'downloading' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] text-sidebar-foreground/60">
                <Loader2 className="h-3 w-3 animate-spin shrink-0 text-[#58a6ff]" />
                <span>Baixando atualização...</span>
                <span className="ml-auto text-[10px] tabular-nums">{Math.round(updater.percent)}%</span>
              </div>
              <div className="h-1 w-full rounded-full bg-sidebar-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#58a6ff] transition-all duration-300"
                  style={{ width: `${updater.percent}%` }}
                />
              </div>
            </div>
          )}

          {updater.status === 'downloaded' && (
            <button
              onClick={handleInstallUpdate}
              className="no-drag flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left hover:bg-[#3fb950]/10 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5 text-[#3fb950] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-[#3fb950]">
                  v{updater.version} pronta!
                </p>
                <p className="text-[10px] text-sidebar-foreground/40">Clique para reiniciar e atualizar</p>
              </div>
            </button>
          )}

          {updater.status === 'error' && (
            <button
              onClick={handleCheckUpdate}
              className="no-drag flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left hover:bg-[#f85149]/10 transition-colors"
            >
              <XCircle className="h-3.5 w-3.5 text-[#f85149] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-[#f85149]">Erro na atualização</p>
                <p className="text-[10px] text-sidebar-foreground/40 truncate">{updater.error}</p>
              </div>
            </button>
          )}
        </div>
      )}

      {/* ── User account ──────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-sidebar-border px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="no-drag flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left hover:bg-sidebar-accent/50 transition-colors group">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.login}
                  className="h-6 w-6 rounded-full shrink-0 ring-1 ring-sidebar-border"
                />
              ) : (
                <UserCircle2 className="h-6 w-6 shrink-0 text-sidebar-foreground/40" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-sidebar-foreground/80 leading-tight">
                  {user?.name ?? user?.login ?? 'Conta'}
                </div>
                {user?.login && (
                  <div className="truncate text-[10px] text-sidebar-foreground/40 leading-tight">
                    @{user.login}
                  </div>
                )}
              </div>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/60 transition-colors" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-52 text-[13px] mb-1">
            {user && (
              <>
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.login}
                      className="h-8 w-8 rounded-full shrink-0"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <OwnerAvatar owner={user.login} size={32} className="h-8 w-8" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-[13px] truncate">{user.name ?? user.login}</p>
                    <p className="text-[11px] text-muted-foreground truncate">@{user.login}</p>
                  </div>
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="h-3.5 w-3.5 mr-2" />
              Configurações
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCheckUpdate} disabled={updater.status === 'checking'}>
              {updater.status === 'checking'
                ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                : <Download className="h-3.5 w-3.5 mr-2" />
              }
              Verificar atualizações
            </DropdownMenuItem>
            {updater.currentVersion && (
              <div className="px-3 py-1 text-[10px] text-muted-foreground">
                v{updater.currentVersion}
              </div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[#f85149] focus:text-[#f85149]"
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5 mr-2" />
              Sair da conta
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  )
}
