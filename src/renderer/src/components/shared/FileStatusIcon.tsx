import { cn } from '@/lib/utils'

interface FileStatusIconProps {
  status: string
  className?: string
}

const META: Record<string, { letter: string; color: string }> = {
  modified:  { letter: 'M', color: '#d29922' },
  added:     { letter: 'A', color: '#3fb950' },
  deleted:   { letter: 'D', color: '#f85149' },
  renamed:   { letter: 'R', color: '#58a6ff' },
  copied:    { letter: 'C', color: '#58a6ff' },
  untracked: { letter: 'U', color: '#8b949e' },
  unmerged:  { letter: '!', color: '#f85149' }
}

export function FileStatusIcon({ status, className }: FileStatusIconProps): JSX.Element {
  const m = META[status] ?? META.modified
  return (
    <span
      className={cn('text-[11px] font-semibold w-4 shrink-0 text-center', className)}
      style={{ color: m.color }}
    >
      {m.letter}
    </span>
  )
}
