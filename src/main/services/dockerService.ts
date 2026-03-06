import Dockerode from 'dockerode'
import { exec, spawn } from 'child_process'
import { shell } from 'electron'
import type { DockerStatus, DockerContainer, DockerImage } from '@shared/types'
import { sendToRenderer } from './notifyService'
import { IPC_CHANNELS } from '@shared/constants'

let docker: Dockerode | null = null

function getDocker(): Dockerode {
  if (!docker) docker = new Dockerode()
  return docker
}

// Fun container name suffixes — bilingual puns
const ORBIT_NAMES_EN = [
  'launchpad', 'starship', 'booster', 'payload', 'liftoff', 'mission-control',
  'thruster', 'capsule', 'nebula', 'comet', 'meteor', 'asteroid', 'pulsar',
  'quasar', 'nova', 'orbiter', 'voyager', 'explorer', 'pioneer', 'horizon',
  'eclipse', 'aurora', 'cosmos', 'gravity', 'ignition', 'warp-drive'
]
const ORBIT_NAMES_PT = [
  'foguete', 'lancamento', 'missao', 'nave', 'estrela', 'cometa',
  'meteoro', 'nebulosa', 'pulsar', 'viajante', 'explorador', 'horizonte',
  'eclipse', 'aurora', 'cosmos', 'ignicao', 'propulsor', 'capsula',
  'asteroide', 'galaxia', 'constelacao', 'turbo', 'relampago', 'trovao'
]

function getOrbitName(): string {
  // Detect locale from env
  const lang = (process.env.LANG ?? process.env.LC_ALL ?? 'en').toLowerCase()
  const names = lang.startsWith('pt') ? ORBIT_NAMES_PT : ORBIT_NAMES_EN
  return names[Math.floor(Math.random() * names.length)]
}

/**
 * Generate a Docker-safe container name for OrbitCI.
 * Format: orbitci-{imageType}-{funName}-{jobName}-{runIdShort}
 * Example: orbitci-ubuntu-launchpad-build-7bef98e1
 */
function generateContainerName(runId: string, jobName: string, image: string): string {
  const funName = getOrbitName()
  // Extract image type: "ubuntu:22.04" -> "ubuntu", "node:20-alpine" -> "node"
  const imageType = image.split(':')[0].split('/').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'linux'
  const sanitizedJob = jobName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 20)
  const runShort = runId.replace(/-/g, '').slice(0, 8)
  return `orbitci-${imageType}-${funName}-${sanitizedJob}-${runShort}`
}

const LOG_PREFIX = '[OrbitCI Docker]'

/**
 * Strip ANSI escape sequences and terminal control codes from Docker TTY output.
 * Must handle all escape sequences to produce clean text for the UI.
 */
