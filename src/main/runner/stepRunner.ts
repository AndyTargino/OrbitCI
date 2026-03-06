import { getAction, type ActionContext } from './actions'
import { getArtifactsDir } from './actions/artifact'
import { evaluateExpression, evaluateCondition, type ExpressionContext } from './expressionEngine'
import {
  execInContainer
} from '../services/dockerService'
import { existsSync, mkdirSync, cpSync, readdirSync } from 'fs'
import { join } from 'path'
import { globSync } from 'glob'
import type { ProcessMonitor, MetricsSummary } from '../services/processMonitor'
import type { StepDefinition } from '@shared/types'

export interface StepRunnerOpts {
  step: StepDefinition
  stepIndex: number
  workspace: string
  env: Record<string, string>
  ctx: ExpressionContext
  log: (msg: string, type?: string) => void
  setOutput: (key: string, value: string) => void
  containerId: string
  isWindows?: boolean
  monitor?: ProcessMonitor
  stepId?: string
  runId?: string
  jobName?: string
  repoId?: string
}

export interface StepResult {
  status: 'success' | 'failure' | 'skipped'
  durationMs: number
  outputs: Record<string, string>
  error?: string
  metrics?: MetricsSummary | null
}

export async function runStep(opts: StepRunnerOpts): Promise<StepResult> {
  const {
    step, stepIndex, workspace, env, ctx, log, setOutput,
    containerId, isWindows, monitor, stepId, runId, jobName, repoId
  } = opts
  const start = Date.now()
  const outputs: Record<string, string> = {}

  const stepLog = (msg: string) => log(msg)
  const stepSetOutput = (k: string, v: string) => {
    outputs[k] = v
    setOutput(k, v)
  }

  // Evaluate condition
  if (step.if) {
    const condition = evaluateExpression(step.if, ctx)
    const shouldRun = evaluateCondition(condition, ctx)
    if (!shouldRun) {
      log(`[SKIP] Skipped (condition: ${step.if})`, 'skip')
      return { status: 'skipped', durationMs: Date.now() - start, outputs }
    }
  }

  try {
    if (step.run) {
      // ── Shell command — always runs inside Docker container ──────────────
      const command = evaluateExpression(step.run, ctx)
      const workDir = step['working-directory']
        ? evaluateExpression(step['working-directory'], ctx)
        : undefined

      // Start Docker container monitoring if available
      const dockerMeta = monitor && runId && jobName
        ? { runId, jobName, stepName: step.name ?? `Step ${stepIndex + 1}` }
        : undefined
      if (monitor && dockerMeta) {
        monitor.startDocker(containerId, dockerMeta)
      }

      const stepShell = step.shell ?? undefined
      const streamLog = (line: string) => log(line, 'output')
      const result = await execInContainer(containerId, command, workDir, isWindows, stepShell, streamLog)
      if (result.exitCode !== 0) {
        throw new Error(`Exit code ${result.exitCode}`)
      }

      // After npm install, patch build tools for cross-compilation (Windows/macOS)
      const targetOS = env.RUNNER_OS
      if ((targetOS === 'Windows' || targetOS === 'macOS') &&
          /npm\s+(install|ci)|yarn\s*(install)?|pnpm\s+install/i.test(command)) {
        // --mac zip: avoids dmg-builder which requires native macOS tools (dmg-license)
        const platformFlag = targetOS === 'Windows' ? '--win' : '--mac zip'
        try {
          await execInContainer(containerId,
            `[ -x /usr/local/bin/orbitci-patch-cross-compile ] && /usr/local/bin/orbitci-patch-cross-compile "${platformFlag}" || true`
          )
        } catch { /* non-critical */ }
      }
    } else if (step.uses) {
      // ── GitHub Action (uses:) — run inside Docker container ──────────────
      await runUsesAction(step, ctx, containerId, isWindows, log, stepSetOutput)
    } else if (step.OrbitCI) {
      // ── Built-in OrbitCI action ─────────────────────────────────────────
      const actionName = evaluateExpression(step.OrbitCI, ctx)
      const action = getAction(actionName)
      if (!action) throw new Error(`Action not found: ${actionName}`)

      // Resolve `with` params
      const resolvedWith: Record<string, string> = {}
      if (step.with) {
        for (const [k, v] of Object.entries(step.with)) {
          resolvedWith[k] = evaluateExpression(String(v), ctx)
        }
      }

      const actionCtx: ActionContext = {
        workspace,
        env,
        with: resolvedWith,
        log: (msg) => stepLog(msg),
        setOutput: stepSetOutput,
        repoId
      }

      const result = await action(actionCtx)
      if (result) {
        for (const [k, v] of Object.entries(result)) {
          stepSetOutput(k, v)
        }
      }
    }

    return { status: 'success', durationMs: Date.now() - start, outputs }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (step['continue-on-error']) {
      log(`[WARN] Continuing after error: ${message}`, 'warning')
      return { status: 'success', durationMs: Date.now() - start, outputs, error: message }
    }

    return { status: 'failure', durationMs: Date.now() - start, outputs, error: message }
  }
}

