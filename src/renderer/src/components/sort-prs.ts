import { PullRequest, TriageSort, TriageVerdict } from '@shared/types'
import { mergeReadiness, MergeReadiness } from './pr-status'

const QUICK_RANK: Record<string, number> = { quick_approve: 0, careful_read: 1, likely_changes: 2, big_effort: 3 }
const RISKY_RANK: Record<string, number> = { likely_changes: 0, careful_read: 1, big_effort: 2, quick_approve: 3 }

export function sortNeedsReview(
  prs: PullRequest[],
  order: TriageSort = 'oldest-first',
  verdicts: Record<string, TriageVerdict> = {}
): PullRequest[] {
  if (order === 'oldest-first') {
    return [...prs].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
  }
  const rank = order === 'quick-first' ? QUICK_RANK : RISKY_RANK
  const score = (p: PullRequest) => {
    const v = verdicts[p.id]
    return v ? rank[v.label] ?? 99 : 99 // un-triaged sinks to the bottom
  }
  return [...prs].sort((a, b) => score(a) - score(b) || Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
}

const MY_RANK: Record<MergeReadiness, number> = { needs_attention: 0, waiting_review: 1, ready: 2, draft: 3 }

export function sortMyPrs(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => {
    const r = MY_RANK[mergeReadiness(a)] - MY_RANK[mergeReadiness(b)]
    return r !== 0 ? r : Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
  })
}
