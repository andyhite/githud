import { PullRequest } from '@shared/types'
import { Chip } from '@/components/chip'

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
