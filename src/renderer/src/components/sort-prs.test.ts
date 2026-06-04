import { describe, it, expect } from 'vitest'
import { sortNeedsReview, sortMyPrs, sortTeamPrs } from './sort-prs'
import type { PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p', number: 1, title: 't', url: 'u', repo: 'o/r', branch: 'b', baseBranch: 'main',
    author: { login: 'me', avatarUrl: '' }, reviewers: [],
    reviewState: 'none', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'success', passed: 1, failed: 0, total: 1 },
    additions: 0, deletions: 0, changedFiles: 0, unresolvedThreads: 0, labels: [],
    updatedAt: '2026-06-01T00:00:00Z', isStale: false, isDraft: false, isQueued: false, ...over
  }
}

describe('sortNeedsReview', () => {
  it('puts the longest-waiting (oldest updatedAt) first', () => {
    const recent = pr({ id: 'recent', updatedAt: '2026-06-02T00:00:00Z' })
    const old = pr({ id: 'old', updatedAt: '2026-05-30T00:00:00Z' })
    expect(sortNeedsReview([recent, old]).map((p) => p.id)).toEqual(['old', 'recent'])
  })
  it('breaks ties (same age) by triage verdict — quickest effort first', () => {
    const a = pr({ id: 'a', updatedAt: '2026-06-01T00:00:00Z' })
    const b = pr({ id: 'b', updatedAt: '2026-06-01T00:00:00Z' }) // same age as a
    const verdicts = { a: { label: 'big_effort' } as any, b: { label: 'quick_approve' } as any }
    expect(sortNeedsReview([a, b], verdicts).map((p) => p.id)).toEqual(['b', 'a'])
  })
  it('keeps age as the primary key regardless of verdict', () => {
    const oldBig = pr({ id: 'oldBig', updatedAt: '2026-05-30T00:00:00Z' })
    const newQuick = pr({ id: 'newQuick', updatedAt: '2026-06-02T00:00:00Z' })
    const verdicts = { oldBig: { label: 'big_effort' } as any, newQuick: { label: 'quick_approve' } as any }
    expect(sortNeedsReview([newQuick, oldBig], verdicts).map((p) => p.id)).toEqual(['oldBig', 'newQuick'])
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

describe('sortTeamPrs', () => {
  it('puts the oldest (oldest updatedAt) first, ignoring status', () => {
    const recentDraft = pr({ id: 'recentDraft', updatedAt: '2026-06-02T00:00:00Z', isDraft: true })
    const oldReady = pr({ id: 'oldReady', updatedAt: '2026-05-30T00:00:00Z', reviewState: 'approved' })
    expect(sortTeamPrs([recentDraft, oldReady]).map((p) => p.id)).toEqual(['oldReady', 'recentDraft'])
  })
})
