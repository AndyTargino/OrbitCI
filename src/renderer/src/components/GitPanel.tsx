import { useState, useCallback } from 'react'
import {
  GitCommit, GitBranch, ArrowUp, ArrowDown, RefreshCw, Loader2,
  ChevronDown, ChevronRight, Minus, Plus, GitMerge, Undo2,
  File
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
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

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'zip', 'tar', 'gz', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'mp3', 'mp4', 'wav', 'avi', 'mov',
  'exe', 'dll', 'so', 'dylib',
])

function isBinaryFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_EXTENSIONS.has(ext)
}

function DiffViewer({ diff, filename }: { diff: string; filename: string }): JSX.Element {
  const lines = parseDiff(diff)
  const hasContent = lines.some((l) => l.type !== 'header')
  const binary = isBinaryFile(filename) || diff.includes('Binary files')

  if (binary) {
    return (
      <div className="h-full overflow-auto font-mono text-[12px] leading-[1.5]">
        <div className="sticky top-0 z-10 px-4 py-1.5 border-b border-border bg-[#0d1117] text-[11px] text-muted-foreground">
          {filename}
        </div>
        <div className="flex items-center justify-center h-[calc(100%-30px)] text-[12px] text-muted-foreground">
          Arquivo binário — visualização não disponível
        </div>
      </div>
    )
  }

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

// ── File status badge (VSCode style — right-aligned letter) ──────────────────
const STATUS_META: Record<string, { label: string; color: string }> = {
  modified:  { label: 'M', color: '#e2c08d' },
  added:     { label: 'A', color: '#73c991' },
  deleted:   { label: 'D', color: '#c74e39' },
  renamed:   { label: 'R', color: '#73c991' },
  untracked: { label: 'U', color: '#73c991' },
  copied:    { label: 'C', color: '#73c991' },
  unmerged:  { label: '!', color: '#e5534b' },
}

// ── File icon color by extension (simplified VSCode Seti-style) ──────────────
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

function StatusBadge({ status }: { status: string }): JSX.Element {
  const s = STATUS_META[status] ?? STATUS_META.modified
  return (
    <span
      className="text-[11px] font-medium w-4 shrink-0 text-right tracking-tight"
      style={{ color: s.color }}
    >
      {s.label}
    </span>
  )
}

// ── File row (VSCode style) ──────────────────────────────────────────────────
function FileRow({
  file,
  isSelected,
  actionIcon,
  onAction,
  onDiscard,
  onClick
}: {
  file: GitFile
  isSelected: boolean
  actionIcon: 'stage' | 'unstage'
  onAction: () => void
  onDiscard?: () => void
  onClick: () => void
}): JSX.Element {
  const filename = file.path.split('/').pop() ?? file.path
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
  const iconColor = getFileIconColor(filename)

  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-center h-[22px] pl-5 pr-2 cursor-pointer group select-none',
        isSelected
          ? 'bg-[#04395e]'
          : 'hover:bg-[#2a2d2e]'
      )}
    >
      {/* File icon */}
      <File className="h-[14px] w-[14px] shrink-0 mr-1.5" style={{ color: iconColor }} />

      {/* Filename + dir (single line, VSCode style) */}
      <div className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
        <span className="text-[13px] leading-[22px] truncate shrink-0">{filename}</span>
        {dir && (
          <span className="text-[12px] leading-[22px] text-[#8b949e]/60 truncate">{dir}</span>
        )}
      </div>

      {/* Hover action buttons */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {onDiscard && (
          <button
            onClick={(e) => { e.stopPropagation(); onDiscard() }}
            className="h-[18px] w-[18px] flex items-center justify-center rounded hover:bg-[#ffffff15]"
            title="Descartar alterações"
          >
            <Undo2 className="h-[13px] w-[13px] text-[#c5c5c5]" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onAction() }}
          className="h-[18px] w-[18px] flex items-center justify-center rounded hover:bg-[#ffffff15]"
          title={actionIcon === 'stage' ? 'Stage Changes' : 'Unstage Changes'}
        >
          {actionIcon === 'stage'
            ? <Plus className="h-[14px] w-[14px] text-[#c5c5c5]" />
            : <Minus className="h-[14px] w-[14px] text-[#c5c5c5]" />
          }
        </button>
      </div>

      {/* Status badge (right) */}
      <StatusBadge status={file.status} />
    </div>
  )
}

// ── Section header (VSCode style) ────────────────────────────────────────────
type SectionAction = {
  icon: 'stage-all' | 'unstage-all' | 'discard-all'
  title: string
  onClick: () => void
}

