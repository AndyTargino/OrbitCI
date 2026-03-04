import type Database from 'better-sqlite3'

export const name = '001_create_repos'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      full_name TEXT NOT NULL,
      local_path TEXT,
      remote_url TEXT,
      default_branch TEXT DEFAULT 'main',
      watch_branches TEXT DEFAULT '["main"]',
      poll_interval INTEGER DEFAULT 60,
      auto_run INTEGER DEFAULT 1,
      notifications INTEGER DEFAULT 1,
      last_sync_at TEXT,
      last_remote_sha TEXT,
      git_user_name TEXT,
      git_user_email TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_repos_owner ON repos(owner);
  `)
}
