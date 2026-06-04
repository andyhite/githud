import { PullRequest, TriageVerdict, TriageLabel } from '@shared/types'
import { api } from '../api'
import { mergeReadiness } from './pr-status'
import { Chip, type ChipTone } from './Chip'

// Compact CI summary for the PR meta line — null when there are no checks.
// `cls` ('good' | 'bad' | 'warn') maps to a text color in PrTitleCell.
function checksMeta(pr: PullRequest): { cls: 'good' | 'bad' | 'warn'; text: string } | null {
  const c = pr.checks
  if (c.state === 'none') return null
  if (c.state === 'failure') return { cls: 'bad', text: `✗ ${c.failed} failing` }
  if (c.state === 'pending') return { cls: 'warn', text: `● ${c.total} running` }
  return { cls: 'good', text: `✓ ${c.passed}/${c.total}` }
}

export function relativeAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function AgeCell({ pr }: { pr: PullRequest }) {
  const rel = relativeAge(pr.updatedAt)
  return (
    <span className={pr.isStale ? 'text-sev-mention' : 'text-muted-foreground'}>
      {rel}
      {pr.isStale ? ' ⚠' : ''}
    </span>
  )
}

export function ReviewersCell({ pr }: { pr: PullRequest }) {
  if (pr.reviewers.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {pr.reviewers.map((r) => (
        <Chip key={r.login} tone="info">
          @{r.login}
        </Chip>
      ))}
    </span>
  )
}

// A PR is "stacked" when it targets something other than the default branch.
function stackedBase(baseBranch: string): string | null {
  if (!baseBranch || baseBranch === 'main' || baseBranch === 'master') return null
  return baseBranch
}

export function DiffStat({ pr }: { pr: PullRequest }) {
  return (
    <span
      className="tabular-nums whitespace-nowrap text-xs"
      title={`${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'} changed`}
    >
      <span className="text-sev-success">+{pr.additions}</span>{' '}
      <span className="text-sev-failure">−{pr.deletions}</span>
    </span>
  )
}

// A single glanceable status tag. Color encodes urgency: failure = needs action,
// mention/amber = blocked on conflicts, success = good to go, info/blue = waiting
// on reviewers, neutral/grey = draft. Most-actionable state wins.
function statusTag(pr: PullRequest): { tone: ChipTone; label: string } {
  if (pr.isDraft) return { tone: 'neutral', label: 'draft' }
  // In the merge queue: the most relevant state, and it's shown INSTEAD of the
  // approval count (a queued PR is already approved + green). Distinct blue tone
  // so it reads as "in flight to merge", not "done".
  if (pr.isQueued) return { tone: 'info', label: 'queued to merge' }
  if (pr.reviewState === 'changes_requested') return { tone: 'failure', label: 'changes requested' }
  if (pr.checks.state === 'failure') return { tone: 'failure', label: 'CI failing' }
  if (pr.mergeable === 'conflicting') return { tone: 'mention', label: 'conflicts' }
  if (mergeReadiness(pr) === 'ready') return { tone: 'success', label: 'ready to merge' }
  if (pr.reviewState === 'approved')
    return { tone: 'success', label: `${pr.approvals} approval${pr.approvals === 1 ? '' : 's'}` }
  return { tone: 'info', label: 'review required' }
}

export function StatusCell({ pr }: { pr: PullRequest }) {
  const { tone, label } = statusTag(pr)
  // Approval is orthogonal to CI/merge state, so the single status chip can hide
  // it — e.g. an approved PR with failing CI shows only "CI failing". Surface the
  // approval as a second, never-masked chip whenever the PR is approved and the
  // primary chip isn't already the approval count ("N approvals").
  const showApproval = pr.reviewState === 'approved' && !pr.isQueued && !/approval/.test(label)
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Chip tone={tone}>{label}</Chip>
      {showApproval && (
        <Chip tone="success" title={`${pr.approvals} approval${pr.approvals === 1 ? '' : 's'}`}>
          ✓ {pr.approvals}
        </Chip>
      )}
    </div>
  )
}

// Title (clickable) + a meta line: repo #num · [→ base if stacked] · [author] ·
// [checks] · [unresolved threads]. These live here rather than in their own
// columns to keep rows compact and every real column useful for triage.
export function PrTitleCell({ pr, showAuthor }: { pr: PullRequest; showAuthor?: boolean }) {
  const checks = checksMeta(pr)
  const base = stackedBase(pr.baseBranch)
  const checksColor =
    checks?.cls === 'good'
      ? 'text-sev-success'
      : checks?.cls === 'bad'
        ? 'text-sev-failure'
        : 'text-sev-mention'
  return (
    <button
      type="button"
      className="flex flex-col items-start gap-0.5 text-left w-full"
      onClick={() => api.openExternal(pr.url)}
    >
      <span className="text-card-foreground hover:text-sev-info hover:underline">{pr.title}</span>
      <span className="flex flex-wrap items-baseline text-xs text-muted-foreground gap-x-1.5">
        <span>
          {pr.repo} #{pr.number}
        </span>
        {base && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-sev-mention" title={`Targets ${base} — stacked PR`}>
              → {base}
            </span>
          </>
        )}
        {showAuthor && (
          <>
            <span aria-hidden="true">·</span>
            <span>{pr.author.login}</span>
          </>
        )}
        {checks && (
          <>
            <span aria-hidden="true">·</span>
            <span className={checksColor}>{checks.text}</span>
          </>
        )}
        {pr.unresolvedThreads > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{pr.unresolvedThreads} unresolved</span>
          </>
        )}
      </span>
    </button>
  )
}

const TRIAGE_META: Record<TriageLabel, { tone: ChipTone; label: string }> = {
  quick_approve: { tone: 'success', label: 'quick approve' },
  careful_read: { tone: 'info', label: 'careful read' },
  likely_changes: { tone: 'mention', label: 'likely changes' },
  big_effort: { tone: 'effort', label: 'big effort' }
}

export function TriageChip({ verdict }: { verdict?: TriageVerdict }) {
  if (!verdict) return <span className="text-muted-foreground">—</span>
  const m = TRIAGE_META[verdict.label]
  if (!m) return <span className="text-muted-foreground">—</span>
  return (
    <Chip tone={m.tone} title={`${verdict.rationale} — focus: ${verdict.focusHint}`}>
      {m.label}
    </Chip>
  )
}
