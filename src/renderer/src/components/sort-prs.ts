import { PullRequest, TriageVerdict } from '@shared/types'
import { mergeReadiness, MergeReadiness } from './pr-status'

// Within the same age, surface the quickest wins first (effort ascending);
// un-triaged PRs sink to the bottom of the tie.
const TRIAGE_TIEBREAK: Record<string, number> = { quick_approve: 0, careful_read: 1, likely_changes: 2, big_effort: 3 }

// Primary sort is PR age (oldest-waiting first); the AI triage verdict is only a
// tiebreak between PRs of the same age.
export function sortNeedsReview(
  prs: PullRequest[],
  verdicts: Record<string, TriageVerdict> = {}
): PullRequest[] {
  const triageRank = (p: PullRequest) => TRIAGE_TIEBREAK[verdicts[p.id]?.label ?? ''] ?? 99
  return [...prs].sort(
    (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || triageRank(a) - triageRank(b)
  )
}

const MY_RANK: Record<MergeReadiness, number> = { needs_attention: 0, waiting_review: 1, ready: 2, draft: 3 }

export function sortMyPrs(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => {
    const r = MY_RANK[mergeReadiness(a)] - MY_RANK[mergeReadiness(b)]
    return r !== 0 ? r : Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
  })
}

// The team panel is a stale-work overview, so it sorts purely by age
// (oldest-waiting first) — unlike sortMyPrs, status/readiness doesn't reorder it.
export function sortTeamPrs(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
}
