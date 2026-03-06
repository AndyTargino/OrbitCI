import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { IPC_CHANNELS } from '../shared/constants'
import { initDatabase } from './db'
import { registerAllHandlers } from './ipc'
import { processOAuthDeepLink } from './ipc/auth'
import { initNotificationManager } from './notification/manager'
import { loadToken } from './services/credentialService'
import { cleanupOrphanedContainers } from './services/dockerService'
import { initGitHub } from './services/githubService'
import { stopAllWatchers } from './services/gitWatcherService'
import { setScheduleRunner, startScheduleService } from './services/scheduleService'
import { setRunner, startSyncService } from './services/syncService'
import { setMainWindow } from './windowState'

// ─── Auto-update configuration ───────────────────────────────────────────────
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function sendToRenderer(channel: string, ...args: unknown[]) {
  const wins = BrowserWindow.getAllWindows()
  if (wins[0]) wins[0].webContents.send(channel, ...args)
}

// Forward autoUpdater events to renderer
autoUpdater.on('checking-for-update', () => {
  sendToRenderer(IPC_CHANNELS.EVENT_UPDATER, { type: 'checking' })
})
autoUpdater.on('update-available', (info) => {
  sendToRenderer(IPC_CHANNELS.EVENT_UPDATER, {
    type: 'available',
    version: info.version,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
  })
})
autoUpdater.on('update-not-available', () => {
  sendToRenderer(IPC_CHANNELS.EVENT_UPDATER, { type: 'not-available' })
})
autoUpdater.on('download-progress', (progress) => {
  sendToRenderer(IPC_CHANNELS.EVENT_UPDATER, {
    type: 'progress',
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total
  })
})
autoUpdater.on('update-downloaded', (info) => {
  sendToRenderer(IPC_CHANNELS.EVENT_UPDATER, {
    type: 'downloaded',
    version: info.version
  })
})
autoUpdater.on('error', (err) => {
  sendToRenderer(IPC_CHANNELS.EVENT_UPDATER, {
    type: 'error',
    message: err?.message ?? 'Unknown error'
  })
})

// IPC handlers for updater actions
ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    return { success: true, version: result?.updateInfo?.version ?? null }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD, async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

ipcMain.handle(IPC_CHANNELS.UPDATER_INSTALL, () => {
  autoUpdater.quitAndInstall(false, true)
  return { success: true }
})

ipcMain.handle(IPC_CHANNELS.UPDATER_GET_VERSION, () => {
  return app.getVersion()
})

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
    backgroundColor: '#0a0a0a',
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

app.whenReady().then(async () => {
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

  // Check for updates (respect autoUpdate setting)
  if (!is.dev) {
    try {
      // Load settings to check autoUpdate preference
      const { sqlite } = await import('./db')
      const row = sqlite.prepare('SELECT auto_update FROM settings LIMIT 1').get() as { auto_update: number } | undefined
      const autoUpdateEnabled = row?.auto_update === 1

      if (autoUpdateEnabled) {
        // Auto-update: check + download + install on quit
        autoUpdater.autoDownload = true
        autoUpdater.checkForUpdates().catch(() => { })
      } else {
        // Manual: just check, don't download
        autoUpdater.autoDownload = false
        autoUpdater.checkForUpdates().catch(() => { })
      }
    } catch {
      // Fallback: just check
      autoUpdater.checkForUpdates().catch(() => { })
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopAllWatchers()
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
