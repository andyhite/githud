import { describe, it, expect } from 'vitest'
import { sortNeedsReview, sortMyPrs } from './sort-prs'
import type { PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p', number: 1, title: 't', url: 'u', repo: 'o/r', branch: 'b',
    author: { login: 'me', avatarUrl: '' }, reviewers: [],
    reviewState: 'none', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'success', passed: 1, failed: 0, total: 1 },
    updatedAt: '2026-06-01T00:00:00Z', isStale: false, isDraft: false, ...over
  }
}

describe('sortNeedsReview', () => {
  it('puts the longest-waiting (oldest updatedAt) first', () => {
    const recent = pr({ id: 'recent', updatedAt: '2026-06-02T00:00:00Z' })
    const old = pr({ id: 'old', updatedAt: '2026-05-30T00:00:00Z' })
    expect(sortNeedsReview([recent, old]).map((p) => p.id)).toEqual(['old', 'recent'])
  })
  it('orders by verdict when quick-first with verdicts supplied', () => {
    const a = pr({ id: 'a', updatedAt: '2026-06-01T00:00:00Z' })
    const b = pr({ id: 'b', updatedAt: '2026-06-02T00:00:00Z' })
    const verdicts = { a: { label: 'big_effort' } as any, b: { label: 'quick_approve' } as any }
    expect(sortNeedsReview([a, b], 'quick-first', verdicts).map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('sortMyPrs', () => {
  it('floats actionable PRs above ready/draft', () => {
    const ready = pr({ id: 'ready', reviewState: 'approved' })
    const attention = pr({ id: 'attention', reviewState: 'changes_requested' })
    const draft = pr({ id: 'draft', isDraft: true })
    expect(sortMyPrs([ready, draft, attention]).map((p) => p.id)).toEqual(['attention', 'ready', 'draft'])
  })
})
