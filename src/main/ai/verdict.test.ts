import { describe, it, expect } from 'vitest'
import { verdictLabel } from './verdict'

describe('verdictLabel', () => {
  it('high risk always means likely_changes', () => {
    expect(verdictLabel('S', 'high')).toBe('likely_changes')
    expect(verdictLabel('XL', 'high')).toBe('likely_changes')
  })
  it('XL (not high risk) means big_effort', () => {
    expect(verdictLabel('XL', 'low')).toBe('big_effort')
    expect(verdictLabel('XL', 'medium')).toBe('big_effort')
  })
  it('low risk + small/medium means quick_approve', () => {
    expect(verdictLabel('S', 'low')).toBe('quick_approve')
    expect(verdictLabel('M', 'low')).toBe('quick_approve')
  })
  it('everything else is careful_read', () => {
    expect(verdictLabel('L', 'low')).toBe('careful_read')
    expect(verdictLabel('M', 'medium')).toBe('careful_read')
  })
})
