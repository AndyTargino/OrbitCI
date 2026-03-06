import { BrowserWindow } from 'electron'
import { FSWatcher, watch } from 'fs'
import { join } from 'path'
import { IPC_CHANNELS } from '../../shared/constants'

// Debounce delay in ms — git can write index multiple times in a single operation
const DEBOUNCE_MS = 300

interface WatchEntry {
    watchers: FSWatcher[]
    timer: ReturnType<typeof setTimeout> | null
}

const entries = new Map<string, WatchEntry>()

function sendToRenderer(repoId: string, localPath: string): void {
    const wins = BrowserWindow.getAllWindows()
    if (wins[0]) {
        wins[0].webContents.send(IPC_CHANNELS.EVENT_GIT_CHANGED, { repoId, localPath })
    }
}

function makeTrigger(repoId: string, localPath: string) {
    return () => {
        const entry = entries.get(repoId)
        if (!entry) return
        if (entry.timer) clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
            sendToRenderer(repoId, localPath)
        }, DEBOUNCE_MS)
    }
}

/**
 * Start watching a repository's .git directory for external changes.
 * Safe to call multiple times for the same repo — idempotent.
 */
export function watchRepo(repoId: string, localPath: string): void {
    if (entries.has(repoId)) return // already watching

    const trigger = makeTrigger(repoId, localPath)
    const watchers: FSWatcher[] = []

    // Watch .git/index   → staged/unstaged changes
    // Watch .git/HEAD    → branch switches, detached HEAD
    // Watch .git/refs    → branch tip updates (commits, resets)
    const targets = [
        join(localPath, '.git', 'index'),
        join(localPath, '.git', 'HEAD'),
        join(localPath, '.git', 'refs'),
    ]

    for (const target of targets) {
        try {
            const w = watch(target, { persistent: false, recursive: false }, trigger)
            w.on('error', () => { /* silently ignore — file may not exist */ })
            watchers.push(w)
        } catch {
            // target doesn't exist yet — that's fine
        }
    }

    // Also watch the working directory (shallow) to detect new/deleted files
    try {
        const w = watch(localPath, { persistent: false, recursive: false }, trigger)
        w.on('error', () => { })
        watchers.push(w)
    } catch { }

    entries.set(repoId, { watchers, timer: null })
}

/**
 * Stop watching a repository.
 */
export function unwatchRepo(repoId: string): void {
    const entry = entries.get(repoId)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    for (const w of entry.watchers) {
        try { w.close() } catch { }
    }
    entries.delete(repoId)
}

/**
 * Stop all watchers (call on app quit).
 */
export function stopAllWatchers(): void {
    for (const repoId of entries.keys()) {
        unwatchRepo(repoId)
    }
}
