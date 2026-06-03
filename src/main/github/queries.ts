// One PullRequest fragment reused by both search blocks.
const PR_FIELDS = `
  id
  number
  title
  url
  headRefName
  isDraft
  updatedAt
  mergeable
  repository { nameWithOwner }
  author { login avatarUrl }
  reviewRequests(first: 20) {
    nodes { requestedReviewer { ... on User { login avatarUrl } } }
  }
  # Event derivation diffs these windows (reviews/comments) against the previous
  # poll by id set-difference. The cap is per ~30s poll: a review or comment
  # pushed out of its trailing window before a poll observes it is not surfaced.
  # Deliberate v1 tradeoff — to make it robust, persist a per-PR last-seen
  # timestamp and emit items newer than it instead of windowed set-difference.
  reviews(last: 50) {
    nodes { id state author { login avatarUrl } submittedAt url }
  }
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
