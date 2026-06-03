import { describe, it, expect } from 'vitest'
import { sizeBucket } from './size'

describe('sizeBucket', () => {
  it('buckets by lines changed and files touched (whichever is larger)', () => {
    expect(sizeBucket({ additions: 5, deletions: 5, changedFiles: 1 })).toBe('S')
    expect(sizeBucket({ additions: 80, deletions: 20, changedFiles: 4 })).toBe('M')
    expect(sizeBucket({ additions: 400, deletions: 100, changedFiles: 12 })).toBe('L')
    expect(sizeBucket({ additions: 2000, deletions: 500, changedFiles: 40 })).toBe('XL')
  })
  it('escalates on file count even when lines are few', () => {
    expect(sizeBucket({ additions: 10, deletions: 0, changedFiles: 25 })).toBe('XL')
  })
})
