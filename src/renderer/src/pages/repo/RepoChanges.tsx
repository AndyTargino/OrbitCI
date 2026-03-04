import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { electron } from '@/lib/electron'
import { GitPanel } from '@/components/GitPanel'
import { EmptyState } from '@/components/shared/EmptyState'
import { FolderOpen } from 'lucide-react'
import { useRepoStore } from '@/store'
import type { GitStatus } from '@shared/types'

export function RepoChanges(): JSX.Element {
  const { repoId } = useParams<{ repoId: string }>()
  const decodedId = decodeURIComponent(repoId ?? '')
  const repo = useRepoStore((s) => s.repos.find((r) => r.id === decodedId))
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStatus = useCallback(async () => {
    if (!decodedId || !repo?.localPath) return
    try {
      const status = await electron.git.status(decodedId)
      setGitStatus(status)
    } catch {
      setGitStatus(null)
    } finally {
      setLoading(false)
    }
  }, [decodedId, repo?.localPath])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  if (!repo?.localPath) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No local folder"
        description="Link a local folder to this repository to see changes"
      />
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-[13px]">Loading repository...</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-hidden">
      <GitPanel repoId={decodedId} gitStatus={gitStatus} onRefresh={loadStatus} />
    </div>
  )
}
