import { describe, it, expect } from 'vitest'
import { buildReviewRequest, reviewUrl, classifyPostError } from './post-review'

describe('buildReviewRequest', () => {
  it('shapes a create-review request with only the inline comments — no body, no event', () => {
    const req = buildReviewRequest('me', 'repo', 7, {
      comments: [{ path: 'a.ts', line: 4, side: 'RIGHT', body: 'Is there a reason we...?' }]
    })
    expect(req).toEqual({
      owner: 'me',
      repo: 'repo',
      pull_number: 7,
      comments: [{ path: 'a.ts', line: 4, side: 'RIGHT', body: 'Is there a reason we...?' }]
    })
  })

  it('never sets an event (PENDING/draft) or a body (assessment stays in the dashboard)', () => {
    const req = buildReviewRequest('me', 'repo', 7, {
      comments: [{ path: 'a.ts', line: 4, side: 'RIGHT', body: 'x' }]
    })
    expect('event' in req).toBe(false)
    expect('body' in req).toBe(false)
  })

  it('drops comments missing a numeric line', () => {
    const req = buildReviewRequest('me', 'repo', 7, {
      comments: [
        { path: 'a.ts', line: 4, side: 'RIGHT', body: 'keep' },
        { path: 'b.ts', line: NaN as unknown as number, side: 'RIGHT', body: 'drop' }
      ]
    })
    expect(req.comments).toHaveLength(1)
    expect(req.comments?.[0].body).toBe('keep')
  })

  it('omits the comments key entirely when there are none', () => {
    const req = buildReviewRequest('me', 'repo', 7, { comments: [] })
    expect('comments' in req).toBe(false)
  })
})

describe('reviewUrl', () => {
  it('prefers the review html_url when present', () => {
    expect(reviewUrl('https://github.com/me/repo/pull/7#pullrequestreview-1', 'me', 'repo', 7)).toBe(
      'https://github.com/me/repo/pull/7#pullrequestreview-1'
    )
  })

  it('falls back to the PR files tab when html_url is empty (pending reviews)', () => {
    expect(reviewUrl('', 'me', 'repo', 7)).toBe('https://github.com/me/repo/pull/7/files')
    expect(reviewUrl(undefined, 'me', 'repo', 7)).toBe('https://github.com/me/repo/pull/7/files')
  })
})

describe('classifyPostError', () => {
  it('classifies 403 as forbidden', () => {
    expect(classifyPostError({ status: 403 }).kind).toBe('forbidden')
  })
  it('classifies 401 as auth', () => {
    expect(classifyPostError({ status: 401 }).kind).toBe('auth')
  })
  it('classifies 422 as unprocessable', () => {
    expect(classifyPostError({ status: 422 }).kind).toBe('unprocessable')
  })
  it('classifies a network error', () => {
    expect(classifyPostError({ code: 'ENOTFOUND' }).kind).toBe('network')
  })
  it('falls back to unknown', () => {
    expect(classifyPostError({ status: 500 }).kind).toBe('unknown')
  })
})
