import type { DashboardSnapshot, NotificationSpec, FeedEvent, FeedEventKind } from '@shared/types'

const MAX_NOTIFICATIONS = 5

function titleFor(e: FeedEvent): string {
  const who = e.actor?.login
  const byKind: Record<FeedEventKind, string> = {
    approved: who ? `${who} approved` : 'PR approved',
    changes_requested: who ? `${who} requested changes` : 'Changes requested',
    review_commented: who ? `${who} reviewed` : 'New review',
    comment: who ? `${who} commented` : 'New comment',
    mention: who ? `${who} mentioned you` : 'You were mentioned',
    ci_failed: 'Checks failed',
    ci_succeeded: 'Checks passed',
    ci_regressed: 'Checks regressed',
    review_requested: 'Review requested',
    review_re_requested: 'Review re-requested',
    changes_addressed: 'Changes addressed',
    merged: 'PR merged',
    closed: 'PR closed'
  }
  return byKind[e.kind]
}

export function diffSnapshots(
  prev: DashboardSnapshot | null,
  next: DashboardSnapshot
): NotificationSpec[] {
  if (!prev) return [] // first poll seeds the baseline; never notify
  const prevIds = new Set(prev.events.map((e) => e.id))
  return next.events
    .filter((e) => !prevIds.has(e.id))
    .slice(0, MAX_NOTIFICATIONS)
    .map((e) => ({ title: titleFor(e), body: `${e.repo} #${e.number} — ${e.title}`, url: e.url }))
}
