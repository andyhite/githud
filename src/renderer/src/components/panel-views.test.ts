import { describe, it, expect } from 'vitest'
import { applyPanelView, viewMatchesNothing } from './panel-views'
import type { PullRequest } from '@shared/types'

function pr(id: string, over: Partial<PullRequest> = {}): PullRequest {
  return {
    id,
    labels: [],
    author: { login: 'octocat', avatarUrl: '' },
    repo: 'acme/web',
    ...over
  } as PullRequest
}

const prs = [
  pr('a', { labels: ['frontend'], author: { login: 'alice', avatarUrl: '' }, repo: 'acme/web' }),
  pr('b', { labels: ['backend'], author: { login: 'bob', avatarUrl: '' }, repo: 'acme/api' }),
  pr('c', { labels: ['frontend', 'backend'], repo: 'acme/web' }),
  pr('d', { author: { login: 'alice', avatarUrl: '' }, repo: 'globex/x' })
]

describe('applyPanelView', () => {
  it('returns everything for an empty filter (the implicit "All" view)', () => {
    expect(applyPanelView(prs, {}).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('filters by label (OR within the dimension)', () => {
    expect(applyPanelView(prs, { labels: ['frontend'] }).map((p) => p.id)).toEqual(['a', 'c'])
    expect(applyPanelView(prs, { labels: ['frontend', 'backend'] }).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('filters by author', () => {
    expect(applyPanelView(prs, { authors: ['alice'] }).map((p) => p.id)).toEqual(['a', 'd'])
  })

  it('filters by repo', () => {
    expect(applyPanelView(prs, { repos: ['acme/web'] }).map((p) => p.id)).toEqual(['a', 'c'])
  })

  it('ANDs across dimensions', () => {
    // frontend-labelled AND authored by alice → only a
    expect(applyPanelView(prs, { labels: ['frontend'], authors: ['alice'] }).map((p) => p.id)).toEqual(['a'])
  })

  it('treats empty arrays in a dimension as no constraint', () => {
    expect(applyPanelView(prs, { labels: [], authors: ['bob'] }).map((p) => p.id)).toEqual(['b'])
  })
})

describe('viewMatchesNothing', () => {
  it('is true only when every present dimension is empty', () => {
    expect(viewMatchesNothing({})).toBe(true)
    expect(viewMatchesNothing({ labels: [], authors: [] })).toBe(true)
    expect(viewMatchesNothing({ labels: ['x'] })).toBe(false)
  })
})
