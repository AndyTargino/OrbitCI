import { registerAuthHandlers } from './auth'
import { registerRepoHandlers } from './repos'
import { registerWorkflowHandlers, setWorkflowRunner } from './workflows'
import { registerRunHandlers, setRunsRunner } from './runs'
import { registerGitHandlers } from './git'
import { registerDockerHandlers } from './docker'
import { registerSecretHandlers } from './secrets'
import { registerSettingsHandlers } from './settings'
import { WorkflowRunner } from '../runner/workflowRunner'

export function registerAllHandlers(): WorkflowRunner {
  const runner = new WorkflowRunner()
  runner.cleanupStaleRuns().catch(console.error)

  registerAuthHandlers()
  registerRepoHandlers()
  registerGitHandlers()
  registerDockerHandlers()
  registerSecretHandlers()
  registerSettingsHandlers()

  setWorkflowRunner(runner)
  registerWorkflowHandlers()

  setRunsRunner(runner)
  registerRunHandlers()

  return runner
}
