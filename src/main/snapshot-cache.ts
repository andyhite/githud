import { existsSync, readFileSync, writeFileSync } from 'fs'
import { snapshotFilePath } from './paths'
import { DashboardSnapshot } from '@shared/types'

export function loadCachedSnapshot(): DashboardSnapshot | null {
  const path = snapshotFilePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DashboardSnapshot
  } catch {
    return null
  }
}

export function cacheSnapshot(snap: DashboardSnapshot): void {
  writeFileSync(snapshotFilePath(), JSON.stringify(snap))
}
