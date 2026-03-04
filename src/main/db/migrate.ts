import type Database from 'better-sqlite3'
import { up as up001, name as name001 } from './migrations/001_create_repos'
import { up as up002, name as name002 } from './migrations/002_create_runs'
import { up as up003, name as name003 } from './migrations/003_create_run_logs'
import { up as up004, name as name004 } from './migrations/004_create_run_jobs'
import { up as up005, name as name005 } from './migrations/005_create_run_steps'
import { up as up006, name as name006 } from './migrations/006_create_schedules'
import { up as up007, name as name007 } from './migrations/007_create_settings'
import { up as up008, name as name008 } from './migrations/008_create_run_metrics'
import { up as up009, name as name009 } from './migrations/009_add_step_metrics'
import { up as up010, name as name010 } from './migrations/010_add_run_metrics'

// ─── Migration registry (ordered) ────────────────────────────────────────────
interface Migration {
  name: string
  up: (db: Database.Database) => void
}

const MIGRATIONS: Migration[] = [
  { name: name001, up: up001 },
  { name: name002, up: up002 },
  { name: name003, up: up003 },
  { name: name004, up: up004 },
  { name: name005, up: up005 },
  { name: name006, up: up006 },
  { name: name007, up: up007 },
  { name: name008, up: up008 },
  { name: name009, up: up009 },
  { name: name010, up: up010 }
]

// ─── Migration runner ─────────────────────────────────────────────────────────
export function runMigrations(sqlite: Database.Database): void {
  // 1. Create the migrations tracking table (always - this is idempotent)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // 2. Get already-applied migrations
  const applied = new Set<string>(
    (sqlite.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(
      (row) => row.name
    )
  )

  // 3. Run pending migrations in order, inside a transaction per migration
  const insertMigration = sqlite.prepare(
    'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)'
  )

  let appliedCount = 0
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue

    // Wrap each migration in a transaction for atomicity
    const runTx = sqlite.transaction(() => {
      migration.up(sqlite)
      insertMigration.run(migration.name, new Date().toISOString())
    })

    try {
      runTx()
      console.log(`[DB] Migration aplicada: ${migration.name}`)
      appliedCount++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[DB] Falha na migration "${migration.name}": ${msg}`)
      throw new Error(`Migration failed: ${migration.name} — ${msg}`)
    }
  }

  if (appliedCount === 0) {
    console.log(`[DB] Banco de dados atualizado (${applied.size} migrations já aplicadas)`)
  } else {
    console.log(`[DB] ${appliedCount} migration(s) aplicada(s) com sucesso`)
  }
}

// ─── Migration status (for diagnostics) ──────────────────────────────────────
export function getMigrationStatus(sqlite: Database.Database): {
  name: string
  applied: boolean
  appliedAt?: string
}[] {
  let appliedRows: { name: string; applied_at: string }[] = []
  try {
    appliedRows = sqlite
      .prepare('SELECT name, applied_at FROM _migrations ORDER BY id')
      .all() as { name: string; applied_at: string }[]
  } catch {
    // table doesn't exist yet
  }

  const appliedMap = new Map(appliedRows.map((r) => [r.name, r.applied_at]))

  return MIGRATIONS.map((m) => ({
    name: m.name,
    applied: appliedMap.has(m.name),
    appliedAt: appliedMap.get(m.name)
  }))
}
