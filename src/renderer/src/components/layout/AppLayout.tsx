import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { Toaster } from '@/components/ui/toaster'
import { electron } from '@/lib/electron'
import { Minus, Square, X } from 'lucide-react'
import { useAuthStore } from '@/store'

function TitleBar(): JSX.Element {
  const { user } = useAuthStore()

  return (
    <div className="flex h-[38px] shrink-0 items-center border-b border-border bg-background titlebar-drag">
      {/* Draggable space */}
      <div className="flex-1" />

      {/* User badge */}
      {user && (
        <div className="flex items-center gap-1.5 px-3 no-drag">
          <img
            src={user.avatarUrl}
            alt={user.login}
            className="h-5 w-5 rounded-full ring-1 ring-border"
          />
          <span className="text-[12px] text-muted-foreground">{user.login}</span>
        </div>
      )}

      {/* Window controls — GitHub-style, right-aligned */}
      <div className="flex items-center no-drag">
        <button
          onClick={() => electron.window.minimize()}
          title="Minimizar"
          className="flex h-[38px] w-10 items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          onClick={() => electron.window.maximize()}
          title="Maximizar"
          className="flex h-[38px] w-10 items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Square className="h-[11px] w-[11px]" />
        </button>
        <button
          onClick={() => electron.window.close()}
          title="Fechar"
          className="flex h-[38px] w-10 items-center justify-center text-muted-foreground/50 hover:text-white hover:bg-[#f85149] transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export function AppLayout(): JSX.Element {
  const navigate = useNavigate()

  useEffect(() => {
    const unsub = electron.on('navigate:run', (runId: unknown) => {
      navigate(`/run/${runId}`)
    })
    return unsub
  }, [navigate])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}
