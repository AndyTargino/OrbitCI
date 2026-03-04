import type { ActionHandler } from './index'
import * as githubService from '../../services/githubService'
import { getRunnerInstance } from '../workflowRunner'
import { readFileSync } from 'fs'
import { join } from 'path'

export const githubActions: Record<string, ActionHandler> = {
  'github/create-release': async ({ with: w, workspace, env, log, setOutput, repoId }) => {
    if (!w?.['tag-name']) throw new Error('github/create-release: "tag-name" é obrigatório')

    const [owner, repo] = (w['repo'] ?? process.env['GITHUB_REPOSITORY'] ?? '/').split('/')
    let body = w?.body ?? ''
    if (w?.['body-from-file']) {
      try {
        body = readFileSync(join(workspace, w['body-from-file']), 'utf-8')
      } catch {
        body = ''
      }
    }

    const isDraft = w?.draft === 'true'
    const isPrerelease = w?.prerelease === 'true'

    const release = await githubService.createRelease(owner, repo, {
      tagName: w['tag-name'],
      name: w?.name ?? w['tag-name'],
      body,
      draft: isDraft,
      prerelease: isPrerelease
    })

    log(`✓ Release publicada: ${release.htmlUrl}`)
    setOutput('release-id', String(release.id))
    setOutput('html-url', release.htmlUrl)

    // Fire release event to trigger dependent workflows (e.g. build-*.yml)
    if (!isDraft && repoId) {
      const runner = getRunnerInstance()
      if (runner) {
        const branch = env?.GITHUB_REF_NAME ?? env?.GITHUB_HEAD_REF ?? 'main'
        const sha = env?.GITHUB_SHA ?? ''
        await runner.triggerEvent(repoId, 'release', {
          branch,
          sha,
          release: {
            tag_name: w['tag-name'],
            name: w?.name ?? w['tag-name'],
            body,
            draft: isDraft,
            prerelease: isPrerelease,
            html_url: release.htmlUrl,
            id: release.id
          }
        })
        log(`✓ Evento release disparado para workflows dependentes`)
      }
    }

    return { 'release-id': String(release.id), 'html-url': release.htmlUrl }
  },

  'github/upload-asset': async ({ with: w, workspace, log }) => {
    if (!w?.['release-tag'] && !w?.['release-id']) {
      throw new Error('github/upload-asset: "release-id" ou "release-tag" é obrigatório')
    }
    if (!w?.file) throw new Error('github/upload-asset: "file" é obrigatório')

    const [owner, repo] = (w['repo'] ?? process.env['GITHUB_REPOSITORY'] ?? '/').split('/')
    const filePath = join(workspace, w.file)
    const fileName = w?.name ?? w.file.split('/').pop() ?? 'asset'
    const releaseId = parseInt(w['release-id'] ?? '0')

    await githubService.uploadReleaseAsset(owner, repo, releaseId, filePath, fileName)
    log(`✓ Asset enviado: ${fileName}`)
  },

  'github/create-issue': async ({ with: w, workspace, log, setOutput }) => {
    if (!w?.title) throw new Error('github/create-issue: "title" é obrigatório')
    const [owner, repo] = (w['repo'] ?? process.env['GITHUB_REPOSITORY'] ?? '/').split('/')
    const labels = w?.labels?.split(',').map((l) => l.trim())
    const number = await githubService.createIssue(owner, repo, w.title, w?.body, labels)
    log(`✓ Issue criada: #${number}`)
    setOutput('issue-number', String(number))
  },

  'github/close-issue': async ({ with: w, workspace, log }) => {
    if (!w?.['issue-number']) throw new Error('github/close-issue: "issue-number" é obrigatório')
    const [owner, repo] = (w['repo'] ?? process.env['GITHUB_REPOSITORY'] ?? '/').split('/')
    await githubService.closeIssue(owner, repo, parseInt(w['issue-number']))
    log(`✓ Issue #${w['issue-number']} fechada`)
  },

  'github/comment': async ({ with: w, workspace, log }) => {
    if (!w?.number) throw new Error('github/comment: "number" é obrigatório')
    if (!w?.body) throw new Error('github/comment: "body" é obrigatório')
    const [owner, repo] = (w['repo'] ?? process.env['GITHUB_REPOSITORY'] ?? '/').split('/')
    await githubService.addComment(owner, repo, parseInt(w.number), w.body)
    log(`✓ Comentário adicionado em #${w.number}`)
  },

  'github/set-status': async ({ with: w, workspace, log }) => {
    if (!w?.sha || !w?.state) throw new Error('github/set-status: "sha" e "state" são obrigatórios')
    const [owner, repo] = (w['repo'] ?? process.env['GITHUB_REPOSITORY'] ?? '/').split('/')
    await githubService.setCommitStatus(
      owner,
      repo,
      w.sha,
      w.state as 'pending' | 'success' | 'failure' | 'error',
      w?.description,
      w?.context
    )
    log(`✓ Status definido: ${w.state}`)
  }
}
