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
