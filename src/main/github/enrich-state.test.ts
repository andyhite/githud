import { describe, it, expect, vi } from 'vitest'
import { StateCache, enrichStates, subjectStateLabel } from './enrich-state'

function thread(id: string, over: any = {}) {
  return {
    id,
    reason: 'state_change',
    updated_at: '2026-06-02T00:00:00Z',
    subject: { type: 'PullRequest', url: `https://api/repos/o/web/pulls/${id}` },
    ...over
  }
}

describe('subjectStateLabel', () => {
  it('labels a merged PR', () => {
    expect(subjectStateLabel({ state: 'closed', merged: true }, 'PullRequest')).toBe('merged')
    expect(subjectStateLabel({ state: 'closed', merged_at: '2026-06-02T00:00:00Z' }, 'PullRequest')).toBe('merged')
  })

  it('labels a closed (unmerged) PR and a reopened PR', () => {
    expect(subjectStateLabel({ state: 'closed', merged: false }, 'PullRequest')).toBe('closed')
    expect(subjectStateLabel({ state: 'open' }, 'PullRequest')).toBe('reopened')
  })

  it('labels closed / not-planned / reopened issues', () => {
    expect(subjectStateLabel({ state: 'closed', state_reason: 'completed' }, 'Issue')).toBe('closed')
    expect(subjectStateLabel({ state: 'closed', state_reason: 'not_planned' }, 'Issue')).toBe('closed as not planned')
    expect(subjectStateLabel({ state: 'open' }, 'Issue')).toBe('reopened')
  })

  it('returns undefined for unknown subject types', () => {
    expect(subjectStateLabel({ state: 'closed' }, 'Commit')).toBeUndefined()
  })
})

describe('enrichStates', () => {
  it('resolves state for state_change threads and caches by url', async () => {
    const cache = new StateCache()
    const request = vi.fn().mockResolvedValue({ data: { state: 'closed', merged: true } })
    const out = await enrichStates([thread('1')], { cache, request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(out.get('1')).toBe('merged')

    await enrichStates([thread('1')], { cache, request })
    expect(request).toHaveBeenCalledTimes(1) // served from cache
  })

  it('ignores threads whose reason is not state_change', async () => {
    const cache = new StateCache()
    const request = vi.fn()
    const out = await enrichStates([thread('1', { reason: 'comment' })], { cache, request })
    expect(request).not.toHaveBeenCalled()
    expect(out.has('1')).toBe(false)
  })

  it('swallows fetch errors without failing the batch', async () => {
    const cache = new StateCache()
    const request = vi.fn().mockRejectedValue(new Error('boom'))
    const out = await enrichStates([thread('1')], { cache, request })
    expect(out.has('1')).toBe(false)
  })
})
