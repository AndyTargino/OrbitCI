import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── Repos ────────────────────────────────────────────────────────────────────
export const repos = sqliteTable('repos', {
  id: text('id').primaryKey(), // "owner/repo"
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  fullName: text('full_name').notNull(),
  localPath: text('local_path'),
  remoteUrl: text('remote_url'),
  defaultBranch: text('default_branch').default('main'),
  watchBranches: text('watch_branches').default('["main"]'), // JSON array
  pollInterval: integer('poll_interval').default(60),
  autoRun: integer('auto_run').default(1), // boolean
  notifications: integer('notifications').default(1), // boolean
  lastSyncAt: text('last_sync_at'),
  lastRemoteSha: text('last_remote_sha'),
  gitUserName: text('git_user_name'),
  gitUserEmail: text('git_user_email'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
})

// ─── Runs ─────────────────────────────────────────────────────────────────────
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(), // uuid
  repoId: text('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
  workflowFile: text('workflow_file').notNull(),
  workflowName: text('workflow_name'),
  trigger: text('trigger'),
  status: text('status').default('pending'), // pending | running | success | failure | cancelled
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  durationMs: integer('duration_ms'),
  gitSha: text('git_sha'),
  gitBranch: text('git_branch'),
  inputs: text('inputs'), // JSON
  outputs: text('outputs'), // JSON
  error: text('error'),
  peakCpuPercent: real('peak_cpu_percent'),
  peakRamBytes: integer('peak_ram_bytes'),
  peakGpuPercent: real('peak_gpu_percent'),
  peakGpuMemBytes: integer('peak_gpu_mem_bytes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
})

// ─── Run Logs ─────────────────────────────────────────────────────────────────
export const runLogs = sqliteTable('run_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  jobName: text('job_name'),
  stepName: text('step_name'),
  message: text('message').notNull(),
  type: text('type').default('info'), // info | output | error | success | skip | step | job | warning
  timestamp: text('timestamp').default(sql`CURRENT_TIMESTAMP`)
})

// ─── Run Jobs ─────────────────────────────────────────────────────────────────
export const runJobs = sqliteTable('run_jobs', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  jobName: text('job_name').notNull(),
  status: text('status').default('pending'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  durationMs: integer('duration_ms')
})

// ─── Run Steps ────────────────────────────────────────────────────────────────
export const runSteps = sqliteTable('run_steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => runJobs.id, { onDelete: 'cascade' }),
  stepName: text('step_name'),
  stepIndex: integer('step_index').notNull(),
  status: text('status').default('pending'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  durationMs: integer('duration_ms'),
  peakCpuPercent: real('peak_cpu_percent'),
  peakRamBytes: integer('peak_ram_bytes'),
  peakGpuPercent: real('peak_gpu_percent'),
  peakGpuMemBytes: integer('peak_gpu_mem_bytes')
})

// ─── Run Metrics ─────────────────────────────────────────────────────────────
export const runMetrics = sqliteTable('run_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  jobName: text('job_name'),
  stepName: text('step_name'),
  timestamp: text('timestamp').notNull(),
  cpuPercent: real('cpu_percent'),
  ramBytes: integer('ram_bytes'),
  gpuPercent: real('gpu_percent'),
  gpuMemBytes: integer('gpu_mem_bytes')
})

// ─── Schedules ────────────────────────────────────────────────────────────────
export const schedules = sqliteTable('schedules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repoId: text('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
  workflowFile: text('workflow_file').notNull(),
  cronExpr: text('cron_expr').notNull(),
  enabled: integer('enabled').default(1),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at')
})

// ─── Settings ─────────────────────────────────────────────────────────────────
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
})

export type RepoRow = typeof repos.$inferSelect
export type RepoInsert = typeof repos.$inferInsert
export type RunRow = typeof runs.$inferSelect
export type RunInsert = typeof runs.$inferInsert
export type RunLogRow = typeof runLogs.$inferSelect
export type RunJobRow = typeof runJobs.$inferSelect
export type RunStepRow = typeof runSteps.$inferSelect
export type RunMetricRow = typeof runMetrics.$inferSelect
export type ScheduleRow = typeof schedules.$inferSelect
export type SettingsRow = typeof settings.$inferSelect
