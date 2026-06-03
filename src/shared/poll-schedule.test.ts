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

  it('stretches the interval as remaining points run low', () => {
    // remaining 100, cost 40, 60min to reset -> ideal = 3,600,000 * 40 / 100 = 24min,
    // but capped at the time until reset (60min). 24min > base, so it slows down.
    const delay = nextPollDelay(rl({ remaining: 100, cost: 40 }), NOW)
    expect(delay).toBeGreaterThan(BASE_POLL_MS)
    expect(delay).toBe((3_600_000 * 40) / 100)
  })

  it('waits until just past the reset when it cannot afford another poll', () => {
    const delay = nextPollDelay(rl({ remaining: 5, cost: 40 }), NOW)
    expect(delay).toBe(3_600_000 + 5_000)
  })

  it('never returns longer than the time until reset (plus the exhausted buffer)', () => {
    const delay = nextPollDelay(rl({ remaining: 2, cost: 1 }), NOW)
    expect(delay).toBeLessThanOrEqual(3_600_000)
  })

  it('falls back to the base interval when resetAt is missing or in the past', () => {
    expect(nextPollDelay(rl({ resetAt: '' }), NOW)).toBe(BASE_POLL_MS)
    expect(nextPollDelay(rl({ resetAt: '2026-06-03T11:00:00Z' }), NOW)).toBe(BASE_POLL_MS)
  })

  it('treats a missing cost as 1 point', () => {
    expect(nextPollDelay(rl({ remaining: 5000, cost: undefined }), NOW)).toBe(BASE_POLL_MS)
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
