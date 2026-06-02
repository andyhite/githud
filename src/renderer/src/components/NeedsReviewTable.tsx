import { PullRequest } from '@shared/types'
import { api } from '../api'

export function ChecksCell({ pr }: { pr: PullRequest }) {
  const c = pr.checks
  if (c.state === 'none') return <span className="muted">—</span>
  if (c.state === 'failure') return <span className="bad">✗ {c.failed} failing</span>
  if (c.state === 'pending') return <span className="warn">● {c.total} running</span>
  return <span className="good">✓ {c.passed}/{c.total}</span>
}

export function AgeCell({ pr }: { pr: PullRequest }) {
  const rel = relativeAge(pr.updatedAt)
  return <span className={pr.isStale ? 'warn' : ''}>{rel}{pr.isStale ? ' ⚠' : ''}</span>
}

export function relativeAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function PrTitleCell({ pr }: { pr: PullRequest }) {
  return (
    <button className="pr-link" onClick={() => api.openExternal(pr.url)}>
      <span className="pr-title">{pr.title}</span>
      <span className="pr-repo">{pr.repo} #{pr.number}</span>
    </button>
  )
}

export function NeedsReviewTable({ items }: { items: PullRequest[] }) {
  if (items.length === 0) return <p className="empty">Nothing needs your review. 🎉</p>
  return (
    <table className="pr-table">
      <thead>
        <tr><th>PR</th><th>Author</th><th>Checks</th><th>Age</th></tr>
      </thead>
      <tbody>
        {items.map((pr) => (
          <tr key={pr.id}>
            <td><PrTitleCell pr={pr} /></td>
            <td>{pr.author.login}</td>
            <td><ChecksCell pr={pr} /></td>
            <td><AgeCell pr={pr} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
