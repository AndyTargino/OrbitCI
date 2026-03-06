import { useMemo } from 'react'
import { StatusIcon } from './StatusIcon'
import { cn } from '@/lib/utils'
import type { RunJob, JobGraphNode, RunStatus } from '@shared/types'

interface WorkflowGraphProps {
  graph: JobGraphNode[]
  jobs: RunJob[]
  className?: string
  onJobClick?: (jobName: string) => void
  selectedJob?: string | null
}

interface LayoutNode {
  name: string
  needs: string[]
  col: number
  row: number
  status: RunStatus | null
  durationMs: number | null
}

function buildLayout(graph: JobGraphNode[], jobs: RunJob[]): LayoutNode[] {
  if (graph.length === 0) return []

  const jobStatusMap = new Map(jobs.map((j) => [j.jobName, j]))

  // Assign columns based on dependency depth
  const colMap = new Map<string, number>()
  const resolved = new Set<string>()

  function getCol(name: string): number {
    if (colMap.has(name)) return colMap.get(name)!
    const node = graph.find((n) => n.name === name)
    if (!node || node.needs.length === 0) {
      colMap.set(name, 0)
      return 0
    }
    const maxParent = Math.max(...node.needs.map((dep) => getCol(dep)))
    const col = maxParent + 1
    colMap.set(name, col)
    return col
  }

  for (const node of graph) getCol(node.name)

  // Group by column, assign rows
  const columns = new Map<number, string[]>()
  for (const node of graph) {
    const col = colMap.get(node.name) ?? 0
    if (!columns.has(col)) columns.set(col, [])
    columns.get(col)!.push(node.name)
  }

  return graph.map((node) => {
    const col = colMap.get(node.name) ?? 0
    const colNodes = columns.get(col) ?? []
    const row = colNodes.indexOf(node.name)
    const jobData = jobStatusMap.get(node.name)
    return {
      name: node.name,
      needs: node.needs,
      col,
      row,
      status: (jobData?.status as RunStatus) ?? null,
      durationMs: jobData?.durationMs ?? null
    }
  })
}

function formatDuration(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

const NODE_W = 180
const NODE_H = 48
const COL_GAP = 60
const ROW_GAP = 16
const DOT_R = 6

export function WorkflowGraph({
  graph,
  jobs,
  className,
  onJobClick,
  selectedJob
}: WorkflowGraphProps): JSX.Element {
  const layout = useMemo(() => buildLayout(graph, jobs), [graph, jobs])

  if (layout.length === 0) return <></>

  const maxCol = Math.max(...layout.map((n) => n.col))
  const maxRowPerCol = new Map<number, number>()
  for (const n of layout) {
    const cur = maxRowPerCol.get(n.col) ?? 0
    if (n.row > cur) maxRowPerCol.set(n.col, n.row)
  }
  const maxRow = Math.max(...Array.from(maxRowPerCol.values()), 0)

  const svgW = (maxCol + 1) * (NODE_W + COL_GAP) + COL_GAP
  const svgH = (maxRow + 1) * (NODE_H + ROW_GAP) + ROW_GAP * 2

  function nodeX(col: number): number {
    return COL_GAP / 2 + col * (NODE_W + COL_GAP)
  }

  function nodeY(row: number): number {
    return ROW_GAP + row * (NODE_H + ROW_GAP)
  }

  // Group nodes by column for background boxes
  const colGroups = new Map<number, LayoutNode[]>()
  for (const n of layout) {
    if (!colGroups.has(n.col)) colGroups.set(n.col, [])
    colGroups.get(n.col)!.push(n)
  }

  function statusColor(status: RunStatus | null): string {
    switch (status) {
      case 'success': return '#3fb950'
      case 'failure': return '#f85149'
      case 'running': return '#58a6ff'
      case 'cancelled': return '#d29922'
      default: return '#484f58'
    }
  }

  function statusBg(status: RunStatus | null): string {
    switch (status) {
      case 'success': return 'rgba(63,185,80,0.08)'
      case 'failure': return 'rgba(248,81,73,0.08)'
      case 'running': return 'rgba(88,166,255,0.08)'
      case 'cancelled': return 'rgba(210,153,34,0.08)'
      default: return 'rgba(72,79,88,0.06)'
    }
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="select-none"
      >
        {/* Column group backgrounds */}
        {Array.from(colGroups.entries()).map(([col, nodes]) => {
          if (nodes.length <= 1) return null
          const x = nodeX(col) - 8
          const minRow = Math.min(...nodes.map((n) => n.row))
          const maxR = Math.max(...nodes.map((n) => n.row))
          const y = nodeY(minRow) - 8
          const h = nodeY(maxR) + NODE_H - y + 8
          return (
            <rect
              key={`bg-${col}`}
              x={x}
              y={y}
              width={NODE_W + 16}
              height={h}
              rx={10}
              fill="rgba(255,255,255,0.03)"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          )
        })}

        {/* Connection lines */}
        {layout.map((node) =>
          node.needs.map((dep) => {
            const parent = layout.find((n) => n.name === dep)
            if (!parent) return null

            const x1 = nodeX(parent.col) + NODE_W
            const y1 = nodeY(parent.row) + NODE_H / 2
            const x2 = nodeX(node.col)
            const y2 = nodeY(node.row) + NODE_H / 2
            const midX = (x1 + x2) / 2

            return (
              <g key={`edge-${dep}-${node.name}`}>
                <path
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth={2}
                />
                {/* Connection dots */}
                <circle cx={x1} cy={y1} r={DOT_R} fill={statusColor(parent.status)} />
                <circle cx={x2} cy={y2} r={DOT_R} fill={statusColor(node.status)} />
              </g>
            )
          })
        )}

        {/* Job nodes */}
        {layout.map((node) => {
          const x = nodeX(node.col)
          const y = nodeY(node.row)
          const isSelected = selectedJob === node.name
          const borderColor = isSelected ? '#8b5cf6' : statusColor(node.status)

          return (
            <g
              key={node.name}
              className="cursor-pointer"
              onClick={() => onJobClick?.(node.name)}
            >
              {/* Node background */}
              <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={isSelected ? 'rgba(139,92,246,0.12)' : statusBg(node.status)}
                stroke={borderColor}
                strokeWidth={isSelected ? 1.5 : 1}
              />

              {/* Status icon area */}
              <foreignObject x={x + 10} y={y + (NODE_H - 16) / 2} width={16} height={16}>
                <StatusIcon status={node.status} size="xs" />
              </foreignObject>

              {/* Job name */}
              <text
                x={x + 32}
                y={y + NODE_H / 2 - (node.durationMs ? 3 : 0)}
                dominantBaseline="central"
                className="fill-current text-foreground"
                style={{ fontSize: 12, fontWeight: 500 }}
              >
                {node.name.length > 16 ? node.name.slice(0, 15) + '…' : node.name}
              </text>

              {/* Duration */}
              {node.durationMs !== null && (
                <text
                  x={x + 32}
                  y={y + NODE_H / 2 + 11}
                  dominantBaseline="central"
                  style={{ fontSize: 10, fill: '#8b949e' }}
                >
                  {formatDuration(node.durationMs)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
