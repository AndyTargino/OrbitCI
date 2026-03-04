import pidusage from 'pidusage'
import Dockerode from 'dockerode'
import { execSync } from 'child_process'
import { db } from '../db'
import { runMetrics, runSteps } from '../db/schema'
import { eq } from 'drizzle-orm'

export interface MetricsSummary {
  peakCpu: number
  peakRam: number
  peakGpu: number | null
  peakGpuMem: number | null
}

interface SessionMeta {
  runId: string
  jobName: string
  stepName: string
}

interface BaseSession extends SessionMeta {
  timer: NodeJS.Timeout
  peakCpu: number
  peakRam: number
  peakGpu: number | null
  peakGpuMem: number | null
}

interface PidSession extends BaseSession {
  type: 'pid'
  pid: number
}

interface DockerSession extends BaseSession {
  type: 'docker'
  containerId: string
  docker: Dockerode
}

type MonitorSession = PidSession | DockerSession

let gpuAvailable: boolean | null = null

function checkGpuAvailable(): boolean {
  if (gpuAvailable !== null) return gpuAvailable
  try {
    execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    gpuAvailable = true
  } catch {
    gpuAvailable = false
  }
  return gpuAvailable
}

function readGpuMetrics(): { gpuPercent: number; gpuMemBytes: number } | null {
  if (!checkGpuAvailable()) return null
  try {
    const output = execSync(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits',
      { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim()
    const [gpuStr, memStr] = output.split(',').map((s) => s.trim())
    return {
      gpuPercent: parseFloat(gpuStr) || 0,
      gpuMemBytes: (parseFloat(memStr) || 0) * 1024 * 1024 // MiB → bytes
    }
  } catch {
    return null
  }
}

export class ProcessMonitor {
  private session: MonitorSession | null = null

  /** Monitor a local process by PID */
  start(pid: number, meta: SessionMeta): void {
    this.stop().catch(() => {})

    const session: PidSession = {
      type: 'pid',
      pid,
      ...meta,
      timer: null!,
      peakCpu: 0,
      peakRam: 0,
      peakGpu: null,
      peakGpuMem: null
    }

    session.timer = setInterval(() => {
      this.samplePid(session).catch(() => {})
    }, 1000)

    this.session = session
    this.samplePid(session).catch(() => {})
  }

  /** Monitor a Docker container by containerId */
  startDocker(containerId: string, meta: SessionMeta): void {
    this.stop().catch(() => {})

    const session: DockerSession = {
      type: 'docker',
      containerId,
      docker: new Dockerode(),
      ...meta,
      timer: null!,
      peakCpu: 0,
      peakRam: 0,
      peakGpu: null,
      peakGpuMem: null
    }

    session.timer = setInterval(() => {
      this.sampleDocker(session).catch(() => {})
    }, 1000)

    this.session = session
    this.sampleDocker(session).catch(() => {})
  }

  async stop(): Promise<MetricsSummary | null> {
    const s = this.session
    if (!s) return null

    clearInterval(s.timer)
    this.session = null

    if (s.type === 'pid') {
      try { pidusage.clear() } catch { /* ignore */ }
    }

    return {
      peakCpu: Math.round(s.peakCpu * 100) / 100,
      peakRam: s.peakRam,
      peakGpu: s.peakGpu,
      peakGpuMem: s.peakGpuMem
    }
  }

  dispose(): void {
    if (this.session) {
      clearInterval(this.session.timer)
      this.session = null
    }
    try { pidusage.clear() } catch { /* ignore */ }
  }

  private async samplePid(session: PidSession): Promise<void> {
    try {
      const stats = await pidusage(session.pid)
      const cpuPercent = stats.cpu ?? 0
      const ramBytes = stats.memory ?? 0

      this.updatePeaks(session, cpuPercent, ramBytes)
      await this.recordSample(session, cpuPercent, ramBytes)
    } catch {
      // Process may have exited — ignore
    }
  }

  private async sampleDocker(session: DockerSession): Promise<void> {
    try {
      const container = session.docker.getContainer(session.containerId)
      const stats = await container.stats({ stream: false }) as unknown as DockerStats

      // Calculate CPU% from Docker stats
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage
      const numCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0

      // RAM from Docker stats
      const ramBytes = stats.memory_stats.usage ?? 0

      this.updatePeaks(session, cpuPercent, ramBytes)
      await this.recordSample(session, cpuPercent, ramBytes)
    } catch {
      // Container may have stopped — ignore
    }
  }

  private updatePeaks(session: MonitorSession, cpuPercent: number, ramBytes: number): void {
    if (cpuPercent > session.peakCpu) session.peakCpu = cpuPercent
    if (ramBytes > session.peakRam) session.peakRam = ramBytes

    const gpu = readGpuMetrics()
    if (gpu) {
      if (session.peakGpu === null || gpu.gpuPercent > session.peakGpu) {
        session.peakGpu = gpu.gpuPercent
      }
      if (session.peakGpuMem === null || gpu.gpuMemBytes > session.peakGpuMem) {
        session.peakGpuMem = gpu.gpuMemBytes
      }
    }
  }

  private async recordSample(session: MonitorSession, cpuPercent: number, ramBytes: number): Promise<void> {
    const gpu = readGpuMetrics()
    await db.insert(runMetrics).values({
      runId: session.runId,
      jobName: session.jobName,
      stepName: session.stepName,
      timestamp: new Date().toISOString(),
      cpuPercent,
      ramBytes,
      gpuPercent: gpu?.gpuPercent ?? null,
      gpuMemBytes: gpu?.gpuMemBytes ?? null
    })
  }

  /** Save peak metrics to a step record */
  async savePeaksToStep(stepId: string, summary: MetricsSummary): Promise<void> {
    await db.update(runSteps).set({
      peakCpuPercent: summary.peakCpu,
      peakRamBytes: summary.peakRam,
      peakGpuPercent: summary.peakGpu,
      peakGpuMemBytes: summary.peakGpuMem
    }).where(eq(runSteps.id, stepId))
  }
}

// Docker stats API response shape
interface DockerStats {
  cpu_stats: {
    cpu_usage: {
      total_usage: number
      percpu_usage?: number[]
    }
    system_cpu_usage: number
    online_cpus?: number
  }
  precpu_stats: {
    cpu_usage: {
      total_usage: number
    }
    system_cpu_usage: number
  }
  memory_stats: {
    usage?: number
    limit?: number
  }
}
