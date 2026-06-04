import { describe, it, expect } from 'vitest'
import { anchorFindings } from './anchor-findings'
import { ReviewFinding } from '@shared/types'

const ANCHORS = {
  'src/a.ts': [
    { line: 1, side: 'RIGHT' as const },
    { line: 2, side: 'RIGHT' as const },
    { line: 4, side: 'RIGHT' as const }
  ]
}

function f(p: Partial<ReviewFinding>): ReviewFinding {
  return { severity: 'note', file: 'src/a.ts', note: 'x', ...p }
}

describe('anchorFindings', () => {
  it('keeps an exact-line hit without snappedFrom', () => {
    const [r] = anchorFindings([f({ line: 2 })], ANCHORS)
    expect(r.anchored).toBe(true)
    expect(r.resolvedLine).toBe(2)
    expect(r.resolvedSide).toBe('RIGHT')
    expect(r.snappedFrom).toBeUndefined()
  })

  it('snaps to the nearest valid anchor and records snappedFrom', () => {
    const [r] = anchorFindings([f({ line: 3 })], ANCHORS)
    expect(r.anchored).toBe(true)
    expect(r.resolvedLine).toBe(2) // 3 is equidistant to 2 and 4; tie -> smaller line
    expect(r.snappedFrom).toBe(3)
  })

  it('snaps to the closest when not a tie', () => {
    const [r] = anchorFindings([f({ line: 5 })], ANCHORS)
    expect(r.resolvedLine).toBe(4)
    expect(r.snappedFrom).toBe(5)
  })

  it('marks anchored:false when the file is not in the diff', () => {
    const [r] = anchorFindings([f({ file: 'src/missing.ts', line: 2 })], ANCHORS)
    expect(r.anchored).toBe(false)
    expect(r.resolvedLine).toBeUndefined()
  })

  it('marks anchored:false when the finding has no line', () => {
    const [r] = anchorFindings([f({ line: undefined })], ANCHORS)
    expect(r.anchored).toBe(false)
  })
})
