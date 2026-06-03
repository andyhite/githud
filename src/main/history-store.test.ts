import { describe, it, expect } from 'vitest'
import { toLocalDay, upsertToday, addMerges, pruneOlderThan } from './history-store'
import { DailyMetric } from '@shared/types'

describe('toLocalDay', () => {
  it('formats a timestamp as local YYYY-MM-DD', () => {
    const ms = new Date(2026, 5, 3, 12, 30, 0).getTime() // local June 3 2026
    expect(toLocalDay(ms)).toBe('2026-06-03')
  })
  it('zero-pads month and day', () => {
    const ms = new Date(2026, 0, 9, 1, 0, 0).getTime() // local Jan 9 2026
    expect(toLocalDay(ms)).toBe('2026-01-09')
  })
})

describe('upsertToday', () => {
  it('appends a new row with merges defaulted to 0', () => {
    const out = upsertToday([], '2026-06-03', { reviewQueue: 5, openWipSize: 200 })
    expect(out).toEqual([{ date: '2026-06-03', reviewQueue: 5, openWipSize: 200, merges: 0 }])
  })
  it("overwrites today's sample fields but preserves merges", () => {
    const start: DailyMetric[] = [{ date: '2026-06-03', reviewQueue: 5, openWipSize: 200, merges: 3 }]
    const out = upsertToday(start, '2026-06-03', { reviewQueue: 8, openWipSize: 50 })
    expect(out).toEqual([{ date: '2026-06-03', reviewQueue: 8, openWipSize: 50, merges: 3 }])
  })
  it('keeps rows sorted by date ascending', () => {
    const start: DailyMetric[] = [{ date: '2026-06-01', reviewQueue: 1, openWipSize: 0, merges: 0 }]
    const out = upsertToday(start, '2026-06-03', { reviewQueue: 2, openWipSize: 0 })
    expect(out.map((m) => m.date)).toEqual(['2026-06-01', '2026-06-03'])
  })
  it('inserts an earlier date in sorted position', () => {
    const start: DailyMetric[] = [{ date: '2026-06-03', reviewQueue: 2, openWipSize: 0, merges: 0 }]
    const out = upsertToday(start, '2026-06-01', { reviewQueue: 1, openWipSize: 0 })
    expect(out.map((m) => m.date)).toEqual(['2026-06-01', '2026-06-03'])
  })
})

describe('addMerges', () => {
  it("increments today's merge count", () => {
    const start: DailyMetric[] = [{ date: '2026-06-03', reviewQueue: 5, openWipSize: 200, merges: 1 }]
    const out = addMerges(start, '2026-06-03', 2)
    expect(out[0].merges).toBe(3)
  })
  it('creates a zeroed row when today is absent', () => {
    const out = addMerges([], '2026-06-03', 2)
    expect(out).toEqual([{ date: '2026-06-03', reviewQueue: 0, openWipSize: 0, merges: 2 }])
  })
  it('keeps rows sorted when creating a row before an existing later row', () => {
    const start: DailyMetric[] = [{ date: '2026-06-05', reviewQueue: 0, openWipSize: 0, merges: 1 }]
    const out = addMerges(start, '2026-06-01', 2)
    expect(out.map((m) => m.date)).toEqual(['2026-06-01', '2026-06-05'])
  })
})

describe('pruneOlderThan', () => {
  it('drops rows strictly older than the cutoff date', () => {
    const start: DailyMetric[] = [
      { date: '2026-03-01', reviewQueue: 1, openWipSize: 0, merges: 0 },
      { date: '2026-06-01', reviewQueue: 2, openWipSize: 0, merges: 0 }
    ]
    const out = pruneOlderThan(start, '2026-06-01')
    expect(out.map((m) => m.date)).toEqual(['2026-06-01'])
  })
})
