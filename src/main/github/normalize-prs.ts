import { PullRequest, ChecksSummary, User } from '@shared/types'
import { isExcludedAuthor } from './filter-events'

interface NormalizeOpts {
  now: number
  staleThresholdMs: number
  // Author filter (mirrors the activity feed) applied to both the PR list itself
  // and the unresolved-thread count, so excluded-author PRs and threads are
  // hidden consistently.
  excludedAuthors?: string[]
}

// Count open review threads, excluding threads opened by an excluded author —
// matching the activity-feed filter.
function countUnresolvedThreads(node: any, excludedAuthors: string[]): number {
  return (node.reviewThreads?.nodes ?? []).filter(Boolean).filter((t: any) => {
    if (t.isResolved) return false
    return !isExcludedAuthor(t.comments?.nodes?.[0]?.author?.login, excludedAuthors)
  }).length
}

const MERGEABLE_MAP: Record<string, PullRequest['mergeable']> = {
  MERGEABLE: 'mergeable',
  CONFLICTING: 'conflicting',
  UNKNOWN: 'unknown'
}

function user(node: any): User {
  return { login: node?.login ?? 'unknown', avatarUrl: node?.avatarUrl ?? '' }
}

function deriveReview(reviews: any[]): { state: PullRequest['reviewState']; approvals: number } {
  // Keep only the latest review per author, ignoring pure COMMENTED reviews.
  const latestByAuthor = new Map<string, string>()
  for (const r of reviews) {
    const login = r.author?.login ?? 'unknown'
    if (r.state === 'DISMISSED') { latestByAuthor.delete(login); continue }
    if (r.state === 'COMMENTED' || r.state === 'PENDING') continue
    latestByAuthor.set(login, r.state) // later entries overwrite earlier -> "last" wins
  }
  const states = [...latestByAuthor.values()]
  const approvals = states.filter((s) => s === 'APPROVED').length
  if (states.includes('CHANGES_REQUESTED')) return { state: 'changes_requested', approvals }
  if (approvals > 0) return { state: 'approved', approvals }
  return { state: 'none', approvals: 0 }
}

const contextName = (n: any): string => (n.__typename === 'CheckRun' ? n.name : n.context) ?? ''

// `required` (from the base branch's branch-protection rule) restricts the count
// to checks required to merge, so a PR whose only failing checks are optional reads
// as passing. Falsy/empty `required` means count every check (today's behavior) —
// which also covers repos where the token can't read branch protection.
function summarizeChecks(rollup: any, required?: string[]): ChecksSummary {
  if (!rollup) return { state: 'none', passed: 0, failed: 0, total: 0 }
  const requiredSet = required && required.length > 0 ? new Set(required) : null
  const allNodes: any[] = rollup.contexts?.nodes ?? []
  const nodes = requiredSet ? allNodes.filter((n) => requiredSet.has(contextName(n))) : allNodes
  const total = nodes.length
  let passed = 0
  let failed = 0
  let pending = 0
  for (const n of nodes) {
    if (n.__typename === 'CheckRun') {
      if (n.conclusion === 'SUCCESS') passed++
      else if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(n.conclusion)) failed++
      else if (n.conclusion == null) pending++
    } else if (n.__typename === 'StatusContext') {
      if (n.state === 'SUCCESS') passed++
      else if (n.state === 'FAILURE' || n.state === 'ERROR') failed++
      else if (n.state === 'PENDING' || n.state === 'EXPECTED') pending++
    }
  }
  let state: ChecksSummary['state']
  if (requiredSet) {
    // Recompute from required-only counts; the rollup's own state reflects optional checks too.
    if (failed > 0) state = 'failure'
    else if (pending > 0) state = 'pending'
    else if (total > 0) state = 'success'
    else state = 'pending' // required checks configured but none have reported yet
  } else {
    const rollupState = (rollup.state ?? '').toUpperCase()
    if (rollupState === 'SUCCESS') state = 'success'
    else if (rollupState === 'FAILURE' || rollupState === 'ERROR') state = 'failure'
    else if (rollupState === 'PENDING' || rollupState === 'EXPECTED') state = 'pending'
    else state = failed > 0 ? 'failure' : passed > 0 && passed === total ? 'success' : 'pending'
  }
  return { state, passed, failed, total }
}

export function normalizePullRequests(nodes: any[], opts: NormalizeOpts): PullRequest[] {
  const excludedAuthors = opts.excludedAuthors ?? []
  return (nodes ?? [])
    .filter(Boolean)
    .filter((n) => !isExcludedAuthor(n.author?.login, excludedAuthors))
    .map((n) => {
    const review = deriveReview(n.reviews?.nodes ?? [])
    const updatedAtMs = Date.parse(n.updatedAt)
    return {
      id: n.id,
      number: n.number,
      title: n.title,
      url: n.url,
      repo: n.repository?.nameWithOwner ?? '',
      branch: n.headRefName ?? '',
      baseBranch: n.baseRefName ?? '',
      author: user(n.author),
      reviewers: (n.reviewRequests?.nodes ?? [])
        .map((rr: any) => rr.requestedReviewer)
        .filter((u: any) => u && u.login)
        .map(user),
      reviewState: review.state,
      approvals: review.approvals,
      mergeable: MERGEABLE_MAP[n.mergeable] ?? 'unknown',
      checks: summarizeChecks(
        n.commits?.nodes?.[0]?.commit?.statusCheckRollup,
        n.baseRef?.branchProtectionRule?.requiredStatusCheckContexts ?? undefined
      ),
      additions: n.additions ?? 0,
      deletions: n.deletions ?? 0,
      changedFiles: n.changedFiles ?? 0,
      unresolvedThreads: countUnresolvedThreads(n, excludedAuthors),
      labels: (n.labels?.nodes ?? []).map((l: any) => l?.name).filter(Boolean),
      updatedAt: n.updatedAt,
      isStale: opts.now - updatedAtMs > opts.staleThresholdMs,
      isDraft: !!n.isDraft
    }
  })
}
