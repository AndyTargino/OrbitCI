import { useEffect } from 'react'
import { electron } from '@/lib/electron'
import { useRepoStore, useRunsStore } from '@/store'
import { IPC_CHANNELS } from '@shared/constants'
import type { SyncEvent, RunStatusEvent, RunLogEvent, RunLog } from '@shared/types'

export function useGlobalEvents(): void {
  const { addSyncEvent } = useRepoStore()
  const { updateRunStatus, appendRunLog } = useRunsStore()

  useEffect(() => {
    const unsubSync = electron.on(IPC_CHANNELS.EVENT_SYNC, (event: unknown) => {
      addSyncEvent(event as SyncEvent)
    })

    const unsubStatus = electron.on(IPC_CHANNELS.EVENT_RUN_STATUS, (event: unknown) => {
      const e = event as RunStatusEvent
      updateRunStatus(e.runId, e.status)
    })

    const unsubLog = electron.on(IPC_CHANNELS.EVENT_RUN_LOG, (event: unknown) => {
      const e = event as RunLogEvent
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

    return () => {
      unsubSync()
      unsubStatus()
      unsubLog()
    }
  }, [])
}
