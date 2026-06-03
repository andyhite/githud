import { useEffect, useState } from 'react'
import { Settings as SettingsType, DEFAULT_SETTINGS, FeedEventKind } from '@shared/types'
import { api } from '../api'
import { ChipInput } from './ChipInput'
import { useTheme } from './theme-provider'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

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

type SectionId = 'general' | 'notifications' | 'filters' | 'connections' | 'appearance'
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'filters', label: 'Filters & Team' },
  { id: 'connections', label: 'Connections' },
  { id: 'appearance', label: 'Appearance' }
]

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
] as const

const fieldHelp = 'text-sm text-muted-foreground'

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
  const { theme, setTheme } = useTheme()

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

  const intervalIsPreset = INTERVAL_PRESETS.some((o) => o.value === settings.refreshIntervalSeconds)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs
          value={section}
          onValueChange={(v) => setSection(v as SectionId)}
          orientation="vertical"
          className="flex-row gap-0"
        >
          <TabsList variant="line" className="w-44 shrink-0 border-r p-2">
            {SECTIONS.map((s) => (
              <TabsTrigger key={s.id} value={s.id} className="justify-start">
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 max-h-[70vh] overflow-y-auto p-6">
            <TabsContent value="general" className="grid gap-5 mt-0">
              <div className="grid gap-2">
                <Label>Refresh interval</Label>
                <ToggleGroup
                  type="single"
                  value={intervalIsPreset ? String(settings.refreshIntervalSeconds) : ''}
                  onValueChange={(v) => { if (v) patch({ refreshIntervalSeconds: Number(v) }) }}
                  variant="outline"
                  aria-label="Refresh interval"
                >
                  {INTERVAL_PRESETS.map((o) => (
                    <ToggleGroupItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {!intervalIsPreset && (
                  <span className="text-sm text-muted-foreground">{settings.refreshIntervalSeconds}s</span>
                )}
              </div>
              <p className={fieldHelp}>How often githud polls GitHub. The adaptive loop only ever backs off from this as your API budget runs low.</p>

              <div className="grid gap-2">
                <Label htmlFor="budget">
                  API budget <span className="text-muted-foreground font-normal">{settings.apiBudgetPercent}%</span>
                </Label>
                <Slider
                  id="budget"
                  aria-label="API budget"
                  value={[settings.apiBudgetPercent]}
                  min={10}
                  max={100}
                  step={5}
                  onValueChange={([v]) => patch({ apiBudgetPercent: v })}
                />
              </div>
              <p className={fieldHelp}>Max share of your hourly GitHub GraphQL budget githud may use before pausing until reset. The rest stays in reserve.</p>

              <div className="grid gap-2">
                <Label htmlFor="stale">Stale threshold (days)</Label>
                <Input
                  id="stale"
                  type="number"
                  min={1}
                  value={settings.staleThresholdDays}
                  onChange={(e) => patch({ staleThresholdDays: Number(e.target.value) || 1 })}
                />
              </div>

              <Label className="flex items-center gap-2">
                <Switch
                  checked={settings.launchAtLogin}
                  onCheckedChange={(v) => patch({ launchAtLogin: v })}
                />
                Launch at login
              </Label>
            </TabsContent>

            <TabsContent value="notifications" className="grid gap-5 mt-0">
              <Label className="flex items-center gap-2">
                <Switch
                  checked={settings.notificationsEnabled}
                  onCheckedChange={(v) => patch({ notificationsEnabled: v })}
                />
                Enable desktop notifications
              </Label>

              <fieldset className="grid gap-3" disabled={!settings.notificationsEnabled}>
                <legend className="text-sm font-medium mb-1">Notify me about</legend>
                <div className="grid grid-cols-2 gap-3">
                  {NOTIFY_OPTIONS.map(({ kind, label }) => (
                    <Label key={kind} className="flex items-center gap-2 font-normal">
                      <Checkbox
                        checked={settings.notifyKinds.includes(kind)}
                        disabled={!settings.notificationsEnabled}
                        onCheckedChange={(checked) =>
                          patch({
                            notifyKinds: checked
                              ? [...settings.notifyKinds, kind]
                              : settings.notifyKinds.filter((k) => k !== kind)
                          })
                        }
                      />
                      {label}
                    </Label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-2">
                <Button type="button" variant="outline" className="w-fit" onClick={sendTest}>
                  Send test notification
                </Button>
                {testStatus && <p className={fieldHelp}>{testStatus}</p>}
              </div>

              <Label className="flex items-center gap-2">
                <Switch
                  checked={settings.quietHours !== null}
                  onCheckedChange={(v) => patch({ quietHours: v ? { start: '18:00', end: '09:00' } : null })}
                />
                Quiet hours
              </Label>
              {settings.quietHours && (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label="Quiet hours start"
                    className="w-auto"
                    value={settings.quietHours.start}
                    onChange={(e) => patch({ quietHours: { ...settings.quietHours!, start: e.target.value } })}
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="time"
                    aria-label="Quiet hours end"
                    className="w-auto"
                    value={settings.quietHours.end}
                    onChange={(e) => patch({ quietHours: { ...settings.quietHours!, end: e.target.value } })}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="filters" className="grid gap-5 mt-0">
              <div className="grid gap-2">
                <ChipInput
                  id="authors"
                  label="Excluded authors"
                  values={settings.excludedAuthors}
                  onChange={(v) => patch({ excludedAuthors: v })}
                  placeholder="dependabot[bot], some-user"
                />
                <p className={fieldHelp}>Hide PRs, reviews, and activity from these GitHub logins everywhere.</p>
              </div>

              <div className="grid gap-2">
                <ChipInput
                  id="team-labels"
                  label="Team PR labels"
                  values={settings.teamLabels}
                  onChange={(v) => patch({ teamLabels: v })}
                  placeholder="frontend, backend"
                />
                <p className={fieldHelp}>Open PRs carrying any of these labels appear in the Team panel. Empty hides the panel.</p>
              </div>

              <div className="grid gap-2">
                <ChipInput
                  id="team-orgs"
                  label="Team organizations"
                  values={settings.teamOrgs}
                  onChange={(v) => patch({ teamOrgs: v })}
                  placeholder="your-org"
                />
                <p className={fieldHelp}>Scope the team search to these orgs. Your own repos are always included.</p>
              </div>
            </TabsContent>

            <TabsContent value="connections" className="grid gap-5 mt-0">
              <div className="grid gap-2">
                <Label htmlFor="ghtoken">
                  GitHub token {tokenLogin && <span className="text-muted-foreground font-normal">(connected as @{tokenLogin})</span>}
                </Label>
                <Input
                  id="ghtoken"
                  type="password"
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setTokenError(null) }}
                  placeholder="ghp_… / github_pat_… (leave blank to keep)"
                />
                {tokenError && <p className="text-sm text-destructive">{tokenError}</p>}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="aikey">
                  Anthropic API key {aiConfigured && <span className="text-muted-foreground font-normal">(configured)</span>}
                </Label>
                <Input
                  id="aikey"
                  type="password"
                  value={aiKey}
                  onChange={(e) => { setAiKey(e.target.value); setAiError(null) }}
                  placeholder={aiConfigured ? '•••••• (leave blank to keep)' : 'sk-ant-…'}
                />
                {aiError && <p className="text-sm text-destructive">{aiError}</p>}
              </div>
            </TabsContent>

            <TabsContent value="appearance" className="grid gap-5 mt-0">
              <div className="grid gap-2">
                <Label>Theme</Label>
                <ToggleGroup
                  type="single"
                  value={theme}
                  onValueChange={(v) => { if (v) setTheme(v as typeof theme) }}
                  variant="outline"
                  aria-label="Theme"
                >
                  {THEME_OPTIONS.map((o) => (
                    <ToggleGroupItem key={o.value} value={o.value}>
                      {o.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className={fieldHelp}>Match the system appearance or pin githud to light or dark.</p>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