function stripAnsi(str: string): string {
  return str
    // Handle \r overwrite: "abc\rdef" → "def" (keep text after last \r per line)
    .replace(/^.*\r(?!\n)/gm, '')
    // CSI sequences: \x1b[ ... (params) ... (final byte) — covers colors, cursor, erase
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    // OSC sequences: \x1b] ... (terminated by BEL \x07 or ST \x1b\\)
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    // DCS/PM/APC sequences: \x1bP, \x1b^, \x1b_ ... ST
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '')
    // Two-char escape sequences: \x1b followed by any single char
    .replace(/\x1b./g, '')
    // Stray control characters (NUL, BEL, BS, VT, FF, SO-SUB, FS-US, DEL)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
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
  runTmpDir?: string
  env: Record<string, string>
  runId: string
  jobName: string
  isWindows?: boolean
}): Promise<string> {
  const d = getDocker()
  // Default env vars matching GitHub Actions runner behavior
  const defaultEnv: Record<string, string> = {
    DEBIAN_FRONTEND: 'noninteractive',
    PIP_BREAK_SYSTEM_PACKAGES: '1',
  }
  const mergedEnv = { ...defaultEnv, ...opts.env }
  const envArr = Object.entries(mergedEnv).map(([k, v]) => `${k}=${v}`)

  // Normalize paths for Docker bind mount (Windows paths need forward slashes)
  const repoPath = opts.repoPath.replace(/\\/g, '/')

  const keepAliveCmd = ['/bin/sh', '-c', 'sleep infinity']

  // ── Shadow Workspace strategy (like GitHub Actions) ──────────────────
  // Mount the host repo as READ-ONLY at /orbit/source
  // Use a Docker VOLUME for /workspace (native ext4 in WSL2 = fast I/O)
  // On bootstrap, we do `git clone --shared /orbit/source /workspace`
  // This gives us:
  //   - Isolation: build artifacts in /workspace don't affect the host repo
  //   - Performance: Docker volumes are 10-50x faster than bind mounts on Windows
  //   - Ephemerality: each job starts with a clean workspace (like GitHub Actions)
  const binds = [
    `${repoPath}:/orbit/source:ro`  // Host repo as read-only source
  ]
  if (opts.runTmpDir) {
    const tmpPath = opts.runTmpDir.replace(/\\/g, '/')
    binds.push(`${tmpPath}:/runner_tmp:rw`)
  }

  // Named Docker volumes for persistent caches between runs
  binds.push(
    'orbitci-npm-cache:/root/.npm',
    'orbitci-yarn-cache:/usr/local/share/.cache/yarn',
    'orbitci-pip-cache:/root/.cache/pip',
    'orbitci-go-cache:/root/go/pkg/mod',
    'orbitci-nuget-cache:/root/.nuget/packages',
    // NOTE: apt volumes (var/cache/apt, var/lib/apt) intentionally NOT shared.
    // Sharing /var/lib/apt across parallel containers causes dpkg lock conflicts (exit code 100).
    // The bootstrapped image already has essential packages pre-installed.
    // NVM cache — persists Node.js versions across runs without touching system dirs
    'orbitci-nvm:/root/.nvm'
  )

  const containerName = generateContainerName(opts.runId, opts.jobName, opts.image)
  console.log(`${LOG_PREFIX} Creating container "${containerName}" | image=${opts.image} | job=${opts.jobName}`)

  // Remove existing container with same name (from previous failed runs)
  try {
    const existing = d.getContainer(containerName)
    await existing.remove({ force: true })
    console.log(`${LOG_PREFIX} Removed stale container with same name: ${containerName}`)
  } catch { /* does not exist, ok */ }

  // Generate a per-job workspace volume name for isolation
  const runShort = opts.runId.replace(/-/g, '').slice(0, 8)
  const sanitizedJob = opts.jobName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase().slice(0, 20)
  const workspaceVolName = `orbitci-ws-${sanitizedJob}-${runShort}`

  const container = await d.createContainer({
    name: containerName,
    Image: opts.image,
    WorkingDir: '/workspace',
    Env: envArr,
    Labels: {
      'orbitci.run_id': opts.runId,
      'orbitci.job': opts.jobName,
      'orbitci.name': containerName,
      'orbitci.workspace_vol': workspaceVolName
    },
    HostConfig: {
      Binds: binds,
      Mounts: [
        {
          Target: '/workspace',
          Source: workspaceVolName,
          Type: 'volume' as const,
          ReadOnly: false
        }
      ],
      AutoRemove: false
    },
    Cmd: keepAliveCmd,
    Tty: true,      // TTY mode: simpler stream handling, no mux headers
    OpenStdin: false
  })

  await container.start()
  console.log(`${LOG_PREFIX} Container started: ${containerName} (${container.id.slice(0, 12)}) | workspace volume: ${workspaceVolName}`)
  return container.id
}

