import { existsSync, readFileSync, writeFileSync } from 'fs'
import { aiCacheFilePath } from '../paths'

export type CacheKind = 'triage' | 'review'

export function cacheKey(kind: CacheKind, prId: string, headOid: string): string {
  return `${kind}:${prId}:${headOid}`
}

// --- pure helpers (unit-tested) ---
export function readEntry<T>(store: Record<string, unknown>, key: string): T | null {
  return (store[key] as T) ?? null
}
export function writeEntry(store: Record<string, unknown>, key: string, value: unknown): void {
  store[key] = value
}

// --- fs-backed store (glue) ---
export function loadCache(): Record<string, unknown> {
  const path = aiCacheFilePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}
export function saveCache(store: Record<string, unknown>): void {
  writeFileSync(aiCacheFilePath(), JSON.stringify(store))
}
