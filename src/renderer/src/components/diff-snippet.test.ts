import { describe, it, expect } from 'vitest'
import { diffSnippet } from './diff-snippet'

const PATCH = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,4 +1,5 @@',
  ' line one',
  '-old two',
  '+new two',
  '+added three',
  ' line four',
  'diff --git a/src/bar.ts b/src/bar.ts',
  '--- a/src/bar.ts',
  '+++ b/src/bar.ts',
  '@@ -10,2 +10,3 @@',
  ' ten',
  '+eleven',
  ' twelve'
].join('\n')

describe('diffSnippet', () => {
  it('returns a window around a RIGHT-side (added) target line', () => {
    const lines = diffSnippet(PATCH, 'src/foo.ts', 3, 'RIGHT', 1)
    expect(lines).not.toBeNull()
    expect(lines!.map((l) => l.text)).toEqual(['new two', 'added three', 'line four'])
    const target = lines!.find((l) => l.isTarget)!
    expect(target.text).toBe('added three')
    expect(target.type).toBe('add')
    expect(target.newLine).toBe(3)
  })

  it('returns a window around a LEFT-side (deleted) target line', () => {
    const lines = diffSnippet(PATCH, 'src/foo.ts', 2, 'LEFT', 1)
    expect(lines!.map((l) => l.text)).toEqual(['line one', 'old two', 'new two'])
    const target = lines!.find((l) => l.isTarget)!
    expect(target.text).toBe('old two')
    expect(target.type).toBe('del')
    expect(target.oldLine).toBe(2)
  })

  it('matches a context line by its new-file number on the RIGHT side', () => {
    const lines = diffSnippet(PATCH, 'src/foo.ts', 4, 'RIGHT', 0)
    expect(lines!.map((l) => l.text)).toEqual(['line four'])
    expect(lines![0].isTarget).toBe(true)
    expect(lines![0].type).toBe('context')
  })

  it('does not cross hunk or file boundaries', () => {
    const lines = diffSnippet(PATCH, 'src/bar.ts', 11, 'RIGHT', 5)
    expect(lines!.map((l) => l.text)).toEqual(['ten', 'eleven', 'twelve'])
  })

  it('returns null when the file is not in the diff', () => {
    expect(diffSnippet(PATCH, 'src/missing.ts', 1, 'RIGHT')).toBeNull()
  })

  it('returns null when no line in the file matches', () => {
    expect(diffSnippet(PATCH, 'src/foo.ts', 999, 'RIGHT')).toBeNull()
  })

  it('returns null for an empty patch', () => {
    expect(diffSnippet('', 'src/foo.ts', 1, 'RIGHT')).toBeNull()
  })
})
