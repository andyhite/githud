import { ReviewSide } from '@shared/types'

export interface DiffSnippetLine {
  type: 'add' | 'del' | 'context'
  oldLine?: number
  newLine?: number
  text: string // line content without the +/-/space prefix
  isTarget: boolean
}

interface ParsedLine {
  type: 'add' | 'del' | 'context'
  oldLine?: number
  newLine?: number
  text: string
}

// One contiguous @@ hunk, per file. We slice context windows within a single
// hunk so a finding's snippet never stitches together unrelated regions.
type FileHunks = Record<string, ParsedLine[][]>

// Parse a unified diff into per-file hunks, retaining each line's content and
// its old/new line numbers — the raw material for rendering a few lines of diff
// around a review finding. Mirrors the anchoring rules in parse-diff-anchors.ts
// (added/context → RIGHT/new line; deleted → LEFT/old line).
function parseHunks(patch: string): FileHunks {
  const out: FileHunks = {}
  if (!patch) return out

  let file: string | null = null
  let hunk: ParsedLine[] | null = null
  let oldLine = 0
  let newLine = 0
  const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).trim()
      file = path === '/dev/null' ? null : path.replace(/^b\//, '')
      if (file && !out[file]) out[file] = []
      hunk = null
      continue
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git')) {
      hunk = null
      continue
    }
    const m = raw.match(hunkHeader)
    if (m) {
      oldLine = Number(m[1])
      newLine = Number(m[2])
      hunk = []
      if (file) out[file].push(hunk)
      continue
    }
    if (!file || !hunk) continue
    const tag = raw[0]
    const text = raw.slice(1)
    if (tag === '+') {
      hunk.push({ type: 'add', newLine, text })
      newLine++
    } else if (tag === '-') {
      hunk.push({ type: 'del', oldLine, text })
      oldLine++
    } else if (tag === ' ') {
      hunk.push({ type: 'context', oldLine, newLine, text })
      oldLine++
      newLine++
    }
    // '\' (no newline at EOF) and stray lines: ignore
  }
  return out
}

function matches(line: ParsedLine, target: number, side: ReviewSide): boolean {
  return side === 'LEFT' ? line.oldLine === target && line.type !== 'add' : line.newLine === target && line.type !== 'del'
}

// Return up to `radius` lines on each side of the finding's anchor within its
// hunk, with the anchor line flagged. null when the file/line isn't in the diff.
export function diffSnippet(
  patch: string,
  file: string,
  line: number,
  side: ReviewSide,
  radius = 3
): DiffSnippetLine[] | null {
  const hunks = parseHunks(patch)[file]
  if (!hunks) return null

  for (const hunk of hunks) {
    const idx = hunk.findIndex((l) => matches(l, line, side))
    if (idx === -1) continue
    const start = Math.max(0, idx - radius)
    const end = Math.min(hunk.length, idx + radius + 1)
    return hunk.slice(start, end).map((l, i) => ({ ...l, isTarget: start + i === idx }))
  }
  return null
}
