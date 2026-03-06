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

  // We send keys to renderer for desktop notifications if we want to translate them perfectly,
  // but for now let's just make the main process strings English by default.
  showNotification({
    title: workflowName,
    body: `Starting run in ${repoId}`,
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
      body: `Successfully completed in ${repoId}`,
      type: 'success',
      duration: 6000
    })
  } else {
    showNotification({
      title: workflowName,
      body: `Run failed in ${repoId}`,
      type: 'failure',
      duration: 0,
      actions: [
        { id: 'view-logs', label: 'View logs', primary: true },
        { id: 'close', label: 'Close' }
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
  payload: { messageKey: string; messageArgs?: Record<string, any>; sha?: string }
): void {
  sendToRenderer(IPC_CHANNELS.EVENT_SYNC, { repoId, type, ...payload })

  // Simplified desktop notification labels
  if (type === 'new-commit') {
    showNotification({
      title: 'New commit detected',
      body: `${repoId}: ${payload.messageArgs?.sha || ''}`,
      type: 'info',
      duration: 4000
    })
  } else if (type === 'error') {
    showNotification({
      title: 'Sync error',
      body: payload.messageArgs?.msg || '',
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
