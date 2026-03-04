import { useState, useCallback } from 'react'
import {
  GitCommit, GitBranch, ArrowUp, ArrowDown, RefreshCw, Loader2,
  ChevronDown, ChevronRight, Minus, Plus, GitMerge
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { GitStatus, GitFile } from '@shared/types'

// ── Diff renderer ─────────────────────────────────────────────────────────────
interface DiffLine {
  type: 'header' | 'hunk' | 'add' | 'del' | 'ctx' | 'meta'
  content: string
  lineNum?: { old?: number; new?: number }
}

// Special git lines that aren't part of the hunk diff body
const GIT_META_PREFIXES = [
  'diff --git', 'index ', '--- ', '+++ ',
  'old mode', 'new mode', 'deleted file mode', 'new file mode',
  'rename from', 'rename to', 'similarity index', 'copy from', 'copy to',
  'Binary files'
]

function parseDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const line of raw.split('\n')) {
    if (GIT_META_PREFIXES.some((p) => line.startsWith(p))) {
      lines.push({ type: 'header', content: line })
    } else if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) { oldLine = parseInt(m[1]); newLine = parseInt(m[2]) }
      lines.push({ type: 'hunk', content: line })
    } else if (line.startsWith('+')) {
      lines.push({ type: 'add', content: line.slice(1), lineNum: { new: newLine++ } })
    } else if (line.startsWith('-')) {
      lines.push({ type: 'del', content: line.slice(1), lineNum: { old: oldLine++ } })
    } else if (line === '\\ No newline at end of file') {
      lines.push({ type: 'meta', content: line })
    } else if (line === '') {
      // skip blank trailing lines
    } else {
      // context line — starts with a space
      lines.push({ type: 'ctx', content: line.slice(1), lineNum: { old: oldLine++, new: newLine++ } })
    }
  }
  return lines
}

// Colours — defined as plain values so they always render (Tailwind can't
// generate opacity variants for arbitrary hex values at runtime).
const CLR = {
  addBg:    'rgba(46, 160, 67, 0.15)',
  addText:  '#3fb950',
  addNum:   'rgba(63, 185, 80, 0.5)',
  delBg:    'rgba(248, 81, 73, 0.15)',
  delText:  '#f85149',
  delNum:   'rgba(248, 81, 73, 0.5)',
  hunkBg:   'rgba(88, 166, 255, 0.08)',
  hunkText: 'rgba(88, 166, 255, 0.75)',
  numDim:   'rgba(140, 148, 158, 0.4)',
}

