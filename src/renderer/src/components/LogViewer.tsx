import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { RunLog } from '@shared/types'

interface LogViewerProps {
  logs: RunLog[]
  autoScroll?: boolean
  className?: string
}

const logTypeClass: Record<string, string> = {
  info: 'text-slate-300',
  output: 'text-slate-200',
  error: 'text-red-400',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  step: 'text-[#c0c0c0] font-medium',
  job: 'text-[#e0e0e0] font-semibold',
  skip: 'text-slate-500'
}

const logTypePrefix: Record<string, string> = {
  job: '▶ ',
  step: '  · ',
  error: '    ',
  success: '    ',
  warning: '    ',
  info: '    ',
  output: '    ',
  skip: '    '
}

export function LogViewer({ logs, autoScroll = true, className }: LogViewerProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs.length, autoScroll])

  return (
    <div
      className={cn(
        'bg-[#060610] rounded-md border border-border overflow-auto font-mono text-xs leading-relaxed',
        className
      )}
      ref={containerRef}
    >
      <div className="p-4 space-y-0.5 min-h-full">
        {logs.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            {t('workspace.runs.waiting_logs', 'Waiting for logs...')}
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={cn(
                'whitespace-pre-wrap break-all',
                logTypeClass[log.type ?? 'info'] ?? 'text-slate-300'
              )}
            >
              <span className="text-slate-600 select-none mr-2 text-[10px]">
                {new Date(log.timestamp).toLocaleTimeString(i18n.language, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </span>
              {logTypePrefix[log.type ?? 'info'] ?? ''}
              {log.message}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