/**
 * Handle `uses:` steps by executing the action inside the Docker container.
 *
 * Supported patterns:
 * - `actions/checkout@v4` → Git checkout (handled specially since repo is already mounted)
 * - `actions/setup-node@v4` → Install Node.js via nvm/apt
 * - `actions/setup-python@v5` → Install Python
 * - `owner/repo@ref` → Clone and run the action's entrypoint
 */
async function runUsesAction(
  step: StepDefinition,
  ctx: ExpressionContext,
  containerId: string,
  isWindows: boolean | undefined,
  log: (msg: string, type?: string) => void,
  setOutput: (key: string, value: string) => void
): Promise<void> {
  const uses = evaluateExpression(step.uses!, ctx)
  const withParams: Record<string, string> = {}
  if (step.with) {
    for (const [k, v] of Object.entries(step.with)) {
      withParams[k] = evaluateExpression(String(v), ctx)
    }
  }

  // Parse action reference: owner/repo@ref or ./local-path
  const match = uses.match(/^([^@]+)@(.+)$/)
  const actionPath = match ? match[1] : uses
  const actionRef = match ? match[2] : 'main'

  // ── Built-in action handlers for common GitHub Actions ──────────────────
  if (actionPath === 'actions/checkout') {
    await handleCheckoutAction(containerId, withParams, ctx, isWindows, log)
    return
  }

  if (actionPath === 'actions/setup-node') {
    await handleSetupNodeAction(containerId, withParams, isWindows, log)
    return
  }

  if (actionPath === 'actions/setup-python') {
    await handleSetupPythonAction(containerId, withParams, isWindows, log)
    return
  }

  if (actionPath === 'actions/setup-go') {
    await handleSetupGoAction(containerId, withParams, isWindows, log)
    return
  }

  if (actionPath === 'actions/setup-java') {
    await handleSetupJavaAction(containerId, withParams, isWindows, log)
    return
  }

  if (actionPath === 'actions/cache') {
    log(`  [Cache] Handled by OrbitCI Docker volumes (persistent cache)`)
    return
  }

  if (actionPath === 'actions/upload-artifact') {
    await handleUploadArtifact(containerId, withParams, ctx, isWindows, log)
    return
  }

  if (actionPath === 'actions/download-artifact') {
    await handleDownloadArtifact(containerId, withParams, ctx, isWindows, log)
    return
  }

  // ── Generic action: clone and run ─────────────────────────────────────────
  await handleGenericAction(containerId, actionPath, actionRef, withParams, isWindows, log, setOutput)
}

