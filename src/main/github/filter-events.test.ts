import { describe, it, expect } from 'vitest'
import { filterEvents, isExcludedAuthor, applyAuthorFilters } from './filter-events'
import type { FeedEvent, DashboardSnapshot, PullRequest } from '@shared/types'

function ev(over: Partial<FeedEvent> = {}): FeedEvent {
  return { id: 'a', kind: 'comment', repo: 'o/web', number: 1, title: 't', url: 'u', createdAt: 'x', unread: true, ...over }
}

function pr(login: string, over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: `pr-${login}`, number: 1, title: 't', url: 'u', repo: 'o/web', branch: 'b', baseBranch: 'main',
    author: { login, avatarUrl: '' }, reviewers: [], reviewState: 'none', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'none', passed: 0, failed: 0, total: 0 }, additions: 0, deletions: 0, changedFiles: 0,
    unresolvedThreads: 0, updatedAt: 'x', isStale: false, isDraft: false, isQueued: false, ...over
  } as PullRequest
}

describe('filterEvents', () => {
  it('drops excluded authors case-insensitively', () => {
    const out = filterEvents([ev({ actor: { login: 'Spammer', avatarUrl: '' } })], ['spammer'])
    expect(out).toHaveLength(0)
  })

  it('drops a bot only when its login is in the excluded list', () => {
    const evt = [ev({ actor: { login: 'dependabot[bot]', avatarUrl: '' } })]
    expect(filterEvents(evt, [])).toHaveLength(1)
    expect(filterEvents(evt, ['dependabot[bot]'])).toHaveLength(0)
  })

  it('keeps actor-less events (CI, lifecycle)', () => {
    const out = filterEvents([ev({ kind: 'ci_failed', actor: undefined })], ['x'])
    expect(out).toHaveLength(1)
  })
})

describe('isExcludedAuthor', () => {
  it('excludes denylisted logins case-insensitively', () => {
    expect(isExcludedAuthor('Spammer', ['spammer'])).toBe(true)
  })
  it('excludes a bot only when its login is in the list', () => {
    expect(isExcludedAuthor('dependabot[bot]', ['dependabot[bot]'])).toBe(true)
    expect(isExcludedAuthor('dependabot[bot]', [])).toBe(false)
  })
  it('keeps clean authors', () => {
    expect(isExcludedAuthor('alice', ['spammer'])).toBe(false)
  })
  it('treats a missing login as not excluded (un-attributable)', () => {
    expect(isExcludedAuthor(undefined, ['x'])).toBe(false)
    expect(isExcludedAuthor('', ['x'])).toBe(false)
  })
})

describe('applyAuthorFilters', () => {
  const base: DashboardSnapshot = {
    fetchedAt: 'x',
    viewer: { login: 'me', avatarUrl: '' },
    needsReview: [pr('alice'), pr('dependabot[bot]'), pr('spammer')],
    myPullRequests: [pr('me'), pr('renovate[bot]')],
    teamPullRequests: [pr('bob'), pr('spammer')],
    events: [ev({ id: 'e1', actor: { login: 'alice', avatarUrl: '' } }), ev({ id: 'e2', actor: { login: 'spammer', avatarUrl: '' } })],
    hiddenPrIds: [],
    history: [],
    rateLimit: { remaining: 0, resetAt: '' }
  }

  it('drops PRs and events from excluded authors (incl. bots in the list) across both tables', () => {
    const out = applyAuthorFilters(base, ['spammer', 'dependabot[bot]', 'renovate[bot]'])
    expect(out.needsReview.map((p) => p.author.login)).toEqual(['alice'])
    expect(out.myPullRequests.map((p) => p.author.login)).toEqual(['me'])
    expect(out.teamPullRequests.map((p) => p.author.login)).toEqual(['bob'])
    expect(out.events.map((e) => e.id)).toEqual(['e1'])
  })

  it('keeps everything when nothing is excluded', () => {
    const out = applyAuthorFilters(base, [])
    expect(out.needsReview).toHaveLength(3)
    expect(out.myPullRequests).toHaveLength(2)
    expect(out.teamPullRequests).toHaveLength(2)
    expect(out.events).toHaveLength(2)
  })

  it('does not mutate the input snapshot', () => {
    applyAuthorFilters(base, ['spammer'])
    expect(base.needsReview).toHaveLength(3)
  })
})
