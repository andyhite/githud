import { describe, it, expect } from 'vitest'
import { severityForKind } from './activity-severity'

describe('severityForKind', () => {
  it('maps failures to red', () => {
    expect(severityForKind('ci_failed')).toBe('failure')
    expect(severityForKind('changes_requested')).toBe('failure')
    expect(severityForKind('ci_regressed')).toBe('failure')
  })
  it('maps positive outcomes to green', () => {
    expect(severityForKind('ci_succeeded')).toBe('success')
    expect(severityForKind('approved')).toBe('success')
    expect(severityForKind('merged')).toBe('success')
    expect(severityForKind('changes_addressed')).toBe('success')
  })
  it('gives a direct mention its own high-signal severity', () => {
    expect(severityForKind('mention')).toBe('mention')
  })
  it('maps everything else to info', () => {
    for (const k of ['comment', 'review_commented', 'review_requested', 'review_re_requested', 'closed'] as const) {
      expect(severityForKind(k)).toBe('info')
    }
  })
})
