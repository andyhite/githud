import { describe, it, expect } from 'vitest'
import { nextPollDelay, formatInterval, BASE_POLL_MS } from './poll-schedule'
import type { RateLimit } from './types'

const NOW = Date.parse('2026-06-03T12:00:00Z')
function rl(over: Partial<RateLimit> = {}): RateLimit {
  return { remaining: 5000, resetAt: '2026-06-03T13:00:00Z', cost: 1, limit: 5000, used: 0, ...over }
}

describe('nextPollDelay', () => {
  it('polls at the base interval when the budget is healthy', () => {
    expect(nextPollDelay(rl({ remaining: 5000, cost: 1 }), NOW)).toBe(BASE_POLL_MS)
  })

  it('stretches the interval as remaining points approach the reserve', () => {
    // limit 5000 -> reserve 1000; spendable = 2000 - 1000 = 1000; cost 40; 60min
    // -> ideal = 3,600,000 * 40 / 1000 = 144,000ms (> base, under the reset cap).
    const delay = nextPollDelay(rl({ remaining: 2000, cost: 40 }), NOW)
    expect(delay).toBe((3_600_000 * 40) / 1000)
    expect(delay).toBeGreaterThan(BASE_POLL_MS)
  })

  it('waits for the reset once remaining reaches the reserve (keeps a budget buffer)', () => {
    // remaining 1000 == reserve -> spendable 0 -> wait, even though the window is wide open.
    expect(nextPollDelay(rl({ remaining: 1000, cost: 1 }), NOW)).toBe(3_600_000 + 5_000)
    // well below the reserve too
    expect(nextPollDelay(rl({ remaining: 200, cost: 40 }), NOW)).toBe(3_600_000 + 5_000)
  })

  it('falls back to the base interval when resetAt is missing or in the past', () => {
    expect(nextPollDelay(rl({ resetAt: '' }), NOW)).toBe(BASE_POLL_MS)
    expect(nextPollDelay(rl({ resetAt: '2026-06-03T11:00:00Z' }), NOW)).toBe(BASE_POLL_MS)
  })

  it('treats a missing cost as 1 point', () => {
    expect(nextPollDelay(rl({ remaining: 5000, cost: undefined }), NOW)).toBe(BASE_POLL_MS)
  })

  it('honours a caller-supplied base interval as the floor', () => {
    expect(nextPollDelay(rl({ remaining: 5000, cost: 1 }), NOW, 120_000)).toBe(120_000)
  })

  it('paces against the smoothed avgCost when present, not the last sample', () => {
    // last poll cost was cheap (1) but the smoothed cost is 40; pace on 40.
    // spendable = 2000 - 1000 reserve = 1000 -> 3,600,000 * 40 / 1000 = 144,000.
    const delay = nextPollDelay(rl({ remaining: 2000, cost: 1, avgCost: 40 }), NOW)
    expect(delay).toBe((3_600_000 * 40) / 1000)
  })

  it('lets the reserve fraction be tuned (more budget allowed -> shorter wait)', () => {
    // remaining 2000, cost 40, limit 5000. reserveFraction 0 -> spendable 2000.
    expect(nextPollDelay(rl({ remaining: 2000, cost: 40 }), NOW, BASE_POLL_MS, 0)).toBe((3_600_000 * 40) / 2000)
    // reserveFraction 0.5 -> reserve 2500 > remaining 2000 -> wait for reset.
    expect(nextPollDelay(rl({ remaining: 2000, cost: 40 }), NOW, BASE_POLL_MS, 0.5)).toBe(3_600_000 + 5_000)
  })
})

describe('formatInterval', () => {
  it('renders sub-minute intervals in seconds', () => {
    expect(formatInterval(30_000)).toBe('30s')
    expect(formatInterval(45_000)).toBe('45s')
  })

  it('renders longer intervals in whole minutes', () => {
    expect(formatInterval(120_000)).toBe('2m')
    expect(formatInterval(1_800_000)).toBe('30m')
  })
})
