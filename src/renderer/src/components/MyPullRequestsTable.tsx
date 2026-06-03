import { PullRequest } from '@shared/types'
import {
  AgeCell, PrTitleCell, ReviewersCell, DiffStat, StatusCell,
  RowActions, HideProps
} from './NeedsReviewTable'

export function MyPullRequestsTable({
  items,
  hiddenIds = [],
  showHidden = false,
  onHide,
  onUnhide,
  onSnooze,
  loading
}: { items: PullRequest[]; loading?: boolean; showHidden?: boolean } & HideProps) {
  const hiddenSet = new Set(hiddenIds)
  const visible = items.filter((pr) => !hiddenSet.has(pr.id))
  const hidden = items.filter((pr) => hiddenSet.has(pr.id))

  if (loading && items.length === 0) return <p className="empty">Loading…</p>
  if (visible.length === 0 && hidden.length === 0)
    return <p className="empty">No open pull requests authored by you.</p>

  const row = (pr: PullRequest, isHidden: boolean) => (
    <tr key={pr.id} className={isHidden ? 'row-hidden' : undefined}>
      <td><PrTitleCell pr={pr} /></td>
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
