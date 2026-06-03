import { PullRequest } from '@shared/types'

// The team panel's chip filter. A PR is visible iff it carries at least one
// configured label that the user hasn't muted (clicked off). Labels a PR has but
// that aren't configured chips don't count — only the panel's own chips gate it.
// All chips active (muted empty) → show everything; all muted → show nothing.
export function filterTeamPrs(
  prs: PullRequest[],
  configuredLabels: string[],
  mutedLabels: string[]
): PullRequest[] {
  const muted = new Set(mutedLabels)
  const active = new Set(configuredLabels.filter((l) => !muted.has(l)))
  return prs.filter((pr) => pr.labels.some((l) => active.has(l)))
}
