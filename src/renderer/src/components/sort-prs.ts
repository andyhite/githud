import { PullRequest, TriageSort } from '@shared/types'
import { mergeReadiness, MergeReadiness } from './pr-status'

// Deterministic for now. M11 adds an optional verdict map to honor
// 'quick-first' / 'risky-first'; 'oldest-first' stays the default.
export function sortNeedsReview(prs: PullRequest[], _order: TriageSort = 'oldest-first'): PullRequest[] {
  return [...prs].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
}

const MY_RANK: Record<MergeReadiness, number> = { needs_attention: 0, waiting_review: 1, ready: 2, draft: 3 }

export function sortMyPrs(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => {
    const r = MY_RANK[mergeReadiness(a)] - MY_RANK[mergeReadiness(b)]
    return r !== 0 ? r : Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
  })
}
