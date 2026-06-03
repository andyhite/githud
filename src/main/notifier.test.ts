import { describe, it, expect } from 'vitest'
import { diffSnapshots, isWithinQuietHours } from './notifier'
import type { DashboardSnapshot, FeedEvent } from '@shared/types'

function ev(id: string, over: Partial<FeedEvent> = {}): FeedEvent {
  return { id, kind: 'approved', repo: 'o/web', number: 88, title: 'Fix nav', url: 'u', createdAt: 'x', unread: true, actor: { login: 'alice', avatarUrl: '' }, ...over }
}

function snap(events: FeedEvent[]): DashboardSnapshot {
  return { fetchedAt: 'x', viewer: { login: 'me', avatarUrl: '' }, needsReview: [], myPullRequests: [], teamPullRequests: [], events, hiddenPrIds: [], history: [], rateLimit: { remaining: 0, resetAt: '' } }
}

const BASE_OPTS = { notifyKinds: ['approved', 'ci_failed', 'changes_requested'] as const, now: new Date(), quietHours: null } as const

describe('diffSnapshots', () => {
  it('returns nothing on the first snapshot', () => {
    expect(diffSnapshots(null, snap([ev('a')]), { ...BASE_OPTS })).toEqual([])
  })

  it('notifies only for events not present before', () => {
    const specs = diffSnapshots(snap([ev('a')]), snap([ev('a'), ev('b', { kind: 'ci_failed', actor: undefined })]), { ...BASE_OPTS })
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({ title: 'Checks failed', body: 'o/web #88 — Fix nav', url: 'u' })
  })

  it('phrases an approval with the actor', () => {
    const specs = diffSnapshots(snap([]), snap([ev('a')]), { ...BASE_OPTS })
    expect(specs[0].title).toBe('alice approved')
  })

  it('caps a large batch of new events at 5 notifications', () => {
    const next = snap(Array.from({ length: 7 }, (_, i) => ev(`e${i}`)))
    const specs = diffSnapshots(snap([]), next, { ...BASE_OPTS })
    expect(specs).toHaveLength(5)
    // the cap takes the first 5 new events
    expect(specs.map((s) => s.body)).toEqual(next.events.slice(0, 5).map((e) => `${e.repo} #${e.number} — ${e.title}`))
  })
})

const OPTS = { notifyKinds: ['approved', 'ci_failed'] as const, now: new Date('2026-06-02T12:00:00'), quietHours: null }

describe('isWithinQuietHours', () => {
  it('is false when no window is set', () => {
    expect(isWithinQuietHours(new Date('2026-06-02T23:00:00'), null)).toBe(false)
  })
  it('matches a same-day window', () => {
    const q = { start: '09:00', end: '17:00' }
    expect(isWithinQuietHours(new Date('2026-06-02T12:00:00'), q)).toBe(true)
    expect(isWithinQuietHours(new Date('2026-06-02T18:00:00'), q)).toBe(false)
  })
  it('matches a window that wraps midnight', () => {
    const q = { start: '18:00', end: '09:00' }
    expect(isWithinQuietHours(new Date('2026-06-02T23:30:00'), q)).toBe(true)
    expect(isWithinQuietHours(new Date('2026-06-02T07:00:00'), q)).toBe(true)
    expect(isWithinQuietHours(new Date('2026-06-02T12:00:00'), q)).toBe(false)
  })
})

describe('diffSnapshots kind filtering + quiet hours', () => {
  it('only notifies for allowed kinds', () => {
    const next = snap([ev('a', { kind: 'approved' }), ev('b', { kind: 'comment', actor: undefined })])
    const specs = diffSnapshots(snap([]), next, { ...OPTS })
    expect(specs.map((s) => s.title)).toEqual(['alice approved'])
  })
  it('fires nothing during quiet hours', () => {
    const next = snap([ev('a', { kind: 'approved' })])
    const specs = diffSnapshots(snap([]), next, { ...OPTS, quietHours: { start: '09:00', end: '17:00' } })
    expect(specs).toEqual([])
  })
})
