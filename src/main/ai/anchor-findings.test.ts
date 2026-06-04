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

  it('marks anchored:false and fileInDiff:false when the file is not in the diff', () => {
    const [r] = anchorFindings([f({ file: 'src/missing.ts', line: 2 })], ANCHORS)
    expect(r.anchored).toBe(false)
    expect(r.fileInDiff).toBe(false)
    expect(r.resolvedLine).toBeUndefined()
  })

  it('marks anchored:false but fileInDiff:true when the file is in the diff but the finding has no line', () => {
    const [r] = anchorFindings([f({ line: undefined })], ANCHORS)
    expect(r.anchored).toBe(false)
    expect(r.fileInDiff).toBe(true)
  })

  it('sets fileInDiff:true on an anchored finding', () => {
    const [r] = anchorFindings([f({ line: 2 })], ANCHORS)
    expect(r.fileInDiff).toBe(true)
  })

  it('treats a file present in the diff with zero anchors as fileInDiff but not anchored', () => {
    const [r] = anchorFindings([f({ file: 'src/empty.ts', line: 2 })], { ...ANCHORS, 'src/empty.ts': [] })
    expect(r.anchored).toBe(false)
    expect(r.fileInDiff).toBe(true)
  })

  it('repairs a near-miss path by unique basename and anchors to the real file', () => {
    const anchors = { 'a/b/ChatInterface/useStreamingControl.ts': [{ line: 2, side: 'RIGHT' as const }] }
    // model dropped the ChatInterface/ segment
    const [r] = anchorFindings([f({ file: 'a/b/useStreamingControl.ts', line: 2 })], anchors)
    expect(r.file).toBe('a/b/ChatInterface/useStreamingControl.ts')
    expect(r.anchored).toBe(true)
    expect(r.fileInDiff).toBe(true)
    expect(r.resolvedLine).toBe(2)
  })

  it('repairs a near-miss path for a file-level (no-line) finding', () => {
    const anchors = { 'a/b/ChatInterface/useStreamingControl.ts': [{ line: 2, side: 'RIGHT' as const }] }
    const [r] = anchorFindings([f({ file: 'x/useStreamingControl.ts', line: undefined })], anchors)
    expect(r.file).toBe('a/b/ChatInterface/useStreamingControl.ts')
    expect(r.anchored).toBe(false)
    expect(r.fileInDiff).toBe(true)
  })

  it('disambiguates a shared basename by the longest matching trailing path', () => {
    const anchors = {
      'pkg/one/util.ts': [{ line: 1, side: 'RIGHT' as const }],
      'pkg/two/sub/util.ts': [{ line: 1, side: 'RIGHT' as const }]
    }
    const [r] = anchorFindings([f({ file: 'two/sub/util.ts', line: 1 })], anchors)
    expect(r.file).toBe('pkg/two/sub/util.ts')
    expect(r.fileInDiff).toBe(true)
  })

  it('does not repair when the basename is ambiguous with no clear trailing winner', () => {
    const anchors = {
      'pkg/one/util.ts': [{ line: 1, side: 'RIGHT' as const }],
      'pkg/two/util.ts': [{ line: 1, side: 'RIGHT' as const }]
    }
    const [r] = anchorFindings([f({ file: 'util.ts', line: 1 })], anchors)
    expect(r.file).toBe('util.ts')
    expect(r.fileInDiff).toBe(false)
  })
})
