import { ReviewFinding } from '@shared/types'
import { DiffAnchor } from '../github/parse-diff-anchors'

// Best-effort nearest-line anchoring. For each finding with a line, snap to the
// nearest valid anchor in the SAME file (preferring the finding's side, else any
// side; ties break toward the smaller line number). Findings with no line, or in
// a file with no valid anchors, are marked anchored:false. `fileInDiff` records
// whether the file appears in the diff at all, so the caller can route an
// un-anchored finding to a whole-file comment (file in diff) vs. fold it into the
// summary (file absent — GitHub can't comment on it).
const basename = (p: string): string => p.split('/').pop() ?? p

// Count how many trailing path segments two paths share — the disambiguator when
// several diff files share a basename.
function trailingMatch(a: string, b: string): number {
  const x = a.split('/')
  const y = b.split('/')
  let i = x.length - 1
  let j = y.length - 1
  let n = 0
  while (i >= 0 && j >= 0 && x[i] === y[j]) {
    n++
    i--
    j--
  }
  return n
}

// Repair a model-produced file path against the real paths in the diff. The model
// sometimes drops/renames an intermediate directory while keeping the basename
// (e.g. .../components/foo.ts vs .../components/ChatInterface/foo.ts). Exact match
// wins; otherwise match by unique basename, breaking ties by the longest matching
// trailing path. Returns null when there's no match or it stays ambiguous.
export function resolveDiffPath(modelPath: string, diffPaths: string[]): string | null {
  if (diffPaths.includes(modelPath)) return modelPath
  const sameBase = diffPaths.filter((p) => basename(p) === basename(modelPath))
  if (sameBase.length === 0) return null
  if (sameBase.length === 1) return sameBase[0]
  let best = sameBase[0]
  let bestScore = trailingMatch(modelPath, best)
  let tie = false
  for (const p of sameBase.slice(1)) {
    const s = trailingMatch(modelPath, p)
    if (s > bestScore) {
      best = p
      bestScore = s
      tie = false
    } else if (s === bestScore) {
      tie = true
    }
  }
  return tie ? null : best
}

export function anchorFindings(
  findings: ReviewFinding[],
  anchorsByFile: Record<string, DiffAnchor[]>
): ReviewFinding[] {
  const diffPaths = Object.keys(anchorsByFile)
  return findings.map((orig) => {
    // Correct a near-miss path to the real diff file so it can anchor / file-comment
    // instead of being folded; keep the model's path when there's no confident match.
    const resolved = resolveDiffPath(orig.file, diffPaths)
    const f = resolved && resolved !== orig.file ? { ...orig, file: resolved } : orig
    const anchors = anchorsByFile[f.file]
    const fileInDiff = anchors !== undefined
    if (!anchors || anchors.length === 0 || typeof f.line !== 'number') {
      return { ...f, anchored: false, fileInDiff }
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
      fileInDiff: true,
      resolvedLine: best.line,
      resolvedSide: best.side,
      snappedFrom: best.line === f.line ? undefined : f.line
    }
  })
}
