// One PullRequest fragment reused by both search blocks.
const PR_FIELDS = `
  id
  number
  title
  url
  headRefName
  baseRefName
  # requiredStatusCheckContexts lets us count only the checks required to merge
  # (so a PR whose only failing checks are optional reads as green). Null when the
  # base branch has no classic branch protection or the token can't read it — then
  # normalize-prs falls back to counting every check. Rulesets are NOT covered here.
  baseRef { branchProtectionRule { requiredStatusCheckContexts } }
  isDraft
  isInMergeQueue
  updatedAt
  mergeable
  additions
  deletions
  changedFiles
  repository { nameWithOwner }
  author { login avatarUrl }
  reviewThreads(first: 50) {
    nodes { isResolved comments(first: 1) { nodes { author { login } } } }
  }
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
              ... on CheckRun { name conclusion }
              ... on StatusContext { context state }
            }
          }
        }
      }
    }
  }
`

// A lean fragment for the Team panel. Team PRs are display-only — they do NOT
// feed event derivation or pr-state diffing — so this drops the expensive fields
// PR_FIELDS only carries for that purpose (the full `comments` window with body
// text, the `reviews` ids/timestamps/urls) and trims the trailing connections to
// what the table actually renders (status tag, reviewers, checks, unresolved
// count, labels, diffstat). Keeping each team search this much cheaper is what
// stops a 3rd full-cost search alias from tripping GitHub's secondary rate limit
// (GraphQL query-complexity) limiter. `labels` lives here, not in PR_FIELDS,
// because only the team view needs it.
const TEAM_PR_FIELDS = `
  id
  number
  title
  url
  headRefName
  baseRefName
  baseRef { branchProtectionRule { requiredStatusCheckContexts } }
  isDraft
  isInMergeQueue
  updatedAt
  mergeable
  additions
  deletions
  changedFiles
  repository { nameWithOwner }
  author { login avatarUrl }
  labels(first: 10) { nodes { name } }
  reviewThreads(first: 30) {
    nodes { isResolved comments(first: 1) { nodes { author { login } } } }
  }
  reviewRequests(first: 20) {
    nodes { requestedReviewer { ... on User { login avatarUrl } } }
  }
  # Only state + author are needed to derive the review status tag (no event diffing).
  reviews(last: 20) {
    nodes { state author { login avatarUrl } }
  }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts(first: 50) {
            nodes {
              __typename
              ... on CheckRun { name conclusion }
              ... on StatusContext { context state }
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
  rateLimit { limit cost remaining used resetAt }
  needsReview: search(query: $needsReview, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
  mine: search(query: $mine, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
}`

export const NEEDS_REVIEW_QUERY = 'is:open is:pr review-requested:@me archived:false'
export const MY_PRS_QUERY = 'is:open is:pr author:@me archived:false'

// Build the owner-scope clause that keeps the team search from spanning all of
// GitHub. Your own repos (the viewer login) are always included; configured org
// logins are added too. GitHub's issues/PR search treats SPACE-separated user:/
// org: qualifiers as an OR (verified empirically) — so we just space-join them.
// IMPORTANT: do NOT use the boolean `OR` operator / `(a OR b)` group here; that
// is code-search syntax and silently returns zero results for issues/PR search
// (it was the bug that blanked the Team panel once a viewer login AND an org
// were both present). There's a hard limit of 16 user/org qualifiers, so we cap.
// Returns null when there's nothing to scope to — the caller then skips the team
// search entirely (never falling back to a global search).
export function ownerScopeClause(viewerLogin: string | undefined, orgs: string[]): string | null {
  const terms: string[] = []
  if (viewerLogin) terms.push(`user:${viewerLogin}`)
  for (const o of orgs) {
    const name = o.trim()
    if (name) terms.push(`org:${name}`)
  }
  const capped = terms.slice(0, 16)
  if (capped.length === 0) return null
  return capped.join(' ')
}

// Build the label clause. GitHub ANDs multiple separate `label:` qualifiers, but
// COMMA-separated quoted values inside a SINGLE `label:` qualifier are OR'd — so
// `label:"a","b"` matches PRs carrying a OR b. (Verified empirically; this is the
// legacy issues-search syntax — the boolean `OR` operator does not work here.)
// Quoting each value handles labels with spaces.
export function labelSearchClause(labels: string[]): string {
  return 'label:' + labels.map((l) => `"${l}"`).join(',')
}

// The "Team PRs" panel aggregates open PRs across your repos + configured orgs
// (the owner clause, space-OR'd) carrying any configured label (comma-OR'd). All
// of that collapses into ONE search — no per-label aliasing, no dedupe needed —
// which is the lowest query-complexity option (well under GitHub's secondary-
// rate-limit ceiling). `sort:updated-desc` so the (capped) page is the most
// recently active PRs. Owner + labels ride in as a search-query variable value
// (not interpolated into the GraphQL), so there's no injection surface.
// `draft:false` excludes work-in-progress PRs — the Team panel is an overview of
// review-ready work, so drafts are noise there (unlike your own My-PRs panel).
export function teamSearchQuery(ownerClause: string, labels: string[]): string {
  return `is:open is:pr draft:false archived:false sort:updated-desc ${ownerClause} ${labelSearchClause(labels)}`
}

// How many results the team search pulls. Smaller than the 50 used for
// needsReview/mine, but it's a single lean (TEAM_PR_FIELDS) alias now, so the
// total cost stays well under GitHub's secondary-rate-limit (query-complexity)
// ceiling.
const TEAM_SEARCH_FIRST = 50

// Build the dashboard query, optionally with the single team search alias.
// includeTeam === false yields exactly the original needsReview+mine query.
export function buildDashboardQuery(includeTeam: boolean): string {
  const teamVar = includeTeam ? ', $team: String!' : ''
  const teamBlock = includeTeam
    ? `  team: search(query: $team, type: ISSUE, first: ${TEAM_SEARCH_FIRST}) {
    nodes { ... on PullRequest { ${TEAM_PR_FIELDS} } }
  }`
    : ''
  return `
query Dashboard($needsReview: String!, $mine: String!${teamVar}) {
  viewer { login avatarUrl }
  rateLimit { limit cost remaining used resetAt }
  needsReview: search(query: $needsReview, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
  mine: search(query: $mine, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
${teamBlock}
}`
}

export const VIEWER_QUERY = `query { viewer { login avatarUrl } }`
