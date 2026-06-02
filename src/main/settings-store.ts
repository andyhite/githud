import { existsSync, readFileSync, writeFileSync } from 'fs'
import { settingsFilePath } from './paths'
import { Settings, DEFAULT_SETTINGS } from '@shared/types'

export function loadSettings(): Settings {
  const path = settingsFilePath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  writeFileSync(settingsFilePath(), JSON.stringify(merged, null, 2))
  return merged
}