function SectionHeader({
  label,
  count,
  collapsed,
  onToggle,
  actions
}: {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
  actions?: SectionAction[]
}): JSX.Element {
  const iconMap = {
    'stage-all': <Plus className="h-[14px] w-[14px] text-[#c5c5c5]" />,
    'unstage-all': <Minus className="h-[14px] w-[14px] text-[#c5c5c5]" />,
    'discard-all': <Undo2 className="h-[13px] w-[13px] text-[#c5c5c5]" />,
  }

  return (
    <div
      className="flex items-center h-[22px] px-1 cursor-pointer hover:bg-[#2a2d2e] select-none group"
      onClick={onToggle}
    >
      {collapsed
        ? <ChevronRight className="h-3 w-3 text-[#c5c5c5] shrink-0" />
        : <ChevronDown className="h-3 w-3 text-[#c5c5c5] shrink-0" />
      }
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#c5c5c5] flex-1 ml-0.5">
        {label}
      </span>
      <span className="text-[11px] text-[#c5c5c5]/70 bg-[#4d4d4d] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1.5 mr-1 font-medium">
        {count}
      </span>
      {actions && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions.map((action) => (
            <button
              key={action.icon}
              onClick={(e) => { e.stopPropagation(); action.onClick() }}
              className="h-[18px] w-[18px] flex items-center justify-center rounded hover:bg-[#ffffff15]"
              title={action.title}
            >
              {iconMap[action.icon]}
            </button>
          ))}
        </div>
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
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false)

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

  const handleDiscard = async (file: string) => {
    setConfirmDiscard(file)
  }

  const executeDiscard = async () => {
    if (!confirmDiscard) return
    await electron.git.discard(repoId, [confirmDiscard])
    setSelectedFile(null)
    setDiff('')
    onRefresh()
  }

  const handleDiscardAll = async () => {
    setConfirmDiscardAll(true)
  }

  const executeDiscardAll = async () => {
    await electron.git.discardAll(repoId)
    setSelectedFile(null)
    setDiff('')
    onRefresh()
  }

  const handleUnstageAll = async () => {
    if (!gitStatus) return
    for (const f of gitStatus.staged) {
      await electron.git.unstage(repoId, [f.path])
    }
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
                {hasStaged && (
                  <>
                    <SectionHeader
                      label="Staged Changes"
                      count={gitStatus.staged.length}
                      collapsed={stagedCollapsed}
                      onToggle={() => setStagedCollapsed((v) => !v)}
                      actions={[
                        { icon: 'unstage-all', title: 'Unstage All Changes', onClick: handleUnstageAll }
                      ]}
                    />
                    {!stagedCollapsed && gitStatus.staged.map((file) => (
                      <FileRow
                        key={file.path}
                        file={file}
                        isSelected={selectedFile === file.path}
                        actionIcon="unstage"
                        onAction={() => handleUnstage(file.path)}
                        onClick={() => selectFile(file.path)}
                      />
                    ))}
                  </>
                )}

                {/* Changes */}
                {hasChanges && (
                  <>
                    <SectionHeader
                      label="Changes"
                      count={allChanges.length}
                      collapsed={changesCollapsed}
                      onToggle={() => setChangesCollapsed((v) => !v)}
                      actions={[
                        { icon: 'discard-all', title: 'Discard All Changes', onClick: handleDiscardAll },
                        { icon: 'stage-all', title: 'Stage All Changes', onClick: handleStageAll }
                      ]}
                    />
                    {!changesCollapsed && allChanges.map((file) => (
                      <FileRow
                        key={file.path}
                        file={file}
                        isSelected={selectedFile === file.path}
                        actionIcon="stage"
                        onAction={() => handleStage(file.path)}
                        onDiscard={() => handleDiscard(file.path)}
                        onClick={() => selectFile(file.path)}
                      />
                    ))}
                  </>
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

      {/* Confirm discard single file */}
      <ConfirmDialog
        open={confirmDiscard !== null}
        onOpenChange={(open) => { if (!open) setConfirmDiscard(null) }}
        title="Descartar alterações"
        description={`Tem certeza que deseja descartar as alterações em "${confirmDiscard?.split('/').pop()}"?`}
        consequences={[
          'Todas as modificações não salvas neste arquivo serão perdidas permanentemente',
          'Esta ação não pode ser desfeita'
        ]}
        confirmLabel="Descartar"
        variant="destructive"
        onConfirm={executeDiscard}
      />

      {/* Confirm discard all */}
      <ConfirmDialog
        open={confirmDiscardAll}
        onOpenChange={setConfirmDiscardAll}
        title="Descartar todas as alterações"
        description="Tem certeza que deseja descartar TODAS as alterações pendentes?"
        consequences={[
          `${allChanges.length} arquivo(s) serão revertidos ao último estado do commit`,
          'Todas as modificações não salvas serão perdidas permanentemente',
          'Esta ação não pode ser desfeita'
        ]}
        confirmLabel="Descartar tudo"
        variant="destructive"
        onConfirm={executeDiscardAll}
      />
    </div>
  )
}
