import { Octokit } from 'octokit'
import { DashboardSnapshot, ActivityItem, Settings } from '@shared/types'
import { DASHBOARD_QUERY, NEEDS_REVIEW_QUERY, MY_PRS_QUERY } from './github/queries'
import { normalizePullRequests } from './github/normalize-prs'
import { fetchNotifications, shouldPollNotifications } from './github/notifications'
import { CommentCache, enrichThreads } from './github/enrich'
import { normalizeActivity } from './github/normalize-activity'
import { filterActivity } from './github/filter-activity'

export class Poller {
  private commentCache = new CommentCache()
  private etag: string | undefined
  private lastNotificationsFetch: number | null = null
  private notificationsPollIntervalMs = 60_000
  private cachedActivity: ActivityItem[] = []

  constructor(private octokit: Octokit) {}

  async refresh(settings: Settings): Promise<DashboardSnapshot> {
    const now = Date.now()
    const staleThresholdMs = settings.staleThresholdDays * 24 * 60 * 60 * 1000

    // --- PR tables via GraphQL (every poll) ---
    const data: any = await this.octokit.graphql(DASHBOARD_QUERY, {
      needsReview: NEEDS_REVIEW_QUERY,
      mine: MY_PRS_QUERY
    })

    const needsReview = normalizePullRequests(data.needsReview?.nodes ?? [], { now, staleThresholdMs })
    const myPullRequests = normalizePullRequests(data.mine?.nodes ?? [], { now, staleThresholdMs })

    // --- Activity via REST notifications (rate-limited by X-Poll-Interval) ---
    let activity = this.cachedActivity
    if (shouldPollNotifications({ lastFetchedAt: this.lastNotificationsFetch, pollIntervalMs: this.notificationsPollIntervalMs, now })) {
      const result = await fetchNotifications(this.octokit, { etag: this.etag })
      this.lastNotificationsFetch = now
      this.notificationsPollIntervalMs = result.pollIntervalMs
      this.etag = result.etag
      if (!result.notModified) {
        const comments = await enrichThreads(result.threads, {
          cache: this.commentCache,
          request: (url: string) => this.octokit.request(url as any)
        })
        activity = normalizeActivity(result.threads, comments).slice(0, 50)
        this.cachedActivity = activity
      }
    }

    const filteredActivity = filterActivity(activity, {
      excludedAuthors: settings.excludedAuthors,
      hideBots: settings.hideBots
    })

    return {
      fetchedAt: new Date(now).toISOString(),
      viewer: { login: data.viewer.login, avatarUrl: data.viewer.avatarUrl },
      needsReview,
      myPullRequests,
      activity: filteredActivity,
      rateLimit: { remaining: data.rateLimit?.remaining ?? 0, resetAt: data.rateLimit?.resetAt ?? '' }
    }
  }
}
