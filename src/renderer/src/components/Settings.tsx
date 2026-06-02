import { useEffect, useState } from 'react'
import { Settings as SettingsType, DEFAULT_SETTINGS } from '@shared/types'
import { api } from '../api'

export function Settings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS)
  const [authorsText, setAuthorsText] = useState('')

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s)
      setAuthorsText(s.excludedAuthors.join(', '))
    })
  }, [])

  async function save() {
    const excludedAuthors = authorsText.split(',').map((a) => a.trim()).filter(Boolean)
    await api.saveSettings({ ...settings, excludedAuthors })
    onClose()
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <h2>Settings</h2>

        <label>
          <input
            type="checkbox"
            checked={settings.notificationsEnabled}
            onChange={(e) => setSettings({ ...settings, notificationsEnabled: e.target.checked })}
          />
          Enable desktop notifications
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.hideBots}
            onChange={(e) => setSettings({ ...settings, hideBots: e.target.checked })}
          />
          Hide bot authors in activity
        </label>

        <label htmlFor="stale">Stale threshold (days)</label>
        <input
          id="stale"
          type="number"
          min={1}
          value={settings.staleThresholdDays}
          onChange={(e) => setSettings({ ...settings, staleThresholdDays: Number(e.target.value) || 1 })}
        />

        <label htmlFor="authors">Excluded authors (comma-separated)</label>
        <input
          id="authors"
          type="text"
          value={authorsText}
          onChange={(e) => setAuthorsText(e.target.value)}
          placeholder="dependabot[bot], some-user"
        />

        <div className="settings-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
