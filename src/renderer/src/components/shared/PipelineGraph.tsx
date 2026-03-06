import { cn } from '@/lib/utils'
import {
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Maximize2,
  Minimize2,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// ── Types ────────────────────────────────────────────────────────────────────

export interface GraphJob {
  id: string
  name: string
  runsOn: string
  needs: string[]
  status: string
  durationMs: number | null
  matrixGroupKey?: string
  matrixChildren?: GraphJob[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNodeStyle(status: string): { bg: string; border: string } {
  switch (status) {
    case 'success':
    case 'completed': return { bg: 'rgba(74,222,128,0.09)', border: 'rgba(74,222,128,0.45)' }
    case 'failure': return { bg: 'rgba(248,113,113,0.09)', border: 'rgba(248,113,113,0.45)' }
    case 'running':
    case 'in_progress': return { bg: 'rgba(96,165,250,0.09)', border: 'rgba(96,165,250,0.45)' }
    case 'queued':
    case 'waiting': return { bg: 'rgba(251,191,36,0.09)', border: 'rgba(251,191,36,0.35)' }
    case 'cancelled': return { bg: 'rgba(107,114,128,0.09)', border: 'rgba(107,114,128,0.35)' }
    default: return { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.12)' }
  }
}

const PIPELINE_NODE_W = 220
const PIPELINE_NODE_H = 54
const PIPELINE_GAP_X = 80
const PIPELINE_GAP_Y = 18

function fmtDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return ''
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ── Status icon ──────────────────────────────────────────────────────────────

function PipelineStatusIcon({ status, className }: { status: string; className?: string }) {
  switch (status) {
    case 'success':
    case 'completed':
      return <CheckCircle2 className={cn('text-[#3fb950]', className)} />
    case 'failure':
      return <XCircle className={cn('text-[#f85149]', className)} />
    case 'running':
    case 'in_progress':
      return <Loader2 className={cn('text-[#58a6ff] animate-spin', className)} />
    case 'queued':
    case 'waiting':
    case 'pending':
      return <Clock className={cn('text-[#d29922]', className)} />
    case 'cancelled':
    case 'skipped':
      return <Ban className={cn('text-[#8b949e]', className)} />
    default:
      return <Circle className={cn('text-[#8b949e]', className)} />
  }
}

// ── Custom nodes ─────────────────────────────────────────────────────────────

type PipelineNodeData = {
  label: string
  runsOn: string
  status: string
  durationMs: number | null
  hasIncoming: boolean
  hasOutgoing: boolean
}

type MatrixGroupNodeData = {
  groupKey: string
  children: GraphJob[]
  hasIncoming: boolean
  hasOutgoing: boolean
  expanded: boolean
  onToggle: () => void
}

function PipelineNode({ data }: NodeProps<Node<PipelineNodeData>>) {
  const ns = getNodeStyle(data.status)
  return (
    <>
      {data.hasIncoming && (
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-[#30363d] !border-2 !border-[#484f58] !w-[8px] !h-[8px]"
        />
      )}
      <div
        className="flex items-center gap-2.5 px-3.5 rounded-md border cursor-default select-none h-full w-full"
        style={{ background: ns.bg, borderColor: ns.border }}
      >
        <PipelineStatusIcon status={data.status} className="w-[18px] h-[18px] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold truncate leading-tight text-[#e6edf3]">{data.label}</p>
          <p className="text-[10px] text-[#8b949e] truncate leading-tight mt-0.5">{data.runsOn}</p>
        </div>
        {fmtDuration(data.durationMs) && (
          <span className="text-[11px] text-[#8b949e] shrink-0 tabular-nums ml-1">
            {fmtDuration(data.durationMs)}
          </span>
        )}
      </div>
      {data.hasOutgoing && (
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-[#30363d] !border-2 !border-[#484f58] !w-[8px] !h-[8px]"
        />
      )}
    </>
  )
}

const MATRIX_GROUP_COLLAPSED_H = 90
const MATRIX_CHILD_H = 44
const MATRIX_CHILD_GAP = 6
const MATRIX_PADDING_TOP = 36
const MATRIX_PADDING_BOTTOM = 12
const MATRIX_GROUP_W = 260

function MatrixGroupNode({ data }: NodeProps<Node<MatrixGroupNodeData>>) {
  const { children, groupKey, expanded, onToggle } = data

  const completed = children.filter((c) => c.status === 'success' || c.status === 'completed').length
  const failed = children.filter((c) => c.status === 'failure').length
  const running = children.filter((c) => c.status === 'running' || c.status === 'in_progress').length
  const total = children.length

  let summaryStatus = 'success'
  if (failed > 0) summaryStatus = 'failure'
  else if (running > 0) summaryStatus = 'in_progress'
  else if (completed < total) summaryStatus = 'pending'

  return (
    <>
      {data.hasIncoming && (
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-[#30363d] !border-2 !border-[#484f58] !w-[8px] !h-[8px]"
        />
      )}
      <div className="rounded-md border border-[#30363d] bg-[#161b22] cursor-default select-none h-full w-full overflow-hidden">
        <div className="px-3 py-2 border-b border-[#30363d]">
          <p className="text-[11px] font-medium text-[#8b949e]">Matrix: {groupKey}</p>
        </div>
        <div className="px-3 py-2">
          {!expanded ? (
            <div>
              <div className="flex items-center gap-2">
                <PipelineStatusIcon status={summaryStatus} className="w-[16px] h-[16px] shrink-0" />
                <span className="text-[12px] text-[#e6edf3]">
                  {failed > 0
                    ? `${failed} job${failed > 1 ? 's' : ''} failed`
                    : running > 0
                      ? `${running} job${running > 1 ? 's' : ''} in progress`
                      : `${completed} job${completed > 1 ? 's' : ''} completed`
                  }
                </span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onToggle() }}
                className="text-[11px] text-[#58a6ff] hover:underline mt-1 cursor-pointer"
              >
                Show all jobs
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {children.map((child) => {
                const cns = getNodeStyle(child.status)
                return (
                  <div
                    key={child.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded border"
                    style={{ background: cns.bg, borderColor: cns.border }}
                  >
                    <PipelineStatusIcon status={child.status} className="w-[14px] h-[14px] shrink-0" />
                    <span className="text-[11px] text-[#e6edf3] truncate flex-1">{child.name}</span>
                    {fmtDuration(child.durationMs) && (
                      <span className="text-[10px] text-[#8b949e] shrink-0 tabular-nums">{fmtDuration(child.durationMs)}</span>
                    )}
                  </div>
                )
              })}
              <button
                onClick={(e) => { e.stopPropagation(); onToggle() }}
                className="text-[11px] text-[#58a6ff] hover:underline mt-0.5 cursor-pointer"
              >
                Hide jobs
              </button>
            </div>
          )}
        </div>
      </div>
      {data.hasOutgoing && (
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-[#30363d] !border-2 !border-[#484f58] !w-[8px] !h-[8px]"
        />
      )}
    </>
  )
}

const pipelineNodeTypes = { pipeline: PipelineNode, matrixGroup: MatrixGroupNode }

// ── Layout logic ─────────────────────────────────────────────────────────────

function mergeMatrixGroups(graphJobs: GraphJob[]): GraphJob[] {
  const grouped = new Map<string, GraphJob[]>()
  const nonMatrix: GraphJob[] = []

  for (const job of graphJobs) {
    if (job.matrixGroupKey) {
      const arr = grouped.get(job.matrixGroupKey) ?? []
      arr.push(job)
      grouped.set(job.matrixGroupKey, arr)
    } else {
      nonMatrix.push(job)
    }
  }

  const result = [...nonMatrix]
  for (const [key, children] of grouped) {
    const groupId = `matrix-group-${key}`
    result.push({
      id: groupId,
      name: key,
      runsOn: 'matrix',
      needs: children[0]?.needs ?? [],
      status: children.every((c) => c.status === 'success' || c.status === 'completed')
        ? 'success'
        : children.some((c) => c.status === 'failure') ? 'failure'
          : children.some((c) => c.status === 'running' || c.status === 'in_progress') ? 'in_progress'
            : 'pending',
      durationMs: null,
      matrixGroupKey: key,
      matrixChildren: children,
    })

    for (const job of result) {
      if (job.id === groupId) continue
      job.needs = job.needs.map((needId) => {
        if (children.some((c) => c.id === needId)) return groupId
        return needId
      })
      job.needs = [...new Set(job.needs)]
    }
  }

  return result
}

function buildFlowElements(
  graphJobs: GraphJob[],
  expandedMatrixGroups: Set<string>
): { nodes: Node[]; edges: Edge[] } {
  const merged = mergeMatrixGroups(graphJobs)
  if (merged.length === 0) return { nodes: [], edges: [] }

  const levels: GraphJob[][] = []
  const placed = new Set<string>()
  let remaining = [...merged]
  while (remaining.length > 0) {
    const level = remaining.filter((j) => j.needs.length === 0 || j.needs.every((n) => placed.has(n)))
    if (level.length === 0) { levels.push(remaining); break }
    levels.push(level)
    level.forEach((j) => placed.add(j.id))
    remaining = remaining.filter((j) => !placed.has(j.id))
  }

  const hasOutgoing = new Set<string>()
  const hasIncoming = new Set<string>()
  for (const job of merged) {
    if (job.needs.length > 0) {
      hasIncoming.add(job.id)
      for (const need of job.needs) hasOutgoing.add(need)
    }
  }

  const LEVEL_W = PIPELINE_NODE_W + PIPELINE_GAP_X
  const nodes: Node[] = []
  levels.forEach((level, li) => {
    let y = 0
    for (const job of level) {
      const isMatrixGroup = !!job.matrixChildren
      const nodeW = isMatrixGroup ? MATRIX_GROUP_W : PIPELINE_NODE_W
      let nodeH: number
      if (job.matrixChildren) {
        const expanded = expandedMatrixGroups.has(job.matrixGroupKey!)
        if (expanded) {
          nodeH = MATRIX_PADDING_TOP + job.matrixChildren.length * (MATRIX_CHILD_H + MATRIX_CHILD_GAP) + MATRIX_PADDING_BOTTOM + 24
        } else {
          nodeH = MATRIX_GROUP_COLLAPSED_H
        }
      } else {
        nodeH = PIPELINE_NODE_H
      }

      if (isMatrixGroup) {
        nodes.push({
          id: job.id,
          type: 'matrixGroup',
          position: { x: li * LEVEL_W, y },
          data: {
            groupKey: job.matrixGroupKey!,
            children: job.matrixChildren!,
            hasIncoming: hasIncoming.has(job.id),
            hasOutgoing: hasOutgoing.has(job.id),
            expanded: expandedMatrixGroups.has(job.matrixGroupKey!),
            onToggle: () => {},
          },
          style: { width: nodeW, height: nodeH },
          draggable: false,
          selectable: false,
          connectable: false,
        })
      } else {
        nodes.push({
          id: job.id,
          type: 'pipeline',
          position: { x: li * LEVEL_W, y },
          data: {
            label: job.name,
            runsOn: job.runsOn,
            status: job.status,
            durationMs: job.durationMs,
            hasIncoming: hasIncoming.has(job.id),
            hasOutgoing: hasOutgoing.has(job.id),
          },
          style: { width: nodeW, height: nodeH },
          draggable: false,
          selectable: false,
          connectable: false,
        })
      }

      y += nodeH + PIPELINE_GAP_Y
    }
  })

  const edges: Edge[] = []
  for (const job of merged) {
    for (const need of job.needs) {
      edges.push({
        id: `${need}->${job.id}`,
        source: need,
        target: job.id,
        type: 'smoothstep',
        style: { stroke: '#30363d', strokeWidth: 2 },
        animated: false,
      })
    }
  }

  return { nodes, edges }
}

// ── Inner flow component ─────────────────────────────────────────────────────

function PipelineFlowInner({ graphJobs, fullscreen }: { graphJobs: GraphJob[]; fullscreen?: boolean }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow()
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const { nodes: rawNodes, edges } = useMemo(
    () => buildFlowElements(graphJobs, expandedGroups),
    [graphJobs, expandedGroups]
  )

  const nodes = useMemo(() => rawNodes.map((n) => {
    if (n.type === 'matrixGroup') {
      const d = n.data as MatrixGroupNodeData
      return { ...n, data: { ...d, onToggle: () => toggleGroup(d.groupKey) } }
    }
    return n
  }), [rawNodes, toggleGroup])

  const totalH = useMemo(() => {
    if (nodes.length === 0) return 90
    let maxY = 0
    for (const n of nodes) {
      const h = (n.style?.height as number) ?? PIPELINE_NODE_H
      const bottom = (n.position?.y ?? 0) + h
      if (bottom > maxY) maxY = bottom
    }
    return maxY + 30
  }, [nodes])

  const graphJobsKey = graphJobs.map((j) => j.id + j.status).join(',')
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.12, duration: 200 }), 80)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphJobsKey, fullscreen])

  return (
    <div className="relative" style={{ width: '100%', height: fullscreen ? '100%' : Math.max(totalH, 90) }}>
      <div className="pipeline-flow w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={pipelineNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          panOnDrag
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2}
        />
      </div>
      {/* Zoom controls */}
      <div className="absolute bottom-2 right-2 flex items-center gap-0.5 bg-[#161b22] border border-[#30363d] rounded-md overflow-hidden">
        <button
          onClick={() => fitView({ padding: 0.15, duration: 200 })}
          className="px-2 py-1 text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#30363d] transition-colors"
          title="Fit view"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3.75C2 2.784 2.784 2 3.75 2h2.5a.75.75 0 010 1.5h-2.5a.25.25 0 00-.25.25v2.5a.75.75 0 01-1.5 0v-2.5zm10.5 0a.25.25 0 00-.25-.25h-2.5a.75.75 0 010-1.5h2.5C13.216 2 14 2.784 14 3.75v2.5a.75.75 0 01-1.5 0v-2.5zM3.5 12.25a.25.25 0 00.25.25h2.5a.75.75 0 010 1.5h-2.5A1.75 1.75 0 012 12.25v-2.5a.75.75 0 011.5 0v2.5zm9.5 0v-2.5a.75.75 0 011.5 0v2.5A1.75 1.75 0 0112.25 14h-2.5a.75.75 0 010-1.5h2.5a.25.25 0 00.25-.25z"/>
          </svg>
        </button>
        <div className="w-px h-4 bg-[#30363d]" />
        <button
          onClick={() => zoomOut({ duration: 150 })}
          className="px-2 py-1 text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#30363d] transition-colors"
          title="Zoom out"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.75 7.25a.75.75 0 000 1.5h10.5a.75.75 0 000-1.5H2.75z"/>
          </svg>
        </button>
        <div className="w-px h-4 bg-[#30363d]" />
        <button
          onClick={() => zoomIn({ duration: 150 })}
          className="px-2 py-1 text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#30363d] transition-colors"
          title="Zoom in"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.25 2.75a.75.75 0 011.5 0v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5z"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Public component ─────────────────────────────────────────────────────────

export interface PipelineGraphProps {
  graphJobs: GraphJob[]
  workflowName?: string
  event?: string
}

export function PipelineGraph({ graphJobs, workflowName, event }: PipelineGraphProps): JSX.Element {
  const [fullscreen, setFullscreen] = useState(false)

  if (graphJobs.length === 0) return <></>

  const content = (
    <div className={cn(
      'bg-[#0d1117] rounded-md border border-[#30363d] overflow-hidden',
      fullscreen && 'fixed inset-0 z-50 rounded-none border-none flex flex-col'
    )}>
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-[#30363d] flex items-center justify-between shrink-0">
        <div>
          {workflowName && (
            <p className="text-[13px] font-semibold text-[#e6edf3]">{workflowName}</p>
          )}
          {event && (
            <p className="text-[11px] text-[#8b949e] mt-0.5">on: {event}</p>
          )}
          {!workflowName && !event && (
            <p className="text-[13px] font-semibold text-[#e6edf3]">Pipeline</p>
          )}
        </div>
        <button
          onClick={() => setFullscreen((f) => !f)}
          className="p-1.5 text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#30363d] rounded transition-colors"
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen
            ? <Minimize2 className="w-4 h-4" />
            : <Maximize2 className="w-4 h-4" />
          }
        </button>
      </div>
      <div className={cn('px-3 py-3', fullscreen && 'flex-1 min-h-0 h-full')}>
        <ReactFlowProvider>
          <PipelineFlowInner graphJobs={graphJobs} fullscreen={fullscreen} />
        </ReactFlowProvider>
      </div>
    </div>
  )

  return content
}
