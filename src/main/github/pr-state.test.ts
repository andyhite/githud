import { describe, it, expect } from 'vitest'
import { toPrState } from './pr-state'

function node(over: any = {}) {
  return {
    id: 'PR1', number: 88, title: 'Fix nav', url: 'https://gh/88',
    repository: { nameWithOwner: 'o/web' },
    author: { login: 'bob', avatarUrl: 'av-bob' },
    reviews: { nodes: [{ id: 'r1', state: 'APPROVED', author: { login: 'alice', avatarUrl: 'av-a' }, submittedAt: '2026-06-02T00:00:00Z', url: 'https://gh/88#r1' }] },
    comments: { nodes: [{ id: 'c1', author: { login: 'carol', avatarUrl: 'av-c' }, createdAt: '2026-06-02T01:00:00Z', url: 'https://gh/88#c1', bodyText: 'hi' }] },
    commits: { nodes: [{ commit: { oid: 'deadbeef', statusCheckRollup: { state: 'FAILURE' } } }] },
    ...over
  }
}

describe('toPrState', () => {
  it('maps a GraphQL PR node into a diffable PRState', () => {
    const s = toPrState(node(), 'mine')
    expect(s).toMatchObject({
      id: 'PR1', number: 88, title: 'Fix nav', url: 'https://gh/88', repo: 'o/web',
      authorLogin: 'bob', source: 'mine', ciState: 'failure', headOid: 'deadbeef'
    })
    expect(s.reviews).toEqual([{ id: 'r1', state: 'APPROVED', authorLogin: 'alice', authorAvatarUrl: 'av-a', url: 'https://gh/88#r1', submittedAt: '2026-06-02T00:00:00Z' }])
    expect(s.comments).toEqual([{ id: 'c1', authorLogin: 'carol', authorAvatarUrl: 'av-c', url: 'https://gh/88#c1', createdAt: '2026-06-02T01:00:00Z', bodyText: 'hi' }])
  })

  it('maps rollup states and tolerates missing data', () => {
    expect(toPrState(node({ commits: { nodes: [{ commit: { oid: 'x', statusCheckRollup: { state: 'SUCCESS' } } }] } }), 'review').ciState).toBe('success')
    expect(toPrState(node({ commits: { nodes: [{ commit: { oid: 'x', statusCheckRollup: { state: 'PENDING' } } }] } }), 'review').ciState).toBe('pending')
    expect(toPrState(node({ commits: { nodes: [] }, reviews: { nodes: [] }, comments: { nodes: [] } }), 'review')).toMatchObject({ ciState: 'none', headOid: '', reviews: [], comments: [] })
  })

  it('skips null review/comment nodes (inaccessible items in a connection)', () => {
    const s = toPrState(node({
      reviews: { nodes: [null, { id: 'r1', state: 'APPROVED', author: { login: 'alice', avatarUrl: 'av-a' }, submittedAt: '', url: 'u' }] },
      comments: { nodes: [{ id: 'c1', author: { login: 'carol', avatarUrl: '' }, createdAt: '', url: 'u', bodyText: 'hi' }, null] }
    }), 'mine')
    expect(s.reviews).toHaveLength(1)
    expect(s.comments).toHaveLength(1)
    expect(s.reviews[0].id).toBe('r1')
    expect(s.comments[0].id).toBe('c1')
  })
})
