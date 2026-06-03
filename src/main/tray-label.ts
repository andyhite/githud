import { DashboardSnapshot } from '@shared/types'

export function visibleNeedsReviewCount(snap: DashboardSnapshot): number {
  const hidden = new Set(snap.hiddenPrIds)
  return snap.needsReview.filter((p) => !hidden.has(p.id)).length
}

export function dockBadge(count: number): string {
  return count > 0 ? String(count) : ''
}
