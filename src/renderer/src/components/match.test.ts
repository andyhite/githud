import { describe, it, expect } from 'vitest'
import { matchesPr, matchesEvent } from './match'
import type { PullRequest, FeedEvent } from '@shared/types'

const pr = { repo: 'o/web', title: 'Fix nav', author: { login: 'asmith' } } as PullRequest
const ev = { repo: 'o/api', title: 'Retry', actor: { login: 'bob' } } as FeedEvent

describe('matchesPr', () => {
  it('matches empty query, repo, title, and author case-insensitively', () => {
    expect(matchesPr(pr, '')).toBe(true)
    expect(matchesPr(pr, 'WEB')).toBe(true)
    expect(matchesPr(pr, 'nav')).toBe(true)
    expect(matchesPr(pr, 'asmith')).toBe(true)
    expect(matchesPr(pr, 'nope')).toBe(false)
  })
})

describe('matchesEvent', () => {
  it('matches repo, title, and actor login', () => {
    expect(matchesEvent(ev, 'api')).toBe(true)
    expect(matchesEvent(ev, 'bob')).toBe(true)
    expect(matchesEvent(ev, 'zzz')).toBe(false)
  })
})
