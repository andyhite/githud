import { describe, it, expect } from 'vitest'
import { deriveEvents } from './derive-events'
import type { PRState } from './pr-state'

const NOW = '2026-06-02T12:00:00Z'

function pr(over: Partial<PRState> = {}): PRState {
  return {
    id: 'PR1', number: 88, title: 'Fix nav', url: 'https://gh/88', repo: 'o/web',
    authorLogin: 'me', source: 'mine', ciState: 'none', headOid: 'oid1',
    reviews: [], comments: [], ...over
  }
}

describe('deriveEvents', () => {
  it('returns nothing when there is no prior baseline', () => {
    expect(deriveEvents(null, [pr()], 'me', NOW)).toEqual([])
  })

  it('emits a review event with the reviewer as actor', () => {
    const prev = [pr({ reviews: [] })]
    const next = [pr({ reviews: [{ id: 'r1', state: 'APPROVED', authorLogin: 'alice', authorAvatarUrl: 'av', url: 'https://gh/88#r1', submittedAt: NOW }] })]
    const [e] = deriveEvents(prev, next, 'me', NOW)
    expect(e).toMatchObject({ id: 'review:r1', kind: 'approved', actor: { login: 'alice', avatarUrl: 'av' }, url: 'https://gh/88#r1', unread: true })
  })

  it('classifies CHANGES_REQUESTED and COMMENTED reviews', () => {
    const prev = [pr()]
    const next = [pr({ reviews: [
      { id: 'r1', state: 'CHANGES_REQUESTED', authorLogin: 'a', authorAvatarUrl: '', url: 'u', submittedAt: NOW },
      { id: 'r2', state: 'COMMENTED', authorLogin: 'b', authorAvatarUrl: '', url: 'u', submittedAt: NOW }
    ] })]
    const kinds = deriveEvents(prev, next, 'me', NOW).map((e) => e.kind)
    expect(kinds).toEqual(['changes_requested', 'review_commented'])
  })

  it('emits a comment event, and a mention when the body @-mentions the viewer', () => {
    const prev = [pr()]
    const next = [pr({ comments: [
      { id: 'c1', authorLogin: 'x', authorAvatarUrl: '', url: 'u1', createdAt: NOW, bodyText: 'looks good' },
      { id: 'c2', authorLogin: 'y', authorAvatarUrl: '', url: 'u2', createdAt: NOW, bodyText: 'cc @ME please' }
    ] })]
    const events = deriveEvents(prev, next, 'me', NOW)
    expect(events.map((e) => e.kind)).toEqual(['comment', 'mention'])
  })

  it('emits a CI event only on transition into failure/success', () => {
    const prev = [pr({ ciState: 'pending' })]
    const next = [pr({ ciState: 'failure' })]
    const [e] = deriveEvents(prev, next, 'me', NOW)
    expect(e).toMatchObject({ id: 'ci:PR1:oid1:failure', kind: 'ci_failed', createdAt: NOW })
    // no transition -> nothing
    expect(deriveEvents([pr({ ciState: 'failure' })], [pr({ ciState: 'failure' })], 'me', NOW)).toEqual([])
  })

  it('emits review_requested for a newly appeared PR in the review set, not for new mine PRs', () => {
    const next = [pr({ id: 'NEW', source: 'review' }), pr({ id: 'NEWMINE', source: 'mine' })]
    const events = deriveEvents([], next, 'me', NOW)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: 'review_requested:NEW', kind: 'review_requested', createdAt: NOW })
  })

  it('emits merged/closed for mine PRs that fell out, using the resolved label', () => {
    const prev = [pr({ id: 'GONE', source: 'mine' })]
    const fallenOut = new Map<string, 'merged' | 'closed'>([['GONE', 'merged']])
    const [e] = deriveEvents(prev, [], 'me', NOW, fallenOut)
    expect(e).toMatchObject({ id: 'merged:GONE', kind: 'merged', createdAt: NOW })
  })

  it('does not emit a backlog of comments for a PR seen for the first time', () => {
    const next = [pr({ id: 'NEW', source: 'review', comments: [{ id: 'c9', authorLogin: 'z', authorAvatarUrl: '', url: 'u', createdAt: NOW, bodyText: 'old' }] })]
    const events = deriveEvents([], next, 'me', NOW)
    expect(events.map((e) => e.kind)).toEqual(['review_requested'])
  })
})
