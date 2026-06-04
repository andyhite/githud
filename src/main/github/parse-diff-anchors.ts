import { ReviewSide } from '@shared/types'

export interface DiffAnchor {
  line: number
  side: ReviewSide
}

// Parse a unified diff into the set of lines a GitHub review comment may anchor
// to, per file. Added/context lines anchor to the NEW line number on the RIGHT
// side; deleted lines anchor to the OLD line number on the LEFT side. Anything
// not in a hunk is not a valid anchor.
export function parseDiffAnchors(patch: string): Record<string, DiffAnchor[]> {
  const out: Record<string, DiffAnchor[]> = {}
  if (!patch) return out

  let file: string | null = null
  let oldLine = 0
  let newLine = 0
  const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).trim()
      file = path === '/dev/null' ? null : path.replace(/^b\//, '')
      if (file && !out[file]) out[file] = []
      continue
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git')) continue
    const m = raw.match(hunkHeader)
    if (m) {
      oldLine = Number(m[1])
      newLine = Number(m[2])
      continue
    }
    if (!file) continue
    const tag = raw[0]
    if (tag === '+') {
      out[file].push({ line: newLine, side: 'RIGHT' })
      newLine++
    } else if (tag === '-') {
      out[file].push({ line: oldLine, side: 'LEFT' })
      oldLine++
    } else if (tag === ' ') {
      out[file].push({ line: newLine, side: 'RIGHT' })
      oldLine++
      newLine++
    }
    // '\' (no newline at EOF) and any stray line: ignore
  }
  return out
}
