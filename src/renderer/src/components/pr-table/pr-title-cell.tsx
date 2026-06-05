import { PullRequest } from '@shared/types'
import { api } from '@/api'
import { AgeCell } from './age-cell'

// Compact CI summary for the PR meta line — null when there are no checks.
// `cls` ('good' | 'bad' | 'warn') maps to a text color in PrTitleCell.
function checksMeta(pr: PullRequest): { cls: 'good' | 'bad' | 'warn'; text: string } | null {
  const c = pr.checks
  if (c.state === 'none') return null
  if (c.state === 'failure') return { cls: 'bad', text: `✗ ${c.failed} failing` }
  if (c.state === 'pending') return { cls: 'warn', text: `● ${c.total} running` }
  return { cls: 'good', text: `✓ ${c.passed}/${c.total}` }
}

// A PR is "stacked" when it targets something other than the default branch.
function stackedBase(baseBranch: string): string | null {
  if (!baseBranch || baseBranch === 'main' || baseBranch === 'master') return null
  return baseBranch
}

// Title (clickable) + a meta line: repo #num · [→ base if stacked] · [author] ·
// [checks] · [unresolved threads]. These live here rather than in their own
// columns to keep rows compact and every real column useful for triage.
export function PrTitleCell({
  pr,
  showAuthor,
  showAge
}: {
  pr: PullRequest
  showAuthor?: boolean
  // The card layout has no Age column, so it folds the age into the meta line
  // (after checks). The table leaves this off — it has a dedicated Age column.
  showAge?: boolean
}) {
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
      className="flex w-full min-w-0 max-w-full flex-col items-start gap-0.5 text-left"
      onClick={() => api.openExternal(pr.url)}
    >
      <span
        className="block w-full max-w-full truncate text-card-foreground hover:text-sev-info hover:underline"
        title={pr.title}
      >
        {pr.title}
      </span>
      <span className="flex min-w-0 max-w-full flex-wrap items-baseline text-xs text-muted-foreground gap-x-1.5">
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
        {showAge && (
          <>
            <span aria-hidden="true">·</span>
            <AgeCell pr={pr} />
          </>
        )}
      </span>
    </button>
  )
}
