import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import { showNotification } from '../notification/manager'
import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { loadUser } from '../services/credentialService'
import type { AppSettings } from '@shared/types'

const DEFAULTS: Omit<AppSettings, 'githubToken' | 'githubUser' | 'githubClientId' | 'githubClientSecret'> = {
  defaultPollInterval: 60,
  maxConcurrentRuns: 1,
  jobTimeoutMinutes: 60,
  dockerEnabled: false,
  defaultDockerImage: 'ubuntu:22.04',
  theme: 'dark',
  notifications: true,
  autoUpdate: false,
  language: null
}

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  return row?.value ?? null
}

async function setSetting(key: string, value: string): Promise<void> {
  const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date().toISOString() })
      .where(eq(settings.key, key))
  } else {
    await db.insert(settings).values({ key, value })
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (): Promise<AppSettings> => {
    const user = loadUser()
    const stored: Record<string, string> = {}
    const rows = await db.select().from(settings)
    for (const row of rows) stored[row.key] = row.value

    return {
      githubToken: null, // never expose token to renderer
      githubUser: user,
      githubClientId: stored.githubClientId ?? null,
      githubClientSecret: stored.githubClientSecret ?? null,
      defaultPollInterval: parseInt(stored.defaultPollInterval ?? String(DEFAULTS.defaultPollInterval)),
      maxConcurrentRuns: parseInt(stored.maxConcurrentRuns ?? String(DEFAULTS.maxConcurrentRuns)),
      jobTimeoutMinutes: parseInt(stored.jobTimeoutMinutes ?? String(DEFAULTS.jobTimeoutMinutes)),
      dockerEnabled: (stored.dockerEnabled ?? 'false') === 'true',
      defaultDockerImage: stored.defaultDockerImage ?? DEFAULTS.defaultDockerImage,
      theme: (stored.theme as 'dark' | 'light' | 'system') ?? DEFAULTS.theme,
      notifications: (stored.notifications ?? 'true') === 'true',
      autoUpdate: (stored.autoUpdate ?? 'false') === 'true',
      language: stored.language ?? null
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.NOTIFY_TEST,
    (_, opts: { type: string; title: string; body: string; duration: number }) => {
      showNotification({
        title: opts.title,
        body: opts.body,
        type: opts.type as 'success' | 'failure' | 'running' | 'warning' | 'info',
        duration: opts.duration,
        actions: opts.type === 'failure'
          ? [{ id: 'view', label: 'Ver detalhes', primary: true }, { id: 'close', label: 'Fechar' }]
          : undefined
      })
      return { ok: true }
    }
  )

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_, updates: Partial<AppSettings>) => {
    const skip = new Set(['githubToken', 'githubUser', 'githubClientSecretConfigured'])
    for (const [key, val] of Object.entries(updates)) {
      if (skip.has(key)) continue
      await setSetting(key, String(val))
    }
    return { success: true }
  })
}
