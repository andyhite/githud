export interface User {
  login: string
  avatarUrl: string
}

export interface ChecksSummary {
  state: 'success' | 'failure' | 'pending' | 'none'
  passed: number
  failed: number
  total: number
}

export interface PullRequest {
  id: string
  number: number
  title: string
  url: string
  repo: string // "owner/name"
  branch: string // headRefName, for copy-branch
  baseBranch: string // baseRefName — surfaced when it's not the default (stacked PR)
  author: User
  reviewers: User[]
  reviewState: 'approved' | 'changes_requested' | 'none'
  approvals: number
  mergeable: 'mergeable' | 'conflicting' | 'unknown'
  checks: ChecksSummary
  additions: number
  deletions: number
  changedFiles: number
  unresolvedThreads: number // open review threads, excluding excluded-author threads
  labels: string[] // label names; powers panel label aggregation + view filtering
  updatedAt: string
  isStale: boolean
  isDraft: boolean
  isQueued: boolean // in the repo's merge queue (GraphQL isInMergeQueue)
}

export type FeedEventKind =
  | 'approved' | 'changes_requested' | 'review_commented'
  | 'comment' | 'mention'
  | 'ci_failed' | 'ci_succeeded' | 'ci_regressed'
  | 'review_requested' | 'review_re_requested' | 'changes_addressed'
  | 'merged' | 'closed'

export interface FeedEvent {
  id: string // stable, content-derived; enables dedupe + read-state
  kind: FeedEventKind
  repo: string // "owner/name"
  number: number
  title: string // PR title
  url: string // deep-link to the comment/review when possible
  actor?: User // reviewer / commenter; absent for CI + lifecycle
  createdAt: string
  unread: boolean
}

export interface RateLimit {
  remaining: number
  resetAt: string
  // GraphQL point accounting (optional: older cached snapshots may lack them).
  // `cost` is what the last query spent; `limit`/`used` are the hourly window.
  cost?: number
  used?: number
  limit?: number
  // Smoothed (EWMA) cost across recent polls — what the adaptive interval paces
  // against, so a single anomalous poll doesn't swing the cadence. Set by the poller.
  avgCost?: number
}

export interface DailyMetric {
  date: string // 'YYYY-MM-DD' in local time
  reviewQueue: number // needsReview count, last sample of the day
  openWipSize: number // sum of (additions + deletions) over my open PRs, last sample
  merges: number // count of my PRs that merged that day (accumulated)
}

export interface DashboardSnapshot {
  fetchedAt: string
  viewer: User
  needsReview: PullRequest[]
  myPullRequests: PullRequest[]
  // The "Other PRs" panel source: open PRs in your owner scope (orgs + team
  // orgs) optionally narrowed by labels / a single team's review queue. NOT part
  // of event derivation or history sampling. (Field name kept for back-compat.)
  teamPullRequests: PullRequest[]
  events: FeedEvent[]
  hiddenPrIds: string[]
  history: DailyMetric[]
  rateLimit: RateLimit
  error?: string
  // When `error` is set, why: 'rate_limit' (GitHub budget/secondary limit — the
  // poll loop is waiting for the reset) vs 'offline' (couldn't reach GitHub —
  // retrying). Lets the TopBar word the status honestly. Absent on success.
  errorKind?: 'rate_limit' | 'offline'
}

export interface Settings {
  staleThresholdDays: number
  notificationsEnabled: boolean
  excludedAuthors: string[]
  // Which event kinds fire a desktop notification (master switch is notificationsEnabled). Empty array = notify on nothing.
  notifyKinds: FeedEventKind[]
  // Suppress notifications during this local-time window. null = always on. "HH:MM" 24h local; may wrap midnight (start > end).
  quietHours: { start: string; end: string } | null
  // Register the app as a macOS login item.
  launchAtLogin: boolean
  // Base auto-refresh cadence, in seconds (floor for the adaptive poll loop —
  // it only ever backs OFF from this as the API budget runs low). Min 30.
  refreshIntervalSeconds: number
  // Max share (%) of the hourly GraphQL budget the app may consume before it
  // stops polling until the reset. The rest is left in reserve (the budget is
  // shared per-user across all your tokens/apps). 10–100; 100 = use it all.
  apiBudgetPercent: number
  // --- "Other PRs" panel source (what the panel fetches; server-side) ---
  // Labels scoping the Other-PRs search (open PRs carrying any of these). Empty =
  // no label constraint. Combined with teamOrgs/otherTeams to define the source.
  teamLabels: string[]
  // Orgs to scope the Other-PRs search to (besides your own repos, always
  // included). Without an owner scope the search would span all of GitHub, so the
  // poller skips it entirely when there's nothing to scope to. org logins only.
  teamOrgs: string[]
  // A single team slug ("org/team") whose review queue feeds the Other-PRs panel
  // via precise `team-review-requested:org/team`. The team's org is auto-added to
  // the owner scope. '' = no team filter. (Single team only — GitHub issue/PR
  // search can't reliably OR multiple team-review-requested qualifiers.)
  otherTeam: string
}

export const DEFAULT_SETTINGS: Settings = {
  staleThresholdDays: 2,
  notificationsEnabled: true,
  excludedAuthors: [],
  notifyKinds: ['mention', 'changes_requested', 'ci_failed', 'changes_addressed', 'review_re_requested'],
  quietHours: null,
  launchAtLogin: false,
  refreshIntervalSeconds: 30,
  apiBudgetPercent: 80,
  teamLabels: [],
  teamOrgs: [],
  otherTeam: ''
}

export interface NotificationSpec {
  title: string
  body: string
  url?: string
}

export interface AuthStatus {
  hasToken: boolean
  login?: string
}

// --- AI layer (Phase 3) ---

