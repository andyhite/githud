import { useEffect, useState } from 'react'
import { Settings as SettingsType, DEFAULT_SETTINGS } from '@shared/types'
import { api } from '../api'

export function useSettings(): { settings: SettingsType; onToggleCharts: () => void } {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS)
  useEffect(() => { api.getSettings().then(setSettings) }, [])
  const onToggleCharts = () => {
    const next = { ...settings, chartsCollapsed: !settings.chartsCollapsed }
    setSettings(next)
    void api.saveSettings(next)
  }
  return { settings, onToggleCharts }
}
