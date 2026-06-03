export interface PrReview {
  id: string
  state: string
  authorLogin: string
  authorAvatarUrl: string
  url: string
  submittedAt: string
}

export interface PrComment {
  id: string
  authorLogin: string
  authorAvatarUrl: string
  url: string
  createdAt: string
  bodyText: string
}

export interface PRState {
  id: string
  number: number
  title: string
  url: string
  repo: string
  authorLogin: string
  source: 'mine' | 'review'
  ciState: 'success' | 'failure' | 'pending' | 'none'
  headOid: string
  reviews: PrReview[]
  comments: PrComment[]
  reviewRequestedLogins: string[]
}

function ciStateFromRollup(state: string | undefined): PRState['ciState'] {
  switch ((state ?? '').toUpperCase()) {
    case 'SUCCESS': return 'success'
    case 'FAILURE':
    case 'ERROR': return 'failure'
    case 'PENDING':
    case 'EXPECTED': return 'pending'
    default: return 'none'
  }
}

export function toPrState(node: any, source: 'mine' | 'review'): PRState {
  const commit = node.commits?.nodes?.[0]?.commit
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    repo: node.repository?.nameWithOwner ?? '',
    authorLogin: node.author?.login ?? 'unknown',
    source,
    ciState: ciStateFromRollup(commit?.statusCheckRollup?.state),
    headOid: commit?.oid ?? '',
    reviews: (node.reviews?.nodes ?? []).filter(Boolean).map((r: any) => ({
      id: r.id,
      state: r.state,
      authorLogin: r.author?.login ?? 'unknown',
      authorAvatarUrl: r.author?.avatarUrl ?? '',
      url: r.url ?? node.url,
      submittedAt: r.submittedAt ?? ''
    })),
    comments: (node.comments?.nodes ?? []).filter(Boolean).map((c: any) => ({
      id: c.id,
      authorLogin: c.author?.login ?? 'unknown',
      authorAvatarUrl: c.author?.avatarUrl ?? '',
      url: c.url ?? node.url,
      createdAt: c.createdAt ?? '',
      bodyText: c.bodyText ?? ''
    })),
    reviewRequestedLogins: (node.reviewRequests?.nodes ?? [])
      .map((rr: any) => rr.requestedReviewer?.login)
      .filter(Boolean),
  }
}
