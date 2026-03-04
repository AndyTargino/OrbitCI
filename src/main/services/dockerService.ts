import Dockerode from 'dockerode'
import { exec } from 'child_process'
import { shell } from 'electron'
import type { DockerStatus, DockerContainer, DockerImage } from '@shared/types'
import { sendToRenderer } from './notifyService'
import { IPC_CHANNELS } from '@shared/constants'

let docker: Dockerode | null = null

function getDocker(): Dockerode {
  if (!docker) docker = new Dockerode()
  return docker
}

export async function getDockerStatus(): Promise<DockerStatus> {
  try {
    const d = getDocker()
    const info = await d.version()
    return {
      available: true,
      version: info.Version ?? null,
      error: null
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { available: false, version: null, error: msg }
  }
}

export async function listImages(): Promise<DockerImage[]> {
  const d = getDocker()
  const images = await d.listImages()
  return images.map((img) => ({
    id: img.Id,
    tags: img.RepoTags ?? [],
    size: img.Size,
    created: img.Created
  }))
}

export async function listContainers(): Promise<DockerContainer[]> {
  const d = getDocker()
  const containers = await d.listContainers({ all: true })
  return containers.map((c) => ({
    id: c.Id,
    name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
    image: c.Image,
    status: c.Status,
    runId: c.Labels?.['orbitci.run_id'] ?? null
  }))
}

export async function pullImage(imageName: string): Promise<void> {
  const d = getDocker()
  return new Promise((resolve, reject) => {
    d.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err)
      d.modem.followProgress(
        stream,
        (err2: Error | null) => {
          if (err2) reject(err2)
          else resolve()
        },
        (event: { status?: string; progress?: string }) => {
          sendToRenderer(IPC_CHANNELS.EVENT_DOCKER_LOG, {
            message: `${event.status ?? ''} ${event.progress ?? ''}`.trim()
          })
        }
      )
    })
  })
}

export async function createWorkflowContainer(opts: {
  image: string
  repoPath: string
  env: Record<string, string>
  runId: string
  jobName: string
}): Promise<string> {
  const d = getDocker()
  const envArr = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)

  const container = await d.createContainer({
    Image: opts.image,
    WorkingDir: '/workspace',
    Env: envArr,
    Labels: {
      'orbitci.run_id': opts.runId,
      'orbitci.job': opts.jobName
    },
    HostConfig: {
      Binds: [`${opts.repoPath}:/workspace:rw`],
      AutoRemove: false
    },
    Cmd: ['/bin/sh', '-c', 'tail -f /dev/null'], // keep alive
    Tty: false
  })

  await container.start()
  return container.id
}

export async function execInContainer(
  containerId: string,
  command: string,
  workingDir?: string
): Promise<{ exitCode: number; output: string }> {
  const d = getDocker()
  const container = d.getContainer(containerId)

  const exec = await container.exec({
    Cmd: ['/bin/sh', '-c', command],
    WorkingDir: workingDir ?? '/workspace',
    AttachStdout: true,
    AttachStderr: true
  })

  return new Promise((resolve, reject) => {
    exec.start({ hijack: true, stdin: false }, (err, stream) => {
      if (err) return reject(err)
      if (!stream) return reject(new Error('No stream from exec'))

      let output = ''
      const chunks: Buffer[] = []

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        // Docker multiplexes stdout/stderr — strip 8-byte header
        if (chunk.length > 8) {
          const content = chunk.slice(8).toString('utf-8')
          output += content
        }
      })

      stream.on('end', async () => {
        try {
          const inspectData = await exec.inspect()
          resolve({ exitCode: inspectData.ExitCode ?? 0, output: output.trim() })
        } catch {
          resolve({ exitCode: 0, output: output.trim() })
        }
      })

      stream.on('error', reject)
    })
  })
}

export async function stopAndRemoveContainer(containerId: string): Promise<void> {
  try {
    const d = getDocker()
    const container = d.getContainer(containerId)
    try {
      await container.stop({ t: 5 })
    } catch {
      // already stopped
    }
    await container.remove({ force: true })
  } catch (err) {
    console.warn('[Docker] Failed to remove container:', containerId, err)
  }
}

export async function removeContainer(containerId: string): Promise<void> {
  return stopAndRemoveContainer(containerId)
}

export async function ensureImageAvailable(image: string): Promise<void> {
  try {
    const d = getDocker()
    await d.getImage(image).inspect()
  } catch {
    // image not found locally, pull it
    await pullImage(image)
  }
}

// ─── Cleanup orphaned containers left from crashed runs ───────────────────────
export async function cleanupOrphanedContainers(): Promise<void> {
  try {
    const d = getDocker()
    const containers = await d.listContainers({
      all: true,
      filters: JSON.stringify({ label: ['orbitci.run_id'] })
    })
    for (const c of containers) {
      try {
        const container = d.getContainer(c.Id)
        try { await container.stop({ t: 3 }) } catch { /* already stopped */ }
        await container.remove({ force: true })
        console.log('[Docker] Cleaned up orphaned container:', c.Id.slice(0, 12))
      } catch (err) {
        console.warn('[Docker] Could not remove orphaned container:', c.Id.slice(0, 12), err)
      }
    }
  } catch {
    // Docker not available, skip silently
  }
}

// ─── Docker installation ───────────────────────────────────────────────────────
export type DockerInstallResult =
  | { status: 'success' }
  | { status: 'opened_browser'; url: string }
  | { status: 'error'; message: string }

export async function installDocker(): Promise<DockerInstallResult> {
  const platform = process.platform

  if (platform === 'linux') {
    // Try the official convenience script — runs fully automatically
    return new Promise((resolve) => {
      exec(
        'curl -fsSL https://get.docker.com | sh',
        { timeout: 300_000 },
        (err) => {
          if (err) {
            // Fallback: open browser
            shell.openExternal('https://docs.docker.com/engine/install/')
            resolve({ status: 'opened_browser', url: 'https://docs.docker.com/engine/install/' })
          } else {
            resolve({ status: 'success' })
          }
        }
      )
    })
  }

  if (platform === 'win32') {
    // Try winget first (available on Windows 10 1809+)
    return new Promise((resolve) => {
      exec(
        'winget install --id Docker.DockerDesktop --silent --accept-source-agreements --accept-package-agreements',
        { timeout: 300_000 },
        (err) => {
          if (err) {
            const url = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'
            shell.openExternal(url)
            resolve({ status: 'opened_browser', url })
          } else {
            resolve({ status: 'success' })
          }
        }
      )
    })
  }

  if (platform === 'darwin') {
    // Try Homebrew first
    return new Promise((resolve) => {
      exec(
        'brew install --cask docker',
        { timeout: 300_000 },
        (err) => {
          if (err) {
            const url = 'https://desktop.docker.com/mac/main/amd64/Docker.dmg'
            shell.openExternal(url)
            resolve({ status: 'opened_browser', url })
          } else {
            resolve({ status: 'success' })
          }
        }
      )
    })
  }

  const url = 'https://docs.docker.com/get-docker/'
  shell.openExternal(url)
  return { status: 'opened_browser', url }
}
