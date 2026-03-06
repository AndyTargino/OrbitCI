import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db'
import { runJobs, runSteps, runLogs } from '../db/schema'
import { runStep } from './stepRunner'
import { evaluateExpression, evaluateCondition, resolveEnv, type ExpressionContext } from './expressionEngine'
import {
  ensureImageAvailable,
  createWorkflowContainer,
  execInContainer,
  stopAndRemoveContainer,
  getBootstrappedImage
} from '../services/dockerService'
import { resolveDockerImage, isWindowsImage, isWindowsTarget, isMacOSTarget } from './imageResolver'
import { sendRunLog, sendToRenderer } from '../services/notifyService'
import { IPC_CHANNELS } from '@shared/constants'
import type { ProcessMonitor } from '../services/processMonitor'
import type { JobDefinition, ServiceDefinition } from '@shared/types'

export interface JobRunnerOpts {
  runId: string
  repoId: string
  jobName: string
  job: JobDefinition
  workspace: string
  runTmpDir: string
  baseEnv: Record<string, string>
  baseCtx: ExpressionContext
  cancelCheck: () => boolean
  monitor?: ProcessMonitor
  /** Shared container pool for reuse across jobs with the same image in a run */
  containerPool?: Map<string, string>
}

export interface JobResult {
  status: 'success' | 'failure' | 'cancelled'
  outputs: Record<string, string>
  durationMs: number
}

