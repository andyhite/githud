import { RateLimit } from '@shared/types'

// Octokit attaches response headers to its errors in a couple of shapes
// (RequestError.response.headers for HTTP errors, GraphqlResponseError.headers
// for GraphQL errors). Pull GitHub's rate-limit headers off whichever exists so
// the poll loop can back off against the authoritative reset window instead of
// the last successful poll's (now stale) numbers. Returns null when the error
// carries no usable reset time — caller keeps whatever it already had.
// Pure: the caller passes the clock (used only for the retry-after fallback).
export function parseRateLimitError(err: any, nowMs: number): RateLimit | null {
  const headers = err?.response?.headers ?? err?.headers
  if (!headers || typeof headers !== 'object') return null

  const num = (v: unknown): number | undefined => {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const remaining = num(headers['x-ratelimit-remaining'])
  const limit = num(headers['x-ratelimit-limit'])
  const used = num(headers['x-ratelimit-used'])
  const resetEpoch = num(headers['x-ratelimit-reset']) // UTC epoch seconds
  const retryAfter = num(headers['retry-after']) // seconds from now (secondary limits)

  let resetAt: string | undefined
  if (resetEpoch !== undefined) resetAt = new Date(resetEpoch * 1000).toISOString()
  else if (retryAfter !== undefined) resetAt = new Date(nowMs + retryAfter * 1000).toISOString()

  // Without a reset time we can't improve on what we already have.
  if (resetAt === undefined) return null

  return { remaining: remaining ?? 0, resetAt, limit, used }
}

export type TokenErrorReason = 'auth' | 'rate_limit' | 'network'

// Classify why a token validation / API call failed, so callers can tell a
// genuinely bad token apart from a transient rate-limit or network blip. A
// rate-limit error must NOT be treated as "token rejected" — the token is fine,
// and (since the GraphQL budget is per-user) regenerating it won't help.
// Pure: the caller passes the clock (for parseRateLimitError's retry-after path).
export function classifyTokenError(err: any, nowMs: number): { reason: TokenErrorReason; resetAt?: string } {
  const rl = parseRateLimitError(err, nowMs)
  if (rl) return { reason: 'rate_limit', resetAt: rl.resetAt }
  const status = err?.status ?? err?.response?.status
  if (status === 401 || status === 403) return { reason: 'auth' }
  return { reason: 'network' }
}
