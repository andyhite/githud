import { useEffect, useState } from 'react'
import { Settings as SettingsType, DEFAULT_SETTINGS, FeedEventKind } from '@shared/types'
import { api } from '../api'

const NOTIFY_OPTIONS: { kind: FeedEventKind; label: string }[] = [
  { kind: 'mention', label: 'Mentions' },
  { kind: 'changes_requested', label: 'Changes requested' },
  { kind: 'changes_addressed', label: 'My change request addressed' },
  { kind: 'review_re_requested', label: 'Re-review requested' },
  { kind: 'review_requested', label: 'Review requested' },
  { kind: 'approved', label: 'Approvals' },
  { kind: 'ci_failed', label: 'CI failed' },
  { kind: 'ci_regressed', label: 'CI regressed (was green)' },
  { kind: 'comment', label: 'Comments' },
  { kind: 'merged', label: 'Merged' }
  // review_commented, ci_succeeded, closed intentionally omitted (low-signal)
]

export function Settings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS)
  const [authorsText, setAuthorsText] = useState('')
  const [aiKey, setAiKey] = useState('')
  const [aiConfigured, setAiConfigured] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s)
      setAuthorsText(s.excludedAuthors.join(', '))
    })
  }, [])

  useEffect(() => { api.getAiStatus().then((s) => setAiConfigured(s.hasKey)) }, [])

  async function save() {
    const excludedAuthors = authorsText.split(',').map((a) => a.trim()).filter(Boolean)
    await api.saveSettings({ ...settings, excludedAuthors })
    if (aiKey.trim()) {
      const res = await api.saveAiKey(aiKey.trim())
      if (!res.ok) { setAiError(res.error ?? 'Anthropic rejected the key.'); return } // keep panel open
    }
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

        <fieldset className="settings-group" disabled={!settings.notificationsEnabled}>
          <legend>Notify me about</legend>
          {NOTIFY_OPTIONS.map(({ kind, label }) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={settings.notifyKinds.includes(kind)}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    notifyKinds: e.target.checked
                      ? [...settings.notifyKinds, kind]
                      : settings.notifyKinds.filter((k) => k !== kind)
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>

        <label>
          <input
            type="checkbox"
            checked={settings.quietHours !== null}
            onChange={(e) =>
              setSettings({ ...settings, quietHours: e.target.checked ? { start: '18:00', end: '09:00' } : null })
            }
          />
          Quiet hours
        </label>
        {settings.quietHours && (
          <div className="quiet-hours">
            <input
              type="time"
              aria-label="Quiet hours start"
              value={settings.quietHours.start}
              onChange={(e) => setSettings({ ...settings, quietHours: { ...settings.quietHours!, start: e.target.value } })}
            />
            <span>to</span>
            <input
              type="time"
              aria-label="Quiet hours end"
              value={settings.quietHours.end}
              onChange={(e) => setSettings({ ...settings, quietHours: { ...settings.quietHours!, end: e.target.value } })}
            />
          </div>
        )}

        <label>
          <input
            type="checkbox"
            checked={settings.hideBots}
            onChange={(e) => setSettings({ ...settings, hideBots: e.target.checked })}
          />
          Hide bot authors in activity
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => setSettings({ ...settings, launchAtLogin: e.target.checked })}
          />
          Launch at login
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

        <label htmlFor="aikey">Anthropic API key {aiConfigured && <span className="muted">(configured)</span>}</label>
        <input
          id="aikey"
          type="password"
          value={aiKey}
          onChange={(e) => { setAiKey(e.target.value); setAiError(null) }}
          placeholder={aiConfigured ? '•••••• (leave blank to keep)' : 'sk-ant-…'}
        />
        {aiError && <p className="error">{aiError}</p>}

        <div className="settings-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
