import { CheckCircle2, XCircle, Loader2, Ban, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RunStatus } from '@shared/types'

interface StatusIconProps {
  status: RunStatus | null
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

const sizeMap = { xs: 'h-2.5 w-2.5', sm: 'h-3.5 w-3.5', md: 'h-4 w-4' }

export function StatusIcon({ status, size = 'sm', className }: StatusIconProps): JSX.Element {
  const s = sizeMap[size]
  switch (status) {
    case 'success':
      return <CheckCircle2 className={cn(s, 'status-success shrink-0', className)} />
    case 'failure':
      return <XCircle className={cn(s, 'status-failure shrink-0', className)} />
    case 'running':
      return <Loader2 className={cn(s, 'status-running animate-spin shrink-0', className)} />
    case 'cancelled':
      return <Ban className={cn(s, 'status-cancelled shrink-0', className)} />
    case 'pending':
      return <Circle className={cn(s, 'status-pending shrink-0', className)} />
    default:
      return <span className={cn('h-2 w-2 rounded-full bg-border shrink-0', className)} />
  }
}
