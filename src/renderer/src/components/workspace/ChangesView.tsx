import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '@/components/ui/tooltip'
import { electron } from '@/lib/electron'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { GitFile, GitStatus } from '@shared/types'
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  ChevronDown, ChevronRight,
  Columns2,
  Expand,
  File,
  FolderOpen,
  GitCommit,
  Globe,
  Loader2,
  Minus, Plus,
  Sparkles,
  Terminal,
  Undo2
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// ── Diff parser ──────────────────────────────────────────────────────────────

const GIT_META_PREFIXES = [
  'diff --git', 'index ', '--- ', '+++ ',
  'old mode', 'new mode', 'deleted file mode', 'new file mode',
  'rename from', 'rename to', 'similarity index', 'copy from', 'copy to',
]

interface RawLine {
  type: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'
  content: string
  oldNum?: number
  newNum?: number
}

// Pair for side-by-side: left = old, right = new
interface SidePair {
  kind: 'hunk' | 'pair' | 'meta'
  hunkHeader?: string
  left?: { num: number; content: string; type: 'del' | 'ctx' | 'empty' }
  right?: { num: number; content: string; type: 'add' | 'ctx' | 'empty' }
}

function parseRaw(raw: string): RawLine[] {
  const out: RawLine[] = []
  let oldLine = 0
  let newLine = 0
  for (const line of raw.split('\n')) {
    if (GIT_META_PREFIXES.some((p) => line.startsWith(p))) continue
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) { oldLine = parseInt(m[1]); newLine = parseInt(m[2]) }
      out.push({ type: 'hunk', content: line })
    } else if (line.startsWith('+')) {
      out.push({ type: 'add', content: line.slice(1), newNum: newLine++ })
    } else if (line.startsWith('-')) {
      out.push({ type: 'del', content: line.slice(1), oldNum: oldLine++ })
    } else if (line === '\\ No newline at end of file') {
      out.push({ type: 'meta', content: line })
    } else if (line.trim() === '' && out.length === 0) {
      // skip leading blanks
    } else if (line.length > 0 || out.length > 0) {
      out.push({ type: 'ctx', content: line.length > 0 ? line.slice(1) : '', oldNum: oldLine++, newNum: newLine++ })
    }
  }
  return out
}

function buildSidePairs(raw: RawLine[]): SidePair[] {
  const pairs: SidePair[] = []
  let i = 0
  while (i < raw.length) {
    const r = raw[i]
    if (r.type === 'hunk') {
      pairs.push({ kind: 'hunk', hunkHeader: r.content })
      i++
      continue
    }
    if (r.type === 'meta') {
      pairs.push({ kind: 'meta', hunkHeader: r.content })
      i++
      continue
    }
    if (r.type === 'ctx') {
      pairs.push({
        kind: 'pair',
        left: { num: r.oldNum!, content: r.content, type: 'ctx' },
        right: { num: r.newNum!, content: r.content, type: 'ctx' },
      })
      i++
      continue
    }
    // collect a block of del/add lines
    const dels: RawLine[] = []
    const adds: RawLine[] = []
    while (i < raw.length && (raw[i].type === 'del' || raw[i].type === 'add')) {
      if (raw[i].type === 'del') dels.push(raw[i])
      else adds.push(raw[i])
      i++
    }
    const maxLen = Math.max(dels.length, adds.length)
    for (let j = 0; j < maxLen; j++) {
      const d = dels[j]
      const a = adds[j]
      pairs.push({
        kind: 'pair',
        left: d ? { num: d.oldNum!, content: d.content, type: 'del' } : undefined,
        right: a ? { num: a.newNum!, content: a.content, type: 'add' } : undefined,
      })
    }
  }
  return pairs
}

// ── Diff colours ─────────────────────────────────────────────────────────────

const CLR = {
  addBg: 'rgba(70,210,110,0.12)',
  addBgStrong: 'rgba(70,210,110,0.22)',
  addText: '#4ade80',
  addNum: 'rgba(74,222,128,0.6)',
  delBg: 'rgba(248,113,113,0.12)',
  delBgStrong: 'rgba(248,113,113,0.22)',
  delText: '#f87171',
  delNum: 'rgba(248,113,113,0.6)',
  hunkBg: 'rgba(56,139,253,0.10)',
  hunkText: 'rgba(96,165,250,0.8)',
  numDim: 'rgba(140,148,158,0.35)',
  ctxText: 'rgba(220,220,220,0.85)',
  emptyBg: 'rgba(255,255,255,0.018)',
}

// ── Binary detection ─────────────────────────────────────────────────────────

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

// ── SplitDiffViewer ──────────────────────────────────────────────────────────

