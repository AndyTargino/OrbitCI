import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import {
  validateToken,
  initGitHub,
  clearGitHub
} from '../services/githubService'
import {
  saveToken,
  loadToken,
  loadUser,
  clearCredentials
} from '../services/credentialService'
import { startSyncService, stopSyncService } from '../services/syncService'
import { startAuthCodeFlow, handleOAuthCallback, cancelOAuthFlow } from '../services/githubOAuthService'
import { getMainWindow } from '../windowState'

export function registerAuthHandlers(): void {
  // ─── PAT login ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_, token: string) => {
    const user = await validateToken(token)
    saveToken(token, user)
    initGitHub(token)
    startSyncService().catch(console.error)
    return { success: true, user }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    cancelOAuthFlow()
    clearCredentials()
    clearGitHub()
    stopSyncService()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_USER, async () => {
    const token = loadToken()
    if (!token) return null
    return loadUser()
  })

  // ─── GitHub OAuth Authorization Code Flow ─────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.AUTH_GITHUB_OAUTH_START,
    async (_, clientId: string, clientSecret: string) => {
      if (!clientId || !clientSecret) {
        throw new Error('Client ID e Client Secret são obrigatórios.')
      }
      const authorizeUrl = startAuthCodeFlow(clientId, clientSecret)
      shell.openExternal(authorizeUrl)
      return { ok: true }
    }
  )
}

// ─── Called from main process when orbitci:// deep link arrives ───────────────
export async function processOAuthDeepLink(callbackUrl: string): Promise<void> {
  const mainWindow = getMainWindow()
  if (!mainWindow) return

  try {
    const result = await handleOAuthCallback(callbackUrl)

    if ('error' in result) {
      mainWindow.webContents.send(IPC_CHANNELS.EVENT_OAUTH_CALLBACK, {
        success: false,
        error: result.error
      })
      return
    }

    const user = await validateToken(result.token)
    saveToken(result.token, user)
    initGitHub(result.token)
    startSyncService().catch(console.error)

    mainWindow.webContents.send(IPC_CHANNELS.EVENT_OAUTH_CALLBACK, {
      success: true,
      user
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    mainWindow.webContents.send(IPC_CHANNELS.EVENT_OAUTH_CALLBACK, {
      success: false,
      error: msg
    })
  }
}
