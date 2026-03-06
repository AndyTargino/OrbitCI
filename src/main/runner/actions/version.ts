import type { ActionHandler } from './index'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

export const versionActions: Record<string, ActionHandler> = {
  'version/bump': async ({ with: w, workspace, log, setOutput, env }) => {
    const type = (w?.type ?? 'patch') as 'major' | 'minor' | 'patch'
    const file = w?.file ?? 'package.json'
    const filePath = join(workspace, file)

    const content = JSON.parse(readFileSync(filePath, 'utf-8'))
    const currentVersion: string = content.version ?? '0.0.0'
    const [major, minor, patch] = currentVersion.split('.').map(Number)

    let newVersion: string
    switch (type) {
      case 'major': newVersion = `${major + 1}.0.0`; break
      case 'minor': newVersion = `${major}.${minor + 1}.0`; break
      case 'patch': newVersion = `${major}.${minor}.${patch + 1}`; break
    }

    content.version = newVersion
    writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8')

    log(`[OK] Version: ${currentVersion} -> ${newVersion}`)
    setOutput('new-version', newVersion)
    setOutput('old-version', currentVersion)
    env['NEW_VERSION'] = newVersion
    env['OLD_VERSION'] = currentVersion

    return { 'new-version': newVersion, 'old-version': currentVersion }
  },

  'changelog/generate': async ({ with: w, workspace, log, setOutput }) => {
    const output = w?.output ?? 'CHANGELOG.md'
    const limit = parseInt(w?.limit ?? '30')
    const outputPath = join(workspace, output)

    try {
      // Get commits for changelog
      const gitLog = execSync(
        `git log --format="%h|%s|%an|%ai" -n ${limit}`,
        { cwd: workspace, encoding: 'utf-8' }
      )

      const commits = gitLog.trim().split('\n').filter(Boolean).map((line) => {
        const [hash, subject, author, date] = line.split('|')
        return { hash, subject, author, date: date?.slice(0, 10) }
      })

      const now = new Date().toISOString().slice(0, 10)
      const sections: Record<string, string[]> = {
        feat: [],
        fix: [],
        chore: [],
        docs: [],
        refactor: [],
        other: []
      }

      for (const c of commits) {
        const match = c.subject?.match(/^(\w+)(\(.+\))?:\s*(.+)$/)
        if (match) {
          const [, type, , desc] = match
          const key = sections[type] ? type : 'other'
          sections[key].push(`- ${desc} (${c.hash})`)
        } else {
          sections.other.push(`- ${c.subject ?? ''} (${c.hash})`)
        }
      }

      let changelog = `# Changelog\n\n## ${now}\n\n`
      if (sections.feat.length) changelog += `### Features\n${sections.feat.join('\n')}\n\n`
      if (sections.fix.length) changelog += `### Bug Fixes\n${sections.fix.join('\n')}\n\n`
      if (sections.refactor.length) changelog += `### Refactoring\n${sections.refactor.join('\n')}\n\n`
      if (sections.docs.length) changelog += `### Documentation\n${sections.docs.join('\n')}\n\n`
      if (sections.chore.length) changelog += `### Chores\n${sections.chore.join('\n')}\n\n`
      if (sections.other.length) changelog += `### Other\n${sections.other.join('\n')}\n\n`

      writeFileSync(outputPath, changelog, 'utf-8')
      log(`[OK] CHANGELOG.md gerado com ${commits.length} commits`)
      setOutput('path', outputPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`[WARN] Erro ao gerar changelog: ${msg}`)
    }
  }
}
