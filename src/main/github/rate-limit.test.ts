import { describe, it, expect } from 'vitest'
import { parseRateLimitError } from './rate-limit'

const NOW = Date.parse('2026-06-03T12:00:00Z')
const RESET_EPOCH = 1780488000 // arbitrary fixed epoch seconds

describe('parseRateLimitError', () => {
  it('reads the rate-limit headers off an HTTP error (RequestError shape)', () => {
    const err = {
      status: 403,
      response: {
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-used': '5000',
          'x-ratelimit-reset': String(RESET_EPOCH)
        }
      }
    }
    expect(parseRateLimitError(err, NOW)).toEqual({
      remaining: 0,
      resetAt: new Date(RESET_EPOCH * 1000).toISOString(),
      limit: 5000,
      used: 5000
    })
  })

  it('reads headers off a GraphQL error (GraphqlResponseError shape)', () => {
    const err = { headers: { 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': String(RESET_EPOCH) } }
    const out = parseRateLimitError(err, NOW)
    expect(out?.remaining).toBe(12)
    expect(out?.resetAt).toBe(new Date(RESET_EPOCH * 1000).toISOString())
  })

  it('derives resetAt from retry-after when no reset header is present (secondary limit)', () => {
    const err = { response: { headers: { 'retry-after': '60' } } }
    const out = parseRateLimitError(err, NOW)
    expect(out).toEqual({ remaining: 0, resetAt: new Date(NOW + 60_000).toISOString(), limit: undefined, used: undefined })
  })

  it('returns null when the error has no headers', () => {
    expect(parseRateLimitError(new Error('network down'), NOW)).toBeNull()
    expect(parseRateLimitError({ response: {} }, NOW)).toBeNull()
  })

  it('returns null when headers carry no reset time', () => {
    expect(parseRateLimitError({ headers: { 'x-ratelimit-remaining': '0' } }, NOW)).toBeNull()
  })
})
