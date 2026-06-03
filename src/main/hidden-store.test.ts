import { describe, it, expect } from 'vitest'
import { resolveHidden, applyHide, applyUnhide, HiddenPr } from './hidden-store'

describe('resolveHidden', () => {
  it('keeps an entry whose PR is unchanged', () => {
    const prs = [{ id: 'a', updatedAt: '2026-06-01T00:00:00Z' }]
    const hidden: HiddenPr[] = [{ id: 'a', updatedAt: '2026-06-01T00:00:00Z' }]
    const { hiddenIds, kept } = resolveHidden(prs, hidden)
    expect(hiddenIds).toEqual(['a'])
    expect(kept).toEqual(hidden)
  })

  it('resurfaces an entry whose PR has newer activity', () => {
    const prs = [{ id: 'a', updatedAt: '2026-06-02T00:00:00Z' }]
    const hidden: HiddenPr[] = [{ id: 'a', updatedAt: '2026-06-01T00:00:00Z' }]
    const { hiddenIds, kept } = resolveHidden(prs, hidden)
    expect(hiddenIds).toEqual([])
    expect(kept).toEqual([])
  })

  it('drops an entry whose PR is no longer present', () => {
    const prs = [{ id: 'b', updatedAt: '2026-06-01T00:00:00Z' }]
    const hidden: HiddenPr[] = [{ id: 'a', updatedAt: '2026-06-01T00:00:00Z' }]
    const { hiddenIds, kept } = resolveHidden(prs, hidden)
    expect(hiddenIds).toEqual([])
    expect(kept).toEqual([])
  })

  it('handles a mix across both lists', () => {
    const prs = [
      { id: 'keep', updatedAt: '2026-06-01T00:00:00Z' },
      { id: 'resurface', updatedAt: '2026-06-03T00:00:00Z' }
    ]
    const hidden: HiddenPr[] = [
      { id: 'keep', updatedAt: '2026-06-01T00:00:00Z' },
      { id: 'resurface', updatedAt: '2026-06-02T00:00:00Z' },
      { id: 'gone', updatedAt: '2026-06-02T00:00:00Z' }
    ]
    const { hiddenIds, kept } = resolveHidden(prs, hidden)
    expect(hiddenIds).toEqual(['keep'])
    expect(kept).toEqual([{ id: 'keep', updatedAt: '2026-06-01T00:00:00Z' }])
  })
})

describe('applyHide', () => {
  it('adds a new entry', () => {
    const out = applyHide([], 'a', '2026-06-01T00:00:00Z')
    expect(out).toEqual([{ id: 'a', updatedAt: '2026-06-01T00:00:00Z' }])
  })

  it('updates updatedAt when re-hiding an existing id', () => {
    const out = applyHide([{ id: 'a', updatedAt: '2026-06-01T00:00:00Z' }], 'a', '2026-06-05T00:00:00Z')
    expect(out).toEqual([{ id: 'a', updatedAt: '2026-06-05T00:00:00Z' }])
  })
})

describe('applyUnhide', () => {
  it('removes the matching entry', () => {
    const out = applyUnhide([{ id: 'a', updatedAt: 'x' }, { id: 'b', updatedAt: 'y' }], 'a')
    expect(out).toEqual([{ id: 'b', updatedAt: 'y' }])
  })
})
