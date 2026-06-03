import { describe, it, expect } from 'vitest'
import { diffSnapshots } from './notifier'
import type { DashboardSnapshot, FeedEvent } from '@shared/types'

function ev(id: string, over: Partial<FeedEvent> = {}): FeedEvent {
  return { id, kind: 'approved', repo: 'o/web', number: 88, title: 'Fix nav', url: 'u', createdAt: 'x', unread: true, actor: { login: 'alice', avatarUrl: '' }, ...over }
}

function snap(events: FeedEvent[]): DashboardSnapshot {
  return { fetchedAt: 'x', viewer: { login: 'me', avatarUrl: '' }, needsReview: [], myPullRequests: [], events, rateLimit: { remaining: 0, resetAt: '' } }
}

describe('diffSnapshots', () => {
  it('returns nothing on the first snapshot', () => {
    expect(diffSnapshots(null, snap([ev('a')]))).toEqual([])
  })

  it('notifies only for events not present before', () => {
    const specs = diffSnapshots(snap([ev('a')]), snap([ev('a'), ev('b', { kind: 'ci_failed', actor: undefined })]))
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({ title: 'Checks failed', body: 'o/web #88 — Fix nav', url: 'u' })
  })

  it('phrases an approval with the actor', () => {
    const specs = diffSnapshots(snap([]), snap([ev('a')]))
    expect(specs[0].title).toBe('alice approved')
  })
})
