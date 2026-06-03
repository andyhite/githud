import { describe, it, expect } from 'vitest'
import { digestFingerprint } from './digest'
import type { DashboardSnapshot, PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p1', number: 1, title: 't', url: 'u', repo: 'o/r', branch: 'b', baseBranch: 'main',
    author: { login: 'me', avatarUrl: '' }, reviewers: [],
    reviewState: 'none', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'success', passed: 1, failed: 0, total: 1 },
    additions: 0, deletions: 0, changedFiles: 0, unresolvedThreads: 0,
    updatedAt: '2026-06-01T00:00:00Z', isStale: false, isDraft: false, ...over
  }
}

function snap(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    fetchedAt: '2026-06-02T00:00:00Z', viewer: { login: 'me', avatarUrl: '' },
    needsReview: [pr()], myPullRequests: [], events: [], hiddenPrIds: [],
    rateLimit: { remaining: 0, resetAt: '' }, ...over
  }
}

describe('digestFingerprint', () => {
  it('is stable across polls that only change fetchedAt', () => {
    expect(digestFingerprint(snap({ fetchedAt: 'A' }))).toBe(digestFingerprint(snap({ fetchedAt: 'B' })))
  })

  it('changes when the evaluated PR data changes (e.g. CI state)', () => {
    const before = digestFingerprint(snap())
    const after = digestFingerprint(snap({ needsReview: [pr({ checks: { state: 'failure', passed: 0, failed: 1, total: 1 } })] }))
    expect(after).not.toBe(before)
  })

  it('changes when an event is added or its read-state flips', () => {
    const base = snap({ events: [{ id: 'e1', kind: 'mention', repo: 'o/r', number: 1, title: 't', url: 'u', createdAt: 'x', unread: true }] })
    const read = snap({ events: [{ id: 'e1', kind: 'mention', repo: 'o/r', number: 1, title: 't', url: 'u', createdAt: 'x', unread: false }] })
    expect(digestFingerprint(read)).not.toBe(digestFingerprint(base))
  })
})
