import { useEffect, useState } from 'react'
import { DashboardSnapshot } from '@shared/types'
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

  const failing = snapshot?.myPullRequests.filter((p) => p.checks.state === 'failure').length ?? 0
  const needs = snapshot?.needsReview.length ?? 0
  const summary = needs === 0 && failing === 0 ? 'all caught up' : `${needs} to review${failing ? ` · ${failing} failing` : ''}`

  const ageMs = snapshot ? Date.now() - Date.parse(snapshot.fetchedAt) : 0
  const isStale = !!snapshot && !snapshot.error && ageMs > STALE_MS

  const rl = snapshot?.rateLimit
  const lowBudget = !!rl && !!rl.resetAt && rl.remaining <= RATE_LIMIT_WARN
  const resetInMin = rl?.resetAt ? Math.max(1, Math.round((Date.parse(rl.resetAt) - Date.now()) / 60_000)) : 0

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
      <button onClick={onRefresh} disabled={isFetching} aria-label="Refresh" title="Refresh">
        {isFetching ? '↻…' : '↻'}
      </button>
      <button onClick={onOpenSettings} aria-label="Settings" title="Settings">
        ⚙
      </button>
    </header>
  )
}
