import type Database from 'better-sqlite3'

export const name = '005_create_run_steps'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES run_jobs(id) ON DELETE CASCADE,
      step_name TEXT,
      step_index INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_steps_job_id ON run_steps(job_id);
  `)
}
