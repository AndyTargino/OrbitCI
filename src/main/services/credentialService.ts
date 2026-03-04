import { safeStorage, app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { GitHubUser } from '@shared/types'

const DATA_DIR = join(app.getPath('home'), '.orbitci')
const CREDS_FILE = join(DATA_DIR, 'credentials.json')

interface Credentials {
  encryptedToken: string // base64 of encrypted buffer
  user: GitHubUser | null
  savedAt: string
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

export function saveToken(token: string, user: GitHubUser): void {
  ensureDataDir()
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available on this system')
  }
  const encrypted = safeStorage.encryptString(token)
  const creds: Credentials = {
    encryptedToken: encrypted.toString('base64'),
    user,
    savedAt: new Date().toISOString()
  }
  writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), 'utf-8')
}

export function loadToken(): string | null {
  try {
    if (!existsSync(CREDS_FILE)) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    const raw = readFileSync(CREDS_FILE, 'utf-8')
    const creds: Credentials = JSON.parse(raw)
    const buf = Buffer.from(creds.encryptedToken, 'base64')
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

export function loadUser(): GitHubUser | null {
  try {
    if (!existsSync(CREDS_FILE)) return null
    const raw = readFileSync(CREDS_FILE, 'utf-8')
    const creds: Credentials = JSON.parse(raw)
    return creds.user ?? null
  } catch {
    return null
  }
}

export function clearCredentials(): void {
  try {
    if (existsSync(CREDS_FILE)) {
      writeFileSync(CREDS_FILE, JSON.stringify({}), 'utf-8')
    }
  } catch {
    // ignore
  }
}

export function hasCredentials(): boolean {
  return loadToken() !== null
}
