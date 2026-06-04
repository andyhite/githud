import { Octokit } from 'octokit'
import { DashboardSnapshot, Settings } from '@shared/types'
import { buildDashboardQuery, otherSearchQuery, ownerScopeClause, orgFromTeamSlug, NEEDS_REVIEW_QUERY, MY_PRS_QUERY } from './github/queries'
import { normalizePullRequests } from './github/normalize-prs'
import { toPrState, PRState } from './github/pr-state'
import { deriveEvents } from './github/derive-events'
import { subjectStateLabel } from './github/enrich-state'
import { filterEvents } from './github/filter-events'
import { appendEvents, loadPrState, savePrState } from './event-store'
import { loadHidden, saveHidden, resolveHidden } from './hidden-store'
import { recordSample } from './history-store'

// Smoothing for the per-poll GraphQL cost. ~0.3 weights the latest poll while
// still averaging over the last several, so the adaptive interval is stable but
// adapts within a few polls when the query cost changes (e.g. new team labels).
const COST_EWMA_ALPHA = 0.3

export class Poller {
  private costEwma: number | undefined

  constructor(private octokit: Octokit) {}

  get client(): Octokit {
    return this.octokit
  }

  async refresh(settings: Settings, viewerLogin?: string): Promise<DashboardSnapshot> {
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const staleThresholdMs = settings.staleThresholdDays * 24 * 60 * 60 * 1000

    // Octokit rejects when the response carries ANY top-level GraphQL error,
    // even if the other fields resolved. Salvage the partial data so one bad
    // field (e.g. a transient search/backend error) doesn't blank the whole
    // dashboard — the `?? []` / `?? ''` accessors below tolerate missing fields.
    // Team search is scoped to your repos + configured orgs (never global). With
    // nothing to scope to (no viewer login yet AND no orgs), skip it rather than
    // search all of GitHub. needsReview/mine are personal (@me) and unscoped.
    // The "Other PRs" panel source. Owner scope = configured orgs PLUS the org of
    // a configured team (so its review queue is always in range), on top of your
    // own repos (the viewer login). Labels + the single team narrow it further.
    const otherTeam = settings.otherTeam ?? ''
    const teamOrg = orgFromTeamSlug(otherTeam)
    const ownerScope = [...(settings.teamOrgs ?? []), ...(teamOrg ? [teamOrg] : [])]
    const ownerClause = ownerScopeClause(viewerLogin, ownerScope)
    const teamLabels = settings.teamLabels ?? []
    // The panel is opt-in: run the extra search only once the user has configured
    // at least one Other-source dimension (orgs / team / labels) AND there's an
    // owner scope to bound it (else it would span all of GitHub). This keeps the
    // baseline two-alias query cheap for users who don't use the panel.
    const hasOtherConfig = (settings.teamOrgs?.length ?? 0) > 0 || otherTeam.trim() !== '' || teamLabels.length > 0
    const includeTeam = ownerClause !== null && hasOtherConfig
    const variables: Record<string, string> = { needsReview: NEEDS_REVIEW_QUERY, mine: MY_PRS_QUERY }
    if (includeTeam) variables.team = otherSearchQuery(ownerClause!, teamLabels, otherTeam)

    let data: any
    try {
      data = await this.octokit.graphql(buildDashboardQuery(includeTeam), variables)
    } catch (err: any) {
      // Salvage a partial GraphQL response whenever usable data came back,
      // regardless of the error class name (Octokit's varies by version).
      // Only a genuinely empty failure (auth/network/rate-limit) rethrows.
      const partial = err?.data
      if (partial && (partial.needsReview || partial.mine || partial.viewer)) {
        console.warn('[poll] salvaging partial GraphQL response:', err?.message)
        data = partial
      } else {
        throw err
      }
    }

    // A secondary-rate-limit / empty response can resolve to a null/undefined
    // body without throwing; turn that into a clean degraded poll instead of a
    // confusing "Cannot read properties of undefined" TypeError downstream.
    if (!data) throw new Error('GitHub returned an empty response (likely a rate limit)')

    const mineNodes: any[] = (data.mine?.nodes ?? []).filter(Boolean)
    const reviewNodes: any[] = (data.needsReview?.nodes ?? []).filter(Boolean)

    const normOpts = { now, staleThresholdMs, excludedAuthors: settings.excludedAuthors }
    const needsReview = normalizePullRequests(reviewNodes, normOpts)
    const myPullRequests = normalizePullRequests(mineNodes, normOpts)

    // A single team search returns each PR at most once, so no dedupe is needed.
    const teamNodes: any[] = (data.team?.nodes ?? []).filter(Boolean)
    const teamPullRequests = normalizePullRequests(teamNodes, normOpts)
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

    const events = filterEvents(allEvents, settings.excludedAuthors)

    const { hiddenIds, kept } = resolveHidden(
      // Team PRs are included so a hidden team-only PR isn't pruned as "fell out".
      [...needsReview, ...myPullRequests, ...teamPullRequests].map((p) => ({ id: p.id, updatedAt: p.updatedAt })),
      loadHidden(),
      now
    )
    saveHidden(kept)

    const openWipSize = myPullRequests.reduce((sum, p) => sum + p.additions + p.deletions, 0)
    const mergeDelta = newEvents.filter((e) => e.kind === 'merged').length
    const history = recordSample({ reviewQueue: needsReview.length, openWipSize, mergeDelta }, now)

    // Smooth the per-poll cost so the adaptive interval paces against the typical
    // query cost, not the last single sample.
    const lastCost = data.rateLimit?.cost
    if (typeof lastCost === 'number' && lastCost > 0) {
      this.costEwma =
        this.costEwma === undefined ? lastCost : COST_EWMA_ALPHA * lastCost + (1 - COST_EWMA_ALPHA) * this.costEwma
    }

    return {
      fetchedAt: nowIso,
      viewer,
      needsReview,
      myPullRequests,
      teamPullRequests,
      events,
      hiddenPrIds: hiddenIds,
      history,
      rateLimit: {
        remaining: data.rateLimit?.remaining ?? 0,
        resetAt: data.rateLimit?.resetAt ?? '',
        cost: data.rateLimit?.cost,
        used: data.rateLimit?.used,
        limit: data.rateLimit?.limit,
        avgCost: this.costEwma !== undefined ? Math.round(this.costEwma) : undefined
      }
    }
  }
}
