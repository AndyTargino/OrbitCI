import { useMemo, useState, useCallback } from 'react'
import type { MetricSample } from '@shared/types'

interface ResourceChartProps {
  samples: MetricSample[]
  height?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m${s > 0 ? `${s}s` : ''}`
}

export function ResourceChart({ samples, height = 200 }: ResourceChartProps) {
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    sample: MetricSample
    timeOffset: number
  } | null>(null)

  const hasGpu = useMemo(
    () => samples.some((s) => s.gpuPercent !== null && s.gpuPercent !== undefined),
    [samples]
  )

  const { cpuPoints, ramPoints, gpuPoints, maxRam, timeLabels, startTime } = useMemo(() => {
    if (samples.length === 0) {
      return { cpuPoints: '', ramPoints: '', gpuPoints: '', maxRam: 0, timeLabels: [], startTime: 0 }
    }

    const start = new Date(samples[0].timestamp).getTime()
    const end = new Date(samples[samples.length - 1].timestamp).getTime()
    const duration = Math.max(end - start, 1000)

    const maxR = Math.max(...samples.map((s) => s.ramBytes), 1)

    const W = 600
    const H = height - 40 // leave space for axes

    const cpuPts: string[] = []
    const ramPts: string[] = []
    const gpuPts: string[] = []

    for (const s of samples) {
      const t = new Date(s.timestamp).getTime()
      const x = ((t - start) / duration) * W
      const cpuY = H - (Math.min(s.cpuPercent, 100) / 100) * H
      const ramY = H - (s.ramBytes / maxR) * H
      cpuPts.push(`${x.toFixed(1)},${cpuY.toFixed(1)}`)
      ramPts.push(`${x.toFixed(1)},${ramY.toFixed(1)}`)

      if (s.gpuPercent !== null && s.gpuPercent !== undefined) {
        const gpuY = H - (Math.min(s.gpuPercent, 100) / 100) * H
        gpuPts.push(`${x.toFixed(1)},${gpuY.toFixed(1)}`)
      }
    }

    // Time labels (up to 6)
    const totalSec = Math.ceil(duration / 1000)
    const labelCount = Math.min(6, totalSec)
    const labels: { x: number; text: string }[] = []
    for (let i = 0; i <= labelCount; i++) {
      const sec = Math.round((i / labelCount) * totalSec)
      labels.push({
        x: (i / labelCount) * W,
        text: formatDuration(sec)
      })
    }

    return {
      cpuPoints: cpuPts.join(' '),
      ramPoints: ramPts.join(' '),
      gpuPoints: gpuPts.join(' '),
      maxRam: maxR,
      timeLabels: labels,
      startTime: start
    }
  }, [samples, height])

  const W = 600
  const H = height - 40

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (samples.length === 0) return
      const svg = e.currentTarget
      const rect = svg.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * W
      const ratio = x / W

      const start = new Date(samples[0].timestamp).getTime()
      const end = new Date(samples[samples.length - 1].timestamp).getTime()
      const duration = Math.max(end - start, 1000)
      const targetTime = start + ratio * duration

      // Find closest sample
      let closest = samples[0]
      let minDist = Infinity
      for (const s of samples) {
        const dist = Math.abs(new Date(s.timestamp).getTime() - targetTime)
        if (dist < minDist) {
          minDist = dist
          closest = s
        }
      }

      const timeOffset = Math.round((new Date(closest.timestamp).getTime() - start) / 1000)
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, sample: closest, timeOffset })
    },
    [samples]
  )

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  if (samples.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
        Sem dados de métricas disponíveis
      </div>
    )
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        style={{ height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const y = H - (pct / 100) * H
          return (
            <g key={pct}>
              <line x1={0} y1={y} x2={W} y2={y} stroke="#2b3040" strokeWidth={0.5} />
              <text x={-4} y={y + 3} fill="#6b7280" fontSize={9} textAnchor="end">
                {pct}%
              </text>
            </g>
          )
        })}

        {/* Time labels */}
        {timeLabels.map((label, i) => (
          <text key={i} x={label.x} y={H + 14} fill="#6b7280" fontSize={9} textAnchor="middle">
            {label.text}
          </text>
        ))}

        {/* RAM area (filled) */}
        <polyline
          points={ramPoints}
          fill="none"
          stroke="#22c55e"
          strokeWidth={1.5}
          strokeLinejoin="round"
          opacity={0.8}
        />

        {/* CPU line */}
        <polyline
          points={cpuPoints}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* GPU line */}
        {hasGpu && gpuPoints && (
          <polyline
            points={gpuPoints}
            fill="none"
            stroke="#a855f7"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        )}

        {/* Hover indicator line */}
        {tooltip && (
          <line
            x1={(tooltip.x / (typeof window !== 'undefined' ? 1 : 1)) * (W / (tooltip.x > 0 ? (tooltip.x / tooltip.x) : 1))}
            y1={0}
            x2={(tooltip.x / 1) * 1}
            y2={H}
            stroke="#9ca3af"
            strokeWidth={0.5}
            strokeDasharray="3,3"
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground px-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px] rounded" style={{ background: '#3b82f6' }} />
          CPU %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px] rounded" style={{ background: '#22c55e' }} />
          RAM (max: {formatBytes(maxRam)})
        </span>
        {hasGpu && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] rounded" style={{ background: '#a855f7' }} />
            GPU %
          </span>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-50 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md"
          style={{
            left: Math.min(tooltip.x + 12, W - 180),
            top: Math.max(tooltip.y - 70, 4)
          }}
        >
          <div className="text-muted-foreground mb-1">+{formatDuration(tooltip.timeOffset)}</div>
          <div className="flex items-center gap-2">
            <span style={{ color: '#3b82f6' }}>CPU:</span>
            <span className="text-foreground">{tooltip.sample.cpuPercent.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: '#22c55e' }}>RAM:</span>
            <span className="text-foreground">{formatBytes(tooltip.sample.ramBytes)}</span>
          </div>
          {tooltip.sample.gpuPercent !== null && (
            <>
              <div className="flex items-center gap-2">
                <span style={{ color: '#a855f7' }}>GPU:</span>
                <span className="text-foreground">{tooltip.sample.gpuPercent.toFixed(1)}%</span>
              </div>
              {tooltip.sample.gpuMemBytes !== null && (
                <div className="flex items-center gap-2">
                  <span style={{ color: '#a855f7' }}>VRAM:</span>
                  <span className="text-foreground">{formatBytes(tooltip.sample.gpuMemBytes)}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
