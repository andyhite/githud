import { describe, it, expect } from 'vitest'
import { digestFingerprint, eventsSince, deltaPayload } from './digest'
import type { DashboardSnapshot, PullRequest, FeedEvent } from '@shared/types'

function evt(over: Partial<FeedEvent> = {}): FeedEvent {
  return { id: 'e1', kind: 'mention', repo: 'o/r', number: 1, title: 't', url: 'u', createdAt: '2026-06-03T10:00:00Z', unread: true, ...over }
}

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p1', number: 1, title: 't', url: 'u', repo: 'o/r', branch: 'b', baseBranch: 'main',
    author: { login: 'me', avatarUrl: '' }, reviewers: [],
    reviewState: 'none', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'success', passed: 1, failed: 0, total: 1 },
    additions: 0, deletions: 0, changedFiles: 0, unresolvedThreads: 0, labels: [],
    updatedAt: '2026-06-01T00:00:00Z', isStale: false, isDraft: false, ...over
  }
}

function snap(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    fetchedAt: '2026-06-02T00:00:00Z', viewer: { login: 'me', avatarUrl: '' },
    needsReview: [pr()], myPullRequests: [], teamPullRequests: [], events: [], hiddenPrIds: [], history: [],
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

describe('eventsSince', () => {
  it('returns only events strictly newer than sinceAt', () => {
    const events = [
      evt({ id: 'old', createdAt: '2026-06-03T09:00:00Z' }),
      evt({ id: 'same', createdAt: '2026-06-03T10:00:00Z' }),
      evt({ id: 'new', createdAt: '2026-06-03T11:00:00Z' })
    ]
    expect(eventsSince(events, '2026-06-03T10:00:00Z').map((e) => e.id)).toEqual(['new'])
  })

  it('returns [] when nothing is newer', () => {
    expect(eventsSince([evt({ createdAt: '2026-06-03T08:00:00Z' })], '2026-06-03T10:00:00Z')).toEqual([])
  })
})

describe('deltaPayload', () => {
  it('includes only events since sinceAt and the PRs they touch', () => {
    const s = snap({
      needsReview: [pr({ repo: 'o/r', number: 7, title: 'Touched' }), pr({ repo: 'o/r', number: 9, title: 'Untouched' })],
      events: [
        evt({ id: 'old', repo: 'o/r', number: 7, createdAt: '2026-06-03T08:00:00Z' }),
        evt({ id: 'new', kind: 'approved', repo: 'o/r', number: 7, createdAt: '2026-06-03T11:00:00Z', actor: { login: 'alice', avatarUrl: '' } })
      ]
    })
    const out = deltaPayload(s, '2026-06-03T10:00:00Z')
    expect(out.newEvents).toEqual([{ kind: 'approved', repo: 'o/r', number: 7, who: 'alice' }])
    expect(out.context).toEqual([{ repo: 'o/r', number: 7, title: 'Touched', checks: 'success' }])
  })
})
