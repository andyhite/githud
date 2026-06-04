import { PullRequest, PanelViewFilter } from '@shared/types'

// Apply a named view's client-side filter to a panel's already-fetched PRs.
// Within a dimension the values are OR'd (a PR matches if it has ANY of them);
// across dimensions they AND (a PR must satisfy every non-empty dimension). An
// empty or absent dimension imposes no constraint — so `{}` is the "All" view.
export function applyPanelView(prs: PullRequest[], filter: PanelViewFilter): PullRequest[] {
  const labels = filter.labels?.filter(Boolean) ?? []
  const authors = filter.authors?.filter(Boolean) ?? []
  const repos = filter.repos?.filter(Boolean) ?? []

  const labelSet = new Set(labels)
  const authorSet = new Set(authors)
  const repoSet = new Set(repos)

  return prs.filter((pr) => {
    if (labelSet.size > 0 && !pr.labels.some((l) => labelSet.has(l))) return false
    if (authorSet.size > 0 && !authorSet.has(pr.author.login)) return false
    if (repoSet.size > 0 && !repoSet.has(pr.repo)) return false
    return true
  })
}

// True when a filter has no effective constraint (every dimension empty/absent)
// — i.e. it's equivalent to "All". Used to skip rendering a redundant view tag.
export function viewMatchesNothing(filter: PanelViewFilter): boolean {
  return (
    (filter.labels?.filter(Boolean).length ?? 0) === 0 &&
    (filter.authors?.filter(Boolean).length ?? 0) === 0 &&
    (filter.repos?.filter(Boolean).length ?? 0) === 0
  )
}
