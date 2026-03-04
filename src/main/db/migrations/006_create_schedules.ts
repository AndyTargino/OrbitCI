import type Database from 'better-sqlite3'

export const name = '006_create_schedules'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      workflow_file TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_repo_id ON schedules(repo_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
  `)
}
