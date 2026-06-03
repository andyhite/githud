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
  author: User
  reviewers: User[]
  reviewState: 'approved' | 'changes_requested' | 'review_required' | 'none'
  approvals: number
  mergeable: 'mergeable' | 'conflicting' | 'unknown'
  checks: ChecksSummary
  updatedAt: string
  isStale: boolean
  isDraft: boolean
}

export type FeedEventKind =
  | 'approved' | 'changes_requested' | 'review_commented'
  | 'comment' | 'mention'
  | 'ci_failed' | 'ci_succeeded'
  | 'review_requested'
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

export interface DashboardSnapshot {
  fetchedAt: string
  viewer: User
  needsReview: PullRequest[]
  myPullRequests: PullRequest[]
  events: FeedEvent[]
  rateLimit: RateLimit
  error?: string
}

export interface Settings {
  staleThresholdDays: number
  notificationsEnabled: boolean
  excludedAuthors: string[]
  hideBots: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  staleThresholdDays: 2,
  notificationsEnabled: true,
  excludedAuthors: [],
  hideBots: true
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

// The typed surface exposed on window.api by preload.
export interface GithudApi {
  getSnapshot(): Promise<DashboardSnapshot | null>
  refresh(): Promise<DashboardSnapshot>
  onSnapshot(cb: (snap: DashboardSnapshot) => void): () => void
  getAuthStatus(): Promise<AuthStatus>
  saveToken(token: string): Promise<{ ok: boolean; login?: string; error?: string }>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  openExternal(url: string): Promise<void>
  markRead(id: string): Promise<FeedEvent[]>
  markAllRead(): Promise<FeedEvent[]>
}
