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
  unresolvedThreads: number // open review threads, excluding bot/excluded-author threads
  updatedAt: string
  isStale: boolean
  isDraft: boolean
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
  events: FeedEvent[]
  hiddenPrIds: string[]
  history: DailyMetric[]
  rateLimit: RateLimit
  error?: string
}

export interface Settings {
  staleThresholdDays: number
  notificationsEnabled: boolean
  excludedAuthors: string[]
  hideBots: boolean
  // M1: which event kinds fire a desktop notification (master switch is notificationsEnabled). Empty array = notify on nothing.
  notifyKinds: FeedEventKind[]
  // M1: suppress notifications during this local-time window. null = always on. "HH:MM" 24h local; may wrap midnight (start > end).
  quietHours: { start: string; end: string } | null
  // M7: register the app as a macOS login item.
  launchAtLogin: boolean
  // Charts: collapse state of the trend strip above the tables.
  chartsCollapsed: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  staleThresholdDays: 2,
  notificationsEnabled: true,
  excludedAuthors: [],
  hideBots: true,
  notifyKinds: ['mention', 'changes_requested', 'ci_failed', 'changes_addressed', 'review_re_requested'],
  quietHours: null,
  launchAtLogin: false,
  chartsCollapsed: false
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
  headOid: string
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

export interface ReviewFinding {
  severity: 'note' | 'concern' | 'blocker'
  file: string
  line?: number
  note: string
}

export interface ReviewResult {
  prId: string
  headOid: string
  findings: ReviewFinding[]
  summary: string
  generatedAt: string
}

export interface AiStatus {
  hasKey: boolean
}

// The typed surface exposed on window.api by preload.
export interface GithudApi {
  getSnapshot(): Promise<DashboardSnapshot | null>
  refresh(): Promise<DashboardSnapshot>
  onSnapshot(cb: (snap: DashboardSnapshot) => void): () => void
  onDigest(cb: (digest: DigestResult) => void): () => void
  getAuthStatus(): Promise<AuthStatus>
  saveToken(token: string): Promise<{ ok: boolean; login?: string; error?: string }>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  openExternal(url: string): Promise<void>
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
  getTriage(prId: string): Promise<TriageVerdict | null>
  getDigest(): Promise<DigestResult>
  getReview(prId: string): Promise<ReviewResult>
}
