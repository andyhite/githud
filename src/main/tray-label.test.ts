import { describe, it, expect } from 'vitest'
import { visibleNeedsReviewCount, dockBadge } from './tray-label'
import type { DashboardSnapshot } from '@shared/types'

function snap(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    fetchedAt: 'x', viewer: { login: 'me', avatarUrl: '' },
    needsReview: [], myPullRequests: [], events: [], hiddenPrIds: [],
    rateLimit: { remaining: 0, resetAt: '' }, ...over
  }
}

describe('visibleNeedsReviewCount', () => {
  it('counts needs-review excluding hidden', () => {
    const s = snap({ needsReview: [{ id: 'a' }, { id: 'b' }] as any, hiddenPrIds: ['b'] })
    expect(visibleNeedsReviewCount(s)).toBe(1)
  })
})

describe('dockBadge', () => {
  it('is empty for zero and the number otherwise', () => {
    expect(dockBadge(0)).toBe('')
    expect(dockBadge(3)).toBe('3')
  })
})
