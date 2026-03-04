import { useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  History, Shield, Plus, BarChart2,
  CheckCircle2, XCircle, Loader2, AlertCircle, LayoutDashboard, RefreshCw,
  LogOut, ChevronDown, UserCircle2, Settings, ArrowUp, ArrowDown, GitBranch
} from 'lucide-react'
import orbitIcon from '@/assets/icon.png'
import { cn } from '@/lib/utils'
import { useRepoStore, useRunsStore, useAuthStore } from '@/store'
import type { GitSummary } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { electron } from '@/lib/electron'
import type { RunStatus } from '@shared/types'

function OwnerAvatar({ owner, className }: { owner: string; className?: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className={cn('rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center text-[9px] font-bold text-primary shrink-0', className)}>
        {owner[0]?.toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={`https://github.com/${owner}.png?size=32`}
      alt={owner}
      className={cn('rounded-full object-cover shrink-0', className)}
      onError={() => setFailed(true)}
    />
  )
}

function RepoStatusDot({ status }: { status: RunStatus | null }): JSX.Element {
  if (status === 'running')
    return <Loader2 className="h-3 w-3 animate-spin text-[#58a6ff] shrink-0" />
  if (status === 'success')
    return <CheckCircle2 className="h-3 w-3 text-[#3fb950] shrink-0" />
  if (status === 'failure')
    return <XCircle className="h-3 w-3 text-[#f85149] shrink-0" />
  if (status === 'cancelled')
    return <AlertCircle className="h-3 w-3 text-[#d29922] shrink-0" />
  return <span className="h-2 w-2 rounded-full bg-sidebar-border shrink-0 mt-px" />
}

export function Sidebar(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { repos, selectedRepoId, selectRepo, gitSummaries, setGitSummary } = useRepoStore()
  const { runs } = useRunsStore()
  const { user, setUser } = useAuthStore()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    navigate(`/dashboard/${encodeURIComponent(repoId)}`)
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

  const navItems = [
    { icon: LayoutDashboard, label: 'Repositórios', path: '/repos' },
    { icon: History, label: 'Histórico', path: '/history' },
    { icon: BarChart2, label: 'Estatísticas', path: '/analytics' },
    { icon: Shield, label: 'Secrets', path: '/secrets' }
  ]

  return (
    <nav className="flex h-full w-[220px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar-background">
      {/* ── Brand ─────────────────────────────────────────────────────────── */}
      <div className="flex h-12 items-center gap-2.5 px-4 titlebar-drag border-b border-sidebar-border select-none">
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

      {/* ── Main navigation ───────────────────────────────────────────────── */}
      <div className="px-2 pt-3 space-y-0.5">
        {navItems.map((item) => {
          const active =
            location.pathname === item.path ||
            (item.path !== '/repos' && location.pathname.startsWith(item.path))
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                'no-drag flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-[7px] text-[13px] font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              )}
            >
              <item.icon
                className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'opacity-60')}
              />
              {item.label}
            </button>
          )
        })}
      </div>

      {/* ── Repos section header ──────────────────────────────────────────── */}
      <div className="mt-4 mb-1 flex items-center justify-between px-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/35">
          Repos
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate('/repos')}
              className="no-drag flex h-5 w-5 items-center justify-center rounded text-sidebar-foreground/35 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">Adicionar repositório</TooltipContent>
        </Tooltip>
      </div>

      {/* ── Repo list ─────────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-2 pb-2">
        <div className="space-y-0.5">
          {repos.map((repo) => {
            const ciStatus = getRepoStatus(repo.id)
            const git: GitSummary | undefined = gitSummaries[repo.id]
            const isSelected = selectedRepoId === repo.id

            return (
              <div
                key={repo.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectRepo(repo.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectRepo(repo.id) } }}
                className={cn(
                  'no-drag group flex w-full items-start gap-2 rounded-[5px] px-2.5 py-2 text-left transition-colors cursor-pointer',
                  isSelected
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                {/* Owner avatar with CI status overlay */}
                <div className="relative shrink-0 mt-0.5">
                  <OwnerAvatar owner={repo.owner} className="h-6 w-6 ring-1 ring-sidebar-border" />
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-[1.5px] ring-sidebar-background">
                    <RepoStatusDot status={ciStatus} />
                  </span>
                </div>

                {/* Repo info */}
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium leading-tight flex-1">{repo.name}</span>
                    {/* ahead / behind */}
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
                  </div>

                  {/* Branch + changes */}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {git ? (
                      <>
                        <GitBranch className="h-2.5 w-2.5 shrink-0 text-sidebar-foreground/35" />
                        <span className="truncate text-[10px] leading-tight text-sidebar-foreground/45">
                          {git.branch}
                        </span>
                        {git.changes > 0 && (
                          <span className="ml-auto shrink-0 text-[10px] text-[#d29922] font-medium">
                            ●{git.changes}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="truncate text-[10px] leading-tight text-sidebar-foreground/35">
                        {repo.owner}
                      </span>
                    )}
                  </div>
                </div>

                {/* Sync button */}
                <button
                  onClick={(e) => handleSync(e, repo.id)}
                  className="no-drag mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
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
        </div>
      </ScrollArea>

      {/* ── User account ──────────────────────────────────────────────────── */}
      <div className="border-t border-sidebar-border px-2 py-2">
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
                    <OwnerAvatar owner={user.login} className="h-8 w-8" />
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
