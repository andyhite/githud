import { RateLimit } from './types'

// Normal cadence when the GraphQL budget is healthy.
export const BASE_POLL_MS = 30_000

// How long to wait before the next poll, given the rate-limit state from the
// last successful poll. The idea: spread the remaining points evenly across the
// time left in the window so we glide to the reset instead of slamming into the
// "quota exhausted" wall. Healthy budget -> BASE; as remaining shrinks the
// interval grows; once we can't afford even one more poll, wait for the reset.
// Pure (no Date.now) so it's unit-testable — the caller passes the clock. Lives
// in shared so the renderer can show the same interval the main loop will use.
export function nextPollDelay(rl: RateLimit, nowMs: number): number {
  const reset = Date.parse(rl.resetAt)
  const msUntilReset = Number.isFinite(reset) ? reset - nowMs : 0
  if (msUntilReset <= 0) return BASE_POLL_MS
  const cost = Math.max(rl.cost ?? 1, 1)
  if (rl.remaining <= cost) return msUntilReset + 5_000 // can't afford a poll -> wait for reset
  const ideal = (msUntilReset * cost) / rl.remaining
  return Math.max(BASE_POLL_MS, Math.min(ideal, msUntilReset))
}

// Compact human label for a poll interval, e.g. "30s" or "4m".
export function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}