export async function runJob(opts: JobRunnerOpts): Promise<JobResult> {
  const { runId, repoId, jobName, job, workspace, runTmpDir, baseEnv, baseCtx, cancelCheck, monitor, containerPool } = opts
  const jobId = uuidv4()
  const start = Date.now()
  const runShort = runId.replace(/-/g, '').slice(0, 8)
  const JOB_TAG = `[OrbitCI Job] [${runShort}/${jobName}]`

  console.log(`${JOB_TAG} Starting job...`)

  // Insert job record
  await db.insert(runJobs).values({
    id: jobId,
    runId,
    jobName,
    status: 'running',
    startedAt: new Date().toISOString()
  })

  sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, { runId, status: 'running', jobName })

  const log = async (
    message: string,
    type: string = 'output',
    stepName?: string
  ) => {
    // Also log to Electron terminal (ASCII-safe)
    console.log(`${JOB_TAG}${stepName ? ` [${stepName}]` : ''} ${message}`)
    await db.insert(runLogs).values({
      runId,
      jobName,
      stepName: stepName ?? null,
      message,
      type,
      timestamp: new Date().toISOString()
    })
    sendRunLog(runId, jobName, stepName ?? null, message, type)
  }

  // Job env
  const env: Record<string, string> = {
    ...baseEnv,
    ...(job.env ?? {}),
    ORBIT_JOB: jobName
  }

  const ctx: ExpressionContext = { ...baseCtx, env }

  // ── ALWAYS create a Docker container for this job ──────────────────────────
  const runsOn = job['runs-on'] ? evaluateExpression(job['runs-on'], ctx) : undefined

  // Set RUNNER_OS based on target platform (like GitHub Actions)
  env.RUNNER_OS = isWindowsTarget(runsOn) ? 'Windows' : isMacOSTarget(runsOn) ? 'macOS' : 'Linux'
  const containerImage = job.container
    ? evaluateExpression(job.container, ctx)
    : undefined
  const image = resolveDockerImage(runsOn, containerImage)
  const isWin = isWindowsImage(runsOn)

  console.log(`${JOB_TAG} Image: ${image} | runs-on: ${runsOn ?? 'default'} | container: ${containerImage ?? 'none'}`)

  let containerId: string
  let reusedContainer = false
  let actualImage = image
  try {
    await log(`[Docker] Preparing image: ${image}`, 'info')

    // Check if a container with the same image is available in the pool
    const pooledId = containerPool?.get(image)
    if (pooledId) {
      containerId = pooledId
      reusedContainer = true
      containerPool.delete(image)
      await log(`[OK] Reusing container: ${containerId.slice(0, 12)} (${image})`, 'info')
      console.log(`${JOB_TAG} Reusing pooled container ${containerId.slice(0, 12)}`)
      // Fresh workspace clone for isolation (like GitHub Actions)
      try {
        await execInContainer(containerId, `
          rm -rf /workspace/* /workspace/.* 2>/dev/null || true
          if [ -d /orbit/source/.git ]; then
            git clone --shared --no-checkout /orbit/source /workspace 2>/dev/null
            cd /workspace && git checkout -f HEAD 2>/dev/null
          else
            cp -a /orbit/source/. /workspace/ 2>/dev/null || true
          fi
        `)
      } catch { /* best effort */ }

      // Run cross-compilation setup if this reused container needs it
      const needsWinTools = isWindowsTarget(runsOn)
      const needsMacTools = isMacOSTarget(runsOn)
      if (needsWinTools || needsMacTools) {
        await log(`Cross-compilation: instalando ferramentas para ${needsWinTools ? 'Windows' : ''}${needsWinTools && needsMacTools ? ' + ' : ''}${needsMacTools ? 'macOS' : ''}`, 'info')
        const crossScript = buildCrossCompileScript(needsWinTools, needsMacTools)
        try {
          const crossStreamLog = (line: string) => { log(line, 'output') }
          await execInContainer(containerId, crossScript, undefined, isWin, undefined, crossStreamLog)
        } catch { /* non-critical */ }
      }
    } else {
      // Try to use a pre-bootstrapped image (skips apt-get install ~30-60s)
      try {
        actualImage = await getBootstrappedImage(image)
        console.log(`${JOB_TAG} Using bootstrapped image: ${actualImage}`)
      } catch (bErr) {
        console.log(`${JOB_TAG} Bootstrapped image unavailable, using base: ${image}`)
        await ensureImageAvailable(image)
      }

      containerId = await createWorkflowContainer({
        image: actualImage,
        repoPath: workspace,
        runTmpDir,
        env,
        runId,
        jobName,
        isWindows: isWin
      })
      await log(`[OK] Container started: ${containerId.slice(0, 12)} (${actualImage})`, 'info')

      // ── Bootstrap: configure git auth + temp files (skip install if bootstrapped) ──
      console.log(`${JOB_TAG} Running container bootstrap...`)
      await bootstrapContainer(containerId, env, isWin, runsOn, log)
      console.log(`${JOB_TAG} Bootstrap complete.`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_TAG} FAILED to create container: ${msg}`)
    await log(`[FAIL] Could not create Docker container: ${msg}`, 'error')
    await log(`  Image: ${image} | runs-on: ${runsOn ?? 'not set'}`, 'error')
    await finalizeJob(jobId, 'failure', Date.now() - start)
    return { status: 'failure', outputs: {}, durationMs: Date.now() - start }
  }

  // ── Start service containers (databases, caches, etc.) ───────────────────
  const serviceContainerIds: string[] = []
  if (job.services) {
    for (const [svcName, svc] of Object.entries(job.services as Record<string, ServiceDefinition>)) {
      try {
        await log(`[Service] ${svcName} (${svc.image})`, 'info')
        await ensureImageAvailable(svc.image)
        const { createServiceContainer } = await import('../services/dockerService')
        const svcId = await createServiceContainer({
          image: svc.image,
          env: svc.env ?? {},
          ports: svc.ports,
          runId,
          jobName,
          serviceName: svcName
        })
        serviceContainerIds.push(svcId)
        // Inject service hostname into job env (GitHub Actions convention)
        env[`SERVICES_${svcName.toUpperCase()}_HOST`] = svcName
        await log(`[OK] Service ${svcName} iniciado: ${svcId.slice(0, 12)}`, 'info')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await log(`[WARN] Service ${svcName} falhou: ${msg}`, 'warning')
      }
    }
  }

  // ── Job timeout ─────────────────────────────────────────────────────────
  const timeoutMs = (job['timeout-minutes'] ?? 360) * 60 * 1000 // default 6h like GitHub
  let timedOut = false
  const timeoutTimer = setTimeout(() => { timedOut = true }, timeoutMs)

  const outputs: Record<string, string> = {}
  let jobStatus: 'success' | 'failure' | 'cancelled' = 'success'

  try {
    await log(`>> Job: ${jobName}`, 'job')
    console.log(`${JOB_TAG} Executing ${(job.steps ?? []).length} steps...`)

    const steps = job.steps ?? []
    for (let i = 0; i < steps.length; i++) {
      if (cancelCheck()) {
        console.log(`${JOB_TAG} Cancelled by user.`)
        jobStatus = 'cancelled'
        break
      }
      if (timedOut) {
        console.log(`${JOB_TAG} Timed out after ${job['timeout-minutes'] ?? 360} min.`)
        await log(`[TIMEOUT] Job timeout (${job['timeout-minutes'] ?? 360} min)`, 'error')
        jobStatus = 'failure'
        break
      }

      const step = steps[i]
      const stepId = uuidv4()
      const stepName = step.name ?? step.run?.slice(0, 40) ?? step.uses ?? step.OrbitCI ?? `Step ${i + 1}`

      console.log(`${JOB_TAG} Step ${i + 1}/${steps.length}: ${stepName}`)

      await db.insert(runSteps).values({
        id: stepId,
        runId,
        jobId,
        stepName,
        stepIndex: i,
        status: 'running',
        startedAt: new Date().toISOString()
      })

      sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, {
        runId,
        status: 'running',
        jobName,
        stepName,
        stepStatus: 'running'
      })

      await log(`  > ${stepName}`, 'step', stepName)

      // Step-level env
      const stepEnv = { ...env, ...resolveEnv(step.env, ctx) }

      const result = await runStep({
        step,
        stepIndex: i,
        workspace,
        env: stepEnv,
        ctx: { ...ctx, env: stepEnv },
        log: async (msg) => log(msg, 'output', stepName),
        setOutput: (k, v) => { outputs[k] = v; env[k] = v },
        containerId,
        isWindows: isWin,
        monitor,
        stepId,
        runId,
        jobName,
        repoId
      })

      // Stop monitor and save metrics for this step
      if (monitor) {
        const metrics = await monitor.stop()
        if (metrics) {
          await monitor.savePeaksToStep(stepId, metrics)
        }
      }

      // Parse GITHUB_OUTPUT file -> expose as step outputs for expressions
      const hostOutputFile = join(runTmpDir, 'github_output')
      if (existsSync(hostOutputFile)) {
        try {
          const content = readFileSync(hostOutputFile, 'utf-8').trim()
          if (content) {
            const parsed = parseGitHubOutput(content)
            for (const [k, v] of Object.entries(parsed)) {
              outputs[k] = v
              result.outputs[k] = v
            }
            writeFileSync(hostOutputFile, '') // Clear for next step
          }
        } catch { /* ignore */ }
      }

      // Update ctx.steps so subsequent steps can use ${{ steps.<id>.outputs.<key> }}
      const stepIdKey = step.id ?? step.name?.replace(/\s+/g, '_').toLowerCase() ?? `step_${i}`
      ctx.steps[stepIdKey] = {
        outputs: { ...result.outputs },
        outcome: result.status
      }
      if (Object.keys(result.outputs).length > 0) {
        console.log(`${JOB_TAG} Step '${stepIdKey}' outputs:`, JSON.stringify(result.outputs))
      }

      // Parse GITHUB_ENV file -> propagate env vars to subsequent steps
      const hostEnvFile = join(runTmpDir, 'github_env')
      if (existsSync(hostEnvFile)) {
        try {
          const content = readFileSync(hostEnvFile, 'utf-8').trim()
          if (!content) { /* empty, skip */ }
          const parsedEnv = parseGitHubOutput(content)
          for (const [k, v] of Object.entries(parsedEnv)) {
            env[k] = v
          }
        } catch { /* ignore */ }
      }

      // Update step status
      await db
        .update(runSteps)
        .set({
          status: result.status,
          finishedAt: new Date().toISOString(),
          durationMs: result.durationMs,
        })
        .where(require('drizzle-orm').eq(runSteps.id, stepId))

      sendToRenderer(IPC_CHANNELS.EVENT_RUN_STATUS, {
        runId,
        status: result.status === 'failure' ? 'failure' : 'running',
        jobName,
        stepName,
        stepStatus: result.status
      })

      if (result.status === 'success' || result.status === 'skipped') {
        const label = result.status === 'skipped' ? 'SKIP' : 'OK'
        console.log(`${JOB_TAG} [${label}] ${stepName} (${result.durationMs}ms)`)
      } else if (result.status === 'failure') {
        console.error(`${JOB_TAG} [FAIL] ${stepName}: ${result.error}`)
        await log(`[FAIL] ${stepName}: ${result.error}`, 'error', stepName)
        jobStatus = 'failure'
        break
      }
    }
  } finally {
    clearTimeout(timeoutTimer)
    console.log(`${JOB_TAG} Cleaning up containers...`)
    // Clean up service containers
    for (const svcId of serviceContainerIds) {
      try {
        await stopAndRemoveContainer(svcId)
      } catch { /* ignore */ }
    }
    // Return container to pool for reuse if job succeeded and pool exists,
    // otherwise destroy it
    if (containerPool && jobStatus === 'success' && !containerPool.has(image)) {
      containerPool.set(image, containerId)
      await log(`[OK] Container returned to pool: ${containerId.slice(0, 12)} (${image})`, 'info')
      console.log(`${JOB_TAG} Container pooled for reuse: ${containerId.slice(0, 12)}`)
    } else {
      await stopAndRemoveContainer(containerId)
      await log(`[OK] Container removed: ${containerId.slice(0, 12)}`, 'info')
    }
    console.log(`${JOB_TAG} Job finished: ${jobStatus} (${Date.now() - start}ms)`)
  }

  // Resolve job outputs (evaluate expressions)
  const resolvedOutputs: Record<string, string> = {}
  if (job.outputs) {
    for (const [key, expr] of Object.entries(job.outputs)) {
      resolvedOutputs[key] = evaluateExpression(expr, ctx)
    }
  }
  // Merge step outputs with declared job outputs
  const finalOutputs = { ...outputs, ...resolvedOutputs }

  const durationMs = Date.now() - start
  await finalizeJob(jobId, jobStatus, durationMs)
  return { status: jobStatus, outputs: finalOutputs, durationMs }
}

async function finalizeJob(
  jobId: string,
  status: string,
  durationMs: number
): Promise<void> {
  const { eq } = await import('drizzle-orm')
  await db.update(runJobs).set({
    status,
    finishedAt: new Date().toISOString(),
    durationMs
  }).where(eq(runJobs.id, jobId))
}

/**
 * Parse GITHUB_OUTPUT file content supporting both simple `key=value`
 * and multi-line heredoc format: `key<<DELIMITER\n...content...\nDELIMITER`
 */
function parseGitHubOutput(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!content) return result

  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Multi-line heredoc: key<<DELIMITER
    const heredocMatch = line.match(/^(\w+)<<(.+)$/)
    if (heredocMatch) {
      const [, key, delimiter] = heredocMatch
      const valueParts: string[] = []
      i++
      while (i < lines.length && lines[i] !== delimiter) {
        valueParts.push(lines[i])
        i++
      }
      result[key] = valueParts.join('\n')
      i++ // skip delimiter line
      continue
    }

    // Simple key=value
    const eqIdx = line.indexOf('=')
    if (eqIdx > 0) {
      const k = line.slice(0, eqIdx).trim()
      const v = line.slice(eqIdx + 1)
      if (k) result[k] = v
    }

    i++
  }

  return result
}

/**
 * Bootstrap the container environment before running any steps.
 *
 * This replicates what GitHub Actions runners do automatically:
 * 1. Install git (if not present) + essential tools (curl, ca-certificates)
 * 2. Configure git safe.directory for the mounted workspace
 * 3. Configure git user.name and user.email (for commits)
 * 4. Configure GITHUB_TOKEN as git credential helper (for push/pull)
 * 5. Create /runner_tmp files if they don't exist
 * 6. Install cross-compilation tools if targeting Windows/macOS from Linux
 */
async function bootstrapContainer(
  containerId: string,
  env: Record<string, string>,
  isWindows: boolean,
  runsOn: string | undefined,
  log: (message: string, type?: string, stepName?: string) => Promise<void>
): Promise<void> {
  const actor = env.GITHUB_ACTOR ?? 'github-actions[bot]'
  const token = env.GITHUB_TOKEN ?? ''
  const serverUrl = env.GITHUB_SERVER_URL ?? 'https://github.com'

  // Build the bootstrap script
  const script = `
export DEBIAN_FRONTEND=noninteractive
export PIP_BREAK_SYSTEM_PACKAGES=1

# ── Install essential tools (skip if already present from bootstrapped image) ──
install_essentials() {
  if [ -f /etc/orbitci-bootstrap-marker ]; then
    echo "[OrbitCI] Tools already installed (bootstrapped image)"
    return 0
  fi
  if command -v git >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v make >/dev/null 2>&1; then
    echo "[OrbitCI] Essential tools already available, skipping install"
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1
    apt-get install -y -qq git curl ca-certificates build-essential >/dev/null 2>&1
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache git curl ca-certificates build-base >/dev/null 2>&1
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git curl ca-certificates make gcc gcc-c++ >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y git curl ca-certificates make gcc gcc-c++ >/dev/null 2>&1
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm git curl ca-certificates base-devel >/dev/null 2>&1
  fi
}
install_essentials

# ── Configure git ────────────────────────────────────────────────────────
git config --global --add safe.directory /workspace
git config --global --add safe.directory /orbit/source
git config --global user.name "${actor}"
git config --global user.email "${actor}@users.noreply.github.com"
git config --global init.defaultBranch main

# ── Configure git authentication (GITHUB_TOKEN credential helper) ──────
${token ? `
git config --global credential.helper store
echo "${serverUrl.replace('https://', `https://${actor}:${token}@`)}" > ~/.git-credentials 2>/dev/null || true
git config --global url."https://${actor}:${token}@github.com/".insteadOf "https://github.com/"
` : '# No GITHUB_TOKEN available — git push will require manual auth'}

# ── Shadow workspace: clone repo from read-only source into Docker volume ──
# This is the key performance optimization:
# /orbit/source = host repo mounted read-only (slow bind mount, but only read)
# /workspace = Docker volume (native ext4, fast I/O for npm install etc.)
# git clone --shared creates hardlinks to objects, near-instant and zero-copy
if [ -d /orbit/source/.git ]; then
  echo "[OrbitCI] Cloning workspace from source (shared)..."
  rm -rf /workspace/* /workspace/.* 2>/dev/null || true
  git clone --shared --no-checkout /orbit/source /workspace 2>/dev/null
  cd /workspace
  git checkout -f HEAD 2>/dev/null
  echo "[OrbitCI] Workspace ready ($(du -sh /workspace 2>/dev/null | cut -f1))"
else
  echo "[OrbitCI] No .git in source, copying files..."
  cp -a /orbit/source/. /workspace/ 2>/dev/null || true
fi

# ── Ensure runner temp files exist ─────────────────────────────────────
mkdir -p /runner_tmp/tool_cache 2>/dev/null || true
touch /runner_tmp/github_output /runner_tmp/github_env /runner_tmp/github_step_summary /runner_tmp/github_path /runner_tmp/github_state 2>/dev/null || true

# ── Load nvm if cached from previous runs ─────────────────────────────
export NVM_DIR="/root/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh" 2>/dev/null
  NODE_PATH=$(which node 2>/dev/null)
  if [ -n "$NODE_PATH" ]; then
    NODE_DIR=$(dirname "$NODE_PATH")
    ln -sf "$NODE_PATH" /usr/local/bin/node 2>/dev/null || true
    ln -sf "$NODE_DIR/npm" /usr/local/bin/npm 2>/dev/null || true
    ln -sf "$NODE_DIR/npx" /usr/local/bin/npx 2>/dev/null || true
  fi
fi

echo "Container bootstrap complete"
`.trim()

  try {
    const streamLog = (line: string) => { log(line, 'output') }
    const result = await execInContainer(containerId, script, undefined, isWindows, undefined, streamLog)
    if (result.exitCode !== 0) {
      await log(`Bootstrap parcial: exit code ${result.exitCode}`, 'warning')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await log(`Bootstrap falhou (non-fatal): ${msg}`, 'warning')
  }

  // ── Cross-compilation tools for Windows/macOS targets ──────────────────
  const needsWinTools = isWindowsTarget(runsOn)
  const needsMacTools = isMacOSTarget(runsOn)

  if (needsWinTools || needsMacTools) {
    await log(`Cross-compilation: instalando ferramentas para ${needsWinTools ? 'Windows' : ''}${needsWinTools && needsMacTools ? ' + ' : ''}${needsMacTools ? 'macOS' : ''}`, 'info')
    const crossScript = buildCrossCompileScript(needsWinTools, needsMacTools)
    try {
      const crossStreamLog = (line: string) => { log(line, 'output') }
      const result = await execInContainer(containerId, crossScript, undefined, isWindows, undefined, crossStreamLog)
      if (result.exitCode !== 0) {
        await log(`Cross-compilation tools: exit code ${result.exitCode} (non-fatal)`, 'warning')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await log(`Cross-compilation tools falhou (non-fatal): ${msg}`, 'warning')
    }
  }
}

/**
 * Build a script to install cross-compilation tools inside a Linux container.
 *
 * For Windows targets:
 * - Wine + mono (for electron-builder NSIS/MSI builds)
 * - dpkg --add-architecture i386 (32-bit support)
 *
 * For macOS targets:
 * - libdmg-hfsplus / genisoimage (for creating .dmg files)
 * - Note: macOS code signing is NOT possible without a real macOS host
 */
function buildCrossCompileScript(needsWin: boolean, needsMac: boolean): string {
  const parts: string[] = []

  if (needsWin) {
    parts.push(`
# ── Windows cross-compilation tools (Wine for electron-builder) ──────
if command -v apt-get >/dev/null 2>&1; then
  dpkg --add-architecture i386 2>/dev/null || true
  apt-get update -qq >/dev/null 2>&1
  apt-get install -y -qq wine wine64 mono-complete zip unzip >/dev/null 2>&1 || \
  apt-get install -y -qq wine64 zip unzip >/dev/null 2>&1 || \
  echo "Wine installation skipped (non-critical)"
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache wine zip unzip >/dev/null 2>&1 || echo "Wine not available on Alpine"
fi

# ── Create post-npm-install patcher for electron-builder cross-compilation ──
# This script wraps electron-builder to force the correct platform flag
# and strips conflicting platform flags from user args
cat > /usr/local/bin/orbitci-patch-cross-compile << 'PATCHER'
#!/bin/sh
PLATFORM_FLAG="$1"
for BIN in electron-builder electron-packager; do
  LINK="/workspace/node_modules/.bin/$BIN"
  if [ -L "$LINK" ]; then
    REAL=$(cd /workspace/node_modules/.bin && readlink "$BIN")
    RESOLVED="/workspace/node_modules/.bin/$REAL"
    rm -f "$LINK"
    # Wrapper strips --mac/--macos/--win/--windows/--linux from user args
    # then prepends the correct cross-compilation flag
    cat > "$LINK" << WRAPPER
#!/bin/sh
ARGS=""
for arg in "\$@"; do
  case "\$arg" in
    --mac|--macos|--win|--windows|--linux) ;; # strip platform flags
    *) ARGS="\$ARGS \$arg" ;;
  esac
done
exec node "$RESOLVED" $PLATFORM_FLAG \$ARGS
WRAPPER
    chmod +x "$LINK"
    echo "[OrbitCI] Patched $BIN for cross-compilation ($PLATFORM_FLAG)"
  fi
done
PATCHER
chmod +x /usr/local/bin/orbitci-patch-cross-compile

echo "Windows cross-compilation tools ready"
`)
  }

  if (needsMac) {
    parts.push(`
# ── macOS cross-compilation tools (for unsigned .dmg/.zip) ───────────
if command -v apt-get >/dev/null 2>&1; then
  apt-get install -y -qq genisoimage libxml2-utils zip unzip >/dev/null 2>&1 || true
fi

# ── Create patcher if not already created by Windows tools ──
if [ ! -f /usr/local/bin/orbitci-patch-cross-compile ]; then
  cat > /usr/local/bin/orbitci-patch-cross-compile << 'PATCHER'
#!/bin/sh
PLATFORM_FLAG="$1"
for BIN in electron-builder electron-packager; do
  LINK="/workspace/node_modules/.bin/$BIN"
  if [ -L "$LINK" ]; then
    REAL=$(cd /workspace/node_modules/.bin && readlink "$BIN")
    RESOLVED="/workspace/node_modules/.bin/$REAL"
    rm -f "$LINK"
    cat > "$LINK" << WRAPPER
#!/bin/sh
ARGS=""
for arg in "\$@"; do
  case "\$arg" in
    --mac|--macos|--win|--windows|--linux) ;;
    *) ARGS="\$ARGS \$arg" ;;
  esac
done
exec node "$RESOLVED" $PLATFORM_FLAG \$ARGS
WRAPPER
    chmod +x "$LINK"
    echo "[OrbitCI] Patched $BIN for cross-compilation ($PLATFORM_FLAG)"
  fi
done
PATCHER
  chmod +x /usr/local/bin/orbitci-patch-cross-compile
fi

echo "macOS cross-compilation tools ready (unsigned builds only)"
`)
  }

  return parts.join('\n').trim()
}

