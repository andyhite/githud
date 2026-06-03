import { useEffect, useState } from 'react'
import { Settings as SettingsType, DEFAULT_SETTINGS, FeedEventKind } from '@shared/types'
import { api } from '../api'
import { Toggle, ChipInput, Slider, Segmented } from './inputs'

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

const INTERVAL_PRESETS = [
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '2m', value: 120 },
  { label: '5m', value: 300 }
]

type SectionId = 'general' | 'notifications' | 'filters' | 'connections'
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'filters', label: 'Filters & Team' },
  { id: 'connections', label: 'Connections' }
]

export function Settings({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SectionId>('general')
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS)
  const [token, setToken] = useState('')
  const [tokenLogin, setTokenLogin] = useState<string | undefined>()
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [aiKey, setAiKey] = useState('')
  const [aiConfigured, setAiConfigured] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<string | null>(null)

  useEffect(() => { api.getSettings().then(setSettings) }, [])
  useEffect(() => { api.getAiStatus().then((s) => setAiConfigured(s.hasKey)) }, [])
  useEffect(() => { api.getAuthStatus().then((s) => setTokenLogin(s.login)) }, [])

  const patch = (p: Partial<SettingsType>) => setSettings((s) => ({ ...s, ...p }))

  async function sendTest() {
    const ok = await api.sendTestNotification()
    setTestStatus(
      ok
        ? 'Sent. If nothing appears, enable notifications for this app in System Settings → Notifications.'
        : 'This platform reports no notification support.'
    )
  }

  async function save() {
    // Validate + persist a new GitHub token first (it also restarts polling). If
    // GitHub rejects it, keep the panel open (on the Connections section so the
    // error is visible) so nothing else silently saves.
    if (token.trim()) {
      const res = await api.saveToken(token.trim())
      if (!res.ok) { setTokenError(res.error ?? 'GitHub rejected the token.'); setSection('connections'); return }
    }
    await api.saveSettings(settings)
    if (aiKey.trim()) {
      const res = await api.saveAiKey(aiKey.trim())
      if (!res.ok) { setAiError(res.error ?? 'Anthropic rejected the key.'); setSection('connections'); return }
    }
    onClose()
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <header className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" aria-label="Close settings" onClick={onClose}>×</button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" role="tablist" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={section === s.id}
                className={section === s.id ? 'nav-item active' : 'nav-item'}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="settings-section" role="tabpanel">
            {section === 'general' && (
              <>
                <Segmented
                  label="Refresh interval"
                  value={settings.refreshIntervalSeconds}
                  options={INTERVAL_PRESETS}
                  onChange={(v) => patch({ refreshIntervalSeconds: v })}
                  formatCustom={(v) => `${v}s`}
                />
                <p className="field-help">How often githud polls GitHub. The adaptive loop only ever backs off from this as your API budget runs low.</p>

                <Slider
                  id="budget"
                  label="API budget"
                  value={settings.apiBudgetPercent}
                  min={10}
                  max={100}
                  step={5}
                  onChange={(v) => patch({ apiBudgetPercent: v })}
                  format={(v) => `${v}%`}
                />
                <p className="field-help">Max share of your hourly GitHub GraphQL budget githud may use before pausing until reset. The rest stays in reserve.</p>

                <div className="field">
                  <label htmlFor="stale">Stale threshold (days)</label>
                  <input
                    id="stale"
                    type="number"
                    min={1}
                    value={settings.staleThresholdDays}
                    onChange={(e) => patch({ staleThresholdDays: Number(e.target.value) || 1 })}
                  />
                </div>

                <Toggle
                  label="Launch at login"
                  checked={settings.launchAtLogin}
                  onChange={(v) => patch({ launchAtLogin: v })}
                />
              </>
            )}

            {section === 'notifications' && (
              <>
                <Toggle
                  label="Enable desktop notifications"
                  checked={settings.notificationsEnabled}
                  onChange={(v) => patch({ notificationsEnabled: v })}
                />

                <fieldset className="settings-group notify-grid" disabled={!settings.notificationsEnabled}>
                  <legend>Notify me about</legend>
                  {NOTIFY_OPTIONS.map(({ kind, label }) => (
                    <label key={kind} className="check">
                      <input
                        type="checkbox"
                        checked={settings.notifyKinds.includes(kind)}
                        onChange={(e) =>
                          patch({
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

                <div className="settings-test-notification">
                  <button type="button" onClick={sendTest}>Send test notification</button>
                  {testStatus && <p className="settings-hint">{testStatus}</p>}
                </div>

                <Toggle
                  label="Quiet hours"
                  checked={settings.quietHours !== null}
                  onChange={(v) => patch({ quietHours: v ? { start: '18:00', end: '09:00' } : null })}
                />
                {settings.quietHours && (
                  <div className="quiet-hours">
                    <input
                      type="time"
                      aria-label="Quiet hours start"
                      value={settings.quietHours.start}
                      onChange={(e) => patch({ quietHours: { ...settings.quietHours!, start: e.target.value } })}
                    />
                    <span>to</span>
                    <input
                      type="time"
                      aria-label="Quiet hours end"
                      value={settings.quietHours.end}
                      onChange={(e) => patch({ quietHours: { ...settings.quietHours!, end: e.target.value } })}
                    />
                  </div>
                )}
              </>
            )}

            {section === 'filters' && (
              <>
                <ChipInput
                  id="authors"
                  label="Excluded authors"
                  values={settings.excludedAuthors}
                  onChange={(v) => patch({ excludedAuthors: v })}
                  placeholder="dependabot[bot], some-user"
                />
                <p className="field-help">Hide PRs, reviews, and activity from these GitHub logins everywhere.</p>

                <ChipInput
                  id="team-labels"
                  label="Team PR labels"
                  values={settings.teamLabels}
                  onChange={(v) => patch({ teamLabels: v })}
                  placeholder="frontend, backend"
                />
                <p className="field-help">Open PRs carrying any of these labels appear in the Team panel. Empty hides the panel.</p>

                <ChipInput
                  id="team-orgs"
                  label="Team organizations"
                  values={settings.teamOrgs}
                  onChange={(v) => patch({ teamOrgs: v })}
                  placeholder="your-org"
                />
                <p className="field-help">Scope the team search to these orgs. Your own repos are always included.</p>
              </>
            )}

            {section === 'connections' && (
              <>
                <div className="field">
                  <label htmlFor="ghtoken">
                    GitHub token {tokenLogin && <span className="muted">(connected as @{tokenLogin})</span>}
                  </label>
                  <input
                    id="ghtoken"
                    type="password"
                    value={token}
                    onChange={(e) => { setToken(e.target.value); setTokenError(null) }}
                    placeholder="ghp_… / github_pat_… (leave blank to keep)"
                  />
                  {tokenError && <p className="error">{tokenError}</p>}
                </div>

                <div className="field">
                  <label htmlFor="aikey">
                    Anthropic API key {aiConfigured && <span className="muted">(configured)</span>}
                  </label>
                  <input
                    id="aikey"
                    type="password"
                    value={aiKey}
                    onChange={(e) => { setAiKey(e.target.value); setAiError(null) }}
                    placeholder={aiConfigured ? '•••••• (leave blank to keep)' : 'sk-ant-…'}
                  />
                  {aiError && <p className="error">{aiError}</p>}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="settings-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
