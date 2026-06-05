import { PullRequest } from '@shared/types'
import { relativeAge } from '@/lib/relative-age'

export function AgeCell({ pr }: { pr: PullRequest }) {
  const rel = relativeAge(pr.updatedAt)
  return (
    <span className={pr.isStale ? 'text-sev-mention' : 'text-muted-foreground'}>
      {rel}
      {pr.isStale ? ' ⚠' : ''}
    </span>
  )
}
