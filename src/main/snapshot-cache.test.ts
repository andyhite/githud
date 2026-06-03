import { describe, it, expect, vi, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import type { DashboardSnapshot } from '@shared/types'

const tmp = mkdtempSync(join(tmpdir(), 'githud-snap-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

import { loadCachedSnapshot, cacheSnapshot } from './snapshot-cache'

const sample: DashboardSnapshot = {
  fetchedAt: '2026-06-02T00:00:00Z',
  viewer: { login: 'me', avatarUrl: 'a' },
  needsReview: [],
  myPullRequests: [],
  events: [],
  hiddenPrIds: [],
  history: [],
  rateLimit: { remaining: 5000, resetAt: '2026-06-02T01:00:00Z' }
}

describe('snapshot-cache', () => {
  it('returns null when nothing cached', () => {
    expect(loadCachedSnapshot()).toBeNull()
  })
  it('round-trips a snapshot', () => {
    cacheSnapshot(sample)
    expect(loadCachedSnapshot()).toEqual(sample)
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })
})