export async function execInContainer(
  containerId: string,
  command: string,
  workingDir?: string,
  isWindows?: boolean,
  shell?: string,
  onOutput?: (line: string) => void
): Promise<{ exitCode: number; output: string }> {
  const d = getDocker()
  const container = d.getContainer(containerId)

  // Verify container is running before exec
  try {
    const info = await container.inspect()
    if (!info.State.Running) {
      console.error(`${LOG_PREFIX} Container ${containerId.slice(0, 12)} is NOT running (State: ${info.State.Status}). Attempting restart...`)
      await container.start()
      console.log(`${LOG_PREFIX} Container restarted successfully.`)
    }
  } catch (inspectErr) {
    console.error(`${LOG_PREFIX} Failed to inspect container ${containerId.slice(0, 12)}:`, inspectErr)
  }

  // Resolve shell command based on explicit shell or defaults
  let cmd: string[]
  if (shell) {
    switch (shell) {
      case 'bash':
        cmd = ['bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', command]
        break
      case 'sh':
        cmd = ['/bin/sh', '-e', '-c', command]
        break
      case 'pwsh':
      case 'powershell':
        cmd = ['pwsh', '-command', command]
        break
      case 'python':
        cmd = ['python3', '-c', command]
        break
      case 'cmd':
        cmd = ['cmd', '/c', command]
        break
      default:
        cmd = ['/bin/sh', '-c', command]
        break
    }
  } else {
    cmd = ['/bin/sh', '-e', '-c', command]
  }

  const execObj = await container.exec({
    Cmd: cmd,
    Env: ['DEBIAN_FRONTEND=noninteractive', 'PIP_BREAK_SYSTEM_PACKAGES=1'],
    WorkingDir: workingDir ?? '/workspace',
    AttachStdout: true,
    AttachStderr: true,
    Tty: true  // Match container Tty setting — raw stream, no mux headers
  })

  return new Promise((resolve, reject) => {
    execObj.start({ hijack: true, stdin: false }, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
      if (err) return reject(err)
      if (!stream) return reject(new Error('No stream from exec'))

      let output = ''
      let lineBuffer = ''
      let escCarry = ''  // Carry incomplete escape sequences across chunks

      // With Tty:true, stream is raw (no Docker mux headers). Read directly.
      stream.on('data', (chunk: Buffer) => {
        let text = escCarry + chunk.toString('utf-8')
        escCarry = ''

        // If text ends with \x1b or an incomplete CSI sequence, carry to next chunk
        // This prevents escape codes split across chunks from leaking single chars
        const lastEsc = text.lastIndexOf('\x1b')
        if (lastEsc !== -1 && lastEsc >= text.length - 8) {
          // Check if the escape sequence after lastEsc is complete
          const tail = text.slice(lastEsc)
          const isComplete = /^\x1b(?:\[[\x20-\x3f]*[\x40-\x7e]|[^[])/.test(tail)
          if (!isComplete) {
            escCarry = tail
            text = text.slice(0, lastEsc)
          }
        }

        output += text

        // Stream lines in real-time via callback
        if (onOutput) {
          lineBuffer += text
          const lines = lineBuffer.split('\n')
          // Keep the last incomplete line in the buffer
          lineBuffer = lines.pop() ?? ''
          for (const line of lines) {
            const cleaned = stripAnsi(line).trim()
            if (cleaned) onOutput(cleaned)
          }
        }
      })

      stream.on('end', async () => {
        // Process any carried escape sequence
        if (escCarry) {
          output += escCarry
          if (onOutput) lineBuffer += escCarry
        }

        // Flush remaining line buffer
        if (onOutput && lineBuffer.trim()) {
          const cleaned = stripAnsi(lineBuffer).trim()
          if (cleaned) onOutput(cleaned)
        }

        try {
          const inspectData = await execObj.inspect()
          const exitCode = inspectData.ExitCode ?? 0
          if (exitCode !== 0) {
            const cleanOutput = stripAnsi(output).trim()
            const lastLines = cleanOutput.split('\n').slice(-15).join('\n')
            console.log(`${LOG_PREFIX} Exec exit code ${exitCode} | cmd: ${cmd.slice(-1)[0]?.slice(0, 80)}...`)
            console.log(`${LOG_PREFIX} Last 15 lines of output:\n${lastLines}`)
          }
          resolve({ exitCode, output: stripAnsi(output).trim() })
        } catch {
          resolve({ exitCode: 0, output: stripAnsi(output).trim() })
        }
      })

      stream.on('error', (streamErr: Error) => {
        console.error(`${LOG_PREFIX} Exec stream error:`, streamErr.message)
        reject(streamErr)
      })
    })
  })
}

export async function createServiceContainer(opts: {
  image: string
  env: Record<string, string>
  ports?: string[]
  runId: string
  jobName: string
  serviceName: string
}): Promise<string> {
  const d = getDocker()
  const envArr = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)

  // Parse port bindings
  const portBindings: Record<string, Array<{ HostPort: string }>> = {}
  if (opts.ports) {
    for (const port of opts.ports) {
      const parts = port.split(':')
      if (parts.length === 2) {
        portBindings[`${parts[1]}/tcp`] = [{ HostPort: parts[0] }]
      } else {
        portBindings[`${parts[0]}/tcp`] = [{ HostPort: parts[0] }]
      }
    }
  }

  const imageType = opts.image.split(':')[0].split('/').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'svc'
  const svcSanitized = opts.serviceName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 20)
  const runShort = opts.runId.replace(/-/g, '').slice(0, 8)
  const containerName = `orbitci-${imageType}-svc-${svcSanitized}-${runShort}`

  console.log(`${LOG_PREFIX} Creating service container "${containerName}" | image=${opts.image}`)

  // Remove stale container with same name
  try {
    const existing = d.getContainer(containerName)
    await existing.remove({ force: true })
  } catch { /* ok */ }

  const container = await d.createContainer({
    name: containerName,
    Image: opts.image,
    Env: envArr,
    Labels: {
      'orbitci.run_id': opts.runId,
      'orbitci.job': opts.jobName,
      'orbitci.service': opts.serviceName
    },
    HostConfig: {
      PortBindings: portBindings,
      AutoRemove: false
    },
    Tty: false
  })

  await container.start()
  console.log(`${LOG_PREFIX} Service "${opts.serviceName}" started: ${containerName} (${container.id.slice(0, 12)})`)
  return container.id
}

