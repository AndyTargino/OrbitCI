import type { ActionHandler } from './index'
import {
  ensureImageAvailable,
  createWorkflowContainer,
  execInContainer,
  stopAndRemoveContainer
} from '../../services/dockerService'

export const dockerActions: Record<string, ActionHandler> = {
  'docker/run': async ({ with: w, workspace, env, log }) => {
    const image = w?.image ?? 'ubuntu:22.04'
    const command = w?.command ?? 'echo done'
    const workingDir = w?.['working-dir']

    await ensureImageAvailable(image)
    log(`Pulling/verificando imagem: ${image}`)

    const containerId = await createWorkflowContainer({
      image,
      repoPath: workspace,
      env,
      runId: 'manual',
      jobName: 'docker/run'
    })

    try {
      const result = await execInContainer(containerId, command, workingDir)
      log(result.output)
      if (result.exitCode !== 0) {
        throw new Error(`Container exited with code ${result.exitCode}`)
      }
    } finally {
      await stopAndRemoveContainer(containerId)
    }
  }
}
