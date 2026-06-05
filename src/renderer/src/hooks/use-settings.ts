import { useEffect, useState } from 'react'
import { Settings as SettingsType, DEFAULT_SETTINGS } from '@shared/types'
import { api } from '../api'

export function useSettings(): { settings: SettingsType } {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS)
  useEffect(() => { api.getSettings().then(setSettings) }, [])
  return { settings }
}
