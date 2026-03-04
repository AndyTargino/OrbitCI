import { useEffect, useState } from 'react'
import {
  GitCommit, Loader2, RotateCcw, GitMerge, Copy, MoreHorizontal, ChevronDown
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatRelativeTime } from '@/lib/utils'
import { notify } from '@/lib/notify'
import { useRepoDetail } from './RepoDetail'
import type { GitCommit as GitCommitType } from '@shared/types'

const LOAD_SIZE = 50

export function RepoHistory(): JSX.Element {
  const { repoId, refreshGitStatus } = useRepoDetail()
  const { repos } = useRepoStore()
  const repo = repos.find((r) => r.id === repoId)

  const [commits, setCommits] = useState<GitCommitType[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [limit, setLimit] = useState(LOAD_SIZE)
  const [hasMore, setHasMore] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  useEffect(() => {
    if (!repoId || !repo?.localPath) return
    loadCommits(LOAD_SIZE, true)
  }, [repoId, repo?.localPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadCommits = async (count: number, reset = false) => {
    setIsLoading(true)
    try {
      const result = await electron.git.log(repoId, count)
      setCommits(reset ? result : result)
      setHasMore(result.length === count)
      setLimit(count)
    } catch { /* git unavailable */ } finally {
      setIsLoading(false)
    }
  }

  const handleLoadMore = () => {
    const next = limit + LOAD_SIZE
    loadCommits(next)
  }

  const handleRevert = async (sha: string, message: string) => {
    setActionInProgress(sha)
    try {
      await electron.git.revert(repoId, sha)
      notify('success', 'Revert concluído', `Commit ${sha.slice(0, 7)} revertido`)
      await loadCommits(limit, true)
      await refreshGitStatus()
    } catch (err: unknown) {
      notify('failure', 'Erro ao reverter', err instanceof Error ? err.message : 'Erro')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleCherryPick = async (sha: string) => {
    setActionInProgress(sha)
    try {
      await electron.git.cherryPick(repoId, sha)
      notify('success', 'Cherry-pick concluído', `Commit ${sha.slice(0, 7)} aplicado`)
      await loadCommits(limit, true)
      await refreshGitStatus()
    } catch (err: unknown) {
      notify('failure', 'Erro no cherry-pick', err instanceof Error ? err.message : 'Erro')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha).then(() => {
      notify('success', 'SHA copiado', sha)
    }).catch(() => {})
  }

  if (!repo?.localPath) {
    return (
      <EmptyState
        icon={GitCommit}
        title="Sem pasta local"
        description="Vincule uma pasta local ao repositório para ver o histórico de commits"
        className="h-full"
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-6 py-2.5 border-b border-border bg-card/20 flex items-center justify-between shrink-0">
        <span className="text-[12px] text-muted-foreground">
          {commits.length > 0
            ? `${commits.length} commit${commits.length !== 1 ? 's' : ''} carregado${commits.length !== 1 ? 's' : ''}`
            : 'Histórico de commits'}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[12px] px-2.5 gap-1.5"
          onClick={() => loadCommits(limit, true)}
          disabled={isLoading}
        >
          <Loader2 className={isLoading ? 'h-3 w-3 animate-spin' : 'hidden'} />
          Atualizar
        </Button>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {isLoading && commits.length === 0 ? (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[13px]">Carregando histórico...</span>
          </div>
        ) : commits.length === 0 ? (
          <EmptyState
            icon={GitCommit}
            title="Nenhum commit encontrado"
            description="O histórico do repositório está vazio"
          />
        ) : (
          <>
            <div className="divide-y divide-border">
              {commits.map((commit) => {
                const isPending = actionInProgress === commit.hash
                return (
                  <div key={commit.hash} className="flex items-start gap-3 px-5 py-3 group hover:bg-accent/20 transition-colors">
                    {/* Visual commit line */}
                    <div className="flex flex-col items-center mt-1 shrink-0">
                      <GitCommit className="h-3.5 w-3.5 text-primary/50" />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground leading-snug line-clamp-2">
                        {commit.message}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                        <code className="font-mono text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded text-[10px]">
                          {commit.hash.slice(0, 7)}
                        </code>
                        <span>{commit.author}</span>
                        <span>{formatRelativeTime(commit.date)}</span>
                      </div>
                    </div>

                    {/* Actions dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          disabled={isPending}
                        >
                          {isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 text-[13px]">
                        <DropdownMenuItem onClick={() => handleCopySha(commit.hash)}>
                          <Copy className="h-3.5 w-3.5 mr-2" />
                          Copiar SHA
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleCherryPick(commit.hash)}>
                          <GitMerge className="h-3.5 w-3.5 mr-2" />
                          Cherry-pick
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleRevert(commit.hash, commit.message)}
                          className="text-destructive focus:text-destructive"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-2" />
                          Reverter
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
            </div>

            {/* Load more footer */}
            <div className="flex items-center justify-center py-4 border-t border-border/30">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : hasMore ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[12px] px-4 gap-1.5"
                  onClick={handleLoadMore}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  Carregar mais
                </Button>
              ) : (
                <span className="text-[11px] text-muted-foreground/50">
                  {commits.length} commit{commits.length !== 1 ? 's' : ''} no total
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
