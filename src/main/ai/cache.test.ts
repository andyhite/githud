import { describe, it, expect } from 'vitest'
import { cacheKey } from './cache'

describe('cacheKey', () => {
  it('combines kind, prId, and headKey', () => {
    expect(cacheKey('triage', 'PR1', 'oidA')).toBe('triage:PR1:oidA')
  })
})
