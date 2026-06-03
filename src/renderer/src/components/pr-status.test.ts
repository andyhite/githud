import { describe, it, expect } from 'vitest'
import { mergeReadiness } from './pr-status'
import type { PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p', number: 1, title: 't', url: 'u', repo: 'o/r', branch: 'feature', baseBranch: 'main',
    author: { login: 'me', avatarUrl: '' }, reviewers: [],
    reviewState: 'none', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'success', passed: 1, failed: 0, total: 1 },
    additions: 0, deletions: 0, changedFiles: 0, unresolvedThreads: 0,
    updatedAt: '2026-06-01T00:00:00Z', isStale: false, isDraft: false, ...over
  }
}

describe('mergeReadiness', () => {
  it('is ready when approved + green + mergeable', () => {
    expect(mergeReadiness(pr({ reviewState: 'approved' }))).toBe('ready')
  })
  it('needs attention on changes requested, failing CI, or conflicts', () => {
    expect(mergeReadiness(pr({ reviewState: 'changes_requested' }))).toBe('needs_attention')
    expect(mergeReadiness(pr({ checks: { state: 'failure', passed: 0, failed: 1, total: 1 } }))).toBe('needs_attention')
    expect(mergeReadiness(pr({ reviewState: 'approved', mergeable: 'conflicting' }))).toBe('needs_attention')
  })
  it('is draft for drafts regardless of state', () => {
    expect(mergeReadiness(pr({ isDraft: true, reviewState: 'approved' }))).toBe('draft')
  })
  it('is waiting_review otherwise', () => {
    expect(mergeReadiness(pr())).toBe('waiting_review')
  })
})
