import { useEffect, useState } from 'react'
import {
  CheckCircle2, XCircle, Loader2, Clock, Square,
  Filter, Download, ChevronRight
} from 'lucide-react'
import { electron } from '@/lib/electron'
import { useRepoStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RunDetailModal } from '@/components/RunDetailModal'
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils'
import type { Run } from '@shared/types'

function StatusIcon({ status }: { status: string }): JSX.Element {
  switch (status) {
    case 'success': return <CheckCircle2 className="h-4 w-4 text-[#3fb950]" />
    case 'failure': return <XCircle className="h-4 w-4 text-[#f85149]" />
    case 'running': return <Loader2 className="h-4 w-4 text-[#58a6ff] animate-spin" />
    case 'cancelled': return <Square className="h-4 w-4 text-[#d29922]" />
    default: return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'success': return 'Concluído'
    case 'failure': return 'Falhou'
    case 'running': return 'Executando'
    case 'cancelled': return 'Cancelado'
    case 'pending': return 'Aguardando'
    default: return status
  }
}

export function History(): JSX.Element {
  const { repos } = useRepoStore()
  const [runs, setRuns] = useState<Run[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filterRepo, setFilterRepo] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [detailRun, setDetailRun] = useState<Run | null>(null)

  useEffect(() => {
    loadRuns()
  }, [filterRepo, filterStatus])

  const loadRuns = async () => {
    setIsLoading(true)
    try {
      const result = await electron.runs.list({
        repoId: filterRepo !== 'all' ? filterRepo : undefined,
        status: filterStatus !== 'all' ? (filterStatus as Run['status']) : undefined,
        limit: 100
      })
      setRuns(result)
    } catch {
      setRuns([])
    } finally {
      setIsLoading(false)
    }
  }

  const exportCSV = () => {
    const headers = 'ID,Repositório,Workflow,Gatilho,Status,Início,Duração\n'
    const rows = runs.map((r) =>
      [
        r.id.slice(0, 8),
        r.repoId,
        r.workflowName ?? r.workflowFile,
        r.trigger ?? '',
        r.status,
        r.startedAt ?? '',
        r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : ''
      ].join(',')
    )
    const csv = headers + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orbitci-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <>
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Histórico de Execuções</h1>
          <p className="text-muted-foreground">{runs.length} execuções encontradas</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={runs.length === 0}>
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={filterRepo} onValueChange={setFilterRepo}>
          <SelectTrigger className="w-52">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Todos os repos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os repositórios</SelectItem>
            {repos.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="success">Concluído</SelectItem>
            <SelectItem value="failure">Falhou</SelectItem>
            <SelectItem value="running">Executando</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Runs list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Clock className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">Nenhuma execução encontrada</h3>
          <p className="text-muted-foreground mt-1">Execute um workflow para ver o histórico aqui</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Repositório</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Workflow</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Gatilho</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Duração</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Quando</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => setDetailRun(run)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={run.status} />
                      <span className="text-sm">{statusLabel(run.status)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{run.repoId}</td>
                  <td className="px-4 py-3 text-sm font-medium">{run.workflowName ?? run.workflowFile}</td>
                  <td className="px-4 py-3">
                    {run.trigger && (
                      <Badge variant="secondary" className="text-xs">{run.trigger}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                    {formatDuration(run.durationMs)}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatRelativeTime(run.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    <RunDetailModal
      open={detailRun !== null}
      onClose={() => setDetailRun(null)}
      source="orbit"
      run={detailRun}
      repoId={detailRun?.repoId ?? ''}
    />
    </>
  )
}
