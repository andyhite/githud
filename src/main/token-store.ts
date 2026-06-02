import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tokenFilePath } from './paths'

export function hasToken(): boolean {
  return existsSync(tokenFilePath())
}

export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available; cannot store token securely.')
  }
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenFilePath(), encrypted)
}

export function loadToken(): string | null {
  const path = tokenFilePath()
  if (!existsSync(path)) return null
  try {
    return safeStorage.decryptString(readFileSync(path))
  } catch {
    return null
  }
}

export function clearToken(): void {
  const path = tokenFilePath()
  if (existsSync(path)) rmSync(path, { force: true })
}
