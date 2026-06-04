import { describe, it, expect } from 'vitest'
import { buildReviewRequest, buildFileCommentRequests, classifyPostError } from './post-review'

describe('buildReviewRequest', () => {
  it('shapes a create-review request and keeps valid inline comments', () => {
    const req = buildReviewRequest('me', 'repo', 7, {
      body: 'Overall nothing blocking.',
      event: 'COMMENT',
      comments: [{ path: 'a.ts', line: 4, side: 'RIGHT', body: 'Is there a reason we...?' }]
    })
    expect(req).toEqual({
      owner: 'me',
      repo: 'repo',
      pull_number: 7,
      body: 'Overall nothing blocking.',
      event: 'COMMENT',
      comments: [{ path: 'a.ts', line: 4, side: 'RIGHT', body: 'Is there a reason we...?' }]
    })
  })

  it('drops comments missing a numeric line', () => {
    const req = buildReviewRequest('me', 'repo', 7, {
      body: 's',
      event: 'COMMENT',
      comments: [
        { path: 'a.ts', line: 4, side: 'RIGHT', body: 'keep' },
        { path: 'b.ts', line: NaN as unknown as number, side: 'RIGHT', body: 'drop' }
      ]
    })
    expect(req.comments).toHaveLength(1)
    expect(req.comments?.[0].body).toBe('keep')
  })

  it('omits the comments key entirely when there are none', () => {
    const req = buildReviewRequest('me', 'repo', 7, { body: 's', event: 'APPROVE', comments: [] })
    expect('comments' in req).toBe(false)
  })
})

describe('buildFileCommentRequests', () => {
  it('shapes one file-level comment request per finding with subject_type file', () => {
    const reqs = buildFileCommentRequests('me', 'repo', 7, 'abc123', [
      { path: 'a.ts', body: 'whole-file note' },
      { path: 'b.ts', body: 'another' }
    ])
    expect(reqs).toEqual([
      { owner: 'me', repo: 'repo', pull_number: 7, commit_id: 'abc123', path: 'a.ts', subject_type: 'file', body: 'whole-file note' },
      { owner: 'me', repo: 'repo', pull_number: 7, commit_id: 'abc123', path: 'b.ts', subject_type: 'file', body: 'another' }
    ])
  })

  it('returns an empty array when there are no file comments', () => {
    expect(buildFileCommentRequests('me', 'repo', 7, 'abc123', [])).toEqual([])
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
