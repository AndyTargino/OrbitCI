import { gitActions } from './git'
import { githubActions } from './github'
import { fileActions } from './file'
import { versionActions } from './version'
import { utilActions } from './utils'
import { dockerActions } from './docker'

export interface ActionContext {
  workspace: string
  env: Record<string, string>
  with: Record<string, string> | undefined
  log: (msg: string) => void
  setOutput: (key: string, value: string) => void
}

export type ActionHandler = (ctx: ActionContext) => Promise<Record<string, string> | void>

export const allActions: Record<string, ActionHandler> = {
  ...gitActions,
  ...githubActions,
  ...fileActions,
  ...versionActions,
  ...utilActions,
  ...dockerActions
}

export function getAction(name: string): ActionHandler | null {
  return allActions[name] ?? null
}
