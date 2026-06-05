import { writeFileSync } from 'fs'
import { settingsFilePath } from './paths'
import { readJsonFile } from './json-file'
import { Settings, DEFAULT_SETTINGS } from '@shared/types'

export function loadSettings(): Settings {
  const parsed = readJsonFile<Partial<Settings>>(settingsFilePath(), {})
  return { ...DEFAULT_SETTINGS, ...parsed }
}

export function saveSettings(settings: Settings): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  writeFileSync(settingsFilePath(), JSON.stringify(merged, null, 2))
  return merged
}