async function handleCheckoutAction(
  containerId: string,
  withParams: Record<string, string>,
  ctx: ExpressionContext,
  isWindows: boolean | undefined,
  log: (msg: string, type?: string) => void
): Promise<void> {
  const ref = withParams['ref'] ?? ''
  const fetchDepth = withParams['fetch-depth'] ?? '1'
  const token = withParams['token'] ?? ctx.secrets?.['GITHUB_TOKEN'] ?? ''
  const repo = withParams['repository'] ?? ctx.github?.repository ?? ''

  // Workspace is a Docker volume with a git clone --shared from /orbit/source.
  // Configure git and handle ref checkout.
  const commands: string[] = [
    'git config --global --add safe.directory /workspace',
    'git config --global --add safe.directory /orbit/source',
  ]

  // Configure token-based auth for this repo's remote URL
  if (token && repo) {
    commands.push(
      `git config --global url."https://x-access-token:${token}@github.com/".insteadOf "https://github.com/"`,
      `cd /workspace && git remote set-url origin "https://x-access-token:${token}@github.com/${repo}.git" 2>/dev/null || true`
    )
  }

  // Ensure workspace is clean
  commands.push('cd /workspace && git reset --hard HEAD 2>/dev/null || true')

  if (ref) {
    commands.push(
      `cd /workspace && git fetch --depth=${fetchDepth} origin ${ref}`,
      `cd /workspace && git checkout -f ${ref}`
    )
  } else {
    // Stay on current ref but ensure it's clean
    commands.push(`cd /workspace && git fetch --depth=${fetchDepth} origin 2>/dev/null || true`)
  }

  if (withParams['submodules'] === 'true' || withParams['submodules'] === 'recursive') {
    commands.push('cd /workspace && git submodule update --init --recursive')
  }

  // Ensure LFS is available if needed
  if (withParams['lfs'] === 'true') {
    commands.push('cd /workspace && git lfs pull 2>/dev/null || true')
  }

  const script = commands.join(' && ')
  log(`  checkout: ${ref || 'current ref'}`)
  const streamLog = (line: string) => log(line)
  const result = await execInContainer(containerId, script, undefined, isWindows, undefined, streamLog)
  if (result.exitCode !== 0) {
    throw new Error(`Checkout failed: exit code ${result.exitCode}`)
  }
}

async function handleSetupNodeAction(
  containerId: string,
  withParams: Record<string, string>,
  isWindows: boolean | undefined,
  log: (msg: string, type?: string) => void
): Promise<void> {
  const nodeVersion = withParams['node-version'] ?? '20'
  log(`  setup-node: v${nodeVersion}`)

  // Install Node.js via nvm (persisted in orbitci-nvm volume between runs)
  const script = `
    export NVM_DIR="/root/.nvm"

    # Load nvm if it exists (cached from previous run)
    if [ -s "$NVM_DIR/nvm.sh" ]; then
      . "$NVM_DIR/nvm.sh" 2>/dev/null
    fi

    # Check if Node is already installed at the requested major version
    if command -v node >/dev/null 2>&1; then
      FULL_VER=$(node --version 2>/dev/null || echo "v0")
      # Extract major version using shell only (no sed/cut)
      MAJOR_VER=$(echo "$FULL_VER" | tr -d 'v' | { IFS=. read major rest; echo "$major"; })
      if [ "$MAJOR_VER" = "${nodeVersion}" ]; then
        echo "[OrbitCI] Node.js v${nodeVersion} already installed (cached): $FULL_VER"
        npm --version 2>/dev/null && echo "npm $(npm --version)"
        exit 0
      fi
      echo "[OrbitCI] Node.js v$MAJOR_VER found but v${nodeVersion} requested, installing..."
    fi

    # Install nvm if not present
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
      echo "[OrbitCI] Installing nvm..."
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash >/dev/null 2>&1
      . "$NVM_DIR/nvm.sh" 2>/dev/null
    fi

    # Install requested Node version via nvm (cached in /root/.nvm volume)
    nvm install ${nodeVersion} >/dev/null 2>&1
    nvm use ${nodeVersion} >/dev/null 2>&1
    nvm alias default ${nodeVersion} >/dev/null 2>&1

    # Symlink to /usr/local/bin so node/npm are globally available
    NODE_PATH=$(nvm which ${nodeVersion})
    NODE_DIR=$(dirname "$NODE_PATH")
    ln -sf "$NODE_PATH" /usr/local/bin/node 2>/dev/null || true
    ln -sf "$NODE_DIR/npm" /usr/local/bin/npm 2>/dev/null || true
    ln -sf "$NODE_DIR/npx" /usr/local/bin/npx 2>/dev/null || true

    echo "Node.js $(node --version) installed"
    echo "npm $(npm --version)"
  `.trim()

  const streamLog = (line: string) => log(line)
  const result = await execInContainer(containerId, script, undefined, isWindows, undefined, streamLog)
  if (result.exitCode !== 0) {
    throw new Error(`setup-node failed: exit code ${result.exitCode}`)
  }
}

