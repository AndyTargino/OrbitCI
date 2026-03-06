import type { ActionHandler } from './index'
import { existsSync, mkdirSync, cpSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { globSync } from 'glob'

/**
 * Local artifact upload/download for OrbitCI.
 * Artifacts are stored at ~/.orbitci/artifacts/{runId}/{name}/
 *
 * Replaces the no-op behavior of actions/upload-artifact and actions/download-artifact.
 */

const ARTIFACTS_BASE = join(homedir(), '.orbitci', 'artifacts')

export function getArtifactsDir(runId: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(ARTIFACTS_BASE, runId, safeName)
}

export const artifactActions: Record<string, ActionHandler> = {
  'artifact/upload': async ({ with: w, workspace, env, log }) => {
    if (!w?.name || !w?.path) throw new Error('artifact/upload: "name" and "path" are required')

    const runId = env.ORBIT_RUN_ID ?? 'unknown'
    const artifactDir = getArtifactsDir(runId, w.name)
    mkdirSync(artifactDir, { recursive: true })

    // Support glob patterns in path
    const patterns = w.path.split('\n').map(p => p.trim()).filter(Boolean)
    let fileCount = 0

    for (const pattern of patterns) {
      const files = globSync(pattern, { cwd: workspace, nodir: true })
      for (const file of files) {
        const src = join(workspace, file)
        const dst = join(artifactDir, file)
        mkdirSync(join(dst, '..'), { recursive: true })
        cpSync(src, dst, { force: true })
        fileCount++
      }
    }

    log(`[OK] Artifact uploaded: ${w.name} (${fileCount} files)`)
    return { 'artifact-path': artifactDir }
  },

  'artifact/download': async ({ with: w, workspace, env, log }) => {
    if (!w?.name) throw new Error('artifact/download: "name" is required')

    const runId = env.ORBIT_RUN_ID ?? 'unknown'
    const artifactDir = getArtifactsDir(runId, w.name)

    if (!existsSync(artifactDir)) {
      log(`[FAIL] Artifact not found: ${w.name}`)
      throw new Error(`Artifact not found: ${w.name}`)
    }

    const targetPath = w?.path ? join(workspace, w.path) : workspace
    mkdirSync(targetPath, { recursive: true })
    cpSync(artifactDir, targetPath, { recursive: true, force: true })

    log(`[OK] Artifact downloaded: ${w.name} -> ${w.path ?? '.'}`)
    return { 'download-path': targetPath }
  }
}
