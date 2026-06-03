import { useState } from 'react'
import { PullRequest } from '@shared/types'
import { api } from '../api'

export interface HideProps {
  hiddenIds?: string[]
  onHide?: (pr: PullRequest) => void
  onUnhide?: (id: string) => void
}

export function HideCell({
  pr,
  hidden,
  onHide,
  onUnhide
}: {
  pr: PullRequest
  hidden: boolean
  onHide?: (pr: PullRequest) => void
  onUnhide?: (id: string) => void
}) {
  return hidden ? (
    <button className="row-action" title="Unhide this PR" onClick={() => onUnhide?.(pr.id)}>
      unhide
    </button>
  ) : (
    <button className="row-action hide-action" title="Hide this PR" onClick={() => onHide?.(pr)}>
      hide
    </button>
  )
}

export function ShowHiddenToggle({
  count,
  open,
  onToggle
}: {
  count: number
  open: boolean
  onToggle: () => void
}) {
  if (count === 0) return null
  return (
    <button className="show-hidden" onClick={onToggle}>
      {open ? 'hide hidden' : `show hidden (${count})`}
    </button>
  )
}

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

export function ReviewersCell({ pr }: { pr: PullRequest }) {
  if (pr.reviewers.length === 0) return <span className="muted">—</span>
  return (
    <span className="reviewer-chips">
      {pr.reviewers.map((r) => (
        <span key={r.login} className="reviewer-chip">@{r.login}</span>
      ))}
    </span>
  )
}

export function PrTitleCell({ pr }: { pr: PullRequest }) {
  return (
    <button className="pr-link" onClick={() => api.openExternal(pr.url)}>
      <span className="pr-title">{pr.title}</span>
      <span className="pr-repo">{pr.repo} #{pr.number}</span>
    </button>
  )
}

export function NeedsReviewTable({
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
    return <p className="empty">Nothing needs your review. 🎉</p>

  const row = (pr: PullRequest, isHidden: boolean) => (
    <tr key={pr.id} className={isHidden ? 'row-hidden' : undefined}>
      <td><PrTitleCell pr={pr} /></td>
      <td>{pr.author.login}</td>
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
            <th>PR</th><th>Author</th><th>Reviewers</th><th>Checks</th><th>Age</th>
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
