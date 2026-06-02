import { describe, it, expect } from 'vitest'
import { diffSnapshots } from './notifier'
import type { DashboardSnapshot, PullRequest, ActivityItem } from '@shared/types'

function pr(id: string, over: Partial<PullRequest> = {}): PullRequest {
  return {
    id, number: 1, title: `PR ${id}`, url: `https://gh/${id}`, repo: 'o/r',
    author: { login: 'me', avatarUrl: '' }, reviewers: [], reviewState: 'none',
    approvals: 0, mergeable: 'mergeable',
    checks: { state: 'success', passed: 1, failed: 0, total: 1 },
    updatedAt: '2026-06-02T00:00:00Z', isStale: false, isDraft: false, ...over
  }
}
function act(id: string, updatedAt = '2026-06-02T00:00:00Z'): ActivityItem {
  return { id, reason: 'comment', subjectType: 'PullRequest', repo: 'o/r', number: 1, title: 't', url: 'u', unread: true, updatedAt }
}
function snap(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    fetchedAt: '2026-06-02T00:00:00Z', viewer: { login: 'me', avatarUrl: '' },
    needsReview: [], myPullRequests: [], activity: [],
    rateLimit: { remaining: 5000, resetAt: '' }, ...over
  }
}

describe('diffSnapshots', () => {
  it('returns no notifications on first poll (prev is null)', () => {
    expect(diffSnapshots(null, snap({ needsReview: [pr('a')] }))).toEqual([])
  })

  it('notifies for a newly requested review', () => {
    const prev = snap()
    const next = snap({ needsReview: [pr('a', { title: 'Review me', repo: 'o/api', number: 7 })] })
    const specs = diffSnapshots(prev, next)
    expect(specs).toHaveLength(1)
    expect(specs[0].title).toMatch(/review/i)
    expect(specs[0].url).toBe('https://gh/a')
  })

  it('coalesces multiple new reviews into one notification', () => {
    const next = snap({ needsReview: [pr('a'), pr('b')] })
    const specs = diffSnapshots(snap(), next)
    expect(specs).toHaveLength(1)
    expect(specs[0].title).toMatch(/2/)
  })

  it('notifies for new activity items not seen before', () => {
    const prev = snap({ activity: [act('x')] })
    const next = snap({ activity: [act('y'), act('x')] })
    const specs = diffSnapshots(prev, next)
    expect(specs.some((s) => s.title.toLowerCase().includes('activity') || s.title.toLowerCase().includes('comment'))).toBe(true)
  })

  it('notifies when one of my PRs starts failing checks', () => {
    const prev = snap({ myPullRequests: [pr('a', { checks: { state: 'success', passed: 1, failed: 0, total: 1 } })] })
    const next = snap({ myPullRequests: [pr('a', { checks: { state: 'failure', passed: 0, failed: 1, total: 1 } })] })
    const specs = diffSnapshots(prev, next)
    expect(specs.some((s) => s.title.toLowerCase().includes('check'))).toBe(true)
  })

  it('notifies when one of my PRs flips to changes requested', () => {
    const prev = snap({ myPullRequests: [pr('a', { reviewState: 'none' })] })
    const next = snap({ myPullRequests: [pr('a', { reviewState: 'changes_requested' })] })
    const specs = diffSnapshots(prev, next)
    expect(specs.some((s) => s.title.toLowerCase().includes('change'))).toBe(true)
  })

  it('emits nothing when nothing changed', () => {
    const s = snap({ needsReview: [pr('a')], myPullRequests: [pr('b')], activity: [act('x')] })
    expect(diffSnapshots(s, s)).toEqual([])
  })
})