export async function stopAndRemoveContainer(containerId: string): Promise<void> {
  try {
    const d = getDocker()
    const container = d.getContainer(containerId)
    const info = await container.inspect().catch(() => null)
    const name = info?.Name?.replace(/^\//, '') ?? containerId.slice(0, 12)
    const wsVol = info?.Config?.Labels?.['orbitci.workspace_vol'] ?? null
    console.log(`${LOG_PREFIX} Stopping container: ${name}`)
    try {
      await container.stop({ t: 5 })
    } catch {
      // already stopped
    }
    await container.remove({ force: true })
    console.log(`${LOG_PREFIX} Removed container: ${name}`)

    // Clean up the ephemeral workspace volume
    if (wsVol) {
      try {
        const vol = d.getVolume(wsVol)
        await vol.remove({ force: true })
        console.log(`${LOG_PREFIX} Removed workspace volume: ${wsVol}`)
      } catch { /* volume may not exist or be in use */ }
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to remove container ${containerId.slice(0, 12)}:`, err)
  }
}

export async function removeContainer(containerId: string): Promise<void> {
  return stopAndRemoveContainer(containerId)
}

export async function ensureImageAvailable(image: string): Promise<void> {
  try {
    const d = getDocker()
    await d.getImage(image).inspect()
    console.log(`${LOG_PREFIX} Image ready (cached): ${image}`)
  } catch {
    console.log(`${LOG_PREFIX} Pulling image: ${image} ...`)
    await pullImage(image)
    console.log(`${LOG_PREFIX} Image pulled: ${image}`)
  }
}

/**
 * Get or build a pre-bootstrapped OrbitCI image for faster container startup.
 *
 * Instead of running apt-get install on every container, we build a local image
 * `orbitci/<base>:bootstrapped` with git, curl, ca-certificates, build-essential
 * already installed. This saves ~30-60s per container.
 *
 * The image is built once and cached locally. Subsequent runs reuse it.
 */
// Bump this version to force rebuild of all bootstrapped images
const BOOTSTRAP_VERSION = '4'

export async function getBootstrappedImage(baseImage: string): Promise<string> {
  const d = getDocker()
  const tag = `orbitci/${baseImage.replace(/[:/]/g, '-')}:bootstrapped`

  // Check if we already have it AND it's the current version
  try {
    const imgInfo = await d.getImage(tag).inspect()
    const imgVersion = imgInfo.Config?.Labels?.['orbitci.bootstrap_version'] ?? '0'
    if (imgVersion === BOOTSTRAP_VERSION) {
      console.log(`${LOG_PREFIX} Bootstrapped image ready: ${tag} (v${BOOTSTRAP_VERSION})`)
      return tag
    }
    // Outdated version — remove and rebuild
    console.log(`${LOG_PREFIX} Bootstrapped image outdated (v${imgVersion} -> v${BOOTSTRAP_VERSION}), rebuilding...`)
    try { await d.getImage(tag).remove({ force: true }) } catch { /* may be in use */ }
  } catch {
    // Need to build it
  }

  console.log(`${LOG_PREFIX} Building bootstrapped image: ${tag} (one-time, ~30s)...`)

  // Ensure base image exists
  await ensureImageAvailable(baseImage)

  // Create a temp container, install tools, commit as new image
  const container = await d.createContainer({
    Image: baseImage,
    Cmd: ['/bin/sh', '-c', `
      export DEBIAN_FRONTEND=noninteractive
      # Detect package manager and install essentials (matching GitHub Actions runner tools)
      if command -v apt-get >/dev/null 2>&1; then
        apt-get update -qq && apt-get install -y -qq \
          git curl ca-certificates build-essential sudo python3 python3-pip jq zip unzip \
          libarchive-tools rpm fakeroot dpkg \
          libgtk-3-0 libnotify4 libnss3 libxss1 libasound2 libgbm1 xvfb \
          >/dev/null 2>&1
      elif command -v apk >/dev/null 2>&1; then
        apk add --no-cache git curl ca-certificates build-base sudo python3 py3-pip jq zip unzip >/dev/null 2>&1
      elif command -v yum >/dev/null 2>&1; then
        yum install -y git curl ca-certificates make gcc gcc-c++ sudo python3 python3-pip jq zip unzip rpm-build >/dev/null 2>&1
      elif command -v dnf >/dev/null 2>&1; then
        dnf install -y git curl ca-certificates make gcc gcc-c++ sudo python3 python3-pip jq zip unzip rpm-build >/dev/null 2>&1
      fi
      # Upgrade pip to support --break-system-packages flag (PEP 668)
      python3 -m pip install --upgrade pip >/dev/null 2>&1 || true
      # Set PIP_BREAK_SYSTEM_PACKAGES so pip works like GitHub Actions runners
      echo 'export PIP_BREAK_SYSTEM_PACKAGES=1' >> /etc/profile
      echo 'PIP_BREAK_SYSTEM_PACKAGES=1' >> /etc/environment
      # Mark as bootstrapped
      echo "orbitci-bootstrapped" > /etc/orbitci-bootstrap-marker
    `],
    Tty: true
  })

  await container.start()
  // Wait for it to finish
  await container.wait()

  // Commit the container as a new image with version label
  await container.commit({
    repo: tag.split(':')[0],
    tag: tag.split(':')[1],
    comment: `OrbitCI bootstrapped image v${BOOTSTRAP_VERSION}`,
    author: 'OrbitCI',
    changes: [`LABEL orbitci.bootstrap_version="${BOOTSTRAP_VERSION}"`]
  })

  // Remove the temp container
  await container.remove({ force: true })

  console.log(`${LOG_PREFIX} Bootstrapped image built: ${tag}`)
  return tag
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

// ─── Docker installation with live progress ──────────────────────────────────
export type DockerInstallResult =
  | { status: 'success' }
  | { status: 'opened_browser'; url: string }
  | { status: 'error'; message: string }

function installLog(message: string, type: 'step' | 'output' | 'error' | 'success' = 'output') {
  sendToRenderer(IPC_CHANNELS.EVENT_DOCKER_INSTALL, { message, type })
}

/** Run a shell command with live stdout/stderr streaming to the renderer */
function spawnWithLogs(
  cmd: string,
  args: string[],
  label: string,
  timeout = 600_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    installLog(`$ ${label}`, 'step')
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      timeout
    })

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split('\n')) {
        if (line.trim()) installLog(line)
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split('\n')) {
        if (line.trim()) installLog(line)
      }
    })

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Exit code ${code}`))
    })

    proc.on('error', reject)
  })
}

