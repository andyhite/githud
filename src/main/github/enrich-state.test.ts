import { describe, it, expect } from 'vitest'
import { subjectStateLabel } from './enrich-state'

describe('subjectStateLabel', () => {
  it('labels a merged PR', () => {
    expect(subjectStateLabel({ state: 'closed', merged: true }, 'PullRequest')).toBe('merged')
    expect(subjectStateLabel({ state: 'closed', merged_at: '2026-06-02T00:00:00Z' }, 'PullRequest')).toBe('merged')
  })

  it('labels a closed (unmerged) PR and a reopened PR', () => {
    expect(subjectStateLabel({ state: 'closed', merged: false }, 'PullRequest')).toBe('closed')
    expect(subjectStateLabel({ state: 'open' }, 'PullRequest')).toBe('reopened')
  })

  it('labels closed / not-planned / reopened issues', () => {
    expect(subjectStateLabel({ state: 'closed', state_reason: 'completed' }, 'Issue')).toBe('closed')
    expect(subjectStateLabel({ state: 'closed', state_reason: 'not_planned' }, 'Issue')).toBe('closed as not planned')
    expect(subjectStateLabel({ state: 'open' }, 'Issue')).toBe('reopened')
  })

  it('returns undefined for unknown subject types', () => {
    expect(subjectStateLabel({ state: 'closed' }, 'Commit')).toBeUndefined()
  })
})
