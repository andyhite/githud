import { useState } from 'react'
import { PullRequest } from '@shared/types'
import {
  ChecksCell, AgeCell, PrTitleCell, ReviewersCell,
  HideCell, ShowHiddenToggle, HideProps
} from './NeedsReviewTable'

function StatusCell({ pr }: { pr: PullRequest }) {
  if (pr.reviewState === 'changes_requested') return <span className="warn">⟳ changes requested</span>
  if (pr.reviewState === 'approved') {
    const mergeNote = pr.mergeable === 'conflicting' ? ' · conflicts' : ''
    return <span className="good">✓ {pr.approvals} approval{pr.approvals === 1 ? '' : 's'}{mergeNote}</span>
  }
  if (pr.isDraft) return <span className="muted">draft</span>
  return <span className="muted">review required</span>
}

export function MyPullRequestsTable({
  items,
  hiddenIds = [],
  onHide,
  onUnhide,
  loading
}: { items: PullRequest[]; loading?: boolean } & HideProps) {
  const [showHidden, setShowHidden] = useState(false)
  const hiddenSet = new Set(hiddenIds)
  const visible = items.filter((pr) => !hiddenSet.has(pr.id))
  const hidden = items.filter((pr) => hiddenSet.has(pr.id))

  if (loading && items.length === 0) return <p className="empty">Loading…</p>
  if (visible.length === 0 && hidden.length === 0)
    return <p className="empty">No open pull requests authored by you.</p>

  const row = (pr: PullRequest, isHidden: boolean) => (
    <tr key={pr.id} className={isHidden ? 'row-hidden' : undefined}>
      <td><PrTitleCell pr={pr} /></td>
      <td><StatusCell pr={pr} /></td>
      <td><ReviewersCell pr={pr} /></td>
      <td><ChecksCell pr={pr} /></td>
      <td><AgeCell pr={pr} /></td>
      <td className="actions"><HideCell pr={pr} hidden={isHidden} onHide={onHide} onUnhide={onUnhide} /></td>
    </tr>
  )

  return (
    <>
      <table className="pr-table">
        <thead>
          <tr>
            <th>PR</th><th>Status</th><th>Reviewers</th><th>Checks</th><th>Age</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((pr) => row(pr, false))}
          {showHidden && hidden.map((pr) => row(pr, true))}
        </tbody>
      </table>
      <ShowHiddenToggle count={hidden.length} open={showHidden} onToggle={() => setShowHidden((v) => !v)} />
    </>
  )
}
