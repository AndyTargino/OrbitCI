import { cn } from '@/lib/utils'
import type { RunStatus } from '@shared/types'

interface StatusBadgeProps {
  status: RunStatus
  className?: string
}

const styles: Record<RunStatus, string> = {
  success: 'text-[#4ade80] border-[#4ade80]/20 bg-[#4ade80]/10',
  failure: 'text-[#f87171] border-[#f87171]/20 bg-[#f87171]/10',
  running: 'text-[#60a5fa] border-[#60a5fa]/20 bg-[#60a5fa]/10',
  cancelled: 'text-[#a1a1aa] border-[#a1a1aa]/20 bg-[#a1a1aa]/10',
  pending: 'text-muted-foreground border-border bg-muted/50'
}

const labels: Record<RunStatus, string> = {
  success: 'success',
  failure: 'failed',
  running: 'running',
  cancelled: 'cancelled',
  pending: 'pending'
}

export function StatusBadge({ status, className }: StatusBadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium',
        styles[status],
        className
      )}
    >
      {labels[status]}
    </span>
  )
}
