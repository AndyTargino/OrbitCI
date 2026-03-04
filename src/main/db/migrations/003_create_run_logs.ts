import type Database from 'better-sqlite3'

export const name = '003_create_run_logs'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      job_name TEXT,
      step_name TEXT,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_logs_type ON run_logs(type);
  `)
}
