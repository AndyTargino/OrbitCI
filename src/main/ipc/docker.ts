import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import {
  getDockerStatus,
  listImages,
  listContainers,
  pullImage,
  removeContainer,
  installDocker
} from '../services/dockerService'

export function registerDockerHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DOCKER_STATUS, async () => {
    try {
      return await getDockerStatus()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao verificar status do Docker: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_IMAGES, async () => {
    try {
      return await listImages()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
        throw new Error('Não foi possível conectar ao Docker. Verifique se o Docker Desktop está rodando.')
      }
      throw new Error(`Erro ao listar imagens Docker: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_CONTAINERS, async () => {
    try {
      return await listContainers()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
        throw new Error('Não foi possível conectar ao Docker. Verifique se o Docker Desktop está rodando.')
      }
      throw new Error(`Erro ao listar containers Docker: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_PULL, async (_, image: string) => {
    try {
      await pullImage(image)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
        throw new Error('Não foi possível conectar ao Docker. Verifique se o Docker Desktop está rodando.')
      }
      if (msg.includes('not found') || msg.includes('404') || msg.includes('manifest unknown')) {
        throw new Error(`Imagem "${image}" não encontrada no Docker Hub. Verifique o nome da imagem.`)
      }
      if (msg.includes('unauthorized') || msg.includes('401')) {
        throw new Error(`Sem autorização para baixar a imagem "${image}". Pode ser necessário fazer docker login.`)
      }
      if (msg.includes('ENOSPC') || msg.includes('no space')) {
        throw new Error('Sem espaço em disco para baixar a imagem Docker.')
      }
      throw new Error(`Erro ao baixar imagem Docker "${image}": ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_REMOVE_CONTAINER, async (_, id: string) => {
    try {
      await removeContainer(id)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('running') || msg.includes('is running')) {
        throw new Error('Não é possível remover um container em execução. Pare-o primeiro.')
      }
      if (msg.includes('No such container') || msg.includes('404')) {
        throw new Error('Container não encontrado. Ele pode já ter sido removido.')
      }
      throw new Error(`Erro ao remover container: ${msg}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_INSTALL, async () => {
    try {
      return await installDocker()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Erro ao instalar Docker: ${msg}`)
    }
  })
}
