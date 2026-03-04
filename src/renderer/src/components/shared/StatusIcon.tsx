import { CheckCircle2, XCircle, Loader2, AlertCircle, Circle } from 'lucide-react'
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
      return <CheckCircle2 className={cn(s, 'text-[#3fb950] shrink-0', className)} />
    case 'failure':
      return <XCircle className={cn(s, 'text-[#f85149] shrink-0', className)} />
    case 'running':
      return <Loader2 className={cn(s, 'text-[#58a6ff] animate-spin shrink-0', className)} />
    case 'cancelled':
      return <AlertCircle className={cn(s, 'text-[#d29922] shrink-0', className)} />
    case 'pending':
      return <Circle className={cn(s, 'text-muted-foreground shrink-0', className)} />
    default:
      return <span className={cn('h-2 w-2 rounded-full bg-border shrink-0', className)} />
  }
}