async function handleSetupPythonAction(
  containerId: string,
  withParams: Record<string, string>,
  isWindows: boolean | undefined,
  log: (msg: string, type?: string) => void
): Promise<void> {
  const pyVersion = withParams['python-version'] ?? '3'
  log(`  setup-python: ${pyVersion}`)

  const script = `
    if command -v python3 >/dev/null 2>&1; then
      echo "[OrbitCI] Python already installed (cached): $(python3 --version)"
      exit 0
    fi
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -qq && apt-get install -y -qq python${pyVersion} python3-pip >/dev/null 2>&1
    elif command -v apk >/dev/null 2>&1; then
      apk add --no-cache python3 py3-pip >/dev/null 2>&1
    elif command -v yum >/dev/null 2>&1; then
      yum install -y python3 python3-pip >/dev/null 2>&1
    fi
    python3 --version
  `.trim()

  const streamLog = (line: string) => log(line)
  const result = await execInContainer(containerId, script, undefined, isWindows, undefined, streamLog)
  if (result.exitCode !== 0) {
    throw new Error(`setup-python failed: exit code ${result.exitCode}`)
  }
}

async function handleSetupGoAction(
  containerId: string,
  withParams: Record<string, string>,
  isWindows: boolean | undefined,
  log: (msg: string, type?: string) => void
): Promise<void> {
  const goVersion = withParams['go-version'] ?? '1.22'
  log(`  setup-go: ${goVersion}`)

  const script = `
    if command -v go >/dev/null 2>&1; then
      echo "[OrbitCI] Go already installed (cached): $(go version)"
      exit 0
    fi
    curl -fsSL https://go.dev/dl/go${goVersion}.linux-amd64.tar.gz | tar -C /usr/local -xzf -
    export PATH=$PATH:/usr/local/go/bin
    echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile
    go version
  `.trim()

  const streamLog = (line: string) => log(line)
  const result = await execInContainer(containerId, script, undefined, isWindows, undefined, streamLog)
  if (result.exitCode !== 0) {
    throw new Error(`setup-go failed: exit code ${result.exitCode}`)
  }
}

async function handleSetupJavaAction(
  containerId: string,
  withParams: Record<string, string>,
  isWindows: boolean | undefined,
  log: (msg: string, type?: string) => void
): Promise<void> {
  const javaVersion = withParams['java-version'] ?? '17'
  const distribution = withParams['distribution'] ?? 'temurin'
  log(`  setup-java: ${distribution} ${javaVersion}`)

  const script = `
    if command -v java >/dev/null 2>&1; then
      echo "[OrbitCI] Java already installed (cached): $(java -version 2>&1 | head -1)"
      exit 0
    fi
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -qq && apt-get install -y -qq openjdk-${javaVersion}-jdk >/dev/null 2>&1
    elif command -v apk >/dev/null 2>&1; then
      apk add --no-cache openjdk${javaVersion} >/dev/null 2>&1
    elif command -v yum >/dev/null 2>&1; then
      yum install -y java-${javaVersion}-openjdk-devel >/dev/null 2>&1
    fi
    java -version 2>&1
  `.trim()

  const streamLog = (line: string) => log(line)
  const result = await execInContainer(containerId, script, undefined, isWindows, undefined, streamLog)
  if (result.exitCode !== 0) {
    throw new Error(`setup-java failed: exit code ${result.exitCode}`)
  }
}

