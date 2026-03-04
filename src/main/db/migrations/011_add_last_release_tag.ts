import type Database from 'better-sqlite3'

export const name = '011_add_last_release_tag'

export function up(db: Database.Database): void {
  db.exec(`ALTER TABLE repos ADD COLUMN last_release_tag TEXT`)
}
