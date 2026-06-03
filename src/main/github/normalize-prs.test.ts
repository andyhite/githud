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
    headRefName: 'feature/x',
    baseRefName: 'main',
    additions: 40,
    deletions: 8,
    changedFiles: 3,
    repository: { nameWithOwner: 'o/api' },
    author: { login: 'jdoe', avatarUrl: 'av' },
    reviewRequests: { nodes: [{ requestedReviewer: { login: 'me', avatarUrl: 'av-me' } }] },
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
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

  it('extracts label names (empty when none / missing)', () => {
    const [pr] = normalizePullRequests([prNode({ labels: { nodes: [{ name: 'frontend' }, { name: 'bug' }] } })], { now, staleThresholdMs: staleMs })
    expect(pr.labels).toEqual(['frontend', 'bug'])
    expect(normalizePullRequests([prNode()], { now, staleThresholdMs: staleMs })[0].labels).toEqual([])
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

  it('counts only required checks when the base branch has required status check contexts', () => {
    const node = prNode({
      baseRef: { branchProtectionRule: { requiredStatusCheckContexts: ['build', 'test'] } },
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'FAILURE', // overall rollup is red because of the optional check
        contexts: { nodes: [
          { __typename: 'CheckRun', name: 'build', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', name: 'test', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', name: 'lint-optional', conclusion: 'FAILURE' } // not required
        ] }
      } } }] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.checks).toEqual({ state: 'success', passed: 2, failed: 0, total: 2 })
  })

  it('reports failure when a required check fails even if optional checks pass', () => {
    const node = prNode({
      baseRef: { branchProtectionRule: { requiredStatusCheckContexts: ['build'] } },
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'FAILURE',
        contexts: { nodes: [
          { __typename: 'CheckRun', name: 'build', conclusion: 'FAILURE' },
          { __typename: 'CheckRun', name: 'lint-optional', conclusion: 'SUCCESS' }
        ] }
      } } }] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.checks).toEqual({ state: 'failure', passed: 0, failed: 1, total: 1 })
  })

  it('matches required StatusContext entries by their context name', () => {
    const node = prNode({
      baseRef: { branchProtectionRule: { requiredStatusCheckContexts: ['ci/legacy'] } },
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'FAILURE',
        contexts: { nodes: [
          { __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS' },
          { __typename: 'StatusContext', context: 'ci/optional', state: 'FAILURE' }
        ] }
      } } }] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.checks).toEqual({ state: 'success', passed: 1, failed: 0, total: 1 })
  })

  it('reports pending when a required check is still in progress', () => {
    const node = prNode({
      baseRef: { branchProtectionRule: { requiredStatusCheckContexts: ['build', 'test'] } },
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'FAILURE',
        contexts: { nodes: [
          { __typename: 'CheckRun', name: 'build', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', name: 'test', conclusion: null }, // required, in progress
          { __typename: 'CheckRun', name: 'lint-optional', conclusion: 'FAILURE' }
        ] }
      } } }] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.checks).toEqual({ state: 'pending', passed: 1, failed: 0, total: 2 })
  })

  it('reports pending when required checks are configured but none have reported yet', () => {
    const node = prNode({
      baseRef: { branchProtectionRule: { requiredStatusCheckContexts: ['build'] } },
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'FAILURE',
        contexts: { nodes: [
          { __typename: 'CheckRun', name: 'lint-optional', conclusion: 'FAILURE' }
        ] }
      } } }] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.checks).toEqual({ state: 'pending', passed: 0, failed: 0, total: 0 })
  })

  it('counts all checks when the required contexts list is empty (no branch protection)', () => {
    const node = prNode({
      baseRef: { branchProtectionRule: { requiredStatusCheckContexts: [] } },
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'FAILURE',
        contexts: { nodes: [
          { __typename: 'CheckRun', name: 'build', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', name: 'lint', conclusion: 'FAILURE' }
        ] }
      } } }] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.checks).toEqual({ state: 'failure', passed: 1, failed: 1, total: 2 })
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

  it('treats a dismissed approval as no active vote', () => {
    const node = prNode({
      reviews: { nodes: [
        { state: 'APPROVED', author: { login: 'a', avatarUrl: '' } },
        { state: 'DISMISSED', author: { login: 'a', avatarUrl: '' } }
      ] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.reviewState).toBe('none')
    expect(pr.approvals).toBe(0)
  })

  it('does not report state none when a rollup exists with an unrecognized state', () => {
    const node = prNode({
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'STALE',
        contexts: { nodes: [{ __typename: 'CheckRun', conclusion: 'SUCCESS' }] }
      } } }] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.checks.state).not.toBe('none')
    expect(pr.checks.state).toBe('success')
  })

  it('maps the head branch name', () => {
    const [pr] = normalizePullRequests([prNode()], { now, staleThresholdMs: staleMs })
    expect(pr.branch).toBe('feature/x')
  })

  it('maps base branch and diff stats', () => {
    const [pr] = normalizePullRequests([prNode({ baseRefName: 'release/2.0', additions: 120, deletions: 30, changedFiles: 7 })], { now, staleThresholdMs: staleMs })
    expect(pr).toMatchObject({ baseBranch: 'release/2.0', additions: 120, deletions: 30, changedFiles: 7 })
  })

  it('counts unresolved review threads, excluding excluded authors', () => {
    const node = prNode({
      reviewThreads: { nodes: [
        { isResolved: false, comments: { nodes: [{ author: { login: 'alice' } }] } },   // counts
        { isResolved: true, comments: { nodes: [{ author: { login: 'bob' } }] } },        // resolved → skip
        { isResolved: false, comments: { nodes: [{ author: { login: 'dependabot[bot]' } }] } }, // excluded → skip
        { isResolved: false, comments: { nodes: [{ author: { login: 'noisy' } }] } }      // excluded → skip
      ] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs, excludedAuthors: ['noisy', 'dependabot[bot]'] })
    expect(pr.unresolvedThreads).toBe(1)
  })

  it('counts all unresolved threads when no author filter is given', () => {
    const node = prNode({
      reviewThreads: { nodes: [
        { isResolved: false, comments: { nodes: [{ author: { login: 'dependabot[bot]' } }] } },
        { isResolved: false, comments: { nodes: [{ author: { login: 'alice' } }] } }
      ] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.unresolvedThreads).toBe(2)
  })

  it('drops PRs whose author is in the excluded list (case-insensitive)', () => {
    const nodes = [
      prNode({ id: 'PR_keep', author: { login: 'alice', avatarUrl: '' } }),
      prNode({ id: 'PR_drop', author: { login: 'Spammer', avatarUrl: '' } })
    ]
    const out = normalizePullRequests(nodes, { now, staleThresholdMs: staleMs, excludedAuthors: ['spammer'] })
    expect(out.map((p) => p.id)).toEqual(['PR_keep'])
  })

  it('drops a bot-authored PR only when its login is in the excluded list', () => {
    const nodes = [prNode({ id: 'PR_bot', author: { login: 'dependabot[bot]', avatarUrl: '' } })]
    expect(normalizePullRequests(nodes, { now, staleThresholdMs: staleMs, excludedAuthors: ['dependabot[bot]'] })).toHaveLength(0)
    expect(normalizePullRequests(nodes, { now, staleThresholdMs: staleMs })).toHaveLength(1)
  })

  it('keeps PRs whose author cannot be attributed', () => {
    const nodes = [prNode({ id: 'PR_ghost', author: null })]
    const out = normalizePullRequests(nodes, { now, staleThresholdMs: staleMs, excludedAuthors: ['x'] })
    expect(out).toHaveLength(1)
  })

  it('returns an empty array for an empty, null, or null-containing node list', () => {
    expect(normalizePullRequests([], { now, staleThresholdMs: staleMs })).toEqual([])
    expect(normalizePullRequests(null as any, { now, staleThresholdMs: staleMs })).toEqual([])
    expect(normalizePullRequests([null], { now, staleThresholdMs: staleMs })).toEqual([])
  })

  it('falls back to failure/pending from contexts when the rollup state is unrecognized', () => {
    const failing = prNode({
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'STALE',
        contexts: { nodes: [{ __typename: 'CheckRun', conclusion: 'FAILURE' }] }
      } } }] }
    })
    expect(normalizePullRequests([failing], { now, staleThresholdMs: staleMs })[0].checks.state).toBe('failure')

    const inProgress = prNode({
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'STALE',
        contexts: { nodes: [
          { __typename: 'CheckRun', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', conclusion: null }
        ] }
      } } }] }
    })
    // passed (1) > 0 but passed !== total (2), and no failures -> pending
    expect(normalizePullRequests([inProgress], { now, staleThresholdMs: staleMs })[0].checks.state).toBe('pending')
  })

  it('reports reviewState none for a PR with pending reviewers and zero submitted reviews', () => {
    const node = prNode({
      reviewRequests: { nodes: [{ requestedReviewer: { login: 'me', avatarUrl: '' } }] },
      reviews: { nodes: [] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.reviewState).toBe('none')
    expect(pr.approvals).toBe(0)
  })
})
