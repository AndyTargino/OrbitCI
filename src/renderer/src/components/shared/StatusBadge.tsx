import { cn } from '@/lib/utils'
import type { RunStatus } from '@shared/types'

interface StatusBadgeProps {
  status: RunStatus
  className?: string
}

const styles: Record<RunStatus, string> = {
  success: 'text-[#3fb950] border-[#3fb950]/25 bg-[#3fb950]/10',
  failure: 'text-[#f85149] border-[#f85149]/25 bg-[#f85149]/10',
  running: 'text-[#58a6ff] border-[#58a6ff]/25 bg-[#58a6ff]/10',
  cancelled: 'text-[#d29922] border-[#d29922]/25 bg-[#d29922]/10',
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