function DiffViewer({ diff, filename }: { diff: string; filename: string }): JSX.Element {
  const lines = parseDiff(diff)
  const hasContent = lines.some((l) => l.type !== 'header')

  if (!diff.trim() || !hasContent) {
    return (
      <div className="flex items-center justify-center h-full text-[12px] text-muted-foreground">
        Sem diferenças para mostrar
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto font-mono text-[12px] leading-[1.5]">
      <div className="sticky top-0 z-10 px-4 py-1.5 border-b border-border bg-[#0d1117] text-[11px] text-muted-foreground">
        {filename}
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => {
            if (line.type === 'header') return null

            if (line.type === 'hunk') {
              return (
                <tr key={i} style={{ backgroundColor: CLR.hunkBg }}>
                  <td className="w-10 px-2 select-none border-r border-white/5" />
                  <td className="w-10 px-2 select-none border-r border-white/5" />
                  <td className="px-4 py-0.5 text-[11px]" style={{ color: CLR.hunkText }}>
                    {line.content}
                  </td>
                </tr>
              )
            }

            if (line.type === 'meta') {
              return (
                <tr key={i}>
                  <td colSpan={3} className="px-4 py-0.5 text-[10px] italic" style={{ color: CLR.numDim }}>
                    {line.content}
                  </td>
                </tr>
              )
            }

            const isAdd = line.type === 'add'
            const isDel = line.type === 'del'
            const rowBg = isAdd ? CLR.addBg : isDel ? CLR.delBg : undefined
            const markerColor = isAdd ? CLR.addText : isDel ? CLR.delText : 'transparent'
            const textColor   = isAdd ? CLR.addText : isDel ? CLR.delText : undefined

            return (
              <tr key={i} style={rowBg ? { backgroundColor: rowBg } : undefined}>
                {/* old line number */}
                <td
                  className="w-10 text-right text-[10px] px-2 select-none border-r"
                  style={{
                    color: isDel ? CLR.delNum : CLR.numDim,
                    borderColor: 'rgba(255,255,255,0.05)'
                  }}
                >
                  {line.lineNum?.old ?? ''}
                </td>
                {/* new line number */}
                <td
                  className="w-10 text-right text-[10px] px-2 select-none border-r"
                  style={{
                    color: isAdd ? CLR.addNum : CLR.numDim,
                    borderColor: 'rgba(255,255,255,0.05)'
                  }}
                >
                  {line.lineNum?.new ?? ''}
                </td>
                {/* content */}
                <td className="px-2 py-px whitespace-pre-wrap break-all">
                  <span
                    className="mr-2 select-none text-[11px] font-semibold"
                    style={{ color: markerColor }}
                  >
                    {isAdd ? '+' : isDel ? '−' : ' '}
                  </span>
                  <span style={textColor ? { color: textColor } : undefined}>
                    {line.content}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── File status badge ─────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; borderColor: string }> = {
  modified:  { label: 'M', color: 'text-[#d29922]', borderColor: '#d29922' },
  added:     { label: 'A', color: 'text-[#3fb950]', borderColor: '#3fb950' },
  deleted:   { label: 'D', color: 'text-[#f85149]', borderColor: '#f85149' },
  renamed:   { label: 'R', color: 'text-[#58a6ff]', borderColor: '#58a6ff' },
  untracked: { label: 'U', color: 'text-[#79c0ff]', borderColor: '#79c0ff' },
  copied:    { label: 'C', color: 'text-[#e3b341]', borderColor: '#e3b341' },
  unmerged:  { label: '!', color: 'text-[#f85149]', borderColor: '#f85149' },
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const s = STATUS_META[status] ?? STATUS_META.modified
  return (
    <span className={cn('text-[10px] font-bold w-3 shrink-0 text-right', s.color)}>
      {s.label}
    </span>
  )
}

// ── File row ──────────────────────────────────────────────────────────────────
function FileRow({
  file,
  isSelected,
  actionIcon,
  onAction,
  onClick
}: {
  file: GitFile
  isSelected: boolean
  actionIcon: 'stage' | 'unstage'
  onAction: () => void
  onClick: () => void
}): JSX.Element {
  const filename = file.path.split('/').pop() ?? file.path
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
  const borderColor = (STATUS_META[file.status] ?? STATUS_META.modified).borderColor

  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 pl-2 pr-3 py-[5px] cursor-pointer group select-none border-l-2',
        isSelected ? 'bg-sidebar-accent' : 'hover:bg-muted/30'
      )}
      style={{ borderLeftColor: borderColor }}
    >
      <StatusBadge status={file.status} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <span className="text-[12px] truncate block">{filename}</span>
        {dir && (
          <span className="text-[10px] text-muted-foreground/50 truncate block leading-tight">{dir}</span>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onAction() }}
        className={cn(
          'shrink-0 h-5 w-5 flex items-center justify-center rounded transition-all',
          'opacity-0 group-hover:opacity-100',
          actionIcon === 'stage'
            ? 'hover:bg-[#3fb950]/20 hover:text-[#3fb950]'
            : 'hover:bg-[#f85149]/20 hover:text-[#f85149]'
        )}
        title={actionIcon === 'stage' ? 'Adicionar ao stage' : 'Remover do stage'}
      >
        {actionIcon === 'stage'
          ? <Plus className="h-3.5 w-3.5" />
          : <Minus className="h-3.5 w-3.5" />
        }
      </button>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({
  label,
  count,
  collapsed,
  onToggle,
  action,
  accent
}: {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
  action?: { label: string; onClick: () => void }
  accent?: string
}): JSX.Element {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-muted/20 select-none group"
      onClick={onToggle}
    >
      {collapsed
        ? <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        : <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      }
      {accent && (
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
      )}
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex-1">
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground/50 mr-1">{count}</span>
      {action && (
        <button
          onClick={(e) => { e.stopPropagation(); action.onClick() }}
          className="text-[10px] text-muted-foreground/60 hover:text-foreground px-1.5 py-0.5 rounded border border-border/60 hover:border-border hover:bg-muted transition-all"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  repoId: string
  gitStatus: GitStatus | null
  onRefresh: () => void
}

export function GitPanel({ repoId, gitStatus, onRefresh }: Props): JSX.Element {
  const [commitMsg, setCommitMsg] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [stagedCollapsed, setStagedCollapsed] = useState(false)
  const [changesCollapsed, setChangesCollapsed] = useState(false)

  const selectFile = useCallback(async (path: string) => {
    setSelectedFile(path)
    setIsDiffLoading(true)
    try {
      const d = await electron.git.diff(repoId, path)
      setDiff(d ?? '')
    } catch {
      setDiff('')
    } finally {
      setIsDiffLoading(false)
    }
  }, [repoId])

  const refreshWithStatus = useCallback(async () => {
    onRefresh()
    if (selectedFile) {
      const d = await electron.git.diff(repoId, selectedFile).catch(() => '')
      setDiff(d ?? '')
    }
  }, [onRefresh, repoId, selectedFile])

  const handleStage = async (file: string) => {
    await electron.git.stage(repoId, [file])
    refreshWithStatus()
  }

  const handleUnstage = async (file: string) => {
    await electron.git.unstage(repoId, [file])
    refreshWithStatus()
  }

  const handleStageAll = async () => {
    await electron.git.stageAll(repoId)
    refreshWithStatus()
  }

  const handleCommit = async (): Promise<boolean> => {
    if (!commitMsg.trim() || !gitStatus?.staged.length) return false
    setIsCommitting(true)
    try {
      const result = await electron.git.commit(repoId, commitMsg.trim())
      notify('success', 'Commit realizado!', `${result.sha.slice(0, 7)} · ${commitMsg.trim().slice(0, 60)}`)
      setCommitMsg('')
      setSelectedFile(null)
      setDiff('')
      onRefresh()
      return true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro no commit', msg)
      return false
    } finally {
      setIsCommitting(false)
    }
  }

  const handleCommitAndPush = async () => {
    const ok = await handleCommit()
    if (!ok) return
    setIsPushing(true)
    try {
      await electron.git.push(repoId)
      notify('success', 'Push realizado!')
      onRefresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro no push', msg)
    } finally {
      setIsPushing(false)
    }
  }

  const handlePush = async () => {
    setIsPushing(true)
    try {
      await electron.git.push(repoId)
      notify('success', 'Push realizado!')
      onRefresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro no push', msg)
    } finally {
      setIsPushing(false)
    }
  }

  const handlePull = async () => {
    setIsPulling(true)
    try {
      await electron.git.pull(repoId)
      notify('success', 'Pull realizado!')
      onRefresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro no pull', msg)
    } finally {
      setIsPulling(false)
    }
  }

  const handleFetch = async () => {
    setIsFetching(true)
    try {
      await electron.git.fetch(repoId)
      notify('success', 'Fetch realizado!')
      onRefresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      notify('failure', 'Erro no fetch', msg)
    } finally {
      setIsFetching(false)
    }
  }

  if (!gitStatus) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-[13px]">Carregando repositório...</span>
      </div>
    )
  }

  const allChanges = [...gitStatus.unstaged, ...gitStatus.untracked]
  const hasStaged = gitStatus.staged.length > 0
  const hasChanges = allChanges.length > 0
  const totalChanges = gitStatus.staged.length + allChanges.length
  const isBusy = isCommitting || isPushing || isPulling || isFetching

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Branch / remote bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card/30 shrink-0">
        <GitBranch className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-[13px] font-medium text-foreground">{gitStatus.branch}</span>
        {gitStatus.tracking && (
          <span className="text-[11px] text-muted-foreground">→ {gitStatus.tracking}</span>
        )}
        {gitStatus.ahead > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-[#3fb950] font-medium">
            <ArrowUp className="h-3 w-3" />{gitStatus.ahead}
          </span>
        )}
        {gitStatus.behind > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-[#d29922] font-medium">
            <ArrowDown className="h-3 w-3" />{gitStatus.behind}
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="outline" size="sm"
            className="h-6 px-2 text-[11px] gap-1 border-border/60 hover:border-[#58a6ff]/50 hover:text-[#58a6ff] hover:bg-[#58a6ff]/10"
            onClick={handlePull} disabled={isBusy}
          >
            {isPulling ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDown className="h-3 w-3" />}
            Pull
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-6 px-2 text-[11px] gap-1 border-border/60 hover:border-[#3fb950]/50 hover:text-[#3fb950] hover:bg-[#3fb950]/10"
            onClick={handlePush} disabled={isBusy}
          >
            {isPushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUp className="h-3 w-3" />}
            Push
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-6 px-2 text-[11px] gap-1 border-border/60 hover:border-border"
            onClick={handleFetch} disabled={isBusy}
          >
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
            Fetch
          </Button>
          <Button
            variant="ghost" size="sm"
            className="h-6 w-6 p-0"
            onClick={refreshWithStatus} disabled={isBusy}
          >
            <RefreshCw className={cn('h-3 w-3', isBusy && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* ── Main body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Left: file list + commit */}
        <div className="w-[280px] shrink-0 border-r border-border flex flex-col">
          {/* File sections */}
          <div className="flex-1 overflow-auto">
            {totalChanges === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <GitCommit className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-[12px] text-muted-foreground">Sem alterações pendentes</p>
                <p className="text-[11px] text-muted-foreground/50 mt-1">
                  Todos os arquivos estão sincronizados
                </p>
              </div>
            ) : (
              <>
                {/* Staged */}
                <SectionHeader
                  label="Staged"
                  count={gitStatus.staged.length}
                  collapsed={stagedCollapsed}
                  onToggle={() => setStagedCollapsed((v) => !v)}
                  accent="#3fb950"
                  action={hasStaged ? { label: '− Tudo', onClick: async () => {
                    for (const f of gitStatus.staged) {
                      await electron.git.unstage(repoId, [f.path])
                    }
                    refreshWithStatus()
                  }} : undefined}
                />
                {!stagedCollapsed && (
                  <div>
                    {gitStatus.staged.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/40 px-7 py-2">Nenhum arquivo</p>
                    ) : gitStatus.staged.map((file) => (
                      <FileRow
                        key={file.path}
                        file={file}
                        isSelected={selectedFile === file.path}
                        actionIcon="unstage"
                        onAction={() => handleUnstage(file.path)}
                        onClick={() => selectFile(file.path)}
                      />
                    ))}
                  </div>
                )}

                {/* Changes */}
                <SectionHeader
                  label="Alterações"
                  count={allChanges.length}
                  collapsed={changesCollapsed}
                  onToggle={() => setChangesCollapsed((v) => !v)}
                  accent="#d29922"
                  action={hasChanges ? { label: '+ Tudo', onClick: handleStageAll } : undefined}
                />
                {!changesCollapsed && (
                  <div>
                    {allChanges.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/40 px-7 py-2">Sem alterações</p>
                    ) : allChanges.map((file) => (
                      <FileRow
                        key={file.path}
                        file={file}
                        isSelected={selectedFile === file.path}
                        actionIcon="stage"
                        onAction={() => handleStage(file.path)}
                        onClick={() => selectFile(file.path)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Commit area */}
          <div className="border-t border-border p-3 space-y-2 shrink-0">
            <Textarea
              placeholder={`Mensagem do commit... (Ctrl+Enter para confirmar)`}
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              className="h-[72px] resize-none text-[12px] leading-relaxed"
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === 'Enter') handleCommit()
              }}
            />
            <div className="flex gap-1.5">
              <Button
                className="flex-1 h-8 text-[12px]"
                onClick={handleCommit}
                disabled={!commitMsg.trim() || !hasStaged || isCommitting}
              >
                {isCommitting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <GitCommit className="h-3.5 w-3.5" />
                }
                Commit
              </Button>
              <Button
                variant="outline"
                className="h-8 text-[12px] px-3 border-primary/40 hover:border-primary/70 hover:bg-primary/10 hover:text-primary"
                onClick={handleCommitAndPush}
                disabled={!commitMsg.trim() || !hasStaged || isCommitting || isPushing}
                title="Commit e Push"
              >
                {(isCommitting || isPushing)
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ArrowUp className="h-3.5 w-3.5" />
                }
                + Push
              </Button>
            </div>
            {!hasStaged && totalChanges > 0 && (
              <p className="text-[10px] text-muted-foreground/50 text-center">
                Adicione arquivos ao stage para fazer commit
              </p>
            )}
          </div>
        </div>

        {/* Right: diff viewer */}
        <div className="flex-1 min-w-0 bg-[#0d1117]">
          {selectedFile ? (
            isDiffLoading ? (
              <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[12px]">Carregando diff...</span>
              </div>
            ) : (
              <DiffViewer diff={diff} filename={selectedFile} />
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="h-12 w-12 rounded-full bg-muted/30 flex items-center justify-center mb-3">
                <GitCommit className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <p className="text-[13px] text-muted-foreground">
                {totalChanges > 0
                  ? 'Clique em um arquivo para ver as alterações'
                  : 'Nenhuma alteração pendente'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
