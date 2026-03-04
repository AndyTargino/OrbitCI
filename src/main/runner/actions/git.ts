import type { ActionHandler } from './index'
import * as gitEngine from '../../git/gitEngine'
import { loadToken } from '../../services/credentialService'
import archiver from 'archiver'
import { createWriteStream, mkdirSync } from 'fs'
import { join } from 'path'
import { RELEASES_DIR } from '@shared/constants'

export const gitActions: Record<string, ActionHandler> = {
  'git/commit': async ({ with: w, workspace, log }) => {
    const message = w?.message ?? 'chore: automated commit'
    const addAll = w?.['add-all'] === 'true'
    const files = w?.files ? w.files.split(',').map((f) => f.trim()) : []

    if (addAll) {
      await gitEngine.stageAll(workspace)
      log(`Staged all files`)
    } else if (files.length > 0) {
      await gitEngine.stageFiles(workspace, files)
      log(`Staged: ${files.join(', ')}`)
    }

    const sha = await gitEngine.commit(workspace, message)
    log(`✓ Committed: ${sha.slice(0, 7)} — ${message}`)
    return { sha }
  },

  'git/push': async ({ with: w, workspace, log, env, setOutput }) => {
    const remote = w?.remote ?? 'origin'
    const branch = w?.branch
    const withTags = w?.tags === 'true'
    const token = loadToken()

    if (token) {
      await gitEngine.authenticatedPush(workspace, token, remote, branch, withTags)
    } else {
      await gitEngine.push(workspace, remote, branch, withTags)
    }
    log(`✓ Push para ${remote}/${branch ?? 'HEAD'}${withTags ? ' (com tags)' : ''}`)
  },

  'git/pull': async ({ with: w, workspace, log }) => {
    const remote = w?.remote ?? 'origin'
    await gitEngine.pull(workspace, remote)
    log(`✓ Pull realizado`)
  },

  'git/tag': async ({ with: w, workspace, log, setOutput }) => {
    const name = w?.name
    if (!name) throw new Error('git/tag: parâmetro "name" é obrigatório')
    const message = w?.message
    await gitEngine.createTag(workspace, name, message)
    log(`✓ Tag criada: ${name}`)
    setOutput('tag', name)
  },

  'git/checkout': async ({ with: w, workspace, log }) => {
    const ref = w?.ref
    if (!ref) throw new Error('git/checkout: parâmetro "ref" é obrigatório')
    await gitEngine.checkout(workspace, ref)
    log(`✓ Checkout: ${ref}`)
  },

  'git/create-branch': async ({ with: w, workspace, log }) => {
    const name = w?.name
    if (!name) throw new Error('git/create-branch: parâmetro "name" é obrigatório')
    const ref = w?.ref
    await gitEngine.createBranch(workspace, name, ref)
    log(`✓ Branch criada: ${name}`)
  },

  'git/release': async ({ with: w, workspace, log, setOutput }) => {
    const name = w?.name ?? 'release'
    const outputDir = w?.['output-dir']
      ? join(workspace, w['output-dir'])
      : join(workspace, RELEASES_DIR)

    mkdirSync(outputDir, { recursive: true })
    const zipPath = join(outputDir, `${name}.zip`)

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath)
      const arc = archiver('zip', { zlib: { level: 9 } })
      output.on('close', resolve)
      arc.on('error', reject)
      arc.pipe(output)
      arc.glob('**/*', {
        cwd: workspace,
        ignore: ['node_modules/**', '.git/**', '.orbit/**', 'dist/**', 'out/**']
      })
      arc.finalize()
    })

    log(`✓ Release criada: ${zipPath}`)
    setOutput('zip-path', zipPath)
    return { 'zip-path': zipPath }
  }
}
