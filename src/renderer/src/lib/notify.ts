import { electron } from './electron'

type NotifyType = 'success' | 'failure' | 'running' | 'warning' | 'info'

export function notify(type: NotifyType, title: string, body = ''): void {
  electron.notify.test({
    type,
    title,
    body,
    duration: type === 'failure' ? 8000 : 5000
  }).catch(() => { /* notification system unavailable */ })
}
