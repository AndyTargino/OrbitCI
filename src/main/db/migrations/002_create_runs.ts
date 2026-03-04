import type Database from 'better-sqlite3'

export const name = '002_create_runs'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      workflow_file TEXT NOT NULL,
      workflow_name TEXT,
      trigger TEXT,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      git_sha TEXT,
      git_branch TEXT,
      inputs TEXT,
      outputs TEXT,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_runs_repo_id ON runs(repo_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
  `)
}
