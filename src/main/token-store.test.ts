import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync } from 'fs'

// Mock electron: safeStorage round-trips via base64 so we can assert behavior;
// paths point at a temp dir.
const tmp = mkdtempSync(join(tmpdir(), 'githud-token-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmp },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

import { saveToken, loadToken, clearToken, hasToken } from './token-store'

describe('token-store', () => {
  beforeEach(() => clearToken())

  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('returns null when no token saved', () => {
    expect(loadToken()).toBeNull()
    expect(hasToken()).toBe(false)
  })

  it('round-trips a saved token through encryption', () => {
    saveToken('ghp_secret123')
    expect(hasToken()).toBe(true)
    expect(loadToken()).toBe('ghp_secret123')
  })

  it('clears a saved token', () => {
    saveToken('ghp_secret123')
    clearToken()
    expect(loadToken()).toBeNull()
  })
})
