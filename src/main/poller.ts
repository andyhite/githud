import { Octokit } from 'octokit'
import { DashboardSnapshot, Settings } from '@shared/types'
import { DASHBOARD_QUERY, NEEDS_REVIEW_QUERY, MY_PRS_QUERY } from './github/queries'
import { normalizePullRequests } from './github/normalize-prs'
import { toPrState, PRState } from './github/pr-state'
import { deriveEvents } from './github/derive-events'
import { subjectStateLabel } from './github/enrich-state'
import { filterEvents } from './github/filter-events'
import { appendEvents, loadPrState, savePrState } from './event-store'
import { loadHidden, saveHidden, resolveHidden } from './hidden-store'

export class Poller {
  constructor(private octokit: Octokit) {}

  async refresh(settings: Settings): Promise<DashboardSnapshot> {
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const staleThresholdMs = settings.staleThresholdDays * 24 * 60 * 60 * 1000

    const data: any = await this.octokit.graphql(DASHBOARD_QUERY, {
      needsReview: NEEDS_REVIEW_QUERY,
      mine: MY_PRS_QUERY
    })

    const mineNodes: any[] = (data.mine?.nodes ?? []).filter(Boolean)
    const reviewNodes: any[] = (data.needsReview?.nodes ?? []).filter(Boolean)

    const needsReview = normalizePullRequests(reviewNodes, { now, staleThresholdMs })
    const myPullRequests = normalizePullRequests(mineNodes, { now, staleThresholdMs })
    const viewer = { login: data.viewer?.login ?? '', avatarUrl: data.viewer?.avatarUrl ?? '' }

    const nextStates: PRState[] = [
      ...mineNodes.map((n) => toPrState(n, 'mine')),
      ...reviewNodes.map((n) => toPrState(n, 'review'))
    ]

    const prev = loadPrState()

    // Resolve merged/closed for the user's own PRs that dropped out of the open set.
    const fallenOut = new Map<string, 'merged' | 'closed'>()
    if (prev) {
      const nextIds = new Set(nextStates.map((s) => s.id))
      for (const p of prev) {
        if (p.source !== 'mine' || nextIds.has(p.id)) continue
        try {
          const res = await this.octokit.request(`GET /repos/${p.repo}/pulls/${p.number}`)
          const label = subjectStateLabel(res.data, 'PullRequest')
          if (label === 'merged' || label === 'closed') fallenOut.set(p.id, label)
        } catch {
          // ignore; we just won't emit a lifecycle event for this PR
        }
      }
    }

    const newEvents = deriveEvents(prev, nextStates, viewer.login, nowIso, fallenOut)
    const allEvents = appendEvents(newEvents)
    savePrState(nextStates)

    const events = filterEvents(allEvents, {
      excludedAuthors: settings.excludedAuthors,
      hideBots: settings.hideBots
    })

    const { hiddenIds, kept } = resolveHidden(
      [...needsReview, ...myPullRequests].map((p) => ({ id: p.id, updatedAt: p.updatedAt })),
      loadHidden()
    )
    saveHidden(kept)

    return {
      fetchedAt: nowIso,
      viewer,
      needsReview,
      myPullRequests,
      events,
      hiddenPrIds: hiddenIds,
      rateLimit: { remaining: data.rateLimit?.remaining ?? 0, resetAt: data.rateLimit?.resetAt ?? '' }
    }
  }
}
