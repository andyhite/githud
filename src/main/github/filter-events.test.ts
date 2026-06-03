import { describe, it, expect } from 'vitest'
import { filterEvents, isBotLogin } from './filter-events'
import type { FeedEvent } from '@shared/types'

function ev(over: Partial<FeedEvent> = {}): FeedEvent {
  return { id: 'a', kind: 'comment', repo: 'o/web', number: 1, title: 't', url: 'u', createdAt: 'x', unread: true, ...over }
}

describe('filterEvents', () => {
  it('drops bot actors when hideBots is on', () => {
    const out = filterEvents([ev({ actor: { login: 'dependabot[bot]', avatarUrl: '' } })], { excludedAuthors: [], hideBots: true })
    expect(out).toHaveLength(0)
  })

  it('drops excluded authors case-insensitively', () => {
    const out = filterEvents([ev({ actor: { login: 'Spammer', avatarUrl: '' } })], { excludedAuthors: ['spammer'], hideBots: false })
    expect(out).toHaveLength(0)
  })

  it('keeps actor-less events (CI, lifecycle)', () => {
    const out = filterEvents([ev({ kind: 'ci_failed', actor: undefined })], { excludedAuthors: ['x'], hideBots: true })
    expect(out).toHaveLength(1)
  })
})

describe('isBotLogin', () => {
  it('matches the [bot] suffix', () => {
    expect(isBotLogin('renovate[bot]')).toBe(true)
    expect(isBotLogin('alice')).toBe(false)
  })
})