async function handleGenericAction(
  containerId: string,
  actionPath: string,
  actionRef: string,
  withParams: Record<string, string>,
  isWindows: boolean | undefined,
  log: (msg: string, type?: string) => void,
  setOutput: (key: string, value: string) => void
): Promise<void> {
  log(`  action: ${actionPath}@${actionRef}`)

  // Clone the action repository into the container
  const actionDir = `/tmp/actions/${actionPath.replace(/\//g, '_')}`
  const cloneScript = `
    if [ ! -d "${actionDir}/.git" ]; then
      mkdir -p $(dirname ${actionDir})
      git clone --depth 1 --branch ${actionRef} https://github.com/${actionPath}.git ${actionDir} 2>/dev/null || \
      git clone --depth 1 https://github.com/${actionPath}.git ${actionDir}
    fi
  `.trim()

  const streamLog = (line: string) => log(line)
  let result = await execInContainer(containerId, cloneScript, undefined, isWindows, undefined, streamLog)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to clone action ${actionPath}@${actionRef}: exit code ${result.exitCode}`)
  }

  // Read action.yml to determine the execution method
  const detectScript = `
    if [ -f "${actionDir}/action.yml" ]; then
      cat "${actionDir}/action.yml"
    elif [ -f "${actionDir}/action.yaml" ]; then
      cat "${actionDir}/action.yaml"
    else
      echo "NO_ACTION_YML"
    fi
  `.trim()

  result = await execInContainer(containerId, detectScript, undefined, isWindows)

  if (result.output.includes('NO_ACTION_YML')) {
    log(`  [WARN] No action.yml found in ${actionPath}, skipping`)
    return
  }

  // Set INPUT_ env vars for the action (GitHub convention)
  const inputEnvs = Object.entries(withParams)
    .map(([k, v]) => `export INPUT_${k.toUpperCase().replace(/-/g, '_')}="${v.replace(/"/g, '\\"')}"`)
    .join(' && ')
  const envPrefix = inputEnvs ? `${inputEnvs} && ` : ''

  // Parse action.yml to determine runs.using
  const actionYml = result.output
  const usingMatch = actionYml.match(/runs:\s*\n\s*using:\s*['"]?(\S+?)['"]?\s*$/m)
    ?? actionYml.match(/using:\s*['"]?(\S+?)['"]?\s*$/m)
  const using = usingMatch?.[1] ?? ''

  if (using.startsWith('node')) {
    // Node.js action: find the main entry point from action.yml
    const mainMatch = actionYml.match(/main:\s*['"]?(\S+?)['"]?\s*$/m)
    const mainFile = mainMatch?.[1] ?? 'dist/index.js'

    const runScript = `cd ${actionDir} && ${envPrefix}node ${mainFile}`
    result = await execInContainer(containerId, runScript, undefined, isWindows, undefined, streamLog)
    if (result.exitCode !== 0) {
      throw new Error(`Action ${actionPath}@${actionRef} failed: exit code ${result.exitCode}`)
    }
  } else if (using === 'composite') {
    // Composite action: parse and execute the steps sequentially
    const stepsMatch = actionYml.match(/steps:\s*\n([\s\S]*?)(?:\noutputs:|$)/)
    if (!stepsMatch) {
      log(`  [WARN] No steps found in composite action ${actionPath}`)
      return
    }

    // Extract run commands from composite steps (simplified YAML parsing)
    const stepsBlock = stepsMatch[1]
    const runMatches = [...stepsBlock.matchAll(/- (?:name:.*\n\s+)?run:\s*\|?\s*\n?([\s\S]*?)(?=\n\s*-\s|\n\s*$|$)/g)]

    for (const runMatch of runMatches) {
      const cmd = runMatch[1].split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .join(' && ')

      if (cmd) {
        const fullCmd = `cd /workspace && ${envPrefix}${cmd}`
        result = await execInContainer(containerId, fullCmd, undefined, isWindows, undefined, streamLog)
        if (result.exitCode !== 0) {
          throw new Error(`Composite step in ${actionPath} failed: exit code ${result.exitCode}`)
        }
      }
    }

    // Also handle uses: within composite (just run them)
    const usesMatches = [...stepsBlock.matchAll(/uses:\s*['"]?(\S+?)['"]?\s*$/gm)]
    for (const usesMatch of usesMatches) {
      log(`  [WARN] Nested uses: ${usesMatch[1]} in composite action -- skipped (not yet supported)`)
    }
  } else if (using === 'docker') {
    // Docker action: build or pull the image defined in action.yml
    const imageMatch = actionYml.match(/image:\s*['"]?(\S+?)['"]?\s*$/m)
    const actionImage = imageMatch?.[1] ?? ''

    if (actionImage.startsWith('Dockerfile') || actionImage === 'Dockerfile') {
      // Build from Dockerfile in the action directory
      const buildScript = `cd ${actionDir} && docker build -t action-${actionPath.replace(/\//g, '-')} . && docker run --rm -v /workspace:/workspace action-${actionPath.replace(/\//g, '-')}`
      result = await execInContainer(containerId, buildScript, undefined, isWindows, undefined, streamLog)
    } else if (actionImage.startsWith('docker://')) {
      // Pull and run a specific image
      const img = actionImage.replace('docker://', '')
      const runScript = `docker run --rm -v /workspace:/workspace ${img}`
      result = await execInContainer(containerId, runScript, undefined, isWindows, undefined, streamLog)
    }
    if (result.exitCode !== 0) {
      throw new Error(`Docker action ${actionPath} failed: exit code ${result.exitCode}`)
    }
  } else {
    // Fallback: try to find and run common entrypoints
    const runScript = `
      cd ${actionDir}
      if [ -f "dist/index.js" ]; then node dist/index.js
      elif [ -f "index.js" ]; then node index.js
      elif [ -f "main.js" ]; then node main.js
      elif [ -f "entrypoint.sh" ]; then bash entrypoint.sh
      else echo "[WARN] Could not find entrypoint for action ${actionPath} (using: ${using})"
      fi
    `.trim()

    result = await execInContainer(containerId, `${envPrefix}${runScript}`, undefined, isWindows, undefined, streamLog)
    if (result.exitCode !== 0) {
      throw new Error(`Action ${actionPath}@${actionRef} failed: exit code ${result.exitCode}`)
    }
  }
}

/**
 * Handle actions/upload-artifact locally.
 * Copies matched files from /workspace to ~/.orbitci/artifacts/{runId}/{name}/
 */
async function handleUploadArtifact(
  containerId: string,
  withParams: Record<string, string>,
  ctx: ExpressionContext,
  isWindows: boolean | undefined,
  log: (msg: string, type?: string) => void
): Promise<void> {
  const name = withParams['name'] ?? 'artifact'
  const path = withParams['path'] ?? ''
  if (!path) {
    log(`[SKIP] upload-artifact: no path specified`)
    return
  }

  const runId = ctx.OrbitCI?.run_id ?? 'unknown'
  const workspace = ctx.OrbitCI?.workspace ?? ctx.github?.workspace ?? ''
  const artifactDir = getArtifactsDir(runId, name)
  mkdirSync(artifactDir, { recursive: true })

  // Glob the files from the workspace
  const patterns = path.split('\n').map(p => p.trim()).filter(Boolean)
  let fileCount = 0

  for (const pattern of patterns) {
    try {
      const files = globSync(pattern, { cwd: workspace, nodir: true })
      for (const file of files) {
        const src = join(workspace, file)
        const dst = join(artifactDir, file)
        if (existsSync(src)) {
          mkdirSync(join(dst, '..'), { recursive: true })
          cpSync(src, dst, { force: true })
          fileCount++
        }
      }
    } catch { /* invalid pattern */ }
  }

  log(`[OK] Artifact uploaded: ${name} (${fileCount} files)`)
}

/**
 * Handle actions/download-artifact locally.
 * Copies files from ~/.orbitci/artifacts/{runId}/{name}/ to /workspace
 */
async function handleDownloadArtifact(
  containerId: string,
  withParams: Record<string, string>,
  ctx: ExpressionContext,
  isWindows: boolean | undefined,
  log: (msg: string, type?: string) => void
): Promise<void> {
  const name = withParams['name'] ?? 'artifact'
  const downloadPath = withParams['path'] ?? '.'

  const runId = ctx.OrbitCI?.run_id ?? 'unknown'
  const workspace = ctx.OrbitCI?.workspace ?? ctx.github?.workspace ?? ''
  const artifactDir = getArtifactsDir(runId, name)

  if (!existsSync(artifactDir)) {
    log(`[SKIP] download-artifact: "${name}" not found`)
    return
  }

  const targetPath = join(workspace, downloadPath)
  mkdirSync(targetPath, { recursive: true })
  cpSync(artifactDir, targetPath, { recursive: true, force: true })
  log(`[OK] Artifact downloaded: ${name} -> ${downloadPath}`)
}
