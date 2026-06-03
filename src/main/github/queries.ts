// One PullRequest fragment reused by both search blocks.
const PR_FIELDS = `
  id
  number
  title
  url
  isDraft
  updatedAt
  mergeable
  repository { nameWithOwner }
  author { login avatarUrl }
  reviewRequests(first: 20) {
    nodes { requestedReviewer { ... on User { login avatarUrl } } }
  }
  reviews(last: 50) {
    nodes { id state author { login avatarUrl } submittedAt url }
  }
  # Event derivation diffs these windows against the previous poll. A comment or
  # review pushed out of the window before a poll observes it is not surfaced.
  comments(last: 20) {
    nodes { id author { login avatarUrl } createdAt url bodyText }
  }
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { conclusion }
              ... on StatusContext { state }
            }
          }
        }
      }
    }
  }
`

export const DASHBOARD_QUERY = `
query Dashboard($needsReview: String!, $mine: String!) {
  viewer { login avatarUrl }
  rateLimit { remaining resetAt }
  needsReview: search(query: $needsReview, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
  mine: search(query: $mine, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
}`

export const NEEDS_REVIEW_QUERY = 'is:open is:pr review-requested:@me archived:false'
export const MY_PRS_QUERY = 'is:open is:pr author:@me archived:false'

export const VIEWER_QUERY = `query { viewer { login avatarUrl } }`
