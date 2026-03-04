import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface NotificationOptions {
  title: string
  body?: string
  type?: 'success' | 'failure' | 'running' | 'warning' | 'info'
  duration?: number                                  // ms; 0 = no auto-dismiss
  actions?: Array<{ id: string; label: string; primary?: boolean }>
  onClick?: () => void
  onAction?: (actionId: string) => void
  onClose?: () => void
}

interface ActiveNotification {
  id: string
  window: BrowserWindow
  height: number
  timeout: ReturnType<typeof setTimeout> | null
  callbacks: Pick<NotificationOptions, 'onClick' | 'onAction' | 'onClose'>
}

// ─── Constants ────────────────────────────────────────────────────────────────
const WIDTH    = 360
const BASE_H   = 88    // estimated before resize
const MARGIN   = 12
const GAP      = 8
const DEFAULT_DURATION = 5000

// ─── State ────────────────────────────────────────────────────────────────────
const active: ActiveNotification[] = []
let handlersRegistered = false

// ─── HTML template ────────────────────────────────────────────────────────────
function buildHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;width:100%;height:100%;-webkit-user-select:none;user-select:none}

.wrap{
  padding:8px;
  width:100%;
}

.card{
  width:100%;
  background:rgba(14,14,16,0.97);
  backdrop-filter:blur(24px) saturate(160%);
  border:1px solid rgba(255,255,255,0.08);
  border-radius:10px;
  box-shadow:0 8px 32px rgba(0,0,0,0.55),0 0 0 1px rgba(255,255,255,0.03);
  overflow:hidden;
  cursor:pointer;
  position:relative;
  transform:translateX(calc(100% + 20px));
  opacity:0;
  transition:transform 0.32s cubic-bezier(0.16,1,0.3,1),opacity 0.32s ease;
}
.card.show{transform:translateX(0);opacity:1}
.card.dismiss{
  transform:translateX(calc(100% + 20px));
  opacity:0;
  transition:transform 0.24s cubic-bezier(0.4,0,1,1),opacity 0.24s ease;
}

