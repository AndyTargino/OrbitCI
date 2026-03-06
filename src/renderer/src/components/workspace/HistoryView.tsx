import React, { useCallback, useEffect, useState } from 'react'
import {
  Copy, GitCommitHorizontal, ChevronDown, ChevronRight, CherryIcon, Undo2,
  File, Loader2
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { cn, formatRelativeTime } from '@/lib/utils'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '@/components/ui/tooltip'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger
} from '@/components/ui/context-menu'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import type { GitCommit } from '@shared/types'
import { useTranslation } from 'react-i18next'

// ── Diff parser ──────────────────────────────────────────────────────────────

interface DiffLine {
  type: 'header' | 'hunk' | 'add' | 'del' | 'ctx' | 'meta'
  content: string
  lineNum?: { old?: number; new?: number }
}

interface FileDiff {
  filename: string
  status: 'M' | 'A' | 'D' | 'R' | 'C'
  lines: DiffLine[]
  additions: number
  deletions: number
}

const STATUS_COLORS: Record<string, string> = {
  M: '#e2c08d',
  A: '#73c991',
  D: '#c74e39',
  R: '#73c991',
  C: '#73c991',
}

const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f1e05a', jsx: '#f1e05a',
  json: '#f1e05a', css: '#563d7c', scss: '#c6538c', html: '#e34c26',
  md: '#519aba', yml: '#cb171e', yaml: '#cb171e', svg: '#ffb13b',
  png: '#a074c4', jpg: '#a074c4', gif: '#a074c4', ico: '#a074c4',
  lock: '#6a737d', sh: '#89e051', bash: '#89e051',
  py: '#3572a5', go: '#00add8', rs: '#dea584', rb: '#701516',
  vue: '#41b883', sql: '#e38c00',
}

function getFileIconColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_COLORS[ext] ?? '#8b949e'
}

function parseFullDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = []
  const fileSections = raw.split(/(?=^diff --git )/m)

  for (const section of fileSections) {
    if (!section.startsWith('diff --git')) continue

    // Extract filename from diff header
    const nameMatch = section.match(/^diff --git a\/(.*?) b\/(.*)$/m)
    const filename = nameMatch?.[2] ?? nameMatch?.[1] ?? 'unknown'

    // Detect status
    let status: FileDiff['status'] = 'M'
    if (section.includes('new file mode')) status = 'A'
    else if (section.includes('deleted file mode')) status = 'D'
    else if (section.includes('rename from')) status = 'R'
    else if (section.includes('copy from')) status = 'C'

    const lines: DiffLine[] = []
    let oldLine = 0
    let newLine = 0
    let additions = 0
    let deletions = 0

    for (const line of section.split('\n')) {
      if (line.startsWith('diff --git') || line.startsWith('index ') ||
          line.startsWith('--- ') || line.startsWith('+++ ') ||
          line.startsWith('old mode') || line.startsWith('new mode') ||
          line.startsWith('deleted file mode') || line.startsWith('new file mode') ||
          line.startsWith('rename from') || line.startsWith('rename to') ||
          line.startsWith('similarity index') || line.startsWith('copy from') ||
          line.startsWith('copy to') || line.startsWith('Binary files')) {
        continue
      }
      if (line.startsWith('@@')) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
        if (m) { oldLine = parseInt(m[1]); newLine = parseInt(m[2]) }
        lines.push({ type: 'hunk', content: line })
      } else if (line.startsWith('+')) {
        additions++
        lines.push({ type: 'add', content: line.slice(1), lineNum: { new: newLine++ } })
      } else if (line.startsWith('-')) {
        deletions++
        lines.push({ type: 'del', content: line.slice(1), lineNum: { old: oldLine++ } })
      } else if (line === '\\ No newline at end of file') {
        lines.push({ type: 'meta', content: line })
      } else if (line === '') {
        // skip empty
      } else {
        lines.push({ type: 'ctx', content: line.slice(1), lineNum: { old: oldLine++, new: newLine++ } })
      }
    }

    files.push({ filename, status, lines, additions, deletions })
  }

  return files
}

// ── File Diff Viewer ────────────────────────────────────────────────────────

