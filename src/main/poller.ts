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

    // Octokit rejects when the response carries ANY top-level GraphQL error,
    // even if the other fields resolved. Salvage the partial data so one bad
    // field (e.g. a transient search/backend error) doesn't blank the whole
    // dashboard — the `?? []` / `?? ''` accessors below tolerate missing fields.
    let data: any
    try {
      data = await this.octokit.graphql(DASHBOARD_QUERY, {
        needsReview: NEEDS_REVIEW_QUERY,
        mine: MY_PRS_QUERY
      })
    } catch (err: any) {
      if (err?.name === 'GraphqlResponseError' && err.data) data = err.data
      else throw err
    }

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
    // PRs we couldn't resolve this poll (transient REST failure). We carry these
    // forward in persisted state so the lifecycle event is retried next poll
    // rather than lost: savePrState(nextStates) alone would drop them from `prev`.
    const unresolvedFallenOut: PRState[] = []
    if (prev) {
      const nextIds = new Set(nextStates.map((s) => s.id))
      for (const p of prev) {
        if (p.source !== 'mine' || nextIds.has(p.id)) continue
        try {
          const res = await this.octokit.request(`GET /repos/${p.repo}/pulls/${p.number}`)
          const label = subjectStateLabel(res.data, 'PullRequest')
          if (label === 'merged' || label === 'closed') fallenOut.set(p.id, label)
          // else still open/reopened — drop; it'll reappear in the open set if relevant
        } catch (err: any) {
          const status = err?.status
          // 404/410 = definitively gone (repo or PR deleted); nothing to emit.
          // Anything else is transient — retain for retry on the next poll.
          if (status !== 404 && status !== 410) unresolvedFallenOut.push(p)
        }
      }
    }

    const newEvents = deriveEvents(prev, nextStates, viewer.login, nowIso, fallenOut)
    const allEvents = appendEvents(newEvents)
    savePrState([...nextStates, ...unresolvedFallenOut])

    const events = filterEvents(allEvents, {
      excludedAuthors: settings.excludedAuthors,
      hideBots: settings.hideBots
    })

    const { hiddenIds, kept } = resolveHidden(
      [...needsReview, ...myPullRequests].map((p) => ({ id: p.id, updatedAt: p.updatedAt })),
      loadHidden(),
      now
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
