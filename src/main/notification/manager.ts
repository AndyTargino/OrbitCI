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
const WIDTH    = 364
const BASE_H   = 88    // estimated before resize
const MARGIN   = 12
const GAP      = 8
const DEFAULT_DURATION = 5000

// ─── State ────────────────────────────────────────────────────────────────────
const active: ActiveNotification[] = []
let handlersRegistered = false

// ─── Platform detection ───────────────────────────────────────────────────────
type Platform = 'win32' | 'darwin' | 'linux'
const PLATFORM: Platform = process.platform as Platform

// ─── HTML template (platform-adaptive) ────────────────────────────────────────
function buildHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;width:100%;height:100%;-webkit-user-select:none;user-select:none}

/* ── Windows 11 style ────────────────────────────────────────── */
${PLATFORM === 'win32' ? `
.wrap{padding:4px;width:100%}
.card{
  width:100%;
  background:rgba(32,32,32,0.96);
  border:1px solid rgba(255,255,255,0.08);
  border-radius:8px;
  box-shadow:0 4px 20px rgba(0,0,0,0.42),0 0 0 1px rgba(255,255,255,0.04);
  overflow:hidden;
  cursor:pointer;
  position:relative;
  transform:translateY(100%);
  opacity:0;
  transition:transform 0.3s cubic-bezier(0.1,0.9,0.2,1),opacity 0.2s ease;
}
.card.show{transform:translateY(0);opacity:1}
.card.dismiss{
  transform:translateX(calc(100% + 20px));opacity:0;
  transition:transform 0.2s cubic-bezier(0.3,0,0.8,0.15),opacity 0.18s ease;
}
.accent{position:absolute;left:0;top:0;bottom:0;width:3px}
.body{display:flex;align-items:flex-start;gap:12px;padding:14px 16px 14px 16px}
.icon-wrap{flex-shrink:0;width:18px;height:18px;margin-top:1px}
.icon-wrap svg{width:100%;height:100%}
.content{flex:1;min-width:0}
.meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}
.app-name{
  font-family:'Segoe UI Variable Text','Segoe UI',sans-serif;
  font-size:11px;font-weight:400;color:rgba(255,255,255,0.45);
}
.time-label{
  font-family:'Segoe UI Variable Text','Segoe UI',sans-serif;
  font-size:11px;color:rgba(255,255,255,0.3);
}
.title{
  font-family:'Segoe UI Variable Text','Segoe UI',sans-serif;
  font-size:13px;font-weight:600;color:rgba(255,255,255,0.95);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35;
}
.message{
  font-family:'Segoe UI Variable Text','Segoe UI',sans-serif;
  font-size:12px;color:rgba(255,255,255,0.6);
  line-height:1.4;margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.actions{display:flex;gap:6px;padding:0 16px 12px 16px}
.btn{
  flex:1;
  font-family:'Segoe UI Variable Text','Segoe UI',sans-serif;
  font-size:12px;font-weight:400;
  padding:5px 12px;border-radius:4px;
  border:1px solid rgba(255,255,255,0.08);
  background:rgba(255,255,255,0.06);
  color:rgba(255,255,255,0.9);cursor:pointer;
  transition:background .12s;
}
.btn:hover{background:rgba(255,255,255,0.1)}
.btn.primary{background:rgba(96,165,250,0.2);border-color:rgba(96,165,250,0.3);color:#93c5fd}
.btn.primary:hover{background:rgba(96,165,250,0.3)}
.timeout-bar{position:absolute;bottom:0;left:0;right:0;height:2px;background:rgba(255,255,255,0.04)}
.timeout-fill{height:100%;transform-origin:left}
.close-btn{
  position:absolute;top:8px;right:8px;width:22px;height:22px;
  border:none;background:transparent;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  color:rgba(255,255,255,0.3);border-radius:4px;
  transition:background .12s,color .12s;font-size:14px;line-height:1;
  font-family:'Segoe UI',sans-serif;
}
.close-btn:hover{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7)}
` : ''}

/* ── macOS style ─────────────────────────────────────────────── */
${PLATFORM === 'darwin' ? `
.wrap{padding:6px;width:100%}
.card{
  width:100%;
  background:rgba(30,30,30,0.85);
  backdrop-filter:blur(40px) saturate(180%);
  -webkit-backdrop-filter:blur(40px) saturate(180%);
  border:0.5px solid rgba(255,255,255,0.12);
  border-radius:14px;
  box-shadow:0 8px 40px rgba(0,0,0,0.45),0 0 1px rgba(255,255,255,0.1);
  overflow:hidden;
  cursor:pointer;
  position:relative;
  transform:translateY(-10px) scale(0.96);
  opacity:0;
  transition:transform 0.35s cubic-bezier(0.2,1,0.3,1),opacity 0.25s ease;
}
.card.show{transform:translateY(0) scale(1);opacity:1}
.card.dismiss{
  transform:translateX(calc(100% + 20px));opacity:0;
  transition:transform 0.22s cubic-bezier(0.4,0,1,1),opacity 0.18s ease;
}
.accent{position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:14px 0 0 14px}
.body{display:flex;align-items:flex-start;gap:10px;padding:12px 14px}
.icon-wrap{flex-shrink:0;width:20px;height:20px;margin-top:1px}
.icon-wrap svg{width:100%;height:100%}
.content{flex:1;min-width:0}
.meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}
.app-name{
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;
  font-size:11px;font-weight:500;letter-spacing:0;
  color:rgba(255,255,255,0.4);
}
.time-label{
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;
  font-size:11px;color:rgba(255,255,255,0.25);
}
.title{
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;
  font-size:13px;font-weight:600;
  color:rgba(255,255,255,0.92);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;
}
.message{
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;
  font-size:12px;color:rgba(255,255,255,0.55);
  line-height:1.4;margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.actions{display:flex;gap:6px;padding:0 14px 10px 14px}
.btn{
  flex:1;
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;
  font-size:12px;font-weight:500;
  padding:5px 10px;border-radius:8px;
  border:none;
  background:rgba(255,255,255,0.1);
  color:rgba(255,255,255,0.85);cursor:pointer;
  transition:background .14s;
}
.btn:hover{background:rgba(255,255,255,0.16)}
.btn.primary{background:rgba(96,165,250,0.25);color:#93c5fd}
.btn.primary:hover{background:rgba(96,165,250,0.35)}
.timeout-bar{position:absolute;bottom:0;left:0;right:0;height:2px;background:rgba(255,255,255,0.04);border-radius:0 0 14px 14px}
.timeout-fill{height:100%;transform-origin:left;border-radius:0 0 0 14px}
.close-btn{display:none}
` : ''}

