import { useEffect, useState } from 'react'
import { DashboardSnapshot } from '@shared/types'
import { nextPollDelay, formatInterval, BASE_POLL_MS } from '@shared/poll-schedule'
import { relativeAge } from './NeedsReviewTable'

// Data older than ~2x the 30s poll interval is treated as stale.
const STALE_MS = 90_000
// GraphQL budget is 5000 points/hr; warn well before exhaustion.
const RATE_LIMIT_WARN = 500

export function TopBar({
  snapshot,
  onRefresh,
  onOpenSettings,
  isFetching
}: {
  snapshot: DashboardSnapshot | null
  onRefresh: () => void
  onOpenSettings: () => void
  isFetching: boolean
}) {
  // Tick so the relative age — and the stale escalation — keeps advancing even
  // when no snapshot arrives (silent timer stall / machine sleep), since the
  // component would otherwise only re-render on a snapshot push or refetch.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // Counts must exclude hidden PRs to match the panel headers and tray badge.
  const hidden = new Set(snapshot?.hiddenPrIds ?? [])
  const failing = snapshot?.myPullRequests.filter((p) => !hidden.has(p.id) && p.checks.state === 'failure').length ?? 0
  const needs = snapshot?.needsReview.filter((p) => !hidden.has(p.id)).length ?? 0
  // Summary = review queue; the failing count is shown only by the badge below.
  const summary = needs === 0 ? 'all caught up' : `${needs} to review`

  const ageMs = snapshot ? Date.now() - Date.parse(snapshot.fetchedAt) : 0
  const isStale = !!snapshot && !snapshot.error && ageMs > STALE_MS

  const rl = snapshot?.rateLimit
  const lowBudget = !!rl && !!rl.resetAt && rl.remaining <= RATE_LIMIT_WARN
  const resetInMin = rl?.resetAt ? Math.max(1, Math.round((Date.parse(rl.resetAt) - Date.now()) / 60_000)) : 0

  // The interval the main poll loop will use next, derived from the same rate
  // limit (nextPollDelay is shared). Grows above the base when the API budget
  // is running low, so showing it explains why refreshes slow down.
  const pollMs = rl ? nextPollDelay(rl, Date.now()) : BASE_POLL_MS
  const throttled = pollMs > BASE_POLL_MS
  const pollTitle = throttled
    ? `Auto-refresh slowed to conserve the GitHub API budget (resets in ~${resetInMin}m)`
    : 'Auto-refresh interval'

  return (
    <header className="top-bar">
      <span className="brand">githud</span>
      <span className="summary">{summary}</span>
      {failing > 0 && <span className="badge bad">✗ {failing} failing</span>}
      <span className="spacer" />
      {lowBudget && (
        <span className="badge warn" title={`GitHub API budget low — resets in ~${resetInMin}m`}>
          {rl!.remaining} API left
        </span>
      )}
      {snapshot?.error && <span className="badge warn" title={snapshot.error}>offline — retrying</span>}
      {snapshot &&
        (isStale ? (
          <span className="badge warn" title="Data may be out of date — last refresh did not complete recently">
            stale · {relativeAge(snapshot.fetchedAt)} old
          </span>
        ) : (
          <span className="refreshed">updated {relativeAge(snapshot.fetchedAt)} ago</span>
        ))}
      {snapshot && (
        <span className={throttled ? 'poll-interval throttled' : 'poll-interval'} title={pollTitle}>
          ↻ {formatInterval(pollMs)}
        </span>
      )}
      <button onClick={onRefresh} disabled={isFetching} aria-label="Refresh" title="Refresh">
        {isFetching ? '↻…' : '↻'}
      </button>
      <button onClick={onOpenSettings} aria-label="Settings" title="Settings">
        ⚙
      </button>
    </header>
  )
}