/** Run a command silently, return stdout */
function execQuiet(cmd: string, timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/** Try to start the Docker daemon/service in background (no GUI window) */
async function startDockerService(): Promise<boolean> {
  // 1. Try starting the Windows service directly
  try {
    installLog('Iniciando serviço Docker (com.docker.service)...', 'step')
    await execQuiet('powershell -Command "Start-Service com.docker.service -ErrorAction Stop"', 15_000)
    installLog('Serviço Docker iniciado!', 'success')
    return true
  } catch {
    installLog('Serviço com.docker.service não encontrado ou sem permissão.', 'output')
  }

  // 2. Try starting Docker Desktop in background (hidden window)
  try {
    installLog('Iniciando Docker Desktop em segundo plano...', 'step')
    await execQuiet(
      'powershell -Command "Start-Process \'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe\' -ArgumentList \'--minimize\' -WindowStyle Hidden -ErrorAction Stop"',
      10_000
    )
    installLog('Docker Desktop iniciado em segundo plano! Aguarde alguns segundos e clique em "Verificar".', 'success')
    return true
  } catch {
    // fallback
  }

  // 3. Last resort — try without --minimize
  try {
    await execQuiet(
      'powershell -Command "Start-Process \'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe\' -WindowStyle Minimized -ErrorAction Stop"',
      10_000
    )
    installLog('Docker Desktop iniciado (minimizado). Aguarde alguns segundos e clique em "Verificar".', 'success')
    return true
  } catch {
    return false
  }
}

async function installDockerWindows(): Promise<DockerInstallResult> {
  // 0. Check if Docker Desktop is already installed but not running
  installLog('Verificando se Docker Desktop já está instalado...', 'step')
  try {
    const checkOutput = await execQuiet(
      'powershell -Command "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName -like \'*Docker Desktop*\' } | Select-Object -ExpandProperty DisplayName"',
      15_000
    )
    if (checkOutput.trim()) {
      installLog(`Docker Desktop já instalado: ${checkOutput.trim()}`, 'output')
      const started = await startDockerService()
      if (!started) {
        installLog('Não foi possível iniciar automaticamente. Inicie o Docker Desktop manualmente e clique em "Verificar".', 'error')
      }
      return { status: 'success' }
    }
  } catch {
    // Registry check failed — proceed with install
  }

  // 1. Try winget
  installLog('Verificando winget...', 'step')
  try {
    const wingetOutput = await new Promise<string>((resolve, reject) => {
      const proc = spawn('winget', ['install', '--id', 'Docker.DockerDesktop', '--silent', '--accept-source-agreements', '--accept-package-agreements'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        timeout: 600_000
      })
      let output = ''
      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8')
        output += text
        for (const line of text.split('\n')) {
          if (line.trim()) installLog(line.trim())
        }
      })
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8')
        output += text
        for (const line of text.split('\n')) {
          if (line.trim()) installLog(line.trim())
        }
      })
      proc.on('close', (code) => {
        if (code === 0) resolve(output)
        else reject(new Error(`Exit code ${code}: ${output}`))
      })
      proc.on('error', reject)
    })

    // Check if winget said it's already installed
    if (wingetOutput.includes('already installed') || wingetOutput.includes('No available upgrade') || wingetOutput.includes('No newer package')) {
      installLog('Docker Desktop já está instalado via winget.', 'output')
      await startDockerService()
      return { status: 'success' }
    }

    installLog('Docker Desktop instalado via winget!', 'success')
    await startDockerService()
    return { status: 'success' }
  } catch {
    installLog('winget falhou ou não disponível, tentando download direto...', 'output')
  }

  // 2. Download via PowerShell and run silently
  const installerUrl = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'
  const tempDir = process.env.TEMP ?? process.env.TMP ?? 'C:\\\\Temp'
  const installerPath = `${tempDir}\\\\DockerDesktopInstaller_${Date.now()}.exe`

  try {
    installLog('Baixando Docker Desktop Installer...', 'step')
    await spawnWithLogs(
      'powershell',
      ['-Command', `"$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${installerUrl}' -OutFile '${installerPath}' -UseBasicParsing"` ],
      `Download → ${installerPath}`,
      600_000
    )
    installLog('Download concluído. Executando instalador...', 'step')
    await spawnWithLogs(
      installerPath,
      ['install', '--quiet', '--accept-license'],
      'Docker Desktop Installer (silencioso)',
      600_000
    )
    // Cleanup temp file
    try { await execQuiet(`del "${installerPath}"`, 5_000) } catch { /* ignore */ }
    installLog('Docker Desktop instalado com sucesso!', 'success')
    return { status: 'success' }
  } catch {
    // Cleanup temp file on failure
    try { await execQuiet(`del "${installerPath}"`, 5_000) } catch { /* ignore */ }
    installLog('Instalação automática falhou. Abrindo página de download...', 'error')
    const url = 'https://docs.docker.com/desktop/setup/install/windows-install/'
    shell.openExternal(url)
    return { status: 'opened_browser', url }
  }
}

