import { PullRequest, TriageVerdict } from '@shared/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AgeCell, PrTitleCell, ReviewersCell, DiffStat, StatusCell, TriageChip } from './pr-cells'
import { RowActions } from './RowActions'
import { EmptyState } from './EmptyState'
import { cn } from '@/lib/utils'
import { HideProps } from './hide-types'

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
  const hiddenSet = new Set(hiddenIds)
  const visible = items.filter((p) => !hiddenSet.has(p.id))
  const hidden = items.filter((p) => hiddenSet.has(p.id))

  if (loading && items.length === 0) return <p className="px-0.5 py-2 text-muted-foreground">Loading…</p>
  if (visible.length === 0 && !(showHidden && hidden.length > 0)) return <EmptyState variant={emptyVariant} />

  const headFor: Record<PrColumn, string> = {
    diff: 'Diff',
    status: 'Status',
    triage: 'Triage',
    reviewers: 'Waiting on',
    age: 'Age'
  }
  const cellFor = (c: PrColumn, pr: PullRequest) => {
    switch (c) {
      case 'diff':
        return <DiffStat pr={pr} />
      case 'status':
        return <StatusCell pr={pr} />
      case 'triage':
        return <TriageChip verdict={verdicts?.[pr.id]} />
      case 'reviewers':
        return <ReviewersCell pr={pr} />
      case 'age':
        return <AgeCell pr={pr} />
    }
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
          {cellFor(c, pr)}
        </TableCell>
      ))}
      <TableCell className="w-10 text-right">
        <RowActions
          pr={pr}
          isHidden={isHidden}
          aiOn={aiOn}
          onHide={onHide}
          onUnhide={onUnhide}
          onSnooze={onSnooze}
          onReview={onReview}
        />
      </TableCell>
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
          <TableHead aria-hidden="true" className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((pr) => row(pr, false))}
        {showHidden && hidden.map((pr) => row(pr, true))}
      </TableBody>
    </Table>
  )
}
