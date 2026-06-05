import { ReactNode } from 'react'
import { PullRequest, TriageVerdict } from '@shared/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { HideProps } from '@/lib/hide-types'
import { useNarrowViewport } from '@/hooks/use-narrow-viewport'
import { EmptyState } from '@/components/empty-state'
import { AgeCell } from './age-cell'
import { PrTitleCell } from './pr-title-cell'
import { ReviewersCell } from './reviewers-cell'
import { DiffStat } from './diff-stat'
import { StatusCell } from './status-cell'
import { TriageChip } from './triage-chip'
import { RowActions } from './row-actions'

export type PrColumn = 'diff' | 'status' | 'triage' | 'reviewers' | 'age'

export function PrTable({
  items,
  columns,
  hiddenIds = [],
  showHidden = false,
  showAuthor = false,
  emptyVariant,
  selectedId,
  loading,
  verdicts,
  aiOn,
  onReview,
  onHide,
  onUnhide,
  onSnooze
}: {
  items: PullRequest[]
  columns: PrColumn[]
  showAuthor?: boolean
  emptyVariant: 'review' | 'mine' | 'team'
  selectedId?: string
  loading?: boolean
  showHidden?: boolean
  verdicts?: Record<string, TriageVerdict>
  aiOn?: boolean
  onReview?: (id: string) => void
} & HideProps) {
  const narrow = useNarrowViewport()
  const hiddenSet = new Set(hiddenIds)
  const visible = items.filter((p) => !hiddenSet.has(p.id))
  const hidden = items.filter((p) => hiddenSet.has(p.id))

  if (loading && items.length === 0) return <p className="px-0.5 py-2 text-muted-foreground">Loading…</p>
  if (visible.length === 0 && !(showHidden && hidden.length > 0)) return <EmptyState variant={emptyVariant} />

  const actions = (pr: PullRequest, isHidden: boolean, alwaysVisible = false, className?: string) => (
    <RowActions
      pr={pr}
      isHidden={isHidden}
      aiOn={aiOn}
      alwaysVisible={alwaysVisible}
      className={className}
      onHide={onHide}
      onUnhide={onUnhide}
      onSnooze={onSnooze}
      onReview={onReview}
    />
  )

  // ── Card layout (narrow panels) ──────────────────────────────────────────
  // Title on the left, always-visible kebab pinned to the top-right corner (cards
  // have no row-hover affordance). The age folds into the title's meta line (after
  // checks) via showAge, and the rest of the columns reflow into a wrapping meta
  // row. Same cells as the table, so triage/status/etc stay consistent.
  const card = (pr: PullRequest, isHidden: boolean) => (
    <div
      key={pr.id}
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-background p-3',
        isHidden && 'opacity-50',
        pr.id === selectedId && 'bg-sev-info/15'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <PrTitleCell pr={pr} showAuthor={showAuthor} showAge={columns.includes('age')} />
        </div>
        {/* Sized to the title's line height (~21px) so the kebab doesn't tower
            over the first line; -mr keeps the icon optically flush to the edge. */}
        {actions(pr, isHidden, true, 'h-[1.3125rem] w-6 -mr-1')}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {columns.includes('status') && <StatusCell pr={pr} />}
        {columns.includes('triage') && <TriageChip verdict={verdicts?.[pr.id]} />}
        {columns.includes('diff') && <DiffStat pr={pr} />}
        {columns.includes('reviewers') && pr.reviewers.length > 0 && (
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>Waiting on</span>
            <ReviewersCell pr={pr} />
          </span>
        )}
      </div>
    </div>
  )

  if (narrow) {
    return (
      <div className="flex flex-col gap-2 px-2 py-1">
        {visible.map((pr) => card(pr, false))}
        {showHidden && hidden.map((pr) => card(pr, true))}
      </div>
    )
  }

  // ── Table layout (wide panels) ───────────────────────────────────────────
  const headFor: Record<PrColumn, string> = {
    diff: 'Diff',
    status: 'Status',
    triage: 'Triage',
    reviewers: 'Waiting on',
    age: 'Age'
  }
  const cellFor: Record<PrColumn, (pr: PullRequest) => ReactNode> = {
    diff: (pr) => <DiffStat pr={pr} />,
    status: (pr) => <StatusCell pr={pr} />,
    triage: (pr) => <TriageChip verdict={verdicts?.[pr.id]} />,
    reviewers: (pr) => <ReviewersCell pr={pr} />,
    age: (pr) => <AgeCell pr={pr} />
  }
  // Fixed per-column widths (with table-fixed below) so any two PR tables sharing
  // a column set — e.g. Team PRs and My PRs — line up, instead of each table
  // auto-sizing to its own content. The PR (title) column flexes to fill the rest.
  // triage and reviewers share the 3rd column slot across the three tables, so
  // they get the SAME width — that keeps all three PR tables column-aligned.
  const COL_WIDTH: Record<PrColumn, string> = {
    diff: 'w-24',
    status: 'w-32',
    triage: 'w-36',
    reviewers: 'w-36',
    age: 'w-14'
  }
  const nowrap = (c: PrColumn) => c !== 'reviewers'

  const row = (pr: PullRequest, isHidden: boolean) => (
    <TableRow
      key={pr.id}
      className={cn('group', isHidden && 'opacity-50', pr.id === selectedId && 'bg-sev-info/15')}
    >
      <TableCell>
        <PrTitleCell pr={pr} showAuthor={showAuthor} />
      </TableCell>
      {columns.map((c) => (
        <TableCell key={c} className={cn(COL_WIDTH[c], nowrap(c) && 'whitespace-nowrap')}>
          {cellFor[c](pr)}
        </TableCell>
      ))}
      <TableCell className="w-14 text-right">{actions(pr, isHidden)}</TableCell>
    </TableRow>
  )

  return (
    <Table className="table-fixed [&_th]:px-3 [&_td]:px-3">
      <TableHeader>
        <TableRow>
          <TableHead>PR</TableHead>
          {columns.map((c) => (
            <TableHead key={c} className={cn(COL_WIDTH[c], nowrap(c) && 'whitespace-nowrap')}>
              {headFor[c]}
            </TableHead>
          ))}
          <TableHead aria-hidden="true" className="w-14" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((pr) => row(pr, false))}
        {showHidden && hidden.map((pr) => row(pr, true))}
      </TableBody>
    </Table>
  )
}
