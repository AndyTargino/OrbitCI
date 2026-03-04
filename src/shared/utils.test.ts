import { describe, it, expect } from 'vitest'

// ─── Version bump logic (mirrors version/bump action) ─────────────────────────

function bumpVersion(current: string, type: 'major' | 'minor' | 'patch'): string {
  const [major, minor, patch] = current.split('.').map(Number)
  switch (type) {
    case 'major': return `${major + 1}.0.0`
    case 'minor': return `${major}.${minor + 1}.0`
    case 'patch': return `${major}.${minor}.${patch + 1}`
  }
}

describe('version bump logic', () => {
  it('bumps patch correctly', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('0.0.0', 'patch')).toBe('0.0.1')
    expect(bumpVersion('1.0.9', 'patch')).toBe('1.0.10')
  })

  it('bumps minor and resets patch', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('0.0.5', 'minor')).toBe('0.1.0')
    expect(bumpVersion('2.9.0', 'minor')).toBe('2.10.0')
  })

  it('bumps major and resets minor+patch', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(bumpVersion('0.9.9', 'major')).toBe('1.0.0')
    expect(bumpVersion('0.0.0', 'major')).toBe('1.0.0')
  })
})

// ─── Changelog commit categorization (mirrors changelog/generate action) ──────

function categorizeCommit(subject: string): string {
  const match = subject.match(/^(\w+)(\(.+\))?:\s*(.+)$/)
  if (!match) return 'other'
  const type = match[1]
  const validTypes = ['feat', 'fix', 'chore', 'docs', 'refactor']
  return validTypes.includes(type) ? type : 'other'
}

describe('commit categorization', () => {
  it('categorizes feat commits', () => {
    expect(categorizeCommit('feat: add dark mode')).toBe('feat')
    expect(categorizeCommit('feat(ui): add dark mode')).toBe('feat')
  })

  it('categorizes fix commits', () => {
    expect(categorizeCommit('fix: resolve crash on startup')).toBe('fix')
    expect(categorizeCommit('fix(db): migration error')).toBe('fix')
  })

  it('categorizes chore commits', () => {
    expect(categorizeCommit('chore: update dependencies')).toBe('chore')
  })

  it('categorizes docs commits', () => {
    expect(categorizeCommit('docs: update README')).toBe('docs')
  })

  it('categorizes refactor commits', () => {
    expect(categorizeCommit('refactor: simplify runner')).toBe('refactor')
  })

  it('returns other for unknown types', () => {
    expect(categorizeCommit('build: update CI')).toBe('other')
    expect(categorizeCommit('ci: add test step')).toBe('other')
  })

  it('returns other for non-conventional messages', () => {
    expect(categorizeCommit('random commit message')).toBe('other')
    expect(categorizeCommit('WIP stuff')).toBe('other')
    expect(categorizeCommit('')).toBe('other')
  })
})

// ─── formatDuration (mirrors renderer utils) ──────────────────────────────────

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

describe('formatDuration', () => {
  it('returns dash for null/undefined/0', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(0)).toBe('—')
  })

  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(1)).toBe('1ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('formats seconds', () => {
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(5000)).toBe('5s')
    expect(formatDuration(59000)).toBe('59s')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s')
    expect(formatDuration(90000)).toBe('1m 30s')
    expect(formatDuration(3599000)).toBe('59m 59s')
  })

  it('formats hours, minutes, and seconds', () => {
    expect(formatDuration(3600000)).toBe('1h 0m 0s')
    expect(formatDuration(3661000)).toBe('1h 1m 1s')
    expect(formatDuration(7200000)).toBe('2h 0m 0s')
  })
})

// ─── truncate (mirrors renderer utils) ────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}

describe('truncate', () => {
  it('returns string unchanged if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('truncates and adds ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello…')
    expect(truncate('abcdefgh', 3)).toBe('abc…')
  })

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('')
  })
})
