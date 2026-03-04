import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import { listSecrets, setSecret, deleteSecret } from '../services/secretService'

export function registerSecretHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SECRETS_LIST, async (_, scope: string) => {
    try {
      return listSecrets(scope)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao listar secrets: ${msg}`)
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.SECRETS_SET,
    async (_, scope: string, key: string, value: string) => {
      try {
        if (!key || !key.trim()) throw new Error('O nome do secret não pode ser vazio.')
        if (!value || !value.trim()) throw new Error('O valor do secret não pode ser vazio.')
        setSecret(scope, key, value)
        return { success: true }
      } catch (err) {
        if (err instanceof Error && (err.message.includes('não pode ser vazio'))) throw err
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('encrypt') || msg.includes('safeStorage')) {
          throw new Error('Erro ao criptografar o secret. Verifique se o sistema suporta armazenamento seguro.')
        }
        throw new Error(`Erro ao salvar secret: ${msg}`)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.SECRETS_DELETE, async (_, scope: string, key: string) => {
    try {
      deleteSecret(scope, key)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao remover secret: ${msg}`)
    }
  })
}
