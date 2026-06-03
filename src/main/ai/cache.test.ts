import { describe, it, expect } from 'vitest'
import { cacheKey, readEntry, writeEntry } from './cache'

describe('cacheKey', () => {
  it('combines kind, prId, and headOid', () => {
    expect(cacheKey('triage', 'PR1', 'oidA')).toBe('triage:PR1:oidA')
  })
})

describe('in-memory entry round-trip', () => {
  it('reads back what was written for a matching key, null otherwise', () => {
    const store: Record<string, unknown> = {}
    writeEntry(store, 'triage:PR1:oidA', { label: 'quick_approve' })
    expect(readEntry(store, 'triage:PR1:oidA')).toEqual({ label: 'quick_approve' })
    expect(readEntry(store, 'triage:PR1:oidB')).toBeNull()
  })
})
