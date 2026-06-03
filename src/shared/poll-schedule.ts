import { RateLimit } from './types'

// Default cadence when the GraphQL budget is healthy. The user can raise this
// (Settings.refreshIntervalSeconds); the main loop passes it in as `baseMs`.
export const BASE_POLL_MS = 60_000

// Default fraction of the hourly GraphQL budget to keep in reserve (the user can
// change this via Settings.apiBudgetPercent → 1 - percent/100). The budget is
// per-user and shared across every token/app, so githud must NOT drain it to
// zero — we only ever spread the spendable remainder (remaining - reserve) over
// the window, and back off to the reset once we'd dip into the reserve.
export const RESERVE_FRACTION = 0.2

// How long to wait before the next poll, given the rate-limit state from the
// last successful poll. The idea: spread the *spendable* points (everything
// above the reserve) evenly across the time left in the window so we glide
// toward the reset instead of slamming into the "quota exhausted" wall while
// still leaving a buffer for other tools. Healthy budget -> baseMs; as remaining
// shrinks the interval grows; once spending more would eat the reserve, wait for
// the reset. Pure (no Date.now) so it's unit-testable — the caller passes the
// clock + base. Lives in shared so the renderer shows the same interval the loop
// will use.
export function nextPollDelay(
  rl: RateLimit,
  nowMs: number,
  baseMs: number = BASE_POLL_MS,
  reserveFraction: number = RESERVE_FRACTION
): number {
  const reset = Date.parse(rl.resetAt)
  const msUntilReset = Number.isFinite(reset) ? reset - nowMs : 0
  if (msUntilReset <= 0) return baseMs
  // Pace against the smoothed cost (avgCost) when we have it, not the last poll's
  // single sample, so an anomalous poll doesn't whipsaw the interval.
  const cost = Math.max(rl.avgCost ?? rl.cost ?? 1, 1)
  const reserve = Math.round((rl.limit ?? 5000) * Math.min(Math.max(reserveFraction, 0), 0.95))
  const spendable = rl.remaining - reserve
  if (spendable <= cost) return msUntilReset + 5_000 // would dip into the reserve -> wait for reset
  const ideal = (msUntilReset * cost) / spendable
  return Math.max(baseMs, Math.min(ideal, msUntilReset))
}

// Compact human label for a poll interval, e.g. "30s" or "4m".
export function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}
