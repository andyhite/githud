import { FeedEvent, FeedEventKind } from '@shared/types'
import { PRState } from './pr-state'

const REVIEW_KIND: Record<string, FeedEventKind> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'review_commented'
}

// Compares the previous persisted PR state against the latest poll and emits
// the events that occurred in between. `prev === null` means no baseline yet
// (first run), so we emit nothing. `now` is the ISO timestamp for events that
// have no natural timestamp of their own (CI, review requests, lifecycle).
export function deriveEvents(
  prev: PRState[] | null,
  next: PRState[],
  viewerLogin: string,
  now: string,
  fallenOutStates: Map<string, 'merged' | 'closed'> = new Map()
): FeedEvent[] {
  if (!prev) return []
  const prevById = new Map(prev.map((p) => [p.id, p]))
  const mention = `@${viewerLogin.toLowerCase()}`
  const events: FeedEvent[] = []

  for (const pr of next) {
    const base = { repo: pr.repo, number: pr.number, title: pr.title }
    const before = prevById.get(pr.id)

    if (!before) {
      if (pr.source === 'review') {
        events.push({ ...base, id: `review_requested:${pr.id}`, kind: 'review_requested', url: pr.url, createdAt: now, unread: true })
      }
      continue
    }

    const seenReviews = new Set(before.reviews.map((r) => r.id))
    for (const r of pr.reviews) {
      if (seenReviews.has(r.id)) continue
      const kind = REVIEW_KIND[r.state]
      if (!kind) continue
      events.push({ ...base, id: `review:${r.id}`, kind, url: r.url, actor: { login: r.authorLogin, avatarUrl: r.authorAvatarUrl }, createdAt: r.submittedAt || now, unread: true })
    }

    const seenComments = new Set(before.comments.map((c) => c.id))
    for (const c of pr.comments) {
      if (seenComments.has(c.id)) continue
      const isMention = !!viewerLogin && c.bodyText.toLowerCase().includes(mention)
      events.push({ ...base, id: `comment:${c.id}`, kind: isMention ? 'mention' : 'comment', url: c.url, actor: { login: c.authorLogin, avatarUrl: c.authorAvatarUrl }, createdAt: c.createdAt || now, unread: true })
    }

    if (pr.ciState !== before.ciState && (pr.ciState === 'failure' || pr.ciState === 'success')) {
      events.push({ ...base, id: `ci:${pr.id}:${pr.headOid}:${pr.ciState}`, kind: pr.ciState === 'failure' ? 'ci_failed' : 'ci_succeeded', url: pr.url, createdAt: now, unread: true })
    }
  }

  const nextIds = new Set(next.map((p) => p.id))
  for (const p of prev) {
    if (p.source !== 'mine' || nextIds.has(p.id)) continue
    const label = fallenOutStates.get(p.id)
    if (!label) continue
    events.push({ repo: p.repo, number: p.number, title: p.title, id: `${label}:${p.id}`, kind: label, url: p.url, createdAt: now, unread: true })
  }

  return events
}
