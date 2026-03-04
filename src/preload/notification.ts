import { contextBridge, ipcRenderer } from 'electron'

export interface NotificationData {
  id: string
  title: string
  body?: string
  type: 'success' | 'failure' | 'running' | 'warning' | 'info'
  duration?: number
  actions?: Array<{ id: string; label: string; primary?: boolean }>
}

contextBridge.exposeInMainWorld('notificationBridge', {
  onShow: (cb: (data: NotificationData) => void) => {
    ipcRenderer.on('notification:show', (_e, data) => cb(data))
  },
  onDismiss: (cb: () => void) => {
    ipcRenderer.on('notification:dismiss', () => cb())
  },
  clicked: (id: string) => ipcRenderer.send('notification:clicked', { id }),
  close: (id: string) => ipcRenderer.send('notification:close', { id }),
  action: (id: string, actionId: string) =>
    ipcRenderer.send('notification:action', { id, actionId }),
  pauseTimeout: (id: string) =>
    ipcRenderer.send('notification:pause-timeout', { id }),
  resumeTimeout: (id: string, remaining: number) =>
    ipcRenderer.send('notification:resume-timeout', { id, remaining }),
  resize: (id: string, height: number) =>
    ipcRenderer.send('notification:resize', { id, height })
})
