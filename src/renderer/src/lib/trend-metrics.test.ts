import { describe, it, expect } from 'vitest'
import { queueMetric, wipMetric, mergesMetric, activityMetric, formatChurn } from './trend-metrics'
import { DailyMetric, FeedEvent } from '@shared/types'

const day = (date: string, reviewQueue = 0, openWipSize = 0, merges = 0): DailyMetric => ({
  date,
  reviewQueue,
  openWipSize,
  merges
})

describe('queueMetric', () => {
  it('is empty for no history', () => {
    expect(queueMetric([])).toEqual({ current: 0, series: [], delta: null })
  })
  it('reports the latest value and the delta vs ~7 days earlier', () => {
    const h = [day('2026-05-27', 10), day('2026-06-01', 8), day('2026-06-03', 12)]
    const m = queueMetric(h)
    expect(m.current).toBe(12)
    expect(m.series).toEqual([10, 8, 12])
    expect(m.delta).toBe(2) // 12 vs 2026-05-27's 10 (nearest row <= 2026-05-27)
  })
  it('has a null delta when there is no row a week back', () => {
    expect(queueMetric([day('2026-06-01', 5), day('2026-06-03', 9)]).delta).toBeNull()
  })
})

describe('wipMetric', () => {
  it('reads the openWipSize field', () => {
    const h = [day('2026-05-27', 0, 100), day('2026-06-03', 0, 250)]
    const m = wipMetric(h)
    expect(m.current).toBe(250)
    expect(m.delta).toBe(150)
  })
})

describe('mergesMetric', () => {
  it('buckets merges into trailing 7-day weeks (oldest -> newest series)', () => {
    const h = [
      day('2026-05-20', 0, 0, 2), // ~2 weeks back
      day('2026-05-28', 0, 0, 3), // last week (6 days before latest)
      day('2026-06-02', 0, 0, 1), // this week
      day('2026-06-03', 0, 0, 1) // this week (latest)
    ]
    const m = mergesMetric(h, 3)
    expect(m.current).toBe(2) // this week: 1 + 1
    expect(m.delta).toBe(-1) // 2 (this week) - 3 (last week)
    expect(m.series).toEqual([2, 3, 2]) // [2wk-ago, last-wk, this-wk]
  })
  it('is empty for no history', () => {
    expect(mergesMetric([])).toEqual({ current: 0, series: [], delta: null })
  })
})

describe('activityMetric', () => {
  const ev = (createdAt: string): FeedEvent => ({
    id: createdAt,
    kind: 'comment',
    repo: 'o/r',
    number: 1,
    title: 't',
    url: 'u',
    createdAt,
    unread: false
  })
  it('counts events per local day and reports today vs yesterday', () => {
    const now = new Date(2026, 5, 3, 12, 0, 0).getTime() // local June 3
    const events = [
      ev(new Date(2026, 5, 3, 9, 0, 0).toISOString()),
      ev(new Date(2026, 5, 3, 10, 0, 0).toISOString()),
      ev(new Date(2026, 5, 2, 10, 0, 0).toISOString())
    ]
    const m = activityMetric(events, now, 3)
    expect(m.current).toBe(2) // two today
    expect(m.delta).toBe(1) // 2 today - 1 yesterday
    expect(m.series).toEqual([0, 1, 2]) // [2 days ago, yesterday, today]
  })
  it('is empty for no events', () => {
    expect(activityMetric([], Date.now(), 7)).toEqual({ current: 0, series: [0, 0, 0, 0, 0, 0, 0], delta: null })
  })
})

describe('formatChurn', () => {
  it('formats thousands compactly', () => {
    expect(formatChurn(1400)).toBe('1.4k')
    expect(formatChurn(950)).toBe('950')
    expect(formatChurn(0)).toBe('0')
  })
})
