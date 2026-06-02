import { describe, it, expect } from 'vitest'
import { normalizePullRequests } from './normalize-prs'

const now = Date.parse('2026-06-02T00:00:00Z')
const staleMs = 2 * 24 * 60 * 60 * 1000

function prNode(overrides: any = {}) {
  return {
    id: 'PR_1',
    number: 210,
    title: 'Add retry logic',
    url: 'https://github.com/o/api/pull/210',
    isDraft: false,
    updatedAt: '2026-06-01T20:00:00Z',
    mergeable: 'MERGEABLE',
    repository: { nameWithOwner: 'o/api' },
    author: { login: 'jdoe', avatarUrl: 'av' },
    reviewRequests: { nodes: [{ requestedReviewer: { login: 'me', avatarUrl: 'av-me' } }] },
    reviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    ...overrides
  }
}

describe('normalizePullRequests', () => {
  it('maps core fields and repo/author', () => {
    const [pr] = normalizePullRequests([prNode()], { now, staleThresholdMs: staleMs })
    expect(pr).toMatchObject({
      id: 'PR_1', number: 210, title: 'Add retry logic',
      url: 'https://github.com/o/api/pull/210', repo: 'o/api',
      author: { login: 'jdoe', avatarUrl: 'av' }, isDraft: false
    })
  })

  it('extracts requested reviewers', () => {
    const [pr] = normalizePullRequests([prNode()], { now, staleThresholdMs: staleMs })
    expect(pr.reviewers).toEqual([{ login: 'me', avatarUrl: 'av-me' }])
  })

  it('maps mergeable enum to lowercase union', () => {
    expect(normalizePullRequests([prNode({ mergeable: 'CONFLICTING' })], { now, staleThresholdMs: staleMs })[0].mergeable).toBe('conflicting')
    expect(normalizePullRequests([prNode({ mergeable: 'UNKNOWN' })], { now, staleThresholdMs: staleMs })[0].mergeable).toBe('unknown')
  })

  it('derives reviewState=approved and approvals count from latest review per author', () => {
    const node = prNode({
      reviews: { nodes: [
        { state: 'COMMENTED', author: { login: 'a', avatarUrl: '' } },
        { state: 'APPROVED', author: { login: 'a', avatarUrl: '' } },
        { state: 'APPROVED', author: { login: 'b', avatarUrl: '' } }
      ] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.reviewState).toBe('approved')
    expect(pr.approvals).toBe(2)
  })

  it('derives reviewState=changes_requested when any latest review requests changes', () => {
    const node = prNode({
      reviews: { nodes: [
        { state: 'APPROVED', author: { login: 'a', avatarUrl: '' } },
        { state: 'CHANGES_REQUESTED', author: { login: 'b', avatarUrl: '' } }
      ] }
    })
    expect(normalizePullRequests([node], { now, staleThresholdMs: staleMs })[0].reviewState).toBe('changes_requested')
  })

  it('uses latest review per author (changes then re-approve = approved)', () => {
    const node = prNode({
      reviews: { nodes: [
        { state: 'CHANGES_REQUESTED', author: { login: 'a', avatarUrl: '' } },
        { state: 'APPROVED', author: { login: 'a', avatarUrl: '' } }
      ] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.reviewState).toBe('approved')
    expect(pr.approvals).toBe(1)
  })

  it('summarizes checks from statusCheckRollup contexts', () => {
    const node = prNode({
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'FAILURE',
        contexts: { nodes: [
          { __typename: 'CheckRun', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', conclusion: 'FAILURE' },
          { __typename: 'StatusContext', state: 'SUCCESS' },
          { __typename: 'CheckRun', conclusion: null } // in-progress
        ] }
      } } }] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.checks).toEqual({ state: 'failure', passed: 2, failed: 1, total: 4 })
  })

  it('reports checks state none when no rollup', () => {
    expect(normalizePullRequests([prNode()], { now, staleThresholdMs: staleMs })[0].checks)
      .toEqual({ state: 'none', passed: 0, failed: 0, total: 0 })
  })

  it('flags stale when updatedAt older than threshold', () => {
    const fresh = prNode({ updatedAt: '2026-06-01T23:00:00Z' })
    const stale = prNode({ updatedAt: '2026-05-28T00:00:00Z' })
    expect(normalizePullRequests([fresh], { now, staleThresholdMs: staleMs })[0].isStale).toBe(false)
    expect(normalizePullRequests([stale], { now, staleThresholdMs: staleMs })[0].isStale).toBe(true)
  })
})
