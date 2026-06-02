import type { DashboardSnapshot, NotificationSpec, PullRequest } from '@shared/types'

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]))
}

export function diffSnapshots(
  prev: DashboardSnapshot | null,
  next: DashboardSnapshot
): NotificationSpec[] {
  if (!prev) return [] // first poll seeds the baseline; never notify

  const specs: NotificationSpec[] = []

  // 1. Newly requested reviews.
  const prevReview = byId(prev.needsReview)
  const newReviews = next.needsReview.filter((pr) => !prevReview.has(pr.id))
  if (newReviews.length === 1) {
    specs.push({ title: 'New review requested', body: `${newReviews[0].repo} #${newReviews[0].number} — ${newReviews[0].title}`, url: newReviews[0].url })
  } else if (newReviews.length > 1) {
    specs.push({ title: `${newReviews.length} new reviews requested`, body: newReviews.map((p) => `${p.repo} #${p.number}`).join(', '), url: newReviews[0].url })
  }

  // 2. New activity items (by id+updatedAt so an updated thread re-notifies once).
  const prevActivityKeys = new Set(prev.activity.map((a) => `${a.id}@${a.updatedAt}`))
  const newActivity = next.activity.filter((a) => !prevActivityKeys.has(`${a.id}@${a.updatedAt}`))
  if (newActivity.length === 1) {
    const a = newActivity[0]
    const who = a.latestComment?.author.login
    specs.push({ title: who ? `New activity from ${who}` : 'New activity', body: `${a.repo} #${a.number ?? ''} — ${a.title}`, url: a.url })
  } else if (newActivity.length > 1) {
    specs.push({ title: `${newActivity.length} new activity updates`, body: newActivity.slice(0, 3).map((a) => `${a.repo} #${a.number ?? ''}`).join(', '), url: newActivity[0].url })
  }

  // 3. My PRs transitioning into a bad state.
  const prevMine = byId(prev.myPullRequests)
  for (const pr of next.myPullRequests) {
    const before = prevMine.get(pr.id)
    if (!before) continue
    if (pr.checks.state === 'failure' && before.checks.state !== 'failure') {
      specs.push({ title: 'Checks failing', body: `${pr.repo} #${pr.number} — ${pr.title}`, url: pr.url })
    }
    if (pr.reviewState === 'changes_requested' && before.reviewState !== 'changes_requested') {
      specs.push({ title: 'Changes requested', body: `${pr.repo} #${pr.number} — ${pr.title}`, url: pr.url })
    }
  }

  return specs
}

export type { PullRequest }