function SplitDiffViewer({ pairs }: { pairs: SidePair[] }): JSX.Element {
  return (
    <div className="flex w-full" style={{ minWidth: 0 }}>
      {/* LEFT PANE */}
      <div className="flex-1 min-w-0 border-r" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <table className="w-full border-collapse">
          <tbody>
            {pairs.map((pair, i) => {
              if (pair.kind === 'hunk') {
                return (
                  <tr key={`lh-${i}`} style={{ backgroundColor: CLR.hunkBg }}>
                    <td className="w-10 text-right text-[10px] px-2 select-none border-r" style={{ borderColor: 'rgba(255,255,255,0.05)', color: CLR.hunkText }} />
                    <td className="w-5 px-1 select-none text-center text-[10px]" style={{ color: CLR.hunkText }} />
                    <td className="px-3 py-0.5 text-[10px]" style={{ color: CLR.hunkText }}>{pair.hunkHeader}</td>
                  </tr>
                )
              }
              if (pair.kind === 'meta') {
                return (
                  <tr key={`lm-${i}`}>
                    <td colSpan={3} className="px-3 py-0.5 text-[10px] italic" style={{ color: CLR.numDim }}>{pair.hunkHeader}</td>
                  </tr>
                )
              }
              const l = pair.left
              const isDel = l?.type === 'del'
              const isEmpty = !l
              const rowBg = isEmpty ? CLR.emptyBg : isDel ? CLR.delBg : undefined
              return (
                <tr key={`l-${i}`} style={rowBg ? { backgroundColor: rowBg } : undefined}>
                  <td
                    className="w-10 text-right text-[10px] px-2 select-none border-r"
                    style={{ color: isDel ? CLR.delNum : CLR.numDim, borderColor: 'rgba(255,255,255,0.05)', minWidth: 40 }}
                  >
                    {l ? l.num : ''}
                  </td>
                  <td className="w-5 text-center text-[11px] select-none px-1" style={{ color: isDel ? CLR.delText : 'transparent' }}>
                    {isDel ? '−' : ' '}
                  </td>
                  <td
                    className="px-2 py-px whitespace-pre-wrap break-all"
                    style={{ color: isDel ? CLR.delText : isEmpty ? 'transparent' : CLR.ctxText }}
                  >
                    {l ? l.content : ' '}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* RIGHT PANE */}
      <div className="flex-1 min-w-0">
        <table className="w-full border-collapse">
          <tbody>
            {pairs.map((pair, i) => {
              if (pair.kind === 'hunk') {
                return (
                  <tr key={`rh-${i}`} style={{ backgroundColor: CLR.hunkBg }}>
                    <td className="w-10 text-right text-[10px] px-2 select-none border-r" style={{ borderColor: 'rgba(255,255,255,0.05)', color: CLR.hunkText }} />
                    <td className="w-5 px-1 select-none text-center text-[10px]" style={{ color: CLR.hunkText }} />
                    <td className="px-3 py-0.5 text-[10px]" style={{ color: CLR.hunkText }} />
                  </tr>
                )
              }
              if (pair.kind === 'meta') {
                return (
                  <tr key={`rm-${i}`}>
                    <td colSpan={3} className="px-3 py-0.5" />
                  </tr>
                )
              }
              const r = pair.right
              const isAdd = r?.type === 'add'
              const isEmpty = !r
              const rowBg = isEmpty ? CLR.emptyBg : isAdd ? CLR.addBg : undefined
              return (
                <tr key={`r-${i}`} style={rowBg ? { backgroundColor: rowBg } : undefined}>
                  <td
                    className="w-10 text-right text-[10px] px-2 select-none border-r"
                    style={{ color: isAdd ? CLR.addNum : CLR.numDim, borderColor: 'rgba(255,255,255,0.05)', minWidth: 40 }}
                  >
                    {r ? r.num : ''}
                  </td>
                  <td className="w-5 text-center text-[11px] select-none px-1" style={{ color: isAdd ? CLR.addText : 'transparent' }}>
                    {isAdd ? '+' : ' '}
                  </td>
                  <td
                    className="px-2 py-px whitespace-pre-wrap break-all"
                    style={{ color: isAdd ? CLR.addText : isEmpty ? 'transparent' : CLR.ctxText }}
                  >
                    {r ? r.content : ' '}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── UnifiedDiffViewer ────────────────────────────────────────────────────────

function UnifiedDiffViewer({ pairs }: { pairs: SidePair[] }): JSX.Element {
  return (
    <table className="w-full border-collapse">
      <tbody>
        {pairs.map((pair, i) => {
          if (pair.kind === 'hunk') {
            return (
              <tr key={i} style={{ backgroundColor: CLR.hunkBg }}>
                <td className="w-10 px-2 select-none border-r" style={{ borderColor: 'rgba(255,255,255,0.05)' }} />
                <td className="w-10 px-2 select-none border-r" style={{ borderColor: 'rgba(255,255,255,0.05)' }} />
                <td className="px-4 py-0.5 text-[10px]" style={{ color: CLR.hunkText }}>{pair.hunkHeader}</td>
              </tr>
            )
          }
          if (pair.kind === 'meta') {
            return (
              <tr key={i}>
                <td colSpan={3} className="px-4 py-0.5 text-[10px] italic" style={{ color: CLR.numDim }}>{pair.hunkHeader}</td>
              </tr>
            )
          }
          const rows: JSX.Element[] = []
          if (pair.left && pair.left.type !== 'ctx') {
            const isDel = pair.left.type === 'del'
            rows.push(
              <tr key={`${i}-l`} style={{ backgroundColor: CLR.delBg }}>
                <td className="w-10 text-right text-[10px] px-2 select-none border-r" style={{ color: CLR.delNum, borderColor: 'rgba(255,255,255,0.05)' }}>{pair.left.num}</td>
                <td className="w-10 text-right text-[10px] px-2 select-none border-r" style={{ color: CLR.numDim, borderColor: 'rgba(255,255,255,0.05)' }} />
                <td className="px-2 py-px whitespace-pre-wrap break-all" style={{ color: CLR.delText }}>
                  <span className="mr-2 select-none text-[11px] font-semibold">−</span>{pair.left.content}
                </td>
              </tr>
            )
            if (!isDel) return null
          }
          if (pair.right && pair.right.type !== 'ctx') {
            rows.push(
              <tr key={`${i}-r`} style={{ backgroundColor: CLR.addBg }}>
                <td className="w-10 text-right text-[10px] px-2 select-none border-r" style={{ color: CLR.numDim, borderColor: 'rgba(255,255,255,0.05)' }} />
                <td className="w-10 text-right text-[10px] px-2 select-none border-r" style={{ color: CLR.addNum, borderColor: 'rgba(255,255,255,0.05)' }}>{pair.right.num}</td>
                <td className="px-2 py-px whitespace-pre-wrap break-all" style={{ color: CLR.addText }}>
                  <span className="mr-2 select-none text-[11px] font-semibold">+</span>{pair.right.content}
                </td>
              </tr>
            )
          }
          if (rows.length) return <>{rows}</>
          // context line
          const l = pair.left!
          return (
            <tr key={i}>
              <td className="w-10 text-right text-[10px] px-2 select-none border-r" style={{ color: CLR.numDim, borderColor: 'rgba(255,255,255,0.05)' }}>{l.num}</td>
              <td className="w-10 text-right text-[10px] px-2 select-none border-r" style={{ color: CLR.numDim, borderColor: 'rgba(255,255,255,0.05)' }}>{pair.right?.num}</td>
              <td className="px-2 py-px whitespace-pre-wrap break-all" style={{ color: CLR.ctxText }}>
                <span className="mr-2 select-none text-[11px]"> </span>{l.content}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── DiffViewer ───────────────────────────────────────────────────────────────

// ── Overview Ruler (VSCode-style scrollbar minimap) ─────────────────────────

const RULER_W = 14 // px — thin like VSCode

function OverviewRuler({
  pairs,
  scrollEl,
}: {
  pairs: SidePair[]
  scrollEl: HTMLDivElement | null
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState({ top: 0, height: 0 })
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartScroll = useRef(0)

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const h = canvas.clientHeight
    if (h === 0) return
    canvas.width = Math.round(RULER_W * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, RULER_W, h)

    const contentPairs = pairs.filter((p) => p.kind === 'pair')
    const total = contentPairs.length
    if (total === 0) return

    const MIN_H = 2

    let idx = 0
    for (const p of pairs) {
      if (p.kind !== 'pair') continue
      const y = (idx / total) * h
      const ph = Math.max(MIN_H, h / total)

      const hasAdd = p.right?.type === 'add'
      const hasDel = p.left?.type === 'del'

      if (hasAdd && hasDel) {
        // Modified: show red on left half, green on right half
        ctx.fillStyle = 'rgba(248,81,73,0.85)'
        ctx.fillRect(0, y, RULER_W / 2, ph)
        ctx.fillStyle = 'rgba(63,185,80,0.85)'
        ctx.fillRect(RULER_W / 2, y, RULER_W / 2, ph)
      } else if (hasDel) {
        ctx.fillStyle = 'rgba(248,81,73,0.85)'
        ctx.fillRect(0, y, RULER_W, ph)
      } else if (hasAdd) {
        ctx.fillStyle = 'rgba(63,185,80,0.85)'
        ctx.fillRect(0, y, RULER_W, ph)
      }
      idx++
    }
  }, [pairs])

  useEffect(() => {
    drawCanvas()
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(drawCanvas)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [drawCanvas])

  useEffect(() => {
    if (!scrollEl) return
    const updateThumb = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl
      if (scrollHeight <= clientHeight) {
        setThumb({ top: 0, height: 0 })
        return
      }
      const rulerH = rulerRef.current?.clientHeight ?? clientHeight
      const ratio = clientHeight / scrollHeight
      setThumb({
        top: (scrollTop / scrollHeight) * rulerH,
        height: Math.max(20, ratio * rulerH),
      })
    }
    updateThumb()
    scrollEl.addEventListener('scroll', updateThumb, { passive: true })
    const ro = new ResizeObserver(updateThumb)
    ro.observe(scrollEl)
    return () => {
      scrollEl.removeEventListener('scroll', updateThumb)
      ro.disconnect()
    }
  }, [scrollEl])

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollEl || isDragging.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    scrollEl.scrollTop = ratio * scrollEl.scrollHeight
  }

  const handleThumbMouseDown = (e: React.MouseEvent) => {
    if (!scrollEl) return
    e.preventDefault()
    e.stopPropagation()
    isDragging.current = true
    dragStartY.current = e.clientY
    dragStartScroll.current = scrollEl.scrollTop

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current || !scrollEl) return
      const rulerH = rulerRef.current?.clientHeight ?? 1
      const delta = ev.clientY - dragStartY.current
      const scrollDelta = (delta / rulerH) * scrollEl.scrollHeight
      scrollEl.scrollTop = dragStartScroll.current + scrollDelta
    }
    const onUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={rulerRef}
      onClick={handleRulerClick}
      className="relative flex-shrink-0 cursor-pointer select-none"
      style={{ width: RULER_W, background: 'rgba(0,0,0,0.25)' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ display: 'block' }}
      />
      {thumb.height > 0 && (
        <div
          onMouseDown={handleThumbMouseDown}
          className="absolute left-0 right-0 cursor-grab active:cursor-grabbing"
          style={{
            top: thumb.top,
            height: thumb.height,
            background: 'rgba(121,121,121,0.4)',
          }}
        />
      )}
    </div>
  )
}

// ── DiffViewer ───────────────────────────────────────────────────────────────

// Max display rows before showing "load more" (like GitHub's 20k lines limit)
const MAX_DISPLAY_PAIRS = 2000

function DiffViewer({ diff, filename }: { diff: string; filename: string }): JSX.Element {
  const { t } = useTranslation()
  const [splitMode, setSplitMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('orbit:diff-split-mode')
    return saved === null ? true : saved === 'true'
  })
  const setAndSaveSplitMode = (val: boolean) => {
    localStorage.setItem('orbit:diff-split-mode', String(val))
    setSplitMode(val)
  }
  const [showAll, setShowAll] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  // Sync scrollEl state when ref mounts
  useEffect(() => {
    setScrollEl(scrollRef.current)
  }, [])

  const rawLines = parseRaw(diff)
  const allPairs = buildSidePairs(rawLines)
  const truncated = !showAll && allPairs.length > MAX_DISPLAY_PAIRS
  const pairs = truncated ? allPairs.slice(0, MAX_DISPLAY_PAIRS) : allPairs
  const hasContent = allPairs.length > 0
  // Only treat as binary if git itself reports 'Binary files ... differ' at line start
  const binary = isBinaryFile(filename) || /^Binary files /m.test(diff)

  if (binary) {
    return (
      <div className="h-full overflow-auto font-mono text-[12px] leading-[1.5]">
        <div className="sticky top-0 z-10 px-4 py-1.5 border-b border-border bg-background text-[11px] text-muted-foreground flex items-center justify-between">
          <span>{filename}</span>
        </div>
        <div className="flex items-center justify-center h-[calc(100%-30px)] text-[12px] text-muted-foreground">
          {t('workspace.diff.binary_file', 'Binary file — preview not available')}
        </div>
      </div>
    )
  }

  if (!diff.trim() || !hasContent) {
    return (
      <div className="flex items-center justify-center h-full text-[12px] text-muted-foreground">
        {t('workspace.diff.no_differences', 'No differences to show')}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col font-mono text-[12px] leading-[1.5]">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-1 border-b border-border bg-background shrink-0">
        <span className="text-[11px] text-muted-foreground truncate">{filename}</span>
        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          <button
            onClick={() => setAndSaveSplitMode(true)}
            title={t('workspace.diff.split_view', 'Split view')}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors"
            style={{
              background: splitMode ? 'rgba(96,165,250,0.15)' : 'transparent',
              color: splitMode ? '#60a5fa' : 'rgba(140,148,158,0.7)',
            }}
          >
            <Columns2 className="h-3 w-3" />
            <span>{t('workspace.diff.split', 'Split')}</span>
          </button>
          <button
            onClick={() => setAndSaveSplitMode(false)}
            title={t('workspace.diff.unified_view', 'Unified view')}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors"
            style={{
              background: !splitMode ? 'rgba(96,165,250,0.15)' : 'transparent',
              color: !splitMode ? '#60a5fa' : 'rgba(140,148,158,0.7)',
            }}
          >
            <AlignLeft className="h-3 w-3" />
            <span>{t('workspace.diff.unified', 'Unified')}</span>
          </button>
        </div>
      </div>

      {/* Body: scrollable content + overview ruler */}
      <div className="flex flex-1 min-h-0">
        {/* Scrollable diff content */}
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-auto">
          {splitMode
            ? <SplitDiffViewer pairs={pairs} />
            : <UnifiedDiffViewer pairs={pairs} />
          }

          {/* Large file banner */}
          {truncated && (
            <div
              className="flex items-center justify-between px-4 py-3 border-t"
              style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(56,139,253,0.08)' }}
            >
              <span className="text-[12px]" style={{ color: 'rgba(96,165,250,0.85)' }}>
                {t('workspace.diff.truncated_info', { max: MAX_DISPLAY_PAIRS.toLocaleString(), total: allPairs.length.toLocaleString(), defaultValue: `Showing ${MAX_DISPLAY_PAIRS.toLocaleString()} of ${allPairs.length.toLocaleString()} changed lines. Large diffs are hidden by default.` })}
              </span>
              <button
                onClick={() => setShowAll(true)}
                className="text-[12px] px-3 py-1 rounded border transition-colors"
                style={{
                  color: '#60a5fa',
                  borderColor: 'rgba(96,165,250,0.4)',
                  background: 'transparent'
                }}
              >
                {t('workspace.diff.load_full', 'Load full diff')}
              </button>
            </div>
          )}
        </div>

        {/* Overview ruler */}
        <OverviewRuler pairs={pairs} scrollEl={scrollEl} />
      </div>
    </div>
  )
}

// ── File status badge ────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string }> = {
  modified: { label: 'M', color: '#e2c08d' },
  added: { label: 'A', color: '#73c991' },
  deleted: { label: 'D', color: '#c74e39' },
  renamed: { label: 'R', color: '#73c991' },
  untracked: { label: 'U', color: '#73c991' },
  copied: { label: 'C', color: '#73c991' },
  unmerged: { label: '!', color: '#e5534b' },
}

// ── File icon colour by extension ────────────────────────────────────────────

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

function FileStatusBadge({ status }: { status: string }): JSX.Element {
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

// ── FileRow ──────────────────────────────────────────────────────────────────

function FileRow({
  file,
  repoId,
  isSelected,
  isStaged,
  onStage,
  onUnstage,
  onDiscard,
  onClick,
  onRefresh
}: {
  file: GitFile
  repoId: string
  isSelected: boolean
  isStaged: boolean
  onStage: () => void
  onUnstage: () => void
  onDiscard?: () => void
  onClick: () => void
  onRefresh: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const filename = file.path.split('/').pop() ?? file.path
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
  const iconColor = getFileIconColor(filename)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={onClick}
          className={cn(
            'flex items-center h-[22px] pl-5 pr-2 cursor-pointer group select-none',
            isSelected
              ? 'bg-[#04395e]'
              : 'hover:bg-[#2a2d2e]'
          )}
        >
          <File className="h-[14px] w-[14px] shrink-0 mr-1.5" style={{ color: iconColor }} />

          <div className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
            <span className="text-[13px] leading-[22px] truncate shrink-0">{filename}</span>
            {dir && (
              <span className="text-[12px] leading-[22px] text-[#8b949e]/60 truncate">{dir}</span>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {onDiscard && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDiscard() }}
                    className="h-[18px] w-[18px] flex items-center justify-center rounded hover:bg-[#ffffff15]"
                  >
                    <Undo2 className="h-[13px] w-[13px] text-[#c5c5c5]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('workspace.changes.discard_tooltip', 'Discard changes')}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => { e.stopPropagation(); isStaged ? onUnstage() : onStage() }}
                  className="h-[18px] w-[18px] flex items-center justify-center rounded hover:bg-[#ffffff15]"
                >
                  {isStaged
                    ? <Minus className="h-[14px] w-[14px] text-[#c5c5c5]" />
                    : <Plus className="h-[14px] w-[14px] text-[#c5c5c5]" />
                  }
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{isStaged ? t('workspace.changes.unstage_tooltip', 'Unstage') : t('workspace.changes.stage_tooltip', 'Stage')}</TooltipContent>
            </Tooltip>
          </div>

          <FileStatusBadge status={file.status} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {isStaged ? (
          <ContextMenuItem onClick={onUnstage}>
            <Minus className="w-3.5 h-3.5 mr-2" />
            {t('workspace.changes.unstage_file', 'Unstage file')}
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={onStage}>
            <Plus className="w-3.5 h-3.5 mr-2" />
            {t('workspace.changes.stage_file', 'Stage file')}
          </ContextMenuItem>
        )}
        {!isStaged && onDiscard && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={onDiscard}
              className="text-red-400 focus:text-red-400"
            >
              <Undo2 className="w-3.5 h-3.5 mr-2" />
              {t('workspace.changes.discard_changes', 'Discard changes')}
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => {
          navigator.clipboard.writeText(file.path)
          notify('success', t('workspace.changes.path_copied', 'Path copied'))
        }}>
          {t('workspace.changes.copy_path', 'Copy file path')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── SectionHeader ────────────────────────────────────────────────────────────

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
  const { t } = useTranslation()
  const iconMap = {
    'stage-all': <Plus className="h-[14px] w-[14px] text-[#c5c5c5]" />,
    'unstage-all': <Minus className="h-[14px] w-[14px] text-[#c5c5c5]" />,
    'discard-all': <Undo2 className="h-[13px] w-[13px] text-[#c5c5c5]" />,
  }

  const titleMap: Record<string, string> = {
    'stage-all': t('workspace.changes.stage_all', 'Stage all changes'),
    'unstage-all': t('workspace.changes.unstage_all', 'Unstage all changes'),
    'discard-all': t('workspace.changes.discard_all', 'Discard all changes'),
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
            <Tooltip key={action.icon}>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => { e.stopPropagation(); action.onClick() }}
                  className="h-[18px] w-[18px] flex items-center justify-center rounded hover:bg-[#ffffff15]"
                >
                  {iconMap[action.icon]}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{titleMap[action.icon] ?? action.title}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ChangesView ──────────────────────────────────────────────────────────────

interface Props {
  repoId: string
  gitStatus: GitStatus | null
  onRefresh: () => void
  localPath?: string
  remoteUrl?: string
}

export function ChangesView({ repoId, gitStatus, onRefresh, localPath, remoteUrl }: Props): JSX.Element {
  const { t } = useTranslation()
  const [commitSummary, setCommitSummary] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedFileStaged, setSelectedFileStaged] = useState(false)
  const [diff, setDiff] = useState<string>('')
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [stagedCollapsed, setStagedCollapsed] = useState(false)
  const [changesCollapsed, setChangesCollapsed] = useState(false)
  const [isGeneratingCommit, setIsGeneratingCommit] = useState(false)
  const [aiStatus, setAiStatus] = useState('')
  const [expandedCommit, setExpandedCommit] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false)

  const allChanges = gitStatus ? [...gitStatus.unstaged, ...gitStatus.untracked] : []
  const hasStaged = (gitStatus?.staged.length ?? 0) > 0
  const hasChanges = allChanges.length > 0
  const totalChanges = (gitStatus?.staged.length ?? 0) + allChanges.length
  const isBusy = isCommitting || isPushing
  const canCommit = !!commitSummary.trim() && hasStaged && !isBusy

  // Simulated streaming text effect
  const streamText = useCallback((target: string, setter: (v: string) => void): Promise<void> => {
    return new Promise((resolve) => {
      let i = 0
      setter('')
      const interval = setInterval(() => {
        i += 1 + Math.floor(Math.random() * 2)
        if (i >= target.length) {
          setter(target)
          clearInterval(interval)
          resolve()
        } else {
          setter(target.slice(0, i))
        }
      }, 18)
    })
  }, [])

  const handleGenerateCommit = async () => {
    if (isGeneratingCommit) return

    if (!hasStaged) {
      notify('failure', t('workspace.ai.no_staged_title', 'No staged files'), t('workspace.ai.no_staged_desc', 'Stage files first so the AI can analyze the changes.'))
      return
    }

    setIsGeneratingCommit(true)
    setAiStatus(t('workspace.ai.status_collecting', 'Collecting staged diff...'))

    try {
      const diffStaged = await electron.git.diffStaged(repoId)

      const diffPreview = diffStaged.length > 5000
        ? diffStaged.slice(0, 5000) + '\n\n... [TRUNCATED]'
        : diffStaged

      console.groupCollapsed('[AI-COMMIT] Data collected')
      console.log('Staged files:', gitStatus?.staged.map(f => f.path))
      console.log(`Diff size: ${diffStaged.length} chars`)
      console.log('Preview:\n' + diffPreview)
      console.groupEnd()

      setAiStatus(t('workspace.ai.status_analyzing', 'Analyzing changes...'))
      await new Promise((resolve) => setTimeout(resolve, 800))

      setAiStatus(t('workspace.ai.status_generating', 'Generating commit message...'))
      await new Promise((resolve) => setTimeout(resolve, 400))

      // Stream the summary
      const mockSummary = 'feat: implement AI commit generator logic'
      const mockDescription = '- Validated staged files before analysis\n- Collected diff data via IPC channel\n- Optimized token usage for large diffs'

      await streamText(mockSummary, setCommitSummary)
      setAiStatus(t('workspace.ai.status_writing', 'Writing description...'))
      await streamText(mockDescription, setCommitDescription)

      setAiStatus('')
    } catch (err: unknown) {
      notify('failure', t('workspace.ai.error_title', 'Error generating commit'), err instanceof Error ? err.message : t('workspace.ai.error_diff', 'Failed to get diff'))
      setAiStatus('')
    } finally {
      setIsGeneratingCommit(false)
    }
  }

  const selectFile = useCallback(async (path: string, staged: boolean) => {
    setSelectedFile(path)
    setSelectedFileStaged(staged)
    setIsDiffLoading(true)
    try {
      const d = await electron.git.diff(repoId, path, staged)
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
      const d = await electron.git.diff(repoId, selectedFile, selectedFileStaged).catch(() => '')
      setDiff(d ?? '')
    }
  }, [onRefresh, repoId, selectedFile, selectedFileStaged])

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
    if (!commitSummary.trim() || !gitStatus?.staged.length) return false
    setIsCommitting(true)

    const fullMsg = commitDescription.trim()
      ? `${commitSummary.trim()}\n\n${commitDescription.trim()}`
      : commitSummary.trim()

    try {
      const result = await electron.git.commit(repoId, fullMsg)
      notify('success', t('workspace.changes.commit_done_title', 'Commit successful!'), `${result.sha.slice(0, 7)} \u00b7 ${commitSummary.trim().slice(0, 50)}...`)
      setCommitSummary('')
      setCommitDescription('')
      setSelectedFile(null)
      setDiff('')
      onRefresh()
      return true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.error')
      notify('failure', t('workspace.changes.commit_error_title', 'Error committing'), msg)
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
      notify('success', t('workspace.changes.push_done_title', 'Push successful!'))
      onRefresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.error')
      notify('failure', t('workspace.changes.push_error_title', 'Error pushing'), msg)
    } finally {
      setIsPushing(false)
    }
  }

  return (
    <TooltipProvider delayDuration={400}>
      <>
        {/* Left sidebar */}
        <div className="w-[300px] shrink-0 flex flex-col border-r border-border">
          {/* File sections */}
          <div className="flex-1 overflow-auto">
            {!gitStatus ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[13px]">{t('common.loading', 'Loading...')}</span>
              </div>
            ) : totalChanges === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <GitCommit className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-[12px] text-muted-foreground">{t('workspace.changes.no_pending', 'No pending changes')}</p>
                <p className="text-[11px] text-muted-foreground/50 mt-1">
                  {t('workspace.changes.all_synced', 'All files are synced')}
                </p>
              </div>
            ) : (
              <>
                {/* Staged */}
                {hasStaged && (
                  <>
                    <SectionHeader
                      label={t('workspace.changes.staged_label', 'Staged Changes')}
                      count={gitStatus.staged.length}
                      collapsed={stagedCollapsed}
                      onToggle={() => setStagedCollapsed((v) => !v)}
                      actions={[
                        { icon: 'unstage-all', title: t('workspace.changes.unstage_all', 'Unstage All Changes'), onClick: handleUnstageAll }
                      ]}
                    />
                    {!stagedCollapsed && gitStatus.staged.map((file) => (
                      <FileRow
                        key={file.path}
                        file={file}
                        repoId={repoId}
                        isSelected={selectedFile === file.path}
                        isStaged={true}
                        onStage={() => handleStage(file.path)}
                        onUnstage={() => handleUnstage(file.path)}
                        onClick={() => selectFile(file.path, true)}
                        onRefresh={onRefresh}
                      />
                    ))}
                  </>
                )}

                {/* Changes */}
                {hasChanges && (
                  <>
                    <SectionHeader
                      label={t('workspace.changes.changes_label', 'Changes')}
                      count={allChanges.length}
                      collapsed={changesCollapsed}
                      onToggle={() => setChangesCollapsed((v) => !v)}
                      actions={[
                        { icon: 'discard-all', title: t('workspace.changes.discard_all', 'Discard All Changes'), onClick: handleDiscardAll },
                        { icon: 'stage-all', title: t('workspace.changes.stage_all', 'Stage All Changes'), onClick: handleStageAll }
                      ]}
                    />
                    {!changesCollapsed && allChanges.map((file) => (
                      <FileRow
                        key={file.path}
                        file={file}
                        repoId={repoId}
                        isSelected={selectedFile === file.path}
                        isStaged={false}
                        onStage={() => handleStage(file.path)}
                        onUnstage={() => handleUnstage(file.path)}
                        onDiscard={() => handleDiscard(file.path)}
                        onClick={() => selectFile(file.path, false)}
                        onRefresh={onRefresh}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          {/* Commit area */}
          <div className="border-t border-border shrink-0 bg-background/50">
            {/* AI status bar */}
            {isGeneratingCommit && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-violet-500/20 bg-violet-500/5">
                <div className="relative h-4 w-4 shrink-0">
                  <Sparkles className="h-4 w-4 text-violet-400 animate-pulse" />
                  <Sparkles className="h-4 w-4 text-violet-400/40 absolute inset-0 animate-ping" />
                </div>
                <span className="text-[11px] text-violet-400 font-medium truncate flex-1">
                  {aiStatus || t('workspace.ai.thinking', 'Thinking...')}
                </span>
                <div className="flex gap-0.5">
                  <div className="h-1 w-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="h-1 w-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="h-1 w-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            <div className="p-3 flex flex-col gap-2">
              {/* Summary input */}
              <div className="relative">
                <Input
                  placeholder={t('workspace.changes.summary_placeholder', 'Summary (required)')}
                  value={commitSummary}
                  onChange={(e) => setCommitSummary(e.target.value)}
                  disabled={isGeneratingCommit}
                  maxLength={72}
                  className={cn(
                    'h-8 text-[13px] font-medium pr-16 border-border/60 focus-visible:ring-1 focus-visible:ring-violet-500/30 transition-all px-2.5',
                    isGeneratingCommit && 'border-violet-500/30'
                  )}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCommit()
                  }}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  <span className={cn(
                    'text-[10px] font-medium tabular-nums transition-colors',
                    commitSummary.length > 72 ? 'text-red-400' : commitSummary.length > 50 ? 'text-amber-400' : 'text-muted-foreground/30'
                  )}>
                    {commitSummary.length}/50
                  </span>
                </div>
              </div>

              {/* Description */}
              <Textarea
                placeholder={t('workspace.changes.description_placeholder', 'Description...')}
                value={commitDescription}
                onChange={(e) => setCommitDescription(e.target.value)}
                disabled={isGeneratingCommit}
                className={cn(
                  'h-[100px] text-[12px] leading-relaxed resize-none border-border/60 focus-visible:ring-1 focus-visible:ring-violet-500/30 transition-all p-2.5',
                  isGeneratingCommit && 'border-violet-500/30'
                )}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCommit()
                }}
              />

              {/* Action buttons row */}
              <div className="flex items-center gap-1.5">
                {/* AI generate (coming soon) */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="inline-flex">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0 border-border/60 text-muted-foreground/40 pointer-events-none"
                        disabled
                        tabIndex={-1}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('workspace.ai.coming_soon', 'AI commit — coming soon')}</TooltipContent>
                </Tooltip>

                {/* Expand button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0 border-border/60 text-muted-foreground transition-all"
                      onClick={() => setExpandedCommit(true)}
                    >
                      <Expand className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('workspace.changes.expand_editor', 'Expand editor')}</TooltipContent>
                </Tooltip>

                {/* Commit + Push split button */}
                <div className="flex items-center flex-1 rounded-md border border-border/60 bg-background overflow-hidden">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        className={cn(
                          "flex-1 h-8 text-[12px] font-medium rounded-none border-0 ring-0 focus-visible:ring-0",
                          canCommit
                            ? "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
                            : "text-muted-foreground"
                        )}
                        onClick={handleCommit}
                        disabled={!commitSummary.trim() || !hasStaged || isBusy}
                      >
                        {isCommitting
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          : <GitCommit className="h-3.5 w-3.5 mr-1.5" />
                        }
                        {t('common.commit', 'Commit')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {t('workspace.changes.commit_tooltip', { shortcut: electron.platform === 'darwin' ? '\u2318' : 'Ctrl', defaultValue: `Commit staged changes (${electron.platform === 'darwin' ? '\u2318' : 'Ctrl'}+Enter)` })}
                    </TooltipContent>
                  </Tooltip>

                  <div className="w-px h-4 bg-border/40 shrink-0" />

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        className={cn(
                          "h-8 text-[12px] font-medium rounded-none border-0 ring-0 focus-visible:ring-0 px-2.5 shrink-0",
                          canCommit && "text-foreground"
                        )}
                        onClick={handleCommitAndPush}
                        disabled={!commitSummary.trim() || !hasStaged || isBusy}
                      >
                        {isBusy
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          : <ArrowUp className="h-3.5 w-3.5 mr-1" />
                        }
                        {t('common.push', 'Push')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('workspace.changes.commit_push_tooltip', 'Commit and push')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {!hasStaged && totalChanges > 0 && (
                <p className="text-[10px] text-muted-foreground/40 text-center uppercase tracking-wider font-medium">
                  {t('workspace.changes.stage_to_commit', 'Stage files to commit')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right content - diff viewer */}
        <div className="flex-1 min-w-0">
          {selectedFile ? (
            isDiffLoading ? (
              <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[12px]">{t('workspace.diff.loading', 'Loading diff...')}</span>
              </div>
            ) : (
              <DiffViewer diff={diff} filename={selectedFile} />
            )
          ) : totalChanges > 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="h-12 w-12 rounded-full bg-muted/30 flex items-center justify-center mb-3">
                <GitCommit className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <p className="text-[13px] text-muted-foreground">
                {t('workspace.diff.click_to_view', 'Click a file to see changes')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="h-16 w-16 rounded-2xl bg-muted/20 flex items-center justify-center mb-5">
                <GitCommit className="h-8 w-8 text-muted-foreground/30" />
              </div>
              <h3 className="text-[15px] font-semibold mb-1">{t('workspace.changes.no_local_title', 'No local changes')}</h3>
              <p className="text-[12px] text-muted-foreground/70 mb-6 max-w-[280px]">
                {t('workspace.changes.no_local_desc', 'There are no uncommitted changes in your repository. Here are some suggestions:')}
              </p>
              <div className="w-full max-w-[320px] space-y-2">
                {gitStatus && gitStatus.behind > 0 && (
                  <button
                    onClick={async () => {
                      try {
                        await electron.git.pull(repoId)
                        notify('success', t('workspace.notifications.pull_success', 'Pull complete'))
                        onRefresh()
                      } catch (err: unknown) {
                        notify('failure', t('workspace.notifications.pull_failed', 'Pull failed'), err instanceof Error ? err.message : t('common.error'))
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-accent transition-colors text-left"
                  >
                    <ArrowDown className="h-4 w-4 text-blue-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">{t('workspace.git.pull_from_origin', 'Pull from origin')}</div>
                      <div className="text-[11px] text-muted-foreground">{t('workspace.git.behind_commits_desc', { count: gitStatus.behind, defaultValue: `${gitStatus.behind} commit(s) behind the remote branch` })}</div>
                    </div>
                  </button>
                )}
                {localPath && (
                  <button
                    onClick={() => electron.repos.openFolder(localPath)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-accent transition-colors text-left"
                  >
                    <FolderOpen className="h-4 w-4 text-yellow-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">
                        {electron.platform === 'darwin' ? t('common.show_in_finder', 'Show in Finder') : electron.platform === 'linux' ? t('common.show_in_file_manager', 'Show in File Manager') : t('common.show_in_explorer', 'Show in Explorer')}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{t('workspace.changes.open_folder_desc', 'Open the repository folder')}</div>
                    </div>
                  </button>
                )}
                {remoteUrl && (
                  <button
                    onClick={() => {
                      const url = remoteUrl.replace(/\.git$/, '')
                      electron.shell.openExternal(url)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-accent transition-colors text-left"
                  >
                    <Globe className="h-4 w-4 text-violet-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">{t('common.view_github', 'View on GitHub')}</div>
                      <div className="text-[11px] text-muted-foreground">{t('workspace.changes.open_browser_desc', 'Open the repository in your browser')}</div>
                    </div>
                  </button>
                )}
                {localPath && (
                  <button
                    onClick={() => {
                      const normalizedPath = localPath.replace(/\\/g, '/')
                      electron.shell.openExternal(`vscode://file/${normalizedPath}`)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-accent transition-colors text-left"
                  >
                    <Terminal className="h-4 w-4 text-green-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">{t('common.open_vscode', 'Open in VS Code')}</div>
                      <div className="text-[11px] text-muted-foreground">{t('workspace.changes.open_editor_desc', 'Open the repository in your editor')}</div>
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Expanded commit modal */}
        <Dialog open={expandedCommit} onOpenChange={expandedCommit ? setExpandedCommit : undefined}>
          <DialogContent className="max-w-2xl p-0 gap-0">
            <DialogHeader className="px-5 pt-5 pb-3">
              <DialogTitle className="text-[15px] flex items-center gap-2">
                <GitCommit className="h-4 w-4 text-primary" />
                {t('workspace.changes.commit_msg_title', 'Commit Message')}
              </DialogTitle>
              <DialogDescription className="text-[12px]">
                {hasStaged
                  ? t('workspace.changes.staged_count_desc', { count: gitStatus?.staged.length, defaultValue: `${gitStatus?.staged.length} staged file(s) will be committed` })
                  : t('workspace.changes.no_staged_desc', 'No files staged for commit')}
              </DialogDescription>
            </DialogHeader>

            <div className="px-5 pb-3 space-y-3">
              {/* AI status in modal */}
              {isGeneratingCommit && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-violet-500/20 bg-violet-500/5">
                  <div className="relative h-4 w-4 shrink-0">
                    <Sparkles className="h-4 w-4 text-violet-400 animate-pulse" />
                    <Sparkles className="h-4 w-4 text-violet-400/40 absolute inset-0 animate-ping" />
                  </div>
                  <span className="text-[12px] text-violet-400 font-medium truncate flex-1">
                    {aiStatus || t('workspace.ai.thinking', 'Thinking...')}
                  </span>
                  <div className="flex gap-0.5">
                    <div className="h-1 w-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="h-1 w-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="h-1 w-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              {/* Summary */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('workspace.changes.summary_label', 'Summary')}</label>
                <div className="relative">
                  <Input
                    placeholder={t('workspace.changes.summary_expanded_placeholder', 'Write a brief summary of your changes')}
                    value={commitSummary}
                    onChange={(e) => setCommitSummary(e.target.value)}
                    disabled={isGeneratingCommit}
                    maxLength={72}
                    autoFocus
                    className={cn(
                      'h-10 text-[14px] font-medium pr-16 border-border/80 focus-visible:ring-1 focus-visible:ring-violet-500/30',
                      isGeneratingCommit && 'border-violet-500/30'
                    )}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        handleCommit()
                        setExpandedCommit(false)
                      }
                    }}
                  />
                  <span className={cn(
                    'absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium tabular-nums transition-colors',
                    commitSummary.length > 72 ? 'text-red-400' : commitSummary.length > 50 ? 'text-amber-400' : 'text-muted-foreground/30'
                  )}>
                    {commitSummary.length}/50
                  </span>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('workspace.changes.description_label', 'Description')}</label>
                <Textarea
                  placeholder={t('workspace.changes.description_expanded_placeholder', 'Add an optional extended description...')}
                  value={commitDescription}
                  onChange={(e) => setCommitDescription(e.target.value)}
                  disabled={isGeneratingCommit}
                  className={cn(
                    'min-h-[180px] text-[13px] leading-relaxed resize-y border-border/80 focus-visible:ring-1 focus-visible:ring-violet-500/30',
                    isGeneratingCommit && 'border-violet-500/30'
                  )}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      handleCommit()
                      setExpandedCommit(false)
                    }
                  }}
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center gap-2 px-5 py-3 border-t border-border bg-muted/20">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground/40 pointer-events-none"
                      disabled
                      tabIndex={-1}
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('workspace.ai.coming_soon', 'AI commit — coming soon')}</TooltipContent>
              </Tooltip>

              <div className="flex-1" />

              <Button
                variant="outline"
                className="h-9 text-[13px]"
                onClick={() => setExpandedCommit(false)}
              >
                {t('common.cancel', 'Cancel')}
              </Button>

              <div className="flex items-center rounded-md border border-border overflow-hidden">
                <Button
                  variant="ghost"
                  className={cn(
                    "h-9 text-[13px] font-medium rounded-none border-0 ring-0 focus-visible:ring-0 px-4",
                    canCommit
                      ? "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
                      : "text-muted-foreground"
                  )}
                  onClick={async () => {
                    const ok = await handleCommit()
                    if (ok) setExpandedCommit(false)
                  }}
                  disabled={!commitSummary.trim() || !hasStaged || isBusy}
                >
                  {isCommitting
                    ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    : <GitCommit className="h-4 w-4 mr-2" />
                  }
                  {t('common.commit', 'Commit')}
                </Button>
                <div className="w-px h-5 bg-border/50 shrink-0" />
                <Button
                  variant="ghost"
                  className={cn(
                    "h-9 text-[13px] font-medium rounded-none border-0 ring-0 focus-visible:ring-0 px-3",
                    canCommit && "text-foreground"
                  )}
                  onClick={async () => {
                    await handleCommitAndPush()
                    setExpandedCommit(false)
                  }}
                  disabled={!commitSummary.trim() || !hasStaged || isBusy}
                >
                  {isBusy
                    ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    : <ArrowUp className="h-4 w-4 mr-1.5" />
                  }
                  {t('common.push', 'Push')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Confirm discard single file */}
        <ConfirmDialog
          open={confirmDiscard !== null}
          onOpenChange={(open) => { if (!open) setConfirmDiscard(null) }}
          title={t('workspace.changes.discard_title', 'Discard changes')}
          description={t('workspace.changes.discard_desc', { file: confirmDiscard?.split('/').pop(), defaultValue: `Discard all changes in "${confirmDiscard?.split('/').pop()}"?` })}
          consequences={[
            t('workspace.changes.discard_cons1', 'All unsaved modifications in this file will be permanently lost'),
            t('common.action_undone', 'This action cannot be undone')
          ]}
          confirmLabel={t('common.discard', 'Discard')}
          variant="destructive"
          onConfirm={executeDiscard}
        />

        {/* Confirm discard all */}
        <ConfirmDialog
          open={confirmDiscardAll}
          onOpenChange={setConfirmDiscardAll}
          title={t('workspace.changes.discard_all_title', 'Discard all changes')}
          description={t('workspace.changes.discard_all_desc', 'Are you sure you want to discard ALL pending changes?')}
          consequences={[
            t('workspace.changes.discard_all_cons1', { count: allChanges.length, defaultValue: `${allChanges.length} file(s) will be reverted to the last commit state` }),
            t('workspace.changes.discard_all_cons2', 'All unsaved modifications will be permanently lost'),
            t('common.action_undone', 'This action cannot be undone')
          ]}
          confirmLabel={t('workspace.changes.discard_all_btn', 'Discard all')}
          variant="destructive"
          onConfirm={executeDiscardAll}
        />
      </>
    </TooltipProvider>
  )
}
