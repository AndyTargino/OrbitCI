import type Database from 'better-sqlite3'

export const name = '008_create_run_metrics'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      job_name TEXT,
      step_name TEXT,
      timestamp TEXT NOT NULL,
      cpu_percent REAL,
      ram_bytes INTEGER,
      gpu_percent REAL,
      gpu_mem_bytes INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_run_metrics_run_id ON run_metrics(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_metrics_step ON run_metrics(run_id, job_name, step_name);
  `)
}
