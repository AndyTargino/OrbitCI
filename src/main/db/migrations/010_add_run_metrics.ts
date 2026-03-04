import type Database from 'better-sqlite3'

export const name = '010_add_run_metrics'

export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE runs ADD COLUMN peak_cpu_percent REAL;
    ALTER TABLE runs ADD COLUMN peak_ram_bytes INTEGER;
    ALTER TABLE runs ADD COLUMN peak_gpu_percent REAL;
    ALTER TABLE runs ADD COLUMN peak_gpu_mem_bytes INTEGER;
  `)
}
