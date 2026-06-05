import { writeFileSync } from 'fs'
import { snapshotFilePath } from './paths'
import { readJsonFile } from './json-file'
import { DashboardSnapshot } from '@shared/types'

export function loadCachedSnapshot(): DashboardSnapshot | null {
  return readJsonFile<DashboardSnapshot | null>(snapshotFilePath(), null)
}

export function cacheSnapshot(snap: DashboardSnapshot): void {
  writeFileSync(snapshotFilePath(), JSON.stringify(snap))
}