async function installDockerMac(): Promise<DockerInstallResult> {
  const isArm = process.arch === 'arm64'

  // 1. Try Homebrew
  installLog(`Arquitetura: ${isArm ? 'Apple Silicon (ARM64)' : 'Intel (x86_64)'}`, 'step')
  installLog('Verificando Homebrew...', 'step')
  try {
    await spawnWithLogs('brew', ['install', '--cask', 'docker'], 'brew install --cask docker', 600_000)
    installLog('Iniciando Docker Desktop...', 'step')
    try { await execQuiet('open -a Docker') } catch { /* ignore */ }
    installLog('Docker Desktop instalado via Homebrew!', 'success')
    return { status: 'success' }
  } catch {
    installLog('Homebrew não disponível, tentando download direto...', 'output')
  }

  // 2. Direct DMG download
  const dmgUrl = isArm
    ? 'https://desktop.docker.com/mac/main/arm64/Docker.dmg'
    : 'https://desktop.docker.com/mac/main/amd64/Docker.dmg'
  const dmgPath = '/tmp/Docker.dmg'

  try {
    installLog(`Baixando Docker Desktop (${isArm ? 'ARM64' : 'AMD64'})...`, 'step')
    await spawnWithLogs('curl', ['-fSL', '--progress-bar', '-o', dmgPath, dmgUrl], `curl → ${dmgPath}`, 600_000)

    installLog('Montando DMG...', 'step')
    await spawnWithLogs('hdiutil', ['attach', dmgPath, '-nobrowse', '-quiet'], 'hdiutil attach', 60_000)

    installLog('Copiando Docker.app para /Applications...', 'step')
    await spawnWithLogs('cp', ['-R', '/Volumes/Docker/Docker.app', '/Applications/'], 'cp Docker.app', 120_000)

    installLog('Desmontando DMG...', 'step')
    await spawnWithLogs('hdiutil', ['detach', '/Volumes/Docker', '-quiet'], 'hdiutil detach', 30_000)
    try { await execQuiet(`rm -f "${dmgPath}"`) } catch { /* ignore */ }

    installLog('Iniciando Docker Desktop...', 'step')
    try { await execQuiet('open -a Docker') } catch { /* ignore */ }

    installLog('Docker Desktop instalado com sucesso!', 'success')
    return { status: 'success' }
  } catch {
    installLog('Instalação automática falhou. Abrindo página de download...', 'error')
    const url = 'https://docs.docker.com/desktop/setup/install/mac-install/'
    shell.openExternal(url)
    return { status: 'opened_browser', url }
  }
}

