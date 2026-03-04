import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, Folder, Lock, Globe, GitBranch,
  Loader2, Link, Download, Clock, MoreHorizontal,
  RefreshCw, Trash2, FolderOpen, FolderSearch, FileCode, Import, Unlink, ScanLine
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore } from '@/store'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { GitHubRepo, Repo } from '@shared/types'

// ── Owner avatar ───────────────────────────────────────────────────────────────
function OwnerAvatar({ src, owner, className }: { src?: string; owner: string; className?: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  const url = (!failed && (src || `https://github.com/${owner}.png?size=64`))
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

// ── .github workflow import dialog ────────────────────────────────────────────
function GithubImportDialog({
  open,
  localPath,
  files,
  onImport,
  onSkip,
  onClose
}: {
  open: boolean
  localPath: string
  files: string[]
  onImport: () => void
  onSkip: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <FileCode className="h-4 w-4 text-primary" />
            Workflows encontrados
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Este repositório já possui workflows em{' '}
            <code className="text-primary font-mono text-[12px]">.github/workflows/</code>.
            Deseja importá-los para o OrbitCI?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/30 divide-y divide-border max-h-40 overflow-auto">
          {files.map((f) => (
            <div key={f} className="flex items-center gap-2 px-3 py-2 text-[12px]">
              <FileCode className="h-3.5 w-3.5 text-primary/70 shrink-0" />
              <span className="font-mono text-foreground">{f}</span>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onSkip} className="text-[12px]">
            Ignorar, criar do zero
          </Button>
          <Button size="sm" onClick={onImport} className="text-[12px]">
            <Import className="h-3.5 w-3.5" />
            Importar workflows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Find local folder dialog ───────────────────────────────────────────────────
function FindLocalDialog({
  open,
  candidates,
  onSelect,
  onBrowse,
  onClose
}: {
  open: boolean
  candidates: string[]
  onSelect: (path: string) => void
  onBrowse: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <FolderSearch className="h-4 w-4 text-primary" />
            Pasta encontrada localmente
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Encontramos possíveis pastas para este repositório. Selecione ou procure manualmente.
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
          {candidates.map((path) => (
            <button
              key={path}
              onClick={() => onSelect(path)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors"
            >
              <Folder className="h-3.5 w-3.5 text-primary/70 shrink-0" />
              <span className="text-[12px] font-mono truncate text-foreground">{path}</span>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onBrowse} className="text-[12px]">
            <FolderOpen className="h-3.5 w-3.5" />
            Procurar manualmente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Delete confirm dialog ──────────────────────────────────────────────────────
function DeleteConfirmDialog({
  open,
  repoName,
  onConfirm,
  onClose
}: {
  open: boolean
  repoName: string
  onConfirm: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[15px] text-[#f85149]">Remover repositório</DialogTitle>
          <DialogDescription className="text-[13px]">
            Tem certeza que deseja remover <strong>{repoName}</strong> do OrbitCI?
            A pasta local não será excluída, apenas o registro no OrbitCI.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-[12px]">Cancelar</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} className="text-[12px]">Remover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Scan results dialog ───────────────────────────────────────────────────────
interface ScanResult { repo: Repo; path: string }

function ScanResultsDialog({
  open,
  results,
  onLink,
  onClose
}: {
  open: boolean
  results: ScanResult[]
  onLink: (repo: Repo, path: string) => void
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <ScanLine className="h-4 w-4 text-primary" />
            Repositórios detectados localmente
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {results.length === 0
              ? 'Nenhum repositório sem pasta encontrado localmente.'
              : `Encontramos ${results.length} pasta${results.length !== 1 ? 's' : ''} correspondente${results.length !== 1 ? 's' : ''}. Vincule os que desejar.`}
          </DialogDescription>
        </DialogHeader>

        {results.length > 0 && (
          <div className="flex-1 overflow-auto divide-y divide-border">
            {results.map(({ repo, path }) => (
              <div key={repo.id} className="flex items-center gap-3 px-5 py-3">
                <OwnerAvatar owner={repo.owner} className="h-7 w-7 ring-1 ring-border shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium truncate">{repo.fullName}</p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">{path}</p>
                </div>
                <Button
                  size="sm"
                  className="h-7 text-[12px] px-2.5 shrink-0"
                  onClick={() => onLink(repo, path)}
                >
                  <Link className="h-3.5 w-3.5" />
                  Vincular
                </Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="px-5 py-3 border-t border-border shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} className="text-[12px]">Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Repo row ──────────────────────────────────────────────────────────────────
function RepoRow({
  repo,
  onClick,
  onSync,
  onOpenFolder,
  onLinkFolder,
  onUnlink,
  onDeleteOrbit,
  onRemove
}: {
  repo: Repo
  onClick: () => void
  onSync: () => void
  onOpenFolder: () => void
  onLinkFolder: () => void
  onUnlink: () => void
  onDeleteOrbit: () => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div
      onClick={onClick}
      className="gh-row cursor-pointer group"
    >
      <OwnerAvatar owner={repo.owner} className="h-8 w-8 ring-1 ring-border" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[13px] text-foreground">{repo.fullName}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
            {repo.defaultBranch}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[12px] text-muted-foreground">
          {repo.localPath ? (
            <span className="flex items-center gap-1 truncate max-w-[300px]">
              <Folder className="h-3 w-3 shrink-0" />
              <span className="truncate">{repo.localPath}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[#d29922]">
              <Link className="h-3 w-3" />
              Sem pasta local
            </span>
          )}
          {repo.lastSyncAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(repo.lastSyncAt).toLocaleDateString('pt-BR')}
            </span>
          )}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 text-[13px]">
          {repo.localPath ? (
            <>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpenFolder() }}>
                <FolderOpen className="h-3.5 w-3.5 mr-2" />
                Abrir pasta
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUnlink() }}>
                <Unlink className="h-3.5 w-3.5 mr-2" />
                Desvincular pasta
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onLinkFolder() }}>
              <Link className="h-3.5 w-3.5 mr-2" />
              Vincular pasta
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSync() }}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Sincronizar
          </DropdownMenuItem>
          {repo.localPath && (
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDeleteOrbit() }}>
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Excluir pasta .orbit
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-[#f85149] focus:text-[#f85149]"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Remover do OrbitCI
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function Repos(): JSX.Element {
  const navigate = useNavigate()
  const { repos, addRepo, updateRepo, removeRepo } = useRepoStore()
  const [search, setSearch] = useState('')
  const [filterOwner, setFilterOwner] = useState<string>('all')
  const [filterLocal, setFilterLocal] = useState<'all' | 'local' | 'no-local'>('all')
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([])
  const [isLoadingGitHub, setIsLoadingGitHub] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [cloningId, setCloningId] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  // bulk scan state
  const [isScanning, setIsScanning] = useState(false)
  const [scanResults, setScanResults] = useState<ScanResult[] | null>(null)

  // .github import dialog
  const [githubImport, setGithubImport] = useState<{
    repoId: string; localPath: string; files: string[]
  } | null>(null)

  // auto-find local dialog
  const [findLocal, setFindLocal] = useState<{
    repo: Repo; candidates: string[]
  } | null>(null)

  // delete confirm dialog
  const [deleteConfirm, setDeleteConfirm] = useState<Repo | null>(null)

  // .orbit delete confirm
  const [orbitDeleteRepo, setOrbitDeleteRepo] = useState<Repo | null>(null)

  const loadGitHubRepos = async () => {
    setIsLoadingGitHub(true)
    try {
      const list = await electron.repos.listGitHub()
      setGithubRepos(list)
    } catch {
      notify('failure', 'Erro ao carregar repositórios', 'Não foi possível carregar repositórios do GitHub')
    } finally {
      setIsLoadingGitHub(false)
    }
  }

  const handleOpenAddDialog = () => {
    setAddDialogOpen(true)
    loadGitHubRepos()
  }

  // After linking/cloning, check for .github/workflows/
  const checkAndOfferGithubImport = async (repoId: string, localPath: string) => {
    try {
      const check = await electron.repos.checkGithubWorkflows(localPath)
      if (check.found) {
        setGithubImport({ repoId, localPath, files: check.files })
      }
    } catch { /* ignore */ }
  }

  const handleImportGithubWorkflows = async () => {
    if (!githubImport) return
    try {
      const result = await electron.repos.importGithubWorkflows(githubImport.localPath)
      notify('success', 'Workflows importados!', `${result.count} arquivo(s) importados de .github/workflows/`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao importar'
      notify('failure', 'Erro ao importar', msg)
    } finally {
      setGithubImport(null)
    }
  }

  const handleClone = async (ghRepo: GitHubRepo) => {
    const repoId = ghRepo.full_name
    setCloningId(repoId)
    try {
      const result = await electron.repos.clone(repoId, ghRepo.clone_url)
      if ('cancelled' in result) { setCloningId(null); return }
      const repo = await electron.repos.add({
        id: repoId, name: ghRepo.name, owner: ghRepo.owner.login,
        fullName: ghRepo.full_name, localPath: result.localPath,
        remoteUrl: ghRepo.clone_url, defaultBranch: ghRepo.default_branch,
        watchBranches: [ghRepo.default_branch], autoRun: true,
        notifications: true, pollInterval: 60
      })
      addRepo(repo)
      setAddDialogOpen(false)
      notify('success', 'Repositório clonado!', `${repoId} adicionado com sucesso`)
      await checkAndOfferGithubImport(repoId, result.localPath)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao clonar'
      notify('failure', 'Erro ao clonar', msg)
    } finally {
      setCloningId(null)
    }
  }

  const handleLink = async (ghRepo: GitHubRepo) => {
    const repoId = ghRepo.full_name
    setLinkingId(repoId)
    try {
      let repo: Repo
      const existing = repos.find((r) => r.id === repoId)
      if (!existing) {
        repo = await electron.repos.add({
          id: repoId, name: ghRepo.name, owner: ghRepo.owner.login,
          fullName: ghRepo.full_name, remoteUrl: ghRepo.clone_url,
          defaultBranch: ghRepo.default_branch, watchBranches: [ghRepo.default_branch],
          autoRun: true, notifications: true, pollInterval: 60
        })
        addRepo(repo)
      } else {
        repo = existing
      }

      // Auto-search for local folder first
      const candidates = await electron.repos.findLocal(ghRepo.name)
      if (candidates.length > 0) {
        setAddDialogOpen(false)
        setFindLocal({ repo, candidates })
      } else {
        const result = await electron.repos.link(repoId)
        if (!('cancelled' in result)) {
          const updated = await electron.repos.update(repoId, { localPath: result.localPath })
          updateRepo(repoId, updated)
          setAddDialogOpen(false)
          notify('success', 'Repositório vinculado!', `${repoId} vinculado com sucesso`)
          await checkAndOfferGithubImport(repoId, result.localPath)
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao vincular'
      notify('failure', 'Erro ao vincular', msg)
    } finally {
      setLinkingId(null)
    }
  }

  const confirmFindLocalPath = async (path: string) => {
    if (!findLocal) return
    const repoId = findLocal.repo.id
    try {
      const updated = await electron.repos.update(repoId, { localPath: path })
      updateRepo(repoId, updated)
      notify('success', 'Repositório vinculado!', `Pasta: ${path}`)
      setFindLocal(null)
      await checkAndOfferGithubImport(repoId, path)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao vincular', msg)
    }
  }

  const browseFindLocalPath = async () => {
    if (!findLocal) return
    const repoId = findLocal.repo.id
    setFindLocal(null)
    const result = await electron.repos.link(repoId)
    if (!('cancelled' in result)) {
      const updated = await electron.repos.update(repoId, { localPath: result.localPath })
      updateRepo(repoId, updated)
      notify('success', 'Repositório vinculado!', `Pasta: ${result.localPath}`)
      await checkAndOfferGithubImport(repoId, result.localPath)
    }
  }

  const handleLinkExisting = async (repo: Repo) => {
    const candidates = await electron.repos.findLocal(repo.name)
    if (candidates.length > 0) {
      setFindLocal({ repo, candidates })
    } else {
      const result = await electron.repos.link(repo.id)
      if (!('cancelled' in result)) {
        const updated = await electron.repos.update(repo.id, { localPath: result.localPath })
        updateRepo(repo.id, updated)
        notify('success', 'Repositório vinculado!', `Pasta: ${result.localPath}`)
        await checkAndOfferGithubImport(repo.id, result.localPath)
      }
    }
  }

  const handleSync = async (repo: Repo) => {
    setSyncingId(repo.id)
    try {
      await electron.repos.sync(repo.id)
      notify('success', 'Sincronizado!', repo.fullName)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao sincronizar', msg)
    } finally {
      setSyncingId(null)
    }
  }

  const handleOpenFolder = async (repo: Repo) => {
    if (!repo.localPath) return
    try {
      await electron.repos.openFolder(repo.localPath)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao abrir pasta', msg)
    }
  }

  const handleDeleteOrbit = async (repo: Repo) => {
    if (!repo.localPath) return
    try {
      const result = await electron.repos.deleteOrbitDir(repo.localPath)
      if (result.deleted) {
        notify('success', 'Pasta .orbit excluída', repo.fullName)
      } else {
        notify('info', 'Pasta .orbit não encontrada')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro', msg)
    } finally {
      setOrbitDeleteRepo(null)
    }
  }

  const handleRemove = async (repo: Repo) => {
    try {
      await electron.repos.remove(repo.id)
      removeRepo(repo.id)
      notify('success', 'Removido', `${repo.fullName} removido do OrbitCI`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao remover', msg)
    } finally {
      setDeleteConfirm(null)
    }
  }

  const handleUnlink = async (repo: Repo) => {
    try {
      const updated = await electron.repos.update(repo.id, { localPath: null })
      updateRepo(repo.id, updated)
      notify('success', 'Pasta desvinculada', `${repo.fullName} desvinculado da pasta local`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao desvincular', msg)
    }
  }

  const handleScanAll = async () => {
    const unlinked = repos.filter((r) => !r.localPath)
    if (unlinked.length === 0) return
    setIsScanning(true)
    try {
      const found: ScanResult[] = []
      await Promise.all(
        unlinked.map(async (repo) => {
          try {
            const candidates = await electron.repos.findLocal(repo.name)
            if (candidates.length > 0) found.push({ repo, path: candidates[0] })
          } catch { /* skip */ }
        })
      )
      setScanResults(found)
    } finally {
      setIsScanning(false)
    }
  }

  const handleScanLink = async (repo: Repo, path: string) => {
    try {
      const updated = await electron.repos.update(repo.id, { localPath: path })
      updateRepo(repo.id, updated)
      notify('success', 'Repositório vinculado!', `Pasta: ${path}`)
      setScanResults((prev) => prev ? prev.filter((r) => r.repo.id !== repo.id) : null)
      await checkAndOfferGithubImport(repo.id, path)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro ao vincular', msg)
    }
  }

  // Unique owners for filter
  const owners = Array.from(new Set(repos.map((r) => r.owner))).sort()

  const filteredRepos = repos.filter((r) => {
    if (!r.fullName.toLowerCase().includes(search.toLowerCase())) return false
    if (filterOwner !== 'all' && r.owner !== filterOwner) return false
    if (filterLocal === 'local' && !r.localPath) return false
    if (filterLocal === 'no-local' && r.localPath) return false
    return true
  })

  // Group filtered repos by owner
  const reposByOwner = filteredRepos.reduce<Record<string, Repo[]>>((acc, r) => {
    if (!acc[r.owner]) acc[r.owner] = []
    acc[r.owner].push(r)
    return acc
  }, {})
  const ownerGroups = Object.keys(reposByOwner).sort()

  const filteredGitHub = githubRepos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  )
  const alreadyAdded = new Set(repos.map((r) => r.id))

  return (
    <div className="h-full flex flex-col">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="border-b border-border px-6 py-4 bg-card/30">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-semibold">Repositórios</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {repos.length} repositório{repos.length !== 1 ? 's' : ''} monitorado{repos.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {repos.some((r) => !r.localPath) && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[13px]"
                onClick={handleScanAll}
                disabled={isScanning}
              >
                {isScanning
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ScanLine className="h-3.5 w-3.5" />
                }
                Detectar local
              </Button>
            )}
            <Button onClick={handleOpenAddDialog} size="sm" className="h-8 text-[13px]">
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
          </div>
        </div>
      </div>

      {/* ── Search + Filters ──────────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-border bg-card/10 flex flex-wrap items-center gap-3">
        <div className="relative max-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar repositório..."
            className="h-8 pl-8 text-[13px] bg-input/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Owner filter */}
        {owners.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterOwner('all')}
              className={cn(
                'h-7 rounded px-2.5 text-[12px] font-medium transition-colors',
                filterOwner === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              Todos
            </button>
            {owners.map((owner) => (
              <button
                key={owner}
                onClick={() => setFilterOwner(owner === filterOwner ? 'all' : owner)}
                className={cn(
                  'h-7 rounded px-2.5 text-[12px] font-medium transition-colors',
                  filterOwner === owner
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {owner}
              </button>
            ))}
          </div>
        )}

        {/* Local filter */}
        <div className="flex items-center gap-1 ml-auto">
          {(['all', 'local', 'no-local'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterLocal(f)}
              className={cn(
                'h-7 rounded px-2.5 text-[12px] font-medium transition-colors',
                filterLocal === f
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f === 'all' ? 'Todos' : f === 'local' ? 'Com pasta' : 'Sem pasta'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Repo list ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {filteredRepos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
              <GitBranch className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="font-semibold">
              {repos.length === 0 ? 'Nenhum repositório' : 'Nenhum resultado'}
            </h3>
            <p className="text-[13px] text-muted-foreground mt-1">
              {repos.length === 0
                ? 'Adicione um repositório para começar a monitorar workflows'
                : 'Tente ajustar os filtros'}
            </p>
            {repos.length === 0 && (
              <Button className="mt-5 h-8 text-[13px]" onClick={handleOpenAddDialog}>
                <Plus className="h-3.5 w-3.5" />
                Adicionar Repositório
              </Button>
            )}
          </div>
        ) : (
          <div>
            {ownerGroups.map((owner) => (
              <div key={owner}>
                {/* Owner group header */}
                <div className="flex items-center gap-2 px-6 py-2 bg-muted/20 border-b border-border sticky top-0 z-10">
                  <OwnerAvatar owner={owner} className="h-5 w-5 text-[9px] ring-1 ring-border" />
                  <span className="text-[12px] font-semibold text-foreground/70">{owner}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    {reposByOwner[owner].length} repo{reposByOwner[owner].length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {reposByOwner[owner].map((repo) => (
                    <RepoRow
                      key={repo.id}
                      repo={repo}
                      onClick={() => {
                        useRepoStore.getState().selectRepo(repo.id)
                        navigate(`/dashboard/${encodeURIComponent(repo.id)}`)
                      }}
                      onSync={() => handleSync(repo)}
                      onOpenFolder={() => handleOpenFolder(repo)}
                      onLinkFolder={() => handleLinkExisting(repo)}
                      onUnlink={() => handleUnlink(repo)}
                      onDeleteOrbit={() => setOrbitDeleteRepo(repo)}
                      onRemove={() => setDeleteConfirm(repo)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add from GitHub dialog ────────────────────────────────────────── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
            <DialogTitle className="text-[15px]">Adicionar Repositório</DialogTitle>
            <DialogDescription className="text-[12px]">
              Selecione um repositório do GitHub para monitorar workflows
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-3 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar no GitHub..."
                className="h-8 pl-8 text-[13px]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {isLoadingGitHub ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredGitHub.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-muted-foreground">
                Nenhum repositório encontrado
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredGitHub.map((ghRepo) => {
                  const added = alreadyAdded.has(ghRepo.full_name)
                  const isCloning = cloningId === ghRepo.full_name
                  const isLinking = linkingId === ghRepo.full_name
                  return (
                    <div
                      key={ghRepo.full_name}
                      className={cn(
                        'flex items-center gap-3 px-5 py-3 hover:bg-accent/40 transition-colors',
                        added && 'opacity-50'
                      )}
                    >
                      <OwnerAvatar
                        src={ghRepo.owner.avatar_url}
                        owner={ghRepo.owner.login}
                        className="h-7 w-7 ring-1 ring-border shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {ghRepo.private
                            ? <Lock className="h-3 w-3 text-[#d29922] shrink-0" />
                            : <Globe className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                          }
                          <span className="font-medium text-[13px] truncate">{ghRepo.full_name}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                            {ghRepo.default_branch}
                          </Badge>
                        </div>
                        {ghRepo.description && (
                          <p className="text-[12px] text-muted-foreground truncate mt-0.5 ml-5">
                            {ghRepo.description}
                          </p>
                        )}
                      </div>

                      {added ? (
                        <Badge variant="secondary" className="shrink-0 text-[11px]">Adicionado</Badge>
                      ) : (
                        <div className="flex gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[12px] px-2.5"
                            onClick={() => handleLink(ghRepo)}
                            disabled={isLinking || isCloning}
                          >
                            {isLinking
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Link className="h-3.5 w-3.5" />
                            }
                            Vincular
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-[12px] px-2.5"
                            onClick={() => handleClone(ghRepo)}
                            disabled={isCloning || isLinking}
                          >
                            {isCloning
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Download className="h-3.5 w-3.5" />
                            }
                            Clonar
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── .github import dialog ─────────────────────────────────────────── */}
      {githubImport && (
        <GithubImportDialog
          open={!!githubImport}
          localPath={githubImport.localPath}
          files={githubImport.files}
          onImport={handleImportGithubWorkflows}
          onSkip={() => setGithubImport(null)}
          onClose={() => setGithubImport(null)}
        />
      )}

      {/* ── Find local folder dialog ──────────────────────────────────────── */}
      {findLocal && (
        <FindLocalDialog
          open={!!findLocal}
          candidates={findLocal.candidates}
          onSelect={confirmFindLocalPath}
          onBrowse={browseFindLocalPath}
          onClose={() => setFindLocal(null)}
        />
      )}

      {/* ── Delete .orbit confirm ─────────────────────────────────────────── */}
      <Dialog open={!!orbitDeleteRepo} onOpenChange={() => setOrbitDeleteRepo(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Excluir pasta .orbit</DialogTitle>
            <DialogDescription className="text-[13px]">
              Tem certeza? Isso removerá todos os workflows e artefatos locais de{' '}
              <strong>{orbitDeleteRepo?.fullName}</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOrbitDeleteRepo(null)} className="text-[12px]">
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => orbitDeleteRepo && handleDeleteOrbit(orbitDeleteRepo)}
              className="text-[12px]"
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove from OrbitCI confirm ───────────────────────────────────── */}
      {deleteConfirm && (
        <DeleteConfirmDialog
          open={!!deleteConfirm}
          repoName={deleteConfirm.fullName}
          onConfirm={() => handleRemove(deleteConfirm)}
          onClose={() => setDeleteConfirm(null)}
        />
      )}

      {/* ── Scan results dialog ────────────────────────────────────────────── */}
      {scanResults !== null && (
        <ScanResultsDialog
          open={true}
          results={scanResults}
          onLink={handleScanLink}
          onClose={() => setScanResults(null)}
        />
      )}
    </div>
  )
}
