import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync } from 'fs'

const tmp = mkdtempSync(join(tmpdir(), 'githud-settings-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

import { loadSettings, saveSettings } from './settings-store'
import { DEFAULT_SETTINGS } from '@shared/types'
import { settingsFilePath } from './paths'

describe('settings-store', () => {
  beforeEach(() => {
    if (existsSync(settingsFilePath())) rmSync(settingsFilePath(), { force: true })
  })

  it('returns defaults when no file exists', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists and reloads settings', () => {
    const next = { ...DEFAULT_SETTINGS, hideBots: false, excludedAuthors: ['noisybot'] }
    saveSettings(next)
    expect(loadSettings()).toEqual(next)
  })

  it('merges partial/legacy files onto defaults', () => {
    saveSettings({ staleThresholdDays: 5 } as any)
    const loaded = loadSettings()
    expect(loaded.staleThresholdDays).toBe(5)
    expect(loaded.notificationsEnabled).toBe(DEFAULT_SETTINGS.notificationsEnabled)
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })
})