export type SizeBucket = 'S' | 'M' | 'L' | 'XL'
export type RiskLevel = 'low' | 'medium' | 'high'
export type TriageLabel = 'quick_approve' | 'careful_read' | 'likely_changes' | 'big_effort'

export interface TriageVerdict {
  prId: string
  headKey: string // pr.updatedAt the verdict was generated against (cache identity)
  label: TriageLabel
  size: SizeBucket
  risk: RiskLevel
  rationale: string
  focusHint: string
  generatedAt: string
}

export interface DigestResult {
  markdown: string
  generatedAt: string
  mode: 'full' | 'delta'
  // delta-only metadata (the window the sentence covers + how many events)
  coveredSince?: string
  eventCount?: number
}

export type ReviewSide = 'LEFT' | 'RIGHT'

export interface ReviewFinding {
  severity: 'note' | 'concern' | 'blocker'
  file: string
  line?: number
  side?: ReviewSide
  note: string
  // Filled by anchor-findings in main before the result reaches the renderer:
  resolvedLine?: number
  resolvedSide?: ReviewSide
  anchored?: boolean // false => no valid line anchor in the diff
  snappedFrom?: number // set only when resolvedLine differs from the model's line
  fileInDiff?: boolean // the file appears in the (capped) diff — eligible for a file-level comment even when not line-anchored
}

// A ballpark approve/not-approve read for the reviewer — shown in the dashboard,
// NEVER posted to GitHub.
export type ReviewRecommendation = 'approve' | 'approve_with_nits' | 'request_changes' | 'needs_discussion'

export interface ReviewResult {
  prId: string
  headKey: string // pr.updatedAt the review was generated against (cache identity)
  findings: ReviewFinding[]
  // `recommendation` + `assessment` are reviewer-facing notes shown ONLY in the
  // dashboard — the posted draft review carries the line-level findings and
  // nothing else (no summary body).
  recommendation: ReviewRecommendation
  assessment: string
  generatedAt: string
  patch?: string // the (capped) unified diff, so the renderer can show context around findings
}

export interface PostReviewComment {
  path: string
  line: number
  side: ReviewSide
  body: string
}

// Only the inline line comments are posted. The review is created PENDING (no
// `event`) and with NO body — the AI assessment is dashboard-only and never
// posted, and un-anchored findings are surfaced in the dashboard but not sent.
export interface PostReviewPayload {
  comments: PostReviewComment[]
}

export type PostReviewResult =
  | { ok: true; url: string }
  | { ok: false; kind: 'forbidden' | 'auth' | 'network' | 'unprocessable' | 'unknown'; message: string }

export interface AiStatus {
  hasKey: boolean
}

// A team the authed user can pick for the Other-PRs panel. `slug` is the value
// stored in Settings.otherTeam ("org/team"); `name` is the friendly display name.
export interface TeamOption {
  slug: string // "org/team"
  name: string // display name
  org: string // org login
}

// Result of an on-demand GitHub list call (orgs/teams). On failure the renderer
// keeps free-text entry; `reason` lets it word a hint ('scope' = the token lacks
// read:org, 'no_token' = not connected yet).
export type ListResult<T> =
  | { ok: true; items: T }
  | { ok: false; reason: 'no_token' | 'scope' | 'network' | 'unknown' }

// The typed surface exposed on window.api by preload.
export interface GithudApi {
  getSnapshot(): Promise<DashboardSnapshot | null>
  refresh(): Promise<DashboardSnapshot>
  onSnapshot(cb: (snap: DashboardSnapshot) => void): () => void
  onDigest(cb: (digest: DigestResult) => void): () => void
  getAuthStatus(): Promise<AuthStatus>
  saveToken(token: string): Promise<{ ok: boolean; login?: string; error?: string }>
  // Removes both stored secrets (GitHub token + Anthropic key) from this machine,
  // stops polling, and clears in-memory state. The renderer reloads back to the
  // first-run token screen afterward.
  resetCredentials(): Promise<{ ok: boolean }>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  // On-demand lookups to auto-populate the Other-PRs source pickers in Settings.
  // Need the token's read:org scope; degrade to a `reason` the UI can explain.
  listOrgs(): Promise<ListResult<string[]>>
  listTeams(): Promise<ListResult<TeamOption[]>>
  openExternal(url: string): Promise<void>
  // Fires one desktop notification immediately (bypasses notifyKinds/quiet hours)
  // so the user can confirm macOS is actually delivering them. Returns false when
  // the platform reports no notification support.
  sendTestNotification(): Promise<boolean>
  markRead(id: string): Promise<FeedEvent[]>
  markAllRead(): Promise<FeedEvent[]>
  hidePr(id: string, updatedAt: string): Promise<DashboardSnapshot>
  unhidePr(id: string): Promise<DashboardSnapshot>
  // M6
  snoozePr(id: string, updatedAt: string, until: string): Promise<DashboardSnapshot>
  // M8 (clipboard via main keeps renderer CSP clean)
  copyToClipboard(text: string): Promise<void>
  // M10–M14 (AI; all reject if no key configured)
  getAiStatus(): Promise<AiStatus>
  saveAiKey(key: string): Promise<{ ok: boolean; error?: string }>
  // Deletes the on-disk AI result cache (triage + review). Next AI call recomputes.
  clearAiCache(): Promise<void>
  getTriage(prId: string): Promise<TriageVerdict | null>
  getDigest(): Promise<DigestResult>
  getReview(prId: string, force?: boolean): Promise<ReviewResult>
  postReview(prId: string, payload: PostReviewPayload): Promise<PostReviewResult>
  getReviewInstructions(): Promise<string>
  saveReviewInstructions(text: string): Promise<void>
  resetReviewInstructions(): Promise<string>
}
