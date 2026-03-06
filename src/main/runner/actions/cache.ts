import type { ActionHandler } from './index'
import { existsSync, mkdirSync, cpSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Local cache action for OrbitCI.
 * Stores/restores files based on a cache key, scoped per repository.
 *
 * Usage in workflow:
 *   - OrbitCI: cache/save
 *     with:
 *       path: node_modules
 *       key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
 *
 *   - OrbitCI: cache/restore
 *     with:
 *       path: node_modules
 *       key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
 *       restore-keys: |
 *         ${{ runner.os }}-node-
 */

const CACHE_BASE = join(homedir(), '.orbitci', 'cache')

function getCacheDir(repoId: string, key: string): string {
  const safeRepo = repoId.replace(/[^a-zA-Z0-9]/g, '_')
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
  return join(CACHE_BASE, safeRepo, safeKey)
}

export const cacheActions: Record<string, ActionHandler> = {
  'cache/save': async ({ with: w, workspace, log, repoId }) => {
    if (!w?.path || !w?.key) throw new Error('cache/save: "path" and "key" are required')

    const sourcePath = join(workspace, w.path)
    if (!existsSync(sourcePath)) {
      log(`[Cache] Nothing to cache: ${w.path} not found`)
      return
    }

    const cacheDir = getCacheDir(repoId ?? 'default', w.key)
    mkdirSync(cacheDir, { recursive: true })

    try {
      cpSync(sourcePath, cacheDir, { recursive: true, force: true })
      log(`[OK] Cache saved: ${w.key} (${w.path})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`[FAIL] Cache save failed: ${msg}`)
    }
  },

  'cache/restore': async ({ with: w, workspace, log, repoId }) => {
    if (!w?.path || !w?.key) throw new Error('cache/restore: "path" and "key" are required')

    const targetPath = join(workspace, w.path)
    const repo = repoId ?? 'default'

    // Try exact key first
    const exactDir = getCacheDir(repo, w.key)
    if (existsSync(exactDir)) {
      mkdirSync(targetPath, { recursive: true })
      cpSync(exactDir, targetPath, { recursive: true, force: true })
      log(`[OK] Cache restored (exact): ${w.key}`)
      return { 'cache-hit': 'true' }
    }

    // Try restore-keys prefix matching
    const restoreKeys = (w['restore-keys'] ?? '').split('\n').map(k => k.trim()).filter(Boolean)
    if (restoreKeys.length > 0) {
      const safeRepo = repo.replace(/[^a-zA-Z0-9]/g, '_')
      const repoCache = join(CACHE_BASE, safeRepo)
      if (existsSync(repoCache)) {
        const entries = readdirSync(repoCache)
        for (const prefix of restoreKeys) {
          const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]/g, '_')
          const match = entries.find(e => e.startsWith(safePrefix))
          if (match) {
            const matchDir = join(repoCache, match)
            mkdirSync(targetPath, { recursive: true })
            cpSync(matchDir, targetPath, { recursive: true, force: true })
            log(`[OK] Cache restored (prefix): ${match}`)
            return { 'cache-hit': 'true' }
          }
        }
      }
    }

    log(`[Cache] No cache found for key: ${w.key}`)
    return { 'cache-hit': 'false' }
  },

  'cache/clean': async ({ with: w, log, repoId }) => {
    const repo = repoId ?? 'default'
    const safeRepo = repo.replace(/[^a-zA-Z0-9]/g, '_')
    const repoCache = join(CACHE_BASE, safeRepo)

    if (w?.key) {
      const cacheDir = getCacheDir(repo, w.key)
      if (existsSync(cacheDir)) {
        rmSync(cacheDir, { recursive: true, force: true })
        log(`[OK] Cache removed: ${w.key}`)
      }
    } else {
      if (existsSync(repoCache)) {
        rmSync(repoCache, { recursive: true, force: true })
        log(`[OK] All cache cleared for ${repo}`)
      }
    }
  }
}
