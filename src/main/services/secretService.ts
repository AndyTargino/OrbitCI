import { safeStorage, app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { Secret } from '@shared/types'

const DATA_DIR = join(app.getPath('home'), '.orbitci')
const SECRETS_DIR = join(DATA_DIR, 'secrets')

interface SecretsFile {
  [key: string]: {
    encrypted: string // base64
    createdAt: string
    updatedAt: string
  }
}

function getSecretsPath(scope: string): string {
  return join(SECRETS_DIR, `${scope.replace(/\//g, '__')}.json`)
}

function ensureDirs(): void {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true })
  }
}

function readSecretsFile(scope: string): SecretsFile {
  ensureDirs()
  const path = getSecretsPath(scope)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SecretsFile
  } catch {
    return {}
  }
}

function writeSecretsFile(scope: string, data: SecretsFile): void {
  ensureDirs()
  writeFileSync(getSecretsPath(scope), JSON.stringify(data, null, 2), 'utf-8')
}

export function setSecret(scope: string, key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available')
  }
  const file = readSecretsFile(scope)
  const encrypted = safeStorage.encryptString(value).toString('base64')
  const now = new Date().toISOString()
  file[key] = {
    encrypted,
    createdAt: file[key]?.createdAt ?? now,
    updatedAt: now
  }
  writeSecretsFile(scope, file)
}

export function getSecret(scope: string, key: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const file = readSecretsFile(scope)
    const entry = file[key]
    if (!entry) return null
    const buf = Buffer.from(entry.encrypted, 'base64')
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

export function deleteSecret(scope: string, key: string): void {
  const file = readSecretsFile(scope)
  delete file[key]
  writeSecretsFile(scope, file)
}

export function listSecrets(scope: string): Secret[] {
  const file = readSecretsFile(scope)
  return Object.entries(file).map(([key, val]) => ({
    key,
    scope,
    createdAt: val.createdAt,
    updatedAt: val.updatedAt
  }))
}

/** Resolves secrets for use in workflow expressions */
export function resolveSecrets(scopes: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  // global first, then repo-specific (repo overrides global)
  for (const scope of ['global', ...scopes]) {
    const file = readSecretsFile(scope)
    for (const key of Object.keys(file)) {
      const val = getSecret(scope, key)
      if (val !== null) result[key] = val
    }
  }
  return result
}
