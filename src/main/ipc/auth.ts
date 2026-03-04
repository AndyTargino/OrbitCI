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
    try {
      if (!token || !token.trim()) {
        throw new Error('Token não pode ser vazio.')
      }
      const user = await validateToken(token)
      saveToken(token, user)
      initGitHub(token)
      startSyncService().catch(console.error)
      return { success: true, user }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Token não pode ser vazio')) throw err
      if (msg.includes('401') || msg.includes('Bad credentials') || msg.includes('Unauthorized')) {
        throw new Error('Token inválido ou expirado. Verifique se o token está correto e se não foi revogado.')
      }
      if (msg.includes('network') || msg.includes('ENOTFOUND') || msg.includes('fetch')) {
        throw new Error('Sem conexão com o GitHub. Verifique sua internet.')
      }
      if (msg.includes('rate limit') || msg.includes('403')) {
        throw new Error('Limite de requisições do GitHub atingido. Aguarde alguns minutos.')
      }
      throw new Error(`Erro no login: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    try {
      cancelOAuthFlow()
      clearCredentials()
      clearGitHub()
      stopSyncService()
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao fazer logout: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_USER, async () => {
    try {
      const token = loadToken()
      if (!token) return null
      return loadUser()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao carregar usuário: ${msg}`)
    }
  })

  // ─── GitHub OAuth Authorization Code Flow ─────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.AUTH_GITHUB_OAUTH_START,
    async (_, clientId: string, clientSecret: string) => {
      try {
        if (!clientId || !clientSecret) {
          throw new Error('Client ID e Client Secret são obrigatórios. Configure-os nas configurações do OAuth App.')
        }
        const authorizeUrl = startAuthCodeFlow(clientId, clientSecret)
        shell.openExternal(authorizeUrl)
        return { ok: true }
      } catch (err) {
        if (err instanceof Error && err.message.includes('Client ID')) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`Erro ao iniciar login OAuth: ${msg}`)
      }
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
      let friendlyError = result.error
      if (result.error.includes('state')) {
        friendlyError = 'Sessão OAuth expirada ou inválida. Tente fazer login novamente.'
      } else if (result.error.includes('code')) {
        friendlyError = 'Código de autorização inválido. Tente fazer login novamente.'
      }
      mainWindow.webContents.send(IPC_CHANNELS.EVENT_OAUTH_CALLBACK, {
        success: false,
        error: friendlyError
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
    let friendlyMsg = msg
    if (msg.includes('401') || msg.includes('Bad credentials')) {
      friendlyMsg = 'Token OAuth inválido. O GitHub pode ter negado a autorização. Tente novamente.'
    } else if (msg.includes('network') || msg.includes('ENOTFOUND')) {
      friendlyMsg = 'Sem conexão com o GitHub durante o OAuth. Verifique sua internet.'
    } else if (msg.includes('client_id') || msg.includes('redirect_uri')) {
      friendlyMsg = 'Configuração do OAuth App incorreta. Verifique o Client ID e a URL de callback (orbitci://callback).'
    }
    mainWindow.webContents.send(IPC_CHANNELS.EVENT_OAUTH_CALLBACK, {
      success: false,
      error: friendlyMsg
    })
  }
}