/* ── Linux / GTK style ───────────────────────────────────────── */
${PLATFORM === 'linux' ? `
.wrap{padding:4px;width:100%}
.card{
  width:100%;
  background:rgba(36,36,36,0.98);
  border:1px solid rgba(255,255,255,0.06);
  border-radius:12px;
  box-shadow:0 6px 24px rgba(0,0,0,0.5),0 0 0 1px rgba(0,0,0,0.2);
  overflow:hidden;
  cursor:pointer;
  position:relative;
  transform:translateY(20px);
  opacity:0;
  transition:transform 0.25s cubic-bezier(0.2,0.8,0.4,1),opacity 0.2s ease;
}
.card.show{transform:translateY(0);opacity:1}
.card.dismiss{
  transform:translateX(calc(100% + 20px));opacity:0;
  transition:transform 0.2s cubic-bezier(0.4,0,1,1),opacity 0.18s ease;
}
.accent{position:absolute;left:0;top:0;bottom:0;width:3px}
.body{display:flex;align-items:flex-start;gap:12px;padding:14px 16px}
.icon-wrap{flex-shrink:0;width:18px;height:18px;margin-top:1px}
.icon-wrap svg{width:100%;height:100%}
.content{flex:1;min-width:0}
.meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px}
.app-name{
  font-family:'Cantarell','Ubuntu','Noto Sans','Liberation Sans',sans-serif;
  font-size:11px;font-weight:700;letter-spacing:0.02em;
  color:rgba(255,255,255,0.45);
}
.time-label{
  font-family:'Cantarell','Ubuntu','Noto Sans',sans-serif;
  font-size:11px;color:rgba(255,255,255,0.3);
}
.title{
  font-family:'Cantarell','Ubuntu','Noto Sans','Liberation Sans',sans-serif;
  font-size:13px;font-weight:700;
  color:rgba(255,255,255,0.92);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35;
}
.message{
  font-family:'Cantarell','Ubuntu','Noto Sans','Liberation Sans',sans-serif;
  font-size:12px;color:rgba(255,255,255,0.6);
  line-height:1.4;margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.actions{display:flex;gap:8px;padding:0 16px 12px 16px}
.btn{
  flex:1;
  font-family:'Cantarell','Ubuntu','Noto Sans',sans-serif;
  font-size:12px;font-weight:500;
  padding:6px 12px;border-radius:6px;
  border:none;
  background:rgba(255,255,255,0.08);
  color:rgba(255,255,255,0.88);cursor:pointer;
  transition:background .12s;
}
.btn:hover{background:rgba(255,255,255,0.14)}
.btn.primary{background:rgba(98,160,234,0.25);color:#7dc4e4}
.btn.primary:hover{background:rgba(98,160,234,0.35)}
.timeout-bar{position:absolute;bottom:0;left:0;right:0;height:2px;background:rgba(255,255,255,0.04)}
.timeout-fill{height:100%;transform-origin:left}
.close-btn{
  position:absolute;top:8px;right:8px;width:24px;height:24px;
  border:none;background:transparent;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  color:rgba(255,255,255,0.3);border-radius:50%;
  transition:background .12s,color .12s;font-size:15px;line-height:1;
  font-family:'Cantarell','Ubuntu',sans-serif;
}
.close-btn:hover{background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7)}
` : ''}

/* ── Common accent/fill colors ───────────────────────────────── */
.accent-success{background:#3fb950}
.accent-failure{background:#f85149}
.accent-running{background:#58a6ff}
.accent-warning{background:#d29922}
.accent-info{background:rgba(180,180,190,0.4)}
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
    <button class="close-btn" id="closeBtn" title="Fechar">&times;</button>
    <div class="actions" id="actions" style="display:none"></div>
    <div class="timeout-bar"><div class="timeout-fill" id="fill"></div></div>
  </div>
</div>

<script>
const card     = document.getElementById('card')
const accent   = document.getElementById('accent')
const iconEl   = document.getElementById('icon')
const titleEl  = document.getElementById('title')
const msgEl    = document.getElementById('msg')
const actEl    = document.getElementById('actions')
const fill     = document.getElementById('fill')
const closeBtn = document.getElementById('closeBtn')

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

// Close button
closeBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  dismiss()
})

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
  // macOS: notifications come from top-right; Windows/Linux: bottom-right
  if (PLATFORM === 'darwin') {
    let offset = MARGIN
    for (let i = 0; i < index; i++) {
      offset += heights[i] + GAP
    }
    return wa.y + offset
  }
  // Windows / Linux: stack from bottom
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
  const y  = PLATFORM === 'darwin'
    ? wa.y + MARGIN
    : wa.y + wa.height - BASE_H - MARGIN

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
