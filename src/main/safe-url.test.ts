import { describe, it, expect } from 'vitest'
import { isSafeExternalUrl } from './safe-url'

describe('isSafeExternalUrl', () => {
  it('allows http and https', () => {
    expect(isSafeExternalUrl('https://github.com/o/r/pull/1')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
  })
  it('rejects dangerous or malformed schemes', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })
})
