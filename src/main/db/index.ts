import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import * as schema from './schema'
import { runMigrations } from './migrate'

const DATA_DIR = join(app.getPath('home'), '.orbitci')
const DB_PATH = join(DATA_DIR, 'orbit.db')

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

const sqlite: BetterSqlite3.Database = new Database(DB_PATH)

// Enable WAL mode for better concurrent performance
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

// ─── Database initialization (runs migrations) ────────────────────────────────
export function initDatabase(): void {
  runMigrations(sqlite)
  console.log('[DB] Ready at', DB_PATH)
}

export { sqlite, schema }
export const DATA_PATH = DATA_DIR
