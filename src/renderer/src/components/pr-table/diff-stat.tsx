import { PullRequest } from '@shared/types'

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
