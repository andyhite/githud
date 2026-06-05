import { describe, it, expect } from 'vitest'
import { computeSnoozeUntil } from './snooze'

const now = new Date('2026-06-02T12:00:00') // a Tuesday, local

describe('computeSnoozeUntil', () => {
  it('1h adds an hour', () => {
    expect(computeSnoozeUntil(now, '1h')).toBe(new Date('2026-06-02T13:00:00').toISOString())
  })
  it('tomorrow is next day at 09:00 local', () => {
    expect(computeSnoozeUntil(now, 'tomorrow')).toBe(new Date('2026-06-03T09:00:00').toISOString())
  })
  it('monday is the next Monday at 09:00 local', () => {
    expect(computeSnoozeUntil(now, 'monday')).toBe(new Date('2026-06-08T09:00:00').toISOString())
  })
})
