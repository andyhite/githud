import { PullRequest } from '@shared/types'
import {
  AgeCell, PrTitleCell, ReviewersCell, DiffStat, StatusCell,
  RowActions, HideProps
} from './NeedsReviewTable'
import { EmptyState } from './EmptyState'

// Shared by the "My open PRs" and "Team PRs" panels. `showAuthor` surfaces the
// PR author in the meta line (on for the team view, where it isn't always you);
// `emptyVariant` picks the blank-slate copy.
export function MyPullRequestsTable({
  items,
  hiddenIds = [],
  showHidden = false,
  showAuthor = false,
  emptyVariant = 'mine',
  onHide,
  onUnhide,
  onSnooze,
  loading
}: {
  items: PullRequest[]
  loading?: boolean
  showHidden?: boolean
  showAuthor?: boolean
  emptyVariant?: 'mine' | 'team'
} & HideProps) {
  const hiddenSet = new Set(hiddenIds)
  const visible = items.filter((pr) => !hiddenSet.has(pr.id))
  const hidden = items.filter((pr) => hiddenSet.has(pr.id))

  if (loading && items.length === 0) return <p className="empty">Loading…</p>
  // Empty state when nothing is rendered; hidden rows only count when expanded
  // (the "show hidden (N)" toggle in the panel header keeps them reachable).
  if (visible.length === 0 && !(showHidden && hidden.length > 0)) return <EmptyState variant={emptyVariant} />

  const row = (pr: PullRequest, isHidden: boolean) => (
    <tr key={pr.id} className={isHidden ? 'row-hidden' : undefined}>
      <td><PrTitleCell pr={pr} showAuthor={showAuthor} /></td>
      <td className="col-diff"><DiffStat pr={pr} /></td>
      <td className="col-status"><StatusCell pr={pr} /></td>
      <td><ReviewersCell pr={pr} /></td>
      <td className="col-age"><AgeCell pr={pr} /></td>
      <td className="actions"><RowActions pr={pr} isHidden={isHidden} onHide={onHide} onUnhide={onUnhide} onSnooze={onSnooze} /></td>
    </tr>
  )

  return (
    <table className="pr-table">
      <thead>
        <tr>
          <th>PR</th>
          <th className="col-diff">Diff</th>
          <th className="col-status">Status</th>
          <th>Waiting on</th>
          <th className="col-age">Age</th>
          <th aria-hidden="true"></th>
        </tr>
      </thead>
      <tbody>
        {visible.map((pr) => row(pr, false))}
        {showHidden && hidden.map((pr) => row(pr, true))}
      </tbody>
    </table>
  )
}
