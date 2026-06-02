import { describe, it, expect, vi } from 'vitest'
import { CommentCache, enrichThreads } from './enrich'

function thread(id: string, url: string | null, updatedAt: string) {
  return {
    id,
    updated_at: updatedAt,
    subject: { latest_comment_url: url }
  }
}

function fakeComment(login: string, body: string) {
  return {
    data: { user: { login, avatar_url: `av-${login}`, type: 'User' }, body, created_at: '2026-06-02T00:00:00Z' }
  }
}

describe('enrichThreads', () => {
  it('fetches and caches comment bodies by url', async () => {
    const cache = new CommentCache()
    const request = vi.fn().mockResolvedValue(fakeComment('asmith', 'hello'))
    const result = await enrichThreads([thread('t1', 'https://api/c/1', '2026-06-02T00:00:00Z')], { cache, request })

    expect(request).toHaveBeenCalledTimes(1)
    expect(result.get('t1')).toEqual({
      author: { login: 'asmith', avatarUrl: 'av-asmith' },
      body: 'hello',
      createdAt: '2026-06-02T00:00:00Z'
    })
  })

  it('reuses the cache when the thread updated_at is unchanged', async () => {
    const cache = new CommentCache()
    const request = vi.fn().mockResolvedValue(fakeComment('asmith', 'hello'))
    const t = thread('t1', 'https://api/c/1', '2026-06-02T00:00:00Z')

    await enrichThreads([t], { cache, request })
    await enrichThreads([t], { cache, request })
    expect(request).toHaveBeenCalledTimes(1) // second call served from cache
  })

  it('re-fetches when updated_at changes', async () => {
    const cache = new CommentCache()
    const request = vi.fn()
      .mockResolvedValueOnce(fakeComment('asmith', 'v1'))
      .mockResolvedValueOnce(fakeComment('asmith', 'v2'))

    await enrichThreads([thread('t1', 'https://api/c/1', '2026-06-02T00:00:00Z')], { cache, request })
    const r2 = await enrichThreads([thread('t1', 'https://api/c/1', '2026-06-02T05:00:00Z')], { cache, request })
    expect(request).toHaveBeenCalledTimes(2)
    expect(r2.get('t1')?.body).toBe('v2')
  })

  it('skips threads with no latest_comment_url', async () => {
    const cache = new CommentCache()
    const request = vi.fn()
    const result = await enrichThreads([thread('t1', null, '2026-06-02T00:00:00Z')], { cache, request })
    expect(request).not.toHaveBeenCalled()
    expect(result.has('t1')).toBe(false)
  })

  it('swallows fetch errors for a thread without failing the batch', async () => {
    const cache = new CommentCache()
    const request = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await enrichThreads([thread('t1', 'https://api/c/1', '2026-06-02T00:00:00Z')], { cache, request })
    expect(result.has('t1')).toBe(false)
  })
})
