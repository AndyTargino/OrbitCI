import cron from 'node-cron'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { db } from '../db'
import { repos } from '../db/schema'
import { WORKFLOWS_DIR } from '@shared/constants'
import type { WorkflowRunner } from '../runner/workflowRunner'
import type { WorkflowDefinition } from '@shared/types'

// Map repoId → list of active cron tasks
const activeTasks = new Map<string, cron.ScheduledTask[]>()

let runner: WorkflowRunner | null = null

export function setScheduleRunner(r: WorkflowRunner): void {
  runner = r
}

/**
 * Start the schedule service on app boot.
 * Scans all repos with a localPath and registers cron jobs for
 * any workflows that have `on.schedule[].cron` defined.
 */
export async function startScheduleService(): Promise<void> {
  const allRepos = await db.select().from(repos)
  for (const repo of allRepos) {
    if (repo.localPath) {
      registerRepoSchedules(repo.id, repo.localPath)
    }
  }
  console.log(`[ScheduleService] Started — ${activeTasks.size} repo(s) with schedules`)
}

/** Stop all cron jobs (called on app quit). */
export function stopScheduleService(): void {
  for (const tasks of activeTasks.values()) {
    for (const task of tasks) task.stop()
  }
  activeTasks.clear()
}

/**
 * Re-scan a single repo's workflows and (re)register its cron jobs.
 * Call this whenever workflows are added/saved in a repo.
 */
export function registerRepoSchedules(repoId: string, localPath: string): void {
  // Remove any previously registered tasks for this repo
  unregisterRepoSchedules(repoId)

  const workflowsDir = join(localPath, WORKFLOWS_DIR)
  if (!existsSync(workflowsDir)) return

  const files = readdirSync(workflowsDir).filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml')
  )

  const tasks: cron.ScheduledTask[] = []

  for (const file of files) {
    try {
      const content = readFileSync(join(workflowsDir, file), 'utf-8')
      const wf = yaml.load(content) as WorkflowDefinition
      if (!wf?.on) continue

      // GitHub format: on.schedule is an array of { cron: string }
      const scheduleDef = (wf.on as Record<string, unknown>)['schedule']
      if (!scheduleDef) continue

      const schedules = Array.isArray(scheduleDef)
        ? (scheduleDef as { cron?: string }[])
        : [scheduleDef as { cron?: string }]

      for (const entry of schedules) {
        const expr = entry?.cron
        if (!expr) continue

        if (!cron.validate(expr)) {
          console.warn(`[ScheduleService] Invalid cron expression in ${repoId}/${file}: "${expr}"`)
          continue
        }

        const task = cron.schedule(
          expr,
          async () => {
            if (!runner) return
            console.log(`[ScheduleService] Firing scheduled run: ${repoId} → ${file} (${expr})`)
            try {
              await runner.queueRun(repoId, file, 'schedule', {})
            } catch (err) {
              console.error(`[ScheduleService] Failed to queue run for ${repoId}/${file}:`, err)
            }
          },
          { scheduled: true, timezone: 'UTC' }
        )

        tasks.push(task)
        console.log(`[ScheduleService] Registered: ${repoId}/${file} → cron "${expr}"`)
      }
    } catch (err) {
      console.error(`[ScheduleService] Error parsing ${file}:`, err)
    }
  }

  if (tasks.length > 0) {
    activeTasks.set(repoId, tasks)
  }
}

/** Remove and stop all cron tasks for a given repo. */
export function unregisterRepoSchedules(repoId: string): void {
  const existing = activeTasks.get(repoId)
  if (existing) {
    for (const task of existing) task.stop()
    activeTasks.delete(repoId)
    console.log(`[ScheduleService] Unregistered schedules for ${repoId}`)
  }
}

/** Returns how many active scheduled tasks exist across all repos. */
export function getActiveScheduleCount(): number {
  let total = 0
  for (const tasks of activeTasks.values()) total += tasks.length
  return total
}
