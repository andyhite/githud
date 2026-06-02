import { describe, it, expect } from 'vitest'
import { parsePollInterval, shouldPollNotifications } from './notifications'

describe('parsePollInterval', () => {
  it('reads x-poll-interval seconds into ms, defaulting to 60s', () => {
    expect(parsePollInterval({ 'x-poll-interval': '90' })).toBe(90_000)
    expect(parsePollInterval({})).toBe(60_000)
    expect(parsePollInterval({ 'x-poll-interval': 'bogus' })).toBe(60_000)
  })
})

describe('shouldPollNotifications', () => {
  const now = 1_000_000

  it('polls when never fetched before', () => {
    expect(shouldPollNotifications({ lastFetchedAt: null, pollIntervalMs: 60_000, now })).toBe(true)
  })

  it('skips when inside the poll interval', () => {
    expect(shouldPollNotifications({ lastFetchedAt: now - 30_000, pollIntervalMs: 60_000, now })).toBe(false)
  })

  it('polls when the interval has elapsed', () => {
    expect(shouldPollNotifications({ lastFetchedAt: now - 61_000, pollIntervalMs: 60_000, now })).toBe(true)
  })
})
