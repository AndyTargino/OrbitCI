import type Database from 'better-sqlite3'

export const name = '004_create_run_jobs'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      job_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_run_jobs_run_id ON run_jobs(run_id);
  `)
}
