import { describe, it, expect } from 'vitest'
import { deriveEvents } from './derive-events'
import type { PRState } from './pr-state'

const NOW = '2026-06-02T12:00:00Z'

function pr(over: Partial<PRState> = {}): PRState {
  return {
    id: 'PR1', number: 88, title: 'Fix nav', url: 'https://gh/88', repo: 'o/web',
    authorLogin: 'me', source: 'mine', ciState: 'none', headOid: 'oid1',
    reviews: [], comments: [], reviewRequestedLogins: [], ...over
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

  it('emits a CI event only on transition into failure/success (for your own PRs)', () => {
    const prev = [pr({ ciState: 'pending' })]
    const next = [pr({ ciState: 'failure' })]
    const [e] = deriveEvents(prev, next, 'me', NOW)
    expect(e).toMatchObject({ id: 'ci:PR1:oid1:failure', kind: 'ci_failed', createdAt: NOW })
    // no transition -> nothing
    expect(deriveEvents([pr({ ciState: 'failure' })], [pr({ ciState: 'failure' })], 'me', NOW)).toEqual([])
  })

  it('never emits a CI event for a review-source PR (e.g. a dependabot PR you were asked to review)', () => {
    // CI status is the author's concern; you don't want toasts for checks on
    // PRs you're only reviewing. Covers both directions of the transition.
    const failed = deriveEvents([pr({ source: 'review', ciState: 'pending' })], [pr({ source: 'review', ciState: 'failure' })], 'me', NOW)
    const passed = deriveEvents([pr({ source: 'review', ciState: 'pending' })], [pr({ source: 'review', ciState: 'success' })], 'me', NOW)
    const regressed = deriveEvents([pr({ source: 'review', ciState: 'success' })], [pr({ source: 'review', ciState: 'failure' })], 'me', NOW)
    expect([...failed, ...passed, ...regressed]).toEqual([])
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

  it('emits a closed lifecycle event for a fallen-out mine PR resolved as closed', () => {
    const prev = [pr({ id: 'GONE', source: 'mine' })]
    const fallenOut = new Map<string, 'merged' | 'closed'>([['GONE', 'closed']])
    const [e] = deriveEvents(prev, [], 'me', NOW, fallenOut)
    expect(e).toMatchObject({ id: 'closed:GONE', kind: 'closed' })
  })

  it('never emits a lifecycle event for a review-source PR that fell out', () => {
    const prev = [pr({ id: 'GONE', source: 'review' })]
    // even with a resolved label, review-source PRs are not the viewer's own work
    const fallenOut = new Map<string, 'merged' | 'closed'>([['GONE', 'merged']])
    expect(deriveEvents(prev, [], 'me', NOW, fallenOut)).toEqual([])
  })

  it('emits nothing for a fallen-out mine PR whose label could not be resolved', () => {
    const prev = [pr({ id: 'GONE', source: 'mine' })]
    // empty fallenOut map = REST resolution failed / still open; must stay silent
    expect(deriveEvents(prev, [], 'me', NOW)).toEqual([])
  })

  it('emits ci_regressed when CI goes green -> red', () => {
    const [e] = deriveEvents([pr({ ciState: 'success' })], [pr({ ciState: 'failure' })], 'me', NOW)
    expect(e).toMatchObject({ kind: 'ci_regressed' })
  })

  it('emits review_re_requested when the viewer is re-added as a reviewer', () => {
    const before = pr({ id: 'X', source: 'review', reviewRequestedLogins: [] })
    const after = pr({ id: 'X', source: 'review', reviewRequestedLogins: ['me'] })
    const [e] = deriveEvents([before], [after], 'me', NOW)
    expect(e).toMatchObject({ id: 'review_re_requested:X', kind: 'review_re_requested' })
  })

  it('tolerates persisted prev state from before reviewRequestedLogins existed', () => {
    // pr-state.json written by a pre-M9 build has no reviewRequestedLogins field:
    // must not throw, and must NOT emit a spurious re-request (no prior baseline).
    const before = pr({ id: 'X', source: 'review' })
    delete (before as { reviewRequestedLogins?: string[] }).reviewRequestedLogins
    const after = pr({ id: 'X', source: 'review', reviewRequestedLogins: ['me'] })
    expect(() => deriveEvents([before], [after], 'me', NOW)).not.toThrow()
    expect(deriveEvents([before], [after], 'me', NOW).map((e) => e.kind)).not.toContain('review_re_requested')
  })

  it('emits changes_addressed when a PR you blocked gets new commits', () => {
    const before = pr({
      id: 'Y', source: 'review', headOid: 'oid1',
      reviews: [{ id: 'r1', state: 'CHANGES_REQUESTED', authorLogin: 'me', authorAvatarUrl: '', url: 'u', submittedAt: NOW }]
    })
    const after = pr({
      id: 'Y', source: 'review', headOid: 'oid2',
      reviews: [{ id: 'r1', state: 'CHANGES_REQUESTED', authorLogin: 'me', authorAvatarUrl: '', url: 'u', submittedAt: NOW }]
    })
    const kinds = deriveEvents([before], [after], 'me', NOW).map((e) => e.kind)
    expect(kinds).toContain('changes_addressed')
  })

  it('does not emit changes_addressed when headOid advances without a prior viewer change-request', () => {
    const before = pr({ id: 'Z', source: 'review', headOid: 'oid1', reviews: [{ id: 'r1', state: 'APPROVED', authorLogin: 'me', authorAvatarUrl: '', url: 'u', submittedAt: NOW }] })
    const after = pr({ id: 'Z', source: 'review', headOid: 'oid2', reviews: [{ id: 'r1', state: 'APPROVED', authorLogin: 'me', authorAvatarUrl: '', url: 'u', submittedAt: NOW }] })
    const kinds = deriveEvents([before], [after], 'me', NOW).map((e) => e.kind)
    expect(kinds).not.toContain('changes_addressed')
  })

  it('falls back to `now` when a review/comment has no source timestamp', () => {
    const prev = [pr()]
    const next = [pr({
      reviews: [{ id: 'r1', state: 'APPROVED', authorLogin: 'a', authorAvatarUrl: '', url: 'u', submittedAt: '' }],
      comments: [{ id: 'c1', authorLogin: 'x', authorAvatarUrl: '', url: 'u', createdAt: '', bodyText: 'hi' }]
    })]
    const events = deriveEvents(prev, next, 'me', NOW)
    expect(events.map((e) => e.createdAt)).toEqual([NOW, NOW])
  })

  it('does not emit a backlog of comments for a PR seen for the first time', () => {
    const next = [pr({ id: 'NEW', source: 'review', comments: [{ id: 'c9', authorLogin: 'z', authorAvatarUrl: '', url: 'u', createdAt: NOW, bodyText: 'old' }] })]
    const events = deriveEvents([], next, 'me', NOW)
    expect(events.map((e) => e.kind)).toEqual(['review_requested'])
  })
})
