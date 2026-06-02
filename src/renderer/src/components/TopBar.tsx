import { DashboardSnapshot } from '@shared/types'
import { relativeAge } from './NeedsReviewTable'

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
  const failing = snapshot?.myPullRequests.filter((p) => p.checks.state === 'failure').length ?? 0
  const needs = snapshot?.needsReview.length ?? 0
  const summary = needs === 0 && failing === 0 ? 'all caught up' : `${needs} to review${failing ? ` · ${failing} failing` : ''}`

  return (
    <header className="top-bar">
      <span className="brand">githud</span>
      <span className="summary">{summary}</span>
      {failing > 0 && <span className="badge bad">✗ {failing} failing</span>}
      <span className="spacer" />
      {snapshot?.error && <span className="badge warn" title={snapshot.error}>offline — retrying</span>}
      <span className="refreshed">
        {snapshot ? `updated ${relativeAge(snapshot.fetchedAt)} ago` : ''}
      </span>
      <button onClick={onRefresh} disabled={isFetching}>{isFetching ? '↻…' : '↻'}</button>
      <button onClick={onOpenSettings}>⚙</button>
    </header>
  )
}