.accent{
  position:absolute;left:0;top:0;bottom:0;width:3px;
  border-radius:10px 0 0 10px;
}
.accent-success{background:#3fb950}
.accent-failure{background:#f85149}
.accent-running{background:#58a6ff}
.accent-warning{background:#d29922}
.accent-info{background:rgba(180,180,190,0.4)}

.body{
  display:flex;align-items:flex-start;
  gap:10px;padding:12px 12px 12px 15px;
}

.icon-wrap{
  flex-shrink:0;width:20px;height:20px;margin-top:1px;
}
.icon-wrap svg{width:100%;height:100%}

.content{flex:1;min-width:0}

.meta{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:3px;
}
.app-name{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:rgba(200,200,210,.45);
}
.time-label{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:10px;color:rgba(200,200,210,.3);
}

.title{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:13px;font-weight:600;
  color:#e8e8ee;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  line-height:1.3;
}

.message{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:12px;
  color:rgba(200,200,210,.65);
  line-height:1.4;margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}

.actions{
  display:flex;gap:6px;
  padding:0 12px 11px 15px;
}
.btn{
  flex:1;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:12px;font-weight:500;
  padding:5px 10px;border-radius:6px;
  border:1px solid rgba(255,255,255,.10);
  background:rgba(255,255,255,.05);
  color:#e0e0e8;cursor:pointer;
  transition:background .14s,border-color .14s;
}
.btn:hover{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.18)}
.btn.primary{
  background:rgba(255,255,255,.13);
  border-color:rgba(255,255,255,.22);
}
.btn.primary:hover{background:rgba(255,255,255,.2)}

.timeout-bar{
  position:absolute;bottom:0;left:0;right:0;height:2px;
  background:rgba(255,255,255,.05);
}
.timeout-fill{
  height:100%;transform-origin:left;
}
.fill-success{background:#3fb950}
.fill-failure{background:#f85149}
.fill-running{background:#58a6ff}
.fill-warning{background:#d29922}
.fill-info{background:rgba(200,200,210,.35)}
</style>
</head>
<body>
<div class="wrap">
  <div class="card" id="card">
    <div class="accent" id="accent"></div>
    <div class="body">
      <div class="icon-wrap" id="icon"></div>
      <div class="content">
        <div class="meta">
          <span class="app-name">OrbitCI</span>
          <span class="time-label">agora</span>
        </div>
        <div class="title" id="title"></div>
        <div class="message" id="msg"></div>
      </div>
    </div>
    <div class="actions" id="actions" style="display:none"></div>
    <div class="timeout-bar"><div class="timeout-fill" id="fill"></div></div>
  </div>
</div>

<script>
const card   = document.getElementById('card')
const accent = document.getElementById('accent')
const iconEl = document.getElementById('icon')
const titleEl= document.getElementById('title')
const msgEl  = document.getElementById('msg')
const actEl  = document.getElementById('actions')
const fill   = document.getElementById('fill')

let currentId   = null
let remaining   = 0
let startedAt   = 0
let timerHandle = null
let paused      = false

const ICONS = {
  success: '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" stroke="#3fb950" stroke-width="1.5"/><path d="M6.5 10.5l2 2 5-5" stroke="#3fb950" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  failure: '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" stroke="#f85149" stroke-width="1.5"/><path d="M7 7l6 6M13 7l-6 6" stroke="#f85149" stroke-width="1.5" stroke-linecap="round"/></svg>',
  running: '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" stroke="#58a6ff" stroke-width="1.5"/><path d="M10 6v4.5l3 1.5" stroke="#58a6ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warning: '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 3.5L17.5 16.5H2.5L10 3.5Z" stroke="#d29922" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 9v3.5M10 14.5v.5" stroke="#d29922" stroke-width="1.5" stroke-linecap="round"/></svg>',
  info:    '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" stroke="rgba(200,200,210,0.5)" stroke-width="1.5"/><path d="M10 9v5M10 7v.5" stroke="rgba(200,200,210,0.5)" stroke-width="1.5" stroke-linecap="round"/></svg>',
}

function show(data) {
  currentId = data.id
  const type = data.type || 'info'

  titleEl.textContent = data.title || ''
  msgEl.textContent   = data.body  || ''
  msgEl.style.display = data.body  ? '' : 'none'

  accent.className = 'accent accent-' + type
  iconEl.innerHTML = ICONS[type] || ICONS.info

  // Actions
  if (data.actions && data.actions.length) {
    actEl.innerHTML = ''
    data.actions.forEach(a => {
      const b = document.createElement('button')
      b.className   = 'btn' + (a.primary ? ' primary' : '')
      b.textContent = a.label
      b.onclick = e => { e.stopPropagation(); window.notificationBridge.action(currentId, a.id) }
      actEl.appendChild(b)
    })
    actEl.style.display = 'flex'
  } else {
    actEl.style.display = 'none'
  }

  // Measure and report height so manager can position correctly
  requestAnimationFrame(() => {
    const h = document.body.scrollHeight
    window.notificationBridge.resize(currentId, h)

    // Show animation
    requestAnimationFrame(() => { card.classList.add('show') })
  })

  // Timeout bar
  const dur = data.duration !== undefined ? data.duration : 5000
  if (dur > 0) {
    remaining = dur
    startedAt = Date.now()
    fill.className = 'timeout-fill fill-' + type
    fill.style.transition = 'none'
    fill.style.transform  = 'scaleX(1)'
    requestAnimationFrame(() => {
      fill.style.transition = 'transform ' + dur + 'ms linear'
      fill.style.transform  = 'scaleX(0)'
    })
    scheduleTimeout(dur)
  } else {
    fill.style.transform = 'scaleX(0)'
  }
}

function scheduleTimeout(ms) {
  clearTimeout(timerHandle)
  timerHandle = setTimeout(dismiss, ms)
}

function dismiss() {
  clearTimeout(timerHandle)
  card.classList.remove('show')
  card.classList.add('dismiss')
  setTimeout(() => window.notificationBridge.close(currentId), 280)
}

// Hover: pause/resume timeout
card.addEventListener('mouseenter', () => {
  if (remaining > 0 && !paused) {
    paused = true
    clearTimeout(timerHandle)
    remaining -= (Date.now() - startedAt)
    // freeze bar at current position
    const computed = getComputedStyle(fill).transform
    fill.style.transition = 'none'
    fill.style.transform  = computed
    window.notificationBridge.pauseTimeout(currentId)
  }
})

card.addEventListener('mouseleave', () => {
  if (paused && remaining > 0) {
    paused    = false
    startedAt = Date.now()
    fill.style.transition = 'transform ' + remaining + 'ms linear'
    fill.style.transform  = 'scaleX(0)'
    scheduleTimeout(remaining)
    window.notificationBridge.resumeTimeout(currentId, remaining)
  }
})

card.addEventListener('click', () => {
  window.notificationBridge.clicked(currentId)
  dismiss()
})

window.notificationBridge.onShow(data => show(data))
window.notificationBridge.onDismiss(() => dismiss())
</script>
</body>
</html>`
}

// ─── Position helpers ─────────────────────────────────────────────────────────
function getWorkArea() {
  const { workArea } = screen.getPrimaryDisplay()
  return workArea
}

function calcY(index: number, heights: number[]): number {
  const wa = getWorkArea()
  let offset = MARGIN
  for (let i = 0; i < index; i++) {
    offset += heights[i] + GAP
  }
  return wa.y + wa.height - offset - (heights[index] ?? BASE_H)
}

function reposition(): void {
  const wa = getWorkArea()
  const heights = active.map((n) => n.height)

  active.forEach((notif, i) => {
    if (notif.window.isDestroyed()) return
    const y = calcY(i, heights)
    const x = wa.x + wa.width - WIDTH - MARGIN
    notif.window.setPosition(x, y, true)
  })
}

// ─── Create one notification window ──────────────────────────────────────────
function createWindow(id: string): BrowserWindow {
  const wa = getWorkArea()
  const x  = wa.x + wa.width - WIDTH - MARGIN
  const y  = wa.y + wa.height - BASE_H - MARGIN

  const preloadPath = join(__dirname, '../preload/notification.js')

  const win = new BrowserWindow({
    width:  WIDTH,
    height: BASE_H,
    x,
    y,
    frame:      false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:   false,
    movable:     false,
    focusable:   false,
    show:        false,
    webPreferences: {
      preload:          preloadPath,
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      devTools:         false
    }
  })

  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildHtml()))
  win.once('ready-to-show', () => win.show())

  return win
}

// ─── IPC handlers (register once) ────────────────────────────────────────────
function registerHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.on('notification:clicked', (_e, { id }: { id: string }) => {
    const notif = active.find((n) => n.id === id)
    if (notif?.callbacks.onClick) notif.callbacks.onClick()
  })

  ipcMain.on('notification:close', (_e, { id }: { id: string }) => {
    const notif = active.find((n) => n.id === id)
    if (notif?.callbacks.onClose) notif.callbacks.onClose()
    removeNotification(id)
  })

  ipcMain.on('notification:action', (_e, { id, actionId }: { id: string; actionId: string }) => {
    const notif = active.find((n) => n.id === id)
    if (notif?.callbacks.onAction) notif.callbacks.onAction(actionId)
    removeNotification(id)
  })

  ipcMain.on('notification:pause-timeout', (_e, { id }: { id: string }) => {
    const notif = active.find((n) => n.id === id)
    if (notif?.timeout) { clearTimeout(notif.timeout); notif.timeout = null }
  })

  ipcMain.on('notification:resume-timeout', (_e, { id, remaining }: { id: string; remaining: number }) => {
    const notif = active.find((n) => n.id === id)
    if (!notif) return
    notif.timeout = setTimeout(() => removeNotification(id), remaining)
  })

  ipcMain.on('notification:resize', (_e, { id, height }: { id: string; height: number }) => {
    const notif = active.find((n) => n.id === id)
    if (!notif || notif.window.isDestroyed()) return
    const clampedH = Math.min(Math.max(height, 64), 200)
    notif.height = clampedH
    notif.window.setSize(WIDTH, clampedH, false)
    reposition()
  })
}

// ─── Remove a notification ────────────────────────────────────────────────────
function removeNotification(id: string): void {
  const idx = active.findIndex((n) => n.id === id)
  if (idx === -1) return

  const notif = active[idx]
  if (notif.timeout) clearTimeout(notif.timeout)

  active.splice(idx, 1)

  // Destroy window after exit animation (280ms)
  setTimeout(() => {
    if (!notif.window.isDestroyed()) notif.window.close()
  }, 350)

  reposition()
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function initNotificationManager(): void {
  registerHandlers()
}

export function showNotification(opts: NotificationOptions): string {
  registerHandlers()

  const id       = uuidv4()
  const type     = opts.type ?? 'info'
  const duration = opts.duration !== undefined ? opts.duration : DEFAULT_DURATION

  const win = createWindow(id)

  const notif: ActiveNotification = {
    id,
    window: win,
    height: BASE_H,
    timeout: null,
    callbacks: {
      onClick:  opts.onClick,
      onAction: opts.onAction,
      onClose:  opts.onClose
    }
  }

  // Send data once renderer is ready
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('notification:show', {
      id,
      title:    opts.title,
      body:     opts.body,
      type,
      duration,
      actions:  opts.actions
    })
  })

  active.unshift(notif)
  reposition()

  // Fallback server-side timeout (in case renderer misses)
  if (duration > 0) {
    notif.timeout = setTimeout(() => removeNotification(id), duration + 800)
  }

  return id
}

export function dismissNotification(id: string): void {
  const notif = active.find((n) => n.id === id)
  if (!notif || notif.window.isDestroyed()) return
  notif.window.webContents.send('notification:dismiss')
  setTimeout(() => removeNotification(id), 300)
}

export function dismissAll(): void {
  for (const notif of [...active]) {
    dismissNotification(notif.id)
  }
}
