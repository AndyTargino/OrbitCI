import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { initDatabase } from './db'
import { registerAllHandlers } from './ipc'
import { loadToken } from './services/credentialService'
import { initGitHub } from './services/githubService'
import { startSyncService, setRunner } from './services/syncService'
import { startScheduleService, setScheduleRunner } from './services/scheduleService'
import { setMainWindow } from './windowState'
import { processOAuthDeepLink } from './ipc/auth'
import { initNotificationManager } from './notification/manager'
import { cleanupOrphanedContainers } from './services/dockerService'
import { is } from '@electron-toolkit/utils'

// ─── Custom protocol for OAuth callback ───────────────────────────────────────
app.setAsDefaultProtocolClient('orbitci')

// ─── Single instance lock (required for Windows deep links) ───────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock && !is.dev) {
  app.quit()
}

// ─── Handle deep link from second instance (Windows) ─────────────────────────
app.on('second-instance', (_, argv) => {
  const url = argv.find((arg) => arg.startsWith('orbitci://'))
  if (url) {
    processOAuthDeepLink(url).catch(console.error)
  }
  // Focus the main window
  const wins = BrowserWindow.getAllWindows()
  if (wins[0]) {
    if (wins[0].isMinimized()) wins[0].restore()
    wins[0].focus()
  }
})

// ─── Handle deep link on macOS ────────────────────────────────────────────────
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith('orbitci://')) {
    processOAuthDeepLink(url).catch(console.error)
  }
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f17',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Initialize DB (synchronous, fast)
  initDatabase()

  // Register all IPC handlers
  const runner = registerAllHandlers()
  setRunner(runner)

  // Initialize custom notification manager
  initNotificationManager()

  // Clean up any containers left from a previous crash (non-blocking)
  cleanupOrphanedContainers().catch(() => { /* docker may not be running */ })

  // Show the window immediately — don't block on async operations
  createWindow()

  // Restore GitHub session in background (non-blocking)
  const token = loadToken()
  if (token) {
    initGitHub(token)
    startSyncService().catch((err) => {
      console.error('[Main] Failed to restore GitHub session:', err)
    })
  }

  // Start cron scheduler — runs regardless of GitHub token
  setScheduleRunner(runner)
  startScheduleService().catch((err) => {
    console.error('[Main] Failed to start schedule service:', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Handle window control IPC
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
