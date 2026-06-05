import { PullRequest } from '@shared/types'
import { mergeReadiness } from '@/lib/pr-status'
import { Chip, type ChipTone } from '@/components/chip'

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
