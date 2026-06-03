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

export function isWithinQuietHours(now: Date, q: { start: string; end: string } | null): boolean {
  if (!q) return false
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number)
    return h * 60 + m
  }
  const mins = now.getHours() * 60 + now.getMinutes()
  const start = toMin(q.start)
  const end = toMin(q.end)
  if (start === end) return false
  return start < end ? mins >= start && mins < end : mins >= start || mins < end
}

export function diffSnapshots(
  prev: DashboardSnapshot | null,
  next: DashboardSnapshot,
  opts: { notifyKinds: readonly FeedEventKind[]; now: Date; quietHours: { start: string; end: string } | null }
): NotificationSpec[] {
  if (!prev) return []
  if (isWithinQuietHours(opts.now, opts.quietHours)) return []
  const allow = new Set(opts.notifyKinds)
  const prevIds = new Set(prev.events.map((e) => e.id))
  return next.events
    .filter((e) => !prevIds.has(e.id) && allow.has(e.kind))
    .slice(0, MAX_NOTIFICATIONS)
    .map((e) => ({ title: titleFor(e), body: `${e.repo} #${e.number} — ${e.title}`, url: e.url }))
}