function FileDiffViewer({ fileDiff }: { fileDiff: FileDiff }) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const { filename, status, lines, additions, deletions } = fileDiff
  const iconColor = getFileIconColor(filename)
  const shortName = filename.split('/').pop() ?? filename
  const dir = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/')) : ''

  return (
    <div className="border border-border rounded-md overflow-hidden">
      {/* File header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        }
        <File className="h-3.5 w-3.5 shrink-0" style={{ color: iconColor }} />
        <span className="text-[12px] font-medium truncate">{shortName}</span>
        {dir && <span className="text-[11px] text-muted-foreground/60 truncate">{dir}/</span>}
        <span
          className="text-[11px] font-medium ml-1 shrink-0"
          style={{ color: STATUS_COLORS[status] ?? '#8b949e' }}
        >
          {status}
        </span>
        <div className="ml-auto flex items-center gap-1 text-[11px] shrink-0">
          {additions > 0 && <span className="text-green-400">+{additions}</span>}
          {deletions > 0 && <span className="text-red-400">-{deletions}</span>}
        </div>
      </button>

      {/* Diff content */}
      {!collapsed && lines.length > 0 && (
        <div className="overflow-x-auto text-[12px] font-mono leading-5">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((l, i) => {
                if (l.type === 'hunk') {
                  return (
                    <tr key={i} className="bg-blue-500/8">
                      <td className="w-10 px-2 select-none border-r border-border/30" />
                      <td className="w-10 px-2 select-none border-r border-border/30" />
                      <td className="px-4 py-0.5 text-[11px] text-blue-400/75">{l.content}</td>
                    </tr>
                  )
                }
                if (l.type === 'meta') {
                  return (
                    <tr key={i}>
                      <td colSpan={3} className="px-4 py-0.5 text-[10px] italic text-muted-foreground/40">
                        {l.content}
                      </td>
                    </tr>
                  )
                }

                const isAdd = l.type === 'add'
                const isDel = l.type === 'del'

                return (
                  <tr
                    key={i}
                    className={cn(
                      isAdd && 'bg-green-500/10',
                      isDel && 'bg-red-500/10'
                    )}
                  >
                    <td
                      className="w-10 text-right text-[10px] px-2 select-none border-r border-border/20"
                      style={{ color: isDel ? 'rgba(248,113,113,0.5)' : 'rgba(140,148,158,0.4)' }}
                    >
                      {l.lineNum?.old ?? ''}
                    </td>
                    <td
                      className="w-10 text-right text-[10px] px-2 select-none border-r border-border/20"
                      style={{ color: isAdd ? 'rgba(74,222,128,0.5)' : 'rgba(140,148,158,0.4)' }}
                    >
                      {l.lineNum?.new ?? ''}
                    </td>
                    <td className="px-2 py-px whitespace-pre-wrap break-all">
                      <span
                        className="mr-2 select-none text-[11px] font-semibold"
                        style={{ color: isAdd ? '#4ade80' : isDel ? '#f87171' : 'transparent' }}
                      >
                        {isAdd ? '+' : isDel ? '\u2212' : ' '}
                      </span>
                      <span style={{ color: isAdd ? '#4ade80' : isDel ? '#f87171' : undefined }}>
                        {l.content}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!collapsed && lines.length === 0 && (
        <div className="px-4 py-3 text-[12px] text-muted-foreground/50 italic">
          {t('workspace.history.binary_or_empty', 'Binary file or empty diff')}
        </div>
      )}
    </div>
  )
}

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 40

// ── HistoryView ──────────────────────────────────────────────────────────────

interface Props {
  repoId: string
}

export function HistoryView({ repoId }: Props): JSX.Element {
  const { t } = useTranslation()
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [selected, setSelected] = useState<GitCommit | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([])
  const [diffLoading, setDiffLoading] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState<GitCommit | null>(null)
  const [confirmCherryPick, setConfirmCherryPick] = useState<GitCommit | null>(null)

  // ── initial load ───────────────────────────────────────────────────────────

  const loadCommits = useCallback(
    async (offset: number) => {
      setLoading(true)
      try {
        const result = await electron.git.log(repoId, PAGE_SIZE + offset)
        const sliced = result.slice(offset)
        if (sliced.length < PAGE_SIZE) setHasMore(false)
        setCommits((prev) => (offset === 0 ? sliced : [...prev, ...sliced]))
      } catch {
        notify('failure', t('workspace.history.error_load', 'Failed to load commit history'))
      } finally {
        setLoading(false)
      }
    },
    [repoId],
  )

  useEffect(() => {
    setCommits([])
    setSelected(null)
    setFileDiffs([])
    setHasMore(true)
    loadCommits(0)
  }, [repoId, loadCommits])

  const handleLoadMore = () => {
    if (!loading && hasMore) loadCommits(commits.length)
  }

  // ── select commit ──────────────────────────────────────────────────────────

  const handleSelect = async (commit: GitCommit) => {
    setSelected(commit)
    setFileDiffs([])
    setDiffLoading(true)
    try {
      const raw = await electron.git.showCommit(repoId, commit.hash)
      setFileDiffs(parseFullDiff(raw))
    } catch {
      setFileDiffs([])
    } finally {
      setDiffLoading(false)
    }
  }

  // ── actions ────────────────────────────────────────────────────────────────

  const copySha = (commit?: GitCommit) => {
    const c = commit ?? selected
    if (!c) return
    navigator.clipboard.writeText(c.hash)
    notify('success', t('workspace.history.sha_copied', 'SHA copied to clipboard'))
  }

  const askCherryPick = (commit?: GitCommit) => {
    const c = commit ?? selected
    if (c) setConfirmCherryPick(c)
  }

  const executeCherryPick = async () => {
    if (!confirmCherryPick) return
    try {
      await electron.git.cherryPick(repoId, confirmCherryPick.hash)
      notify('success', t('workspace.history.cherry_pick_applied', 'Cherry pick applied'), confirmCherryPick.hash.slice(0, 7))
    } catch {
      notify('failure', t('workspace.history.cherry_pick_failed', 'Cherry pick failed'))
    }
  }

  const askRevert = (commit?: GitCommit) => {
    const c = commit ?? selected
    if (c) setConfirmRevert(c)
  }

  const executeRevert = async () => {
    if (!confirmRevert) return
    try {
      await electron.git.revert(repoId, confirmRevert.hash)
      notify('success', t('workspace.history.revert_applied', 'Commit reverted'), confirmRevert.hash.slice(0, 7))
    } catch {
      notify('failure', t('workspace.history.revert_failed', 'Revert failed'))
    }
  }

  const totalAdditions = fileDiffs.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = fileDiffs.reduce((s, f) => s + f.deletions, 0)

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={400}>
      <>
        {/* Left sidebar — commit list */}
        <div className="w-[300px] shrink-0 flex flex-col border-r border-border">
          <ScrollArea className="flex-1">
            <div className="divide-y divide-border">
              {commits.map((c) => (
                <ContextMenu key={c.hash}>
                  <ContextMenuTrigger asChild>
                    <button
                      onClick={() => handleSelect(c)}
                      className={cn(
                        'w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors',
                        selected?.hash === c.hash && 'bg-accent',
                      )}
                    >
                      <p className="text-[13px] text-foreground truncate leading-snug">{c.message}</p>
                      <div className="flex items-center justify-between mt-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <code className="text-[11px] font-mono text-muted-foreground">
                            {c.hash.slice(0, 7)}
                          </code>
                          <span className="text-[11px] text-muted-foreground/70 truncate">
                            {c.author}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground/50 shrink-0 ml-2">
                          {formatRelativeTime(c.date)}
                        </span>
                      </div>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52">
                    <ContextMenuItem onClick={() => copySha(c)}>
                      <Copy className="w-3.5 h-3.5 mr-2" />
                      {t('workspace.history.copy_sha', 'Copy SHA')}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        navigator.clipboard.writeText(c.message)
                        notify('success', t('workspace.history.message_copied', 'Message copied'))
                      }}
                    >
                      <Copy className="w-3.5 h-3.5 mr-2" />
                      {t('workspace.history.copy_message', 'Copy commit message')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => askCherryPick(c)}>
                      <CherryIcon className="w-3.5 h-3.5 mr-2" />
                      {t('workspace.history.cherry_pick_btn', 'Cherry pick commit')}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => askRevert(c)}>
                      <Undo2 className="w-3.5 h-3.5 mr-2" />
                      {t('workspace.history.revert_btn', 'Revert commit')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>

            {hasMore && (
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-[12px]"
                  disabled={loading}
                  onClick={handleLoadMore}
                >
                  <ChevronDown className="w-3.5 h-3.5 mr-1" />
                  {loading ? t('common.loading', 'Loading...') : t('common.load_more', 'Load more')}
                </Button>
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right content — commit details */}
        <div className="flex-1 min-w-0 overflow-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <GitCommitHorizontal className="w-10 h-10 opacity-30" />
              <p className="text-[13px]">{t('workspace.history.select_prompt', 'Select a commit to see details')}</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* Commit header */}
              <div className="space-y-2">
                <p className="text-[14px] text-foreground font-medium leading-snug">
                  {selected.message}
                </p>
                <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">{selected.author}</span>
                  <span>{formatRelativeTime(selected.date)}</span>
                  <code className="text-[11px] font-mono text-muted-foreground/60 select-all">
                    {selected.hash}
                  </code>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => copySha()}>
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      {t('workspace.history.copy_sha', 'Copy SHA')}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('workspace.history.copy_sha_tooltip', 'Copy full commit hash')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => askCherryPick()}>
                      <CherryIcon className="w-3.5 h-3.5 mr-1" />
                      {t('workspace.history.cherry_pick_action', 'Cherry Pick')}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('workspace.history.cherry_pick_tooltip', 'Apply this commit to the current branch')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => askRevert()}>
                      <Undo2 className="w-3.5 h-3.5 mr-1" />
                      {t('workspace.history.revert_action', 'Revert')}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('workspace.history.revert_tooltip', 'Create a new commit that undoes this commit')}</TooltipContent>
                </Tooltip>
              </div>

              {/* File changes summary */}
              {diffLoading ? (
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('workspace.history.loading_changes', 'Loading changes...')}
                </div>
              ) : fileDiffs.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-[12px]">
                    <span className="text-muted-foreground font-medium">
                      {t('workspace.history.files_changed', { count: fileDiffs.length, defaultValue: `${fileDiffs.length} file(s) changed` })}
                    </span>
                    {totalAdditions > 0 && (
                      <span className="text-green-400 font-medium">+{totalAdditions}</span>
                    )}
                    {totalDeletions > 0 && (
                      <span className="text-red-400 font-medium">-{totalDeletions}</span>
                    )}
                  </div>

                  {/* Per-file diffs */}
                  {fileDiffs.map((fd, i) => (
                    <FileDiffViewer key={`${fd.filename}-${i}`} fileDiff={fd} />
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">{t('workspace.history.no_diff', 'No diff available for this commit.')}</p>
              )}
            </div>
          )}
        </div>
      </>

      <ConfirmDialog
        open={confirmRevert !== null}
        onOpenChange={(open) => { if (!open) setConfirmRevert(null) }}
        title={t('workspace.history.revert_title', 'Revert commit')}
        description={t('workspace.history.revert_desc', { message: confirmRevert?.message?.slice(0, 60), defaultValue: `A new commit will be created that undoes the changes from "${confirmRevert?.message?.slice(0, 60)}".` })}
        consequences={[
          t('workspace.history.revert_cons1', 'A new revert commit will be added to the history'),
          t('workspace.history.revert_cons2', 'If there are conflicts, you will need to resolve them manually'),
          t('workspace.history.revert_cons3', 'Changes from the original commit will be undone in the current branch')
        ]}
        confirmLabel={t('common.revert', 'Revert')}
        variant="warning"
        onConfirm={executeRevert}
      />

      <ConfirmDialog
        open={confirmCherryPick !== null}
        onOpenChange={(open) => { if (!open) setConfirmCherryPick(null) }}
        title={t('workspace.history.cherry_pick_title', 'Cherry-pick commit')}
        description={t('workspace.history.cherry_pick_desc', { message: confirmCherryPick?.message?.slice(0, 60), defaultValue: `Changes from commit "${confirmCherryPick?.message?.slice(0, 60)}" will be applied to the current branch.` })}
        consequences={[
          t('workspace.history.cherry_pick_cons1', 'A new commit will be created on the current branch with the same changes'),
          t('workspace.history.cherry_pick_cons2', 'If there are conflicts, you will need to resolve them manually'),
          t('workspace.history.cherry_pick_cons3', 'The original commit remains unchanged in its source branch')
        ]}
        confirmLabel={t('common.apply', 'Apply')}
        variant="warning"
        onConfirm={executeCherryPick}
      />
    </TooltipProvider>
  )
}
