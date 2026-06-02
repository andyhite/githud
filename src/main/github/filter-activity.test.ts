import { describe, it, expect } from 'vitest'
import { filterActivity, isBotLogin } from './filter-activity'
import type { ActivityItem } from '@shared/types'

function item(id: string, login: string | null): ActivityItem {
  return {
    id, reason: 'comment', subjectType: 'PullRequest', repo: 'o/r', number: 1,
    title: 't', url: 'u', unread: true, updatedAt: '2026-06-02T00:00:00Z',
    latestComment: login ? { author: { login, avatarUrl: '' }, body: 'b', createdAt: '2026-06-02T00:00:00Z' } : undefined
  }
}

describe('isBotLogin', () => {
  it('detects the [bot] suffix case-insensitively', () => {
    expect(isBotLogin('dependabot[bot]')).toBe(true)
    expect(isBotLogin('github-actions[bot]')).toBe(true)
    expect(isBotLogin('Renovate[Bot]')).toBe(true)
    expect(isBotLogin('asmith')).toBe(false)
  })
})

describe('filterActivity', () => {
  const items = [item('a', 'asmith'), item('b', 'dependabot[bot]'), item('c', 'noisyuser'), item('d', null)]

  it('passes everything through when no filters set', () => {
    const out = filterActivity(items, { excludedAuthors: [], hideBots: false })
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops bots when hideBots is on', () => {
    const out = filterActivity(items, { excludedAuthors: [], hideBots: true })
    expect(out.map((i) => i.id)).toEqual(['a', 'c', 'd'])
  })

  it('drops denylisted authors case-insensitively', () => {
    const out = filterActivity(items, { excludedAuthors: ['NoisyUser'], hideBots: false })
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'd'])
  })

  it('keeps items with no resolved comment author', () => {
    const out = filterActivity(items, { excludedAuthors: ['anyone'], hideBots: true })
    expect(out.some((i) => i.id === 'd')).toBe(true)
  })
})
