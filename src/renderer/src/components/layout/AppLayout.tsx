import { Outlet } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { electron } from '@/lib/electron'
import { Minus, Square, X } from 'lucide-react'

export function AppLayout(): JSX.Element {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      <div className="flex h-[32px] shrink-0 items-center border-b border-border titlebar-drag select-none">
        <span className="pl-3 text-[11px] font-semibold tracking-wide text-muted-foreground/70">
          OrbitCI
        </span>
        <div className="flex-1" />
        <div className="flex items-center no-drag">
          <button
            onClick={() => electron.window.minimize()}
            className="flex h-[32px] w-[46px] items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            onClick={() => electron.window.maximize()}
            className="flex h-[32px] w-[46px] items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
          >
            <Square className="h-[10px] w-[10px]" />
          </button>
          <button
            onClick={() => electron.window.close()}
            className="flex h-[32px] w-[46px] items-center justify-center text-muted-foreground/50 hover:text-white hover:bg-red-500 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
