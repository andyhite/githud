import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { aiKeyFilePath } from '../paths'

export function hasAiKey(): boolean {
  return existsSync(aiKeyFilePath())
}

export function saveAiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available; cannot store the AI key securely.')
  }
  writeFileSync(aiKeyFilePath(), safeStorage.encryptString(key))
}

export function loadAiKey(): string | null {
  const path = aiKeyFilePath()
  if (!existsSync(path)) return null
  try {
    return safeStorage.decryptString(readFileSync(path))
  } catch {
    return null
  }
}

export function clearAiKey(): void {
  const path = aiKeyFilePath()
  if (existsSync(path)) rmSync(path, { force: true })
}
