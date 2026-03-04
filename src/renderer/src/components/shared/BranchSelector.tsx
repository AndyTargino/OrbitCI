import { useState, useEffect, useRef } from 'react'
import { GitBranch, Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GitBranch as GitBranchType } from '@shared/types'

interface BranchSelectorProps {
  branches: GitBranchType[]
  current: string
  onSelect: (branch: string) => void
  className?: string
}

export function BranchSelector({ branches, current, onSelect, className }: BranchSelectorProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (open) {
      setSearch('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const localBranches = branches.filter((b) => !b.remote)
  const filtered = localBranches.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-secondary hover:bg-accent text-[13px] font-medium transition-colors"
      >
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-[140px] truncate">{current}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[260px] rounded-lg border border-border bg-popover shadow-xl z-50">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a branch..."
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="max-h-[240px] overflow-auto py-1">
            {filtered.length === 0 && (
              <p className="text-[12px] text-muted-foreground px-3 py-2">No branches found</p>
            )}
            {filtered.map((b) => (
              <button
                key={b.name}
                onClick={() => { onSelect(b.name); setOpen(false) }}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-left hover:bg-accent transition-colors',
                  b.name === current && 'text-foreground font-medium'
                )}
              >
                {b.name === current ? (
                  <Check className="h-3.5 w-3.5 text-[#3fb950] shrink-0" />
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span className="truncate">{b.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
