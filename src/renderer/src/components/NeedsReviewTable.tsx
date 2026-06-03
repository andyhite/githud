import { useEffect, useRef, useState } from 'react'
import { PullRequest, TriageVerdict } from '@shared/types'
import { api } from '../api'
import { computeSnoozeUntil } from './snooze'

export interface HideProps {
  hiddenIds?: string[]
  onHide?: (pr: PullRequest) => void
  onUnhide?: (id: string) => void
  onSnooze?: (pr: PullRequest, until: string) => void
}

// All per-row actions collapsed into one kebab (⋮) menu so rows stay tight.
export function RowActions({
  pr,
  isHidden,
  aiOn,
  onHide,
  onUnhide,
  onSnooze,
  onReview
}: {
  pr: PullRequest
  isHidden: boolean
  aiOn?: boolean
  onReview?: (id: string) => void
} & HideProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const act = (fn: () => void) => { fn(); setOpen(false) }

  return (
    <div className={`row-actions${open ? ' open' : ''}`} ref={ref}>
      <button
        className="row-action kebab"
        title="Actions"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {open && (
        <div className="row-menu" role="menu">
          {!isHidden && aiOn && onReview && (
            <button role="menuitem" onClick={() => act(() => onReview(pr.id))}>Pre-review (AI)</button>
          )}
          <button role="menuitem" onClick={() => act(() => api.copyToClipboard(pr.url))}>Copy PR link</button>
          {pr.branch && (
            <button role="menuitem" onClick={() => act(() => api.copyToClipboard(pr.branch))}>Copy branch name</button>
          )}
          {!isHidden && onSnooze && (
            <>
              <button role="menuitem" onClick={() => act(() => onSnooze(pr, computeSnoozeUntil(new Date(), '1h')))}>Snooze 1 hour</button>
              <button role="menuitem" onClick={() => act(() => onSnooze(pr, computeSnoozeUntil(new Date(), 'tomorrow')))}>Snooze until tomorrow</button>
              <button role="menuitem" onClick={() => act(() => onSnooze(pr, computeSnoozeUntil(new Date(), 'monday')))}>Snooze until Monday</button>
            </>
          )}
          {isHidden ? (
            <button role="menuitem" onClick={() => act(() => onUnhide?.(pr.id))}>Unhide</button>
          ) : (
            <button role="menuitem" onClick={() => act(() => onHide?.(pr))}>Hide</button>
          )}
        </div>
      )}
    </div>
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

// Compact CI summary for the PR meta line — null when there are no checks.
function checksMeta(pr: PullRequest): { cls: string; text: string } | null {
  const c = pr.checks
  if (c.state === 'none') return null
  if (c.state === 'failure') return { cls: 'bad', text: `✗ ${c.failed} failing` }
  if (c.state === 'pending') return { cls: 'warn', text: `● ${c.total} running` }
  return { cls: 'good', text: `✓ ${c.passed}/${c.total}` }
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

// Title (clickable) + a meta line: repo #num · [author] · [checks]. Checks and
// author live here rather than in their own columns to keep rows compact and
// every column useful for triage.
export function PrTitleCell({ pr, showAuthor }: { pr: PullRequest; showAuthor?: boolean }) {
  const checks = checksMeta(pr)
  return (
    <button className="pr-link" onClick={() => api.openExternal(pr.url)}>
      <span className="pr-title">{pr.title}</span>
      <span className="pr-meta">
        <span className="pr-repo">{pr.repo} #{pr.number}</span>
        {showAuthor && <span className="pr-author">{pr.author.login}</span>}
        {checks && <span className={`pr-checks ${checks.cls}`}>{checks.text}</span>}
      </span>
    </button>
  )
}

const TRIAGE_META: Record<string, { cls: string; label: string }> = {
  quick_approve: { cls: 'triage-green', label: 'quick approve' },
  careful_read: { cls: 'triage-blue', label: 'careful read' },
  likely_changes: { cls: 'triage-amber', label: 'likely changes' },
  big_effort: { cls: 'triage-purple', label: 'big effort' }
}

export function TriageChip({ verdict }: { verdict?: TriageVerdict }) {
  if (!verdict) return <span className="muted">—</span>
  const m = TRIAGE_META[verdict.label]
  if (!m) return <span className="muted">—</span>
  return <span className={`triage-chip ${m.cls}`} title={`${verdict.rationale} — focus: ${verdict.focusHint}`}>{m.label}</span>
}

export function NeedsReviewTable({
  items,
  hiddenIds = [],
  showHidden = false,
  onHide,
  onUnhide,
  onSnooze,
  selectedId,
  loading,
  verdicts,
  aiOn,
  onReview
}: { items: PullRequest[]; loading?: boolean; showHidden?: boolean; selectedId?: string; verdicts?: Record<string, TriageVerdict>; aiOn?: boolean; onReview?: (id: string) => void } & HideProps) {
  const hiddenSet = new Set(hiddenIds)
  const visible = items.filter((pr) => !hiddenSet.has(pr.id))
  const hidden = items.filter((pr) => hiddenSet.has(pr.id))

  if (loading && items.length === 0) return <p className="empty">Loading…</p>
  if (visible.length === 0 && hidden.length === 0)
    return <p className="empty">Nothing needs your review. 🎉</p>

  const row = (pr: PullRequest, isHidden: boolean) => (
    <tr key={pr.id} className={[isHidden ? 'row-hidden' : '', pr.id === selectedId ? 'row-selected' : ''].filter(Boolean).join(' ') || undefined}>
      <td><PrTitleCell pr={pr} showAuthor /></td>
      {aiOn && <td className="col-triage"><TriageChip verdict={verdicts?.[pr.id]} /></td>}
      <td className="col-age"><AgeCell pr={pr} /></td>
      <td className="actions"><RowActions pr={pr} isHidden={isHidden} aiOn={aiOn} onHide={onHide} onUnhide={onUnhide} onSnooze={onSnooze} onReview={onReview} /></td>
    </tr>
  )

  return (
    <table className="pr-table">
      <thead>
        <tr>
          <th>PR</th>
          {aiOn && <th className="col-triage">Triage</th>}
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
