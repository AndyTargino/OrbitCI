import { useEffect, useRef } from 'react'
import { electron } from '@/lib/electron'
import { useRunsStore } from '@/store'
import { IPC_CHANNELS } from '@shared/constants'
import type { RunLog, RunLogEvent, RunStatusEvent } from '@shared/types'

export function useRunLogs(runId: string | null): void {
  const { appendRunLog, updateRunStatus } = useRunsStore()

  useEffect(() => {
    if (!runId) return

    // Initial fetch
    electron.runs.getLogs(runId).then((logs: RunLog[]) => {
      useRunsStore.getState().setRunLogs(runId, logs)
    })

    // Subscribe to live events
    const unsubLog = electron.on(IPC_CHANNELS.EVENT_RUN_LOG, (event: unknown) => {
      const e = event as RunLogEvent
      if (e.runId !== runId) return
      appendRunLog({
        id: Date.now(),
        runId: e.runId,
        jobName: e.jobName,
        stepName: e.stepName,
        message: e.message,
        type: e.type,
        timestamp: e.timestamp
      })
    })

    const unsubStatus = electron.on(IPC_CHANNELS.EVENT_RUN_STATUS, (event: unknown) => {
      const e = event as RunStatusEvent
      if (e.runId !== runId) return
      updateRunStatus(runId, e.status)
    })

    return () => {
      unsubLog()
      unsubStatus()
    }
  }, [runId])
}
