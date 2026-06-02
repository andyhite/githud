import { PullRequest, ChecksSummary, User } from '@shared/types'

interface NormalizeOpts {
  now: number
  staleThresholdMs: number
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

function summarizeChecks(rollup: any): ChecksSummary {
  if (!rollup) return { state: 'none', passed: 0, failed: 0, total: 0 }
  const nodes: any[] = rollup.contexts?.nodes ?? []
  const total = nodes.length
  let passed = 0
  let failed = 0
  for (const n of nodes) {
    if (n.__typename === 'CheckRun') {
      if (n.conclusion === 'SUCCESS') passed++
      else if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(n.conclusion)) failed++
    } else if (n.__typename === 'StatusContext') {
      if (n.state === 'SUCCESS') passed++
      else if (n.state === 'FAILURE' || n.state === 'ERROR') failed++
    }
  }
  const rollupState = (rollup.state ?? '').toUpperCase()
  let state: ChecksSummary['state']
  if (rollupState === 'SUCCESS') state = 'success'
  else if (rollupState === 'FAILURE' || rollupState === 'ERROR') state = 'failure'
  else if (rollupState === 'PENDING' || rollupState === 'EXPECTED') state = 'pending'
  else state = failed > 0 ? 'failure' : passed > 0 && passed === total ? 'success' : 'pending'
  return { state, passed, failed, total }
}

export function normalizePullRequests(nodes: any[], opts: NormalizeOpts): PullRequest[] {
  return (nodes ?? []).filter(Boolean).map((n) => {
    const review = deriveReview(n.reviews?.nodes ?? [])
    const updatedAtMs = Date.parse(n.updatedAt)
    return {
      id: n.id,
      number: n.number,
      title: n.title,
      url: n.url,
      repo: n.repository?.nameWithOwner ?? '',
      author: user(n.author),
      reviewers: (n.reviewRequests?.nodes ?? [])
        .map((rr: any) => rr.requestedReviewer)
        .filter((u: any) => u && u.login)
        .map(user),
      reviewState: review.state,
      approvals: review.approvals,
      mergeable: MERGEABLE_MAP[n.mergeable] ?? 'unknown',
      checks: summarizeChecks(n.commits?.nodes?.[0]?.commit?.statusCheckRollup),
      updatedAt: n.updatedAt,
      isStale: opts.now - updatedAtMs > opts.staleThresholdMs,
      isDraft: !!n.isDraft
    }
  })
}
