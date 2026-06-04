import { ReviewFinding } from '@shared/types'
import { DiffAnchor } from '../github/parse-diff-anchors'

// Best-effort nearest-line anchoring. For each finding with a line, snap to the
// nearest valid anchor in the SAME file (preferring the finding's side, else any
// side; ties break toward the smaller line number). Findings with no line or in
// a file absent from the diff are marked anchored:false so callers fold them
// into the review summary instead of posting an inline comment.
export function anchorFindings(
  findings: ReviewFinding[],
  anchorsByFile: Record<string, DiffAnchor[]>
): ReviewFinding[] {
  return findings.map((f) => {
    const anchors = anchorsByFile[f.file]
    if (!anchors || anchors.length === 0 || typeof f.line !== 'number') {
      return { ...f, anchored: false }
    }
    const wantSide = f.side ?? 'RIGHT'
    const sameSide = anchors.filter((a) => a.side === wantSide)
    const pool = sameSide.length > 0 ? sameSide : anchors

    let best = pool[0]
    let bestDist = Math.abs(best.line - f.line)
    for (const a of pool) {
      const d = Math.abs(a.line - f.line)
      if (d < bestDist || (d === bestDist && a.line < best.line)) {
        best = a
        bestDist = d
      }
    }
    return {
      ...f,
      anchored: true,
      resolvedLine: best.line,
      resolvedSide: best.side,
      snappedFrom: best.line === f.line ? undefined : f.line
    }
  })
}
