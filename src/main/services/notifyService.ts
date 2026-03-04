import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import { showNotification } from '../notification/manager'

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

export function notifyRunStart(runId: string, workflowName: string, repoId: string): void {
  sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, { runId, status: 'running' })

  showNotification({
    title: workflowName,
    body: `Iniciando execução em ${repoId}`,
    type: 'running',
    duration: 3000
  })
}

export function notifyRunComplete(
  runId: string,
  workflowName: string,
  status: 'success' | 'failure',
  repoId: string
): void {
  sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, { runId, status })

  if (status === 'success') {
    showNotification({
      title: workflowName,
      body: `Concluído com sucesso em ${repoId}`,
      type: 'success',
      duration: 6000
    })
  } else {
    showNotification({
      title: workflowName,
      body: `Falha na execução em ${repoId}`,
      type: 'failure',
      duration: 0,
      actions: [
        { id: 'view-logs', label: 'Ver logs', primary: true },
        { id: 'close', label: 'Fechar' }
      ],
      onAction: (actionId) => {
        if (actionId === 'view-logs') {
          sendToRenderer('navigate:run', runId)
        }
      }
    })
  }
}

export function notifySyncEvent(
  repoId: string,
  type: string,
  message: string,
  sha?: string
): void {
  sendToRenderer(IPC_CHANNELS.EVENT_SYNC, { repoId, type, message, sha })

  if (type === 'new-commit') {
    showNotification({
      title: 'Novo commit detectado',
      body: message,
      type: 'info',
      duration: 4000
    })
  } else if (type === 'error') {
    showNotification({
      title: 'Erro de sincronização',
      body: message,
      type: 'warning',
      duration: 6000
    })
  }
}

export function sendRunLog(
  runId: string,
  jobName: string | null,
  stepName: string | null,
  message: string,
  type: string
): void {
  sendToRenderer(IPC_CHANNELS.EVENT_RUN_LOG, {
    runId,
    jobName,
    stepName,
    message,
    type,
    timestamp: new Date().toISOString()
  })
}
