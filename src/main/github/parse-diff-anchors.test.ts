import { describe, it, expect } from 'vitest'
import { parseDiffAnchors } from './parse-diff-anchors'

const PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1
-const y = 2
+const y = 3
+const z = 4
 const w = 5
diff --git a/src/new.ts b/src/new.ts
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const a = 1
+export const b = 2
`

describe('parseDiffAnchors', () => {
  it('maps added and context lines to RIGHT-side new line numbers', () => {
    const anchors = parseDiffAnchors(PATCH)
    // a.ts new side: line 1 (context), 2 (added y), 3 (added z), 4 (context w)
    const aRight = anchors['src/a.ts'].filter((x) => x.side === 'RIGHT').map((x) => x.line)
    expect(aRight).toEqual([1, 2, 3, 4])
  })

  it('maps deleted lines to LEFT-side old line numbers', () => {
    const anchors = parseDiffAnchors(PATCH)
    const aLeft = anchors['src/a.ts'].filter((x) => x.side === 'LEFT').map((x) => x.line)
    expect(aLeft).toEqual([2]) // "const y = 2" was old line 2
  })

  it('handles a new file (--- /dev/null)', () => {
    const anchors = parseDiffAnchors(PATCH)
    expect(anchors['src/new.ts'].filter((x) => x.side === 'RIGHT').map((x) => x.line)).toEqual([1, 2])
  })

  it('returns {} for an empty patch', () => {
    expect(parseDiffAnchors('')).toEqual({})
  })
})
