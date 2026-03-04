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
    return getDockerStatus()
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_IMAGES, async () => {
    return listImages()
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_CONTAINERS, async () => {
    return listContainers()
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_PULL, async (_, image: string) => {
    await pullImage(image)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_REMOVE_CONTAINER, async (_, id: string) => {
    await removeContainer(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.DOCKER_INSTALL, async () => {
    return installDocker()
  })
}
