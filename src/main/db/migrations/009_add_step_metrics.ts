import type Database from 'better-sqlite3'

export const name = '009_add_step_metrics'

export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE run_steps ADD COLUMN peak_cpu_percent REAL;
    ALTER TABLE run_steps ADD COLUMN peak_ram_bytes INTEGER;
    ALTER TABLE run_steps ADD COLUMN peak_gpu_percent REAL;
    ALTER TABLE run_steps ADD COLUMN peak_gpu_mem_bytes INTEGER;
  `)
}
