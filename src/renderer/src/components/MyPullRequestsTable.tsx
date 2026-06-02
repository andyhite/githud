import { PullRequest } from '@shared/types'
import { ChecksCell, AgeCell, PrTitleCell } from './NeedsReviewTable'

function StatusCell({ pr }: { pr: PullRequest }) {
  if (pr.reviewState === 'changes_requested') return <span className="warn">⟳ changes requested</span>
  if (pr.reviewState === 'approved') {
    const mergeNote = pr.mergeable === 'conflicting' ? ' · conflicts' : ''
    return <span className="good">✓ {pr.approvals} approval{pr.approvals === 1 ? '' : 's'}{mergeNote}</span>
  }
  if (pr.isDraft) return <span className="muted">draft</span>
  return <span className="muted">review required</span>
}

export function MyPullRequestsTable({ items }: { items: PullRequest[] }) {
  if (items.length === 0) return <p className="empty">No open pull requests authored by you.</p>
  return (
    <table className="pr-table">
      <thead>
        <tr><th>PR</th><th>Status</th><th>Checks</th><th>Age</th></tr>
      </thead>
      <tbody>
        {items.map((pr) => (
          <tr key={pr.id}>
            <td><PrTitleCell pr={pr} /></td>
            <td><StatusCell pr={pr} /></td>
            <td><ChecksCell pr={pr} /></td>
            <td><AgeCell pr={pr} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
