import { PullRequest } from '@shared/types'

export type MergeReadiness = 'ready' | 'needs_attention' | 'waiting_review' | 'draft'

export function mergeReadiness(pr: PullRequest): MergeReadiness {
  if (pr.isDraft) return 'draft'
  if (pr.reviewState === 'changes_requested' || pr.checks.state === 'failure' || pr.mergeable === 'conflicting') {
    return 'needs_attention'
  }
  if (pr.reviewState === 'approved' && pr.checks.state === 'success' && pr.mergeable === 'mergeable') {
    return 'ready'
  }
  return 'waiting_review'
}