async function installDockerLinux(): Promise<DockerInstallResult> {
  const user = process.env.USER ?? process.env.LOGNAME ?? ''

  // 1. Try official convenience script
  installLog('Tentando script oficial get.docker.com...', 'step')
  try {
    await spawnWithLogs('sh', ['-c', 'curl -fsSL https://get.docker.com | sh'], 'curl get.docker.com | sh', 600_000)

    if (user) {
      installLog(`Adicionando ${user} ao grupo docker...`, 'step')
      try { await spawnWithLogs('sudo', ['usermod', '-aG', 'docker', user], `usermod -aG docker ${user}`) } catch { /* ignore */ }
    }
    installLog('Habilitando serviço Docker...', 'step')
    try { await spawnWithLogs('sudo', ['systemctl', 'enable', '--now', 'docker'], 'systemctl enable --now docker') } catch { /* ignore */ }

    installLog('Docker instalado com sucesso!', 'success')
    return { status: 'success' }
  } catch {
    installLog('Script oficial falhou, tentando gerenciador de pacotes...', 'output')
  }

  // 2. Try package managers
  const managers: { check: string; install: string; label: string }[] = [
    {
      check: 'which apt-get',
      install: 'sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin',
      label: 'apt-get'
    },
    {
      check: 'which dnf',
      install: 'sudo dnf install -y docker docker-compose-plugin',
      label: 'dnf'
    },
    {
      check: 'which pacman',
      install: 'sudo pacman -S --noconfirm docker docker-compose',
      label: 'pacman'
    }
  ]

  for (const pm of managers) {
    try {
      await execQuiet(pm.check)
      installLog(`Detectado ${pm.label}, instalando Docker...`, 'step')
      await spawnWithLogs('sh', ['-c', pm.install], pm.install, 600_000)

      if (user) {
        try { await spawnWithLogs('sudo', ['usermod', '-aG', 'docker', user], `usermod -aG docker ${user}`) } catch { /* ignore */ }
      }
      try { await spawnWithLogs('sudo', ['systemctl', 'enable', '--now', 'docker'], 'systemctl enable --now docker') } catch { /* ignore */ }

      installLog('Docker instalado com sucesso!', 'success')
      return { status: 'success' }
    } catch { /* try next */ }
  }

  // 3. Fallback
  installLog('Nenhum método automático funcionou. Abrindo documentação...', 'error')
  const url = 'https://docs.docker.com/engine/install/'
  shell.openExternal(url)
  return { status: 'opened_browser', url }
}

export async function installDocker(): Promise<DockerInstallResult> {
  const platform = process.platform
  const osLabel = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'
  installLog(`Iniciando instalação do Docker para ${osLabel}...`, 'step')

  if (platform === 'win32') return installDockerWindows()
  if (platform === 'darwin') return installDockerMac()
  if (platform === 'linux') return installDockerLinux()

  const url = 'https://docs.docker.com/get-docker/'
  shell.openExternal(url)
  return { status: 'opened_browser', url }
}
