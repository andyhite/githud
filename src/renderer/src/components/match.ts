import { PullRequest, FeedEvent } from '@shared/types'

export function matchesPr(pr: PullRequest, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [pr.repo, pr.title, pr.author.login].some((f) => f.toLowerCase().includes(q))
}

export function matchesEvent(ev: FeedEvent, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [ev.repo, ev.title, ev.actor?.login ?? ''].some((f) => f.toLowerCase().includes(q))
}
