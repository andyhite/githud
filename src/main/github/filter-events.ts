import { FeedEvent, DashboardSnapshot } from '@shared/types'

// The single source of truth for "should anything authored by this login be
// hidden?" — used for feed events, PR authors, and review-thread authors so the
// denylist behaves identically everywhere something has an author. Bots are only
// excluded if their login (e.g. "dependabot[bot]") is in the list. A missing
// login is un-attributable (CI/lifecycle), so it's kept.
export function isExcludedAuthor(login: string | null | undefined, excludedAuthors: string[]): boolean {
  if (!login) return false
  const lower = login.toLowerCase()
  return excludedAuthors.some((a) => a.toLowerCase() === lower)
}

export function filterEvents(events: FeedEvent[], excludedAuthors: string[]): FeedEvent[] {
  return events.filter((e) => !isExcludedAuthor(e.actor?.login, excludedAuthors))
}

// Re-filter an already-normalized snapshot by author. Used to apply a changed
// denylist to data that's already in memory (existing data), without a network
// round-trip. Pure — returns a new snapshot, never mutates the input.
export function applyAuthorFilters(snap: DashboardSnapshot, excludedAuthors: string[]): DashboardSnapshot {
  return {
    ...snap,
    needsReview: snap.needsReview.filter((p) => !isExcludedAuthor(p.author?.login, excludedAuthors)),
    myPullRequests: snap.myPullRequests.filter((p) => !isExcludedAuthor(p.author?.login, excludedAuthors)),
    teamPullRequests: snap.teamPullRequests.filter((p) => !isExcludedAuthor(p.author?.login, excludedAuthors)),
    events: filterEvents(snap.events, excludedAuthors)
  }
}
