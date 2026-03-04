import { describe, it, expect } from 'vitest'
import { IPC_CHANNELS, APP_NAME, MIN_POLL_INTERVAL, DEFAULT_POLL_INTERVAL } from './constants'

describe('constants', () => {
  it('APP_NAME is OrbitCI', () => {
    expect(APP_NAME).toBe('OrbitCI')
  })

  it('poll intervals are valid', () => {
    expect(MIN_POLL_INTERVAL).toBeGreaterThan(0)
    expect(DEFAULT_POLL_INTERVAL).toBeGreaterThanOrEqual(MIN_POLL_INTERVAL)
  })

  it('IPC channel names are unique', () => {
    const values = Object.values(IPC_CHANNELS)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })

  it('IPC channels have correct naming convention', () => {
    for (const [key, value] of Object.entries(IPC_CHANNELS)) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
      // All channels should contain a colon separator
      expect(value).toContain(':')
    }
  })

  it('all event channels start with "event:"', () => {
    const eventKeys = Object.keys(IPC_CHANNELS).filter((k) => k.startsWith('EVENT_'))
    for (const key of eventKeys) {
      expect(IPC_CHANNELS[key as keyof typeof IPC_CHANNELS]).toMatch(/^event:/)
    }
  })

  it('all updater channels start with "updater:"', () => {
    const updaterKeys = Object.keys(IPC_CHANNELS).filter(
      (k) => k.startsWith('UPDATER_')
    )
    expect(updaterKeys.length).toBeGreaterThan(0)
    for (const key of updaterKeys) {
      expect(IPC_CHANNELS[key as keyof typeof IPC_CHANNELS]).toMatch(/^updater:/)
    }
  })

  it('required IPC channels exist', () => {
    // Auth
    expect(IPC_CHANNELS.AUTH_LOGIN).toBeDefined()
    expect(IPC_CHANNELS.AUTH_LOGOUT).toBeDefined()
    expect(IPC_CHANNELS.AUTH_GET_USER).toBeDefined()

    // Repos
    expect(IPC_CHANNELS.REPOS_LIST).toBeDefined()
    expect(IPC_CHANNELS.REPOS_ADD).toBeDefined()
    expect(IPC_CHANNELS.REPOS_REMOVE).toBeDefined()

    // Workflows
    expect(IPC_CHANNELS.WORKFLOWS_LIST).toBeDefined()
    expect(IPC_CHANNELS.WORKFLOWS_RUN).toBeDefined()

    // Runs
    expect(IPC_CHANNELS.RUNS_LIST).toBeDefined()
    expect(IPC_CHANNELS.RUNS_GET).toBeDefined()
    expect(IPC_CHANNELS.RUNS_CANCEL).toBeDefined()

    // Settings
    expect(IPC_CHANNELS.SETTINGS_GET).toBeDefined()
    expect(IPC_CHANNELS.SETTINGS_UPDATE).toBeDefined()

    // Updater
    expect(IPC_CHANNELS.UPDATER_CHECK).toBeDefined()
    expect(IPC_CHANNELS.UPDATER_DOWNLOAD).toBeDefined()
    expect(IPC_CHANNELS.UPDATER_INSTALL).toBeDefined()
    expect(IPC_CHANNELS.UPDATER_GET_VERSION).toBeDefined()

    // Events
    expect(IPC_CHANNELS.EVENT_RUN_LOG).toBeDefined()
    expect(IPC_CHANNELS.EVENT_RUN_STATUS).toBeDefined()
    expect(IPC_CHANNELS.EVENT_UPDATER).toBeDefined()
  })
})
