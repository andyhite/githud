import { describe, it, expect } from 'vitest'
import { normalizeActivity } from './normalize-activity'
import type { ResolvedComment } from './enrich'

function thread(over: any = {}) {
  return {
    id: 't1',
    reason: 'mention',
    unread: true,
    updated_at: '2026-06-02T00:00:00Z',
    repository: { full_name: 'o/web' },
    subject: {
      title: 'Fix nav focus trap',
      type: 'PullRequest',
      url: 'https://api.github.com/repos/o/web/pulls/88',
      latest_comment_url: 'https://api.github.com/repos/o/web/issues/comments/5'
    },
    ...over
  }
}

describe('normalizeActivity', () => {
  it('maps a thread into an ActivityItem with parsed number and html url', () => {
    const [item] = normalizeActivity([thread()], new Map())
    expect(item).toMatchObject({
      id: 't1', reason: 'mention', subjectType: 'PullRequest',
      repo: 'o/web', number: 88, title: 'Fix nav focus trap', unread: true,
      url: 'https://github.com/o/web/pull/88'
    })
  })

  it('attaches the resolved latest comment when present', () => {
    const comments = new Map<string, ResolvedComment>([
      ['t1', { author: { login: 'asmith', avatarUrl: 'av' }, body: 'please fix', createdAt: '2026-06-02T00:00:00Z' }]
    ])
    const [item] = normalizeActivity([thread()], comments)
    expect(item.latestComment).toEqual({ author: { login: 'asmith', avatarUrl: 'av' }, body: 'please fix', createdAt: '2026-06-02T00:00:00Z' })
  })

  it('drops the comment for non-comment reasons when it is just the subject body', () => {
    const t = thread({ reason: 'subscribed', subject: { ...thread().subject, latest_comment_url: thread().subject.url } })
    const comments = new Map<string, ResolvedComment>([
      ['t1', { author: { login: 'asmith', avatarUrl: 'av' }, body: 'the PR description', createdAt: '2026-06-02T00:00:00Z' }]
    ])
    const [item] = normalizeActivity([t], comments)
    expect(item.latestComment).toBeUndefined()
  })

  it('keeps the comment author for mentions even when it points at the subject body', () => {
    const t = thread({ reason: 'mention', subject: { ...thread().subject, latest_comment_url: thread().subject.url } })
    const comments = new Map<string, ResolvedComment>([
      ['t1', { author: { login: 'alice', avatarUrl: 'av' }, body: 'hey @me take a look', createdAt: '2026-06-02T00:00:00Z' }]
    ])
    const [item] = normalizeActivity([t], comments)
    expect(item.latestComment?.author.login).toBe('alice')
  })

  it('attaches a resolved subject state when provided', () => {
    const states = new Map<string, string>([['t1', 'merged']])
    const [item] = normalizeActivity([thread()], new Map(), states)
    expect(item.subjectState).toBe('merged')
  })

  it('builds an issue html url for Issue subjects', () => {
    const [item] = normalizeActivity([thread({ subject: { ...thread().subject, type: 'Issue', url: 'https://api.github.com/repos/o/web/issues/42' } })], new Map())
    expect(item.subjectType).toBe('Issue')
    expect(item.number).toBe(42)
    expect(item.url).toBe('https://github.com/o/web/issues/42')
  })

  it('sorts newest first by updated_at', () => {
    const a = thread({ id: 'a', updated_at: '2026-06-01T00:00:00Z' })
    const b = thread({ id: 'b', updated_at: '2026-06-02T00:00:00Z' })
    const items = normalizeActivity([a, b], new Map())
    expect(items.map((i) => i.id)).toEqual(['b', 'a'])
  })
})
