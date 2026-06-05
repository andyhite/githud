import { writeFileSync, existsSync, rmSync } from 'fs'
import { aiCacheFilePath } from '../paths'
import { readJsonFile } from '../json-file'

export type CacheKind = 'triage' | 'review'

// `headKey` is pr.updatedAt — it advances on new commits, so a cache entry
// auto-invalidates when the PR changes.
export function cacheKey(kind: CacheKind, prId: string, headKey: string): string {
  return `${kind}:${prId}:${headKey}`
}

export function loadCache(): Record<string, unknown> {
  return readJsonFile<Record<string, unknown>>(aiCacheFilePath(), {})
}

export function saveCache(store: Record<string, unknown>): void {
  writeFileSync(aiCacheFilePath(), JSON.stringify(store))
}

export function clearCache(): void {
  const path = aiCacheFilePath()
  if (existsSync(path)) rmSync(path, { force: true })
}
