import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import { listSecrets, setSecret, deleteSecret } from '../services/secretService'

export function registerSecretHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SECRETS_LIST, async (_, scope: string) => {
    return listSecrets(scope)
  })

  ipcMain.handle(
    IPC_CHANNELS.SECRETS_SET,
    async (_, scope: string, key: string, value: string) => {
      setSecret(scope, key, value)
      return { success: true }
    }
  )

  ipcMain.handle(IPC_CHANNELS.SECRETS_DELETE, async (_, scope: string, key: string) => {
    deleteSecret(scope, key)
    return { success: true }
  })
}
