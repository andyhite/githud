import { describe, it, expect } from 'vitest'
import { classifyActivity } from './activity-severity'
import type { ActivityItem } from '@shared/types'

function item(over: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 't1', reason: 'comment', subjectType: 'PullRequest', repo: 'o/web', number: 1,
    title: 'Fix nav focus trap', url: 'u', unread: true, updatedAt: '2026-06-02T00:00:00Z', ...over
  }
}

describe('classifyActivity', () => {
  it('treats CI activity as a failure by default', () => {
    expect(classifyActivity(item({ reason: 'ci_activity', title: 'CI workflow run' }))).toBe('failure')
  })

  it('treats CI activity as success when the title says it passed', () => {
    expect(classifyActivity(item({ reason: 'ci_activity', title: 'CI succeeded on main' }))).toBe('success')
    expect(classifyActivity(item({ reason: 'ci_activity', title: 'All checks passed' }))).toBe('success')
  })

  it('does not read status keywords from non-CI titles', () => {
    // A PR titled with the word "failure" must stay info, not turn red.
    expect(classifyActivity(item({ reason: 'comment', title: 'Fix login failure' }))).toBe('info')
  })

  it('treats comments, mentions, reviews, assignments as info', () => {
    for (const reason of ['comment', 'mention', 'team_mention', 'review_requested', 'assign', 'subscribed', 'author', 'state_change']) {
      expect(classifyActivity(item({ reason }))).toBe('info')
    }
  })

  it('falls back to info for unknown reasons', () => {
    expect(classifyActivity(item({ reason: 'something_new' }))).toBe('info')
  })
})
