# Workflow & AI Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn githud from a passive PR dashboard into an active day-job triage tool — better notification control, faster triage (sorting, filtering, keyboard nav), an always-on tray presence, a richer event feed, and an opt-in AI layer that classifies each review's posture and summarizes activity.

**Architecture:** Preserve the existing invariants — read-only, single github.com account, the only thing crossing main↔renderer is `DashboardSnapshot`, all GitHub/AI I/O and secrets live in `main`. New AI work lives in `src/main/ai/`, mirrors the existing token-store/safeStorage pattern for its key, runs **off** the 30s poll loop (on-demand, cached by `PR id + headOid`), and never auto-acts — output is advisory and clearly labeled. UX work is mostly pure renderer logic plus small `Settings`/store extensions.

**Tech Stack:** Electron 42 (main/preload/renderer), React 19 + TanStack Query, TypeScript 6, Vitest + React Testing Library, Octokit (GitHub), `@anthropic-ai/sdk` (new, AI layer only).

---

## Roadmap (three shippable phases)

Each milestone ends green (typecheck + tests + build) and is independently committable/shippable. Do them in order; later phases assume types from `Milestone 0`.

**Phase 1 — Quick wins (no new infra):**
- M0: Shared type additions (foundation for everything below)
- M1: Per-event-type notification filtering + quiet hours
- M2: "Ready to merge" / "needs attention" derived status
- M3: Triage sorting (deterministic)
- M4: Quick filter box
- M5: Copy-to-clipboard quick actions (PR URL + branch)

**Phase 2 — Deeper UX + event model:**
- M6: Snooze (time-boxed hide)
- M7: Tray / dock badge + launch-at-login
- M8: Keyboard navigation + command palette
- M9: Event-model extensions (changes-addressed, review re-requested, CI regression)

**Phase 3 — AI layer (opt-in, requires an Anthropic API key):**
- M10: AI infrastructure (key store, client, diff fetch, on-disk cache)
- M11: Triage verdict (size + risk → posture label) — the headline feature
- M12: "Catch me up" activity digest
- M13: First-pass AI review of the diff
- M14: Secondary AI helpers (thread TL;DR, mention triage, standup generator)

---

## Cross-cutting conventions (apply to every task)

- **TDD:** write the failing test, watch it fail, implement minimally, watch it pass, commit. Pure logic is unit-tested; Electron glue (`index.ts`, `poller.ts`, `ai/client.ts`, tray wiring) is validated by the manual smoke test, per `CLAUDE.md`.
- **`@shared` alias** must already resolve for main/preload/renderer (it does — see `electron.vite.config.ts`). Preload imports `../shared/types` relatively.
- **Component tests** mock `window.api` in `beforeEach`.
- **Verify green before each commit:** `pnpm test` + `pnpm run typecheck`. Run `pnpm run build` at the end of each milestone.
- Commit messages end with the repo's `Co-Authored-By` trailer.

---

## Milestone 0: Shared type additions

All new cross-boundary types live here so later milestones stay consistent. This milestone has no behavior change — it only widens the contract and defaults, which `settings-store.ts` already merges forward-compatibly.

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Extend `FeedEventKind` with the three new kinds (used in M9)**

In `src/shared/types.ts`, replace the `FeedEventKind` union:

```typescript
export type FeedEventKind =
  | 'approved' | 'changes_requested' | 'review_commented'
  | 'comment' | 'mention'
  | 'ci_failed' | 'ci_succeeded' | 'ci_regressed'
  | 'review_requested' | 'review_re_requested' | 'changes_addressed'
  | 'merged' | 'closed'
```

- [ ] **Step 2: Add a `branch` field to `PullRequest` (used in M5)**

In the `PullRequest` interface, add after `repo`:

```typescript
  repo: string // "owner/name"
  branch: string // headRefName, for copy-branch
```

- [ ] **Step 3: Extend `Settings` and `DEFAULT_SETTINGS`**

Replace the `Settings` interface and `DEFAULT_SETTINGS`:

```typescript
export type TriageSort = 'oldest-first' | 'quick-first' | 'risky-first'

export interface Settings {
  staleThresholdDays: number
  notificationsEnabled: boolean
  excludedAuthors: string[]
  hideBots: boolean
  // M1: which event kinds fire a desktop notification (master switch is
  // notificationsEnabled). Empty array = notify on nothing.
  notifyKinds: FeedEventKind[]
  // M1: suppress notifications during this local-time window. null = always on.
  // Times are "HH:MM" 24h local; a window may wrap midnight (start > end).
  quietHours: { start: string; end: string } | null
  // M3: ordering for the Needs-review list.
  triageSort: TriageSort
  // M7: register the app as a macOS login item.
  launchAtLogin: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  staleThresholdDays: 2,
  notificationsEnabled: true,
  excludedAuthors: [],
  hideBots: true,
  // High-signal kinds only, by default — matches the signal-quality goal.
  notifyKinds: ['mention', 'changes_requested', 'ci_failed', 'changes_addressed', 'review_re_requested'],
  quietHours: null,
  triageSort: 'oldest-first',
  launchAtLogin: false
}
```

- [ ] **Step 4: Add AI-layer contract types (used in M10–M14)**

Append to `src/shared/types.ts`:

```typescript
// --- AI layer (Phase 3) ---

export type SizeBucket = 'S' | 'M' | 'L' | 'XL'
export type RiskLevel = 'low' | 'medium' | 'high'
export type TriageLabel = 'quick_approve' | 'careful_read' | 'likely_changes' | 'big_effort'

export interface TriageVerdict {
  prId: string
  headOid: string // cache key: the verdict is valid only for this commit
  label: TriageLabel
  size: SizeBucket
  risk: RiskLevel
  rationale: string // one line, shown on hover
  focusHint: string // "review the auth + retry paths closely"
  generatedAt: string
}

export interface DigestResult {
  markdown: string
  generatedAt: string
}

export interface ReviewFinding {
  severity: 'note' | 'concern' | 'blocker'
  file: string
  line?: number
  note: string
}

export interface ReviewResult {
  prId: string
  headOid: string
  findings: ReviewFinding[]
  summary: string
  generatedAt: string
}

export interface AiStatus {
  hasKey: boolean
}
```

- [ ] **Step 5: Extend `GithudApi` with the new IPC surface**

Replace the `GithudApi` interface, keeping all existing members and adding:

```typescript
export interface GithudApi {
  getSnapshot(): Promise<DashboardSnapshot | null>
  refresh(): Promise<DashboardSnapshot>
  onSnapshot(cb: (snap: DashboardSnapshot) => void): () => void
  getAuthStatus(): Promise<AuthStatus>
  saveToken(token: string): Promise<{ ok: boolean; login?: string; error?: string }>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  openExternal(url: string): Promise<void>
  markRead(id: string): Promise<FeedEvent[]>
  markAllRead(): Promise<FeedEvent[]>
  hidePr(id: string, updatedAt: string): Promise<DashboardSnapshot>
  unhidePr(id: string): Promise<DashboardSnapshot>
  // M6
  snoozePr(id: string, updatedAt: string, until: string): Promise<DashboardSnapshot>
  // M8 (clipboard via main keeps renderer CSP clean)
  copyToClipboard(text: string): Promise<void>
  // M10–M14 (AI; all reject if no key configured)
  getAiStatus(): Promise<AiStatus>
  saveAiKey(key: string): Promise<{ ok: boolean; error?: string }>
  getTriage(prId: string): Promise<TriageVerdict | null>
  getDigest(): Promise<DigestResult>
  getReview(prId: string): Promise<ReviewResult>
}
```

- [ ] **Step 6: Verify typecheck fails where existing code is now incomplete, then fix the obvious gaps**

Run: `pnpm run typecheck`
Expected: errors in `normalize-prs.ts` (missing `branch`) and `preload/index.ts` / `index.ts` (missing API members). These are filled by their owning milestones — for M0, only add `branch: ''` as a temporary default so typecheck passes:

In `src/main/github/normalize-prs.ts`, inside the returned object add:

```typescript
      repo: n.repository?.nameWithOwner ?? '',
      branch: n.headRefName ?? '',
```

(The GraphQL field is wired in M5; `?? ''` keeps it safe until then.)

For preload/index.ts and main/index.ts, the new API members are added in their milestones. To keep M0 self-contained and green, add **stub handlers** that throw "not implemented" — they are replaced in later milestones:

In `src/preload/index.ts`, add to the `api` object:

```typescript
  snoozePr: (id, updatedAt, until) => ipcRenderer.invoke('snoozePr', id, updatedAt, until),
  copyToClipboard: (text) => ipcRenderer.invoke('copyToClipboard', text),
  getAiStatus: () => ipcRenderer.invoke('getAiStatus'),
  saveAiKey: (key) => ipcRenderer.invoke('saveAiKey', key),
  getTriage: (prId) => ipcRenderer.invoke('getTriage', prId),
  getDigest: () => ipcRenderer.invoke('getDigest'),
  getReview: (prId) => ipcRenderer.invoke('getReview', prId)
```

In `src/main/index.ts` `registerIpc()`, add temporary handlers (replaced later):

```typescript
  ipcMain.handle('snoozePr', () => { throw new Error('not implemented') })
  ipcMain.handle('copyToClipboard', () => { throw new Error('not implemented') })
  ipcMain.handle('getAiStatus', () => ({ hasKey: false }))
  ipcMain.handle('saveAiKey', () => { throw new Error('not implemented') })
  ipcMain.handle('getTriage', () => null)
  ipcMain.handle('getDigest', () => { throw new Error('not implemented') })
  ipcMain.handle('getReview', () => { throw new Error('not implemented') })
```

- [ ] **Step 7: Verify green and commit**

Run: `pnpm run typecheck && pnpm test`
Expected: typecheck clean; all existing tests pass.

```bash
git add src/shared/types.ts src/main/github/normalize-prs.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(types): add contract for notifications, snooze, clipboard, and AI layer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 1: Per-event-type notification filtering + quiet hours

**What:** Only fire desktop notifications for the kinds the user opted into, and never during quiet hours. Pure filtering lives in `notifier.ts`; `index.ts` glue passes settings + clock.

**Files:**
- Modify: `src/main/notifier.ts`
- Test: `src/main/notifier.test.ts`
- Modify: `src/main/index.ts` (`fireNotifications`)
- Modify: `src/renderer/src/components/Settings.tsx`
- Test: `src/renderer/src/components/Settings.test.tsx`

- [ ] **Step 1: Write failing tests for the quiet-hours helper and kind filtering**

Append to `src/main/notifier.test.ts`:

```typescript
import { diffSnapshots, isWithinQuietHours } from './notifier'

const OPTS = { notifyKinds: ['approved', 'ci_failed'] as const, now: new Date('2026-06-02T12:00:00'), quietHours: null }

describe('isWithinQuietHours', () => {
  it('is false when no window is set', () => {
    expect(isWithinQuietHours(new Date('2026-06-02T23:00:00'), null)).toBe(false)
  })
  it('matches a same-day window', () => {
    const q = { start: '09:00', end: '17:00' }
    expect(isWithinQuietHours(new Date('2026-06-02T12:00:00'), q)).toBe(true)
    expect(isWithinQuietHours(new Date('2026-06-02T18:00:00'), q)).toBe(false)
  })
  it('matches a window that wraps midnight', () => {
    const q = { start: '18:00', end: '09:00' }
    expect(isWithinQuietHours(new Date('2026-06-02T23:30:00'), q)).toBe(true)
    expect(isWithinQuietHours(new Date('2026-06-02T07:00:00'), q)).toBe(true)
    expect(isWithinQuietHours(new Date('2026-06-02T12:00:00'), q)).toBe(false)
  })
})

describe('diffSnapshots kind filtering + quiet hours', () => {
  it('only notifies for allowed kinds', () => {
    const next = snap([ev('a', { kind: 'approved' }), ev('b', { kind: 'comment', actor: undefined })])
    const specs = diffSnapshots(snap([]), next, { ...OPTS })
    expect(specs.map((s) => s.title)).toEqual(['alice approved'])
  })
  it('fires nothing during quiet hours', () => {
    const next = snap([ev('a', { kind: 'approved' })])
    const specs = diffSnapshots(snap([]), next, { ...OPTS, quietHours: { start: '00:00', end: '23:59' } })
    expect(specs).toEqual([])
  })
})
```

Note: the existing `diffSnapshots` tests call it with 2 args — update them to pass `{ notifyKinds: ['approved','ci_failed','changes_requested'], now: new Date(), quietHours: null }` so they still exercise their kinds.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- notifier`
Expected: FAIL — `isWithinQuietHours` not exported; `diffSnapshots` arity mismatch.

- [ ] **Step 3: Implement filtering + quiet hours in `notifier.ts`**

Replace the `diffSnapshots` signature/body and add the helper:

```typescript
import type { DashboardSnapshot, NotificationSpec, FeedEvent, FeedEventKind } from '@shared/types'

const MAX_NOTIFICATIONS = 5

export function isWithinQuietHours(now: Date, q: { start: string; end: string } | null): boolean {
  if (!q) return false
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number)
    return h * 60 + m
  }
  const mins = now.getHours() * 60 + now.getMinutes()
  const start = toMin(q.start)
  const end = toMin(q.end)
  if (start === end) return false
  return start < end ? mins >= start && mins < end : mins >= start || mins < end
}

export function diffSnapshots(
  prev: DashboardSnapshot | null,
  next: DashboardSnapshot,
  opts: { notifyKinds: FeedEventKind[]; now: Date; quietHours: { start: string; end: string } | null }
): NotificationSpec[] {
  if (!prev) return [] // first poll seeds the baseline; never notify
  if (isWithinQuietHours(opts.now, opts.quietHours)) return []
  const allow = new Set(opts.notifyKinds)
  const prevIds = new Set(prev.events.map((e) => e.id))
  return next.events
    .filter((e) => !prevIds.has(e.id) && allow.has(e.kind))
    .slice(0, MAX_NOTIFICATIONS)
    .map((e) => ({ title: titleFor(e), body: `${e.repo} #${e.number} — ${e.title}`, url: e.url }))
}
```

(Keep the existing `titleFor` function unchanged.)

- [ ] **Step 4: Update `fireNotifications` in `index.ts` to pass settings + clock**

In `src/main/index.ts`, replace the `diffSnapshots(prev, next)` call:

```typescript
function fireNotifications(prev: DashboardSnapshot | null, next: DashboardSnapshot, settings: Settings): void {
  if (!settings.notificationsEnabled || !Notification.isSupported()) return
  const specs = diffSnapshots(prev, next, {
    notifyKinds: settings.notifyKinds,
    now: new Date(),
    quietHours: settings.quietHours
  })
  for (const spec of specs) {
    const n = new Notification({ title: spec.title, body: spec.body })
    if (spec.url && isSafeExternalUrl(spec.url)) n.on('click', () => shell.openExternal(spec.url!))
    n.show()
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- notifier`
Expected: PASS.

- [ ] **Step 6: Add Settings UI for notify-kinds + quiet hours**

In `src/renderer/src/components/Settings.tsx`, add a labelled checkbox group and two time inputs. Define the options near the top of the file:

```typescript
import { Settings as SettingsType, DEFAULT_SETTINGS, FeedEventKind } from '@shared/types'

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
]
```

Inside the panel, after the "Enable desktop notifications" checkbox, add:

```tsx
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
```

- [ ] **Step 7: Add a Settings test for the new controls**

Append to `src/renderer/src/components/Settings.test.tsx` inside the `describe('Settings', ...)`:

```typescript
  it('toggles a notify-kind and enables quiet hours', async () => {
    render(<Settings onClose={() => {}} />)
    const approvals = await screen.findByLabelText(/approvals/i)
    await userEvent.click(approvals) // default off for 'approved'
    await userEvent.click(screen.getByLabelText(/quiet hours/i))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(window.api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyKinds: expect.arrayContaining(['approved']),
        quietHours: { start: '18:00', end: '09:00' }
      })
    )
  })
```

- [ ] **Step 8: Verify green, build, commit**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Expected: all pass; build emits all three processes.

```bash
git add src/main/notifier.ts src/main/notifier.test.ts src/main/index.ts src/renderer/src/components/Settings.tsx src/renderer/src/components/Settings.test.tsx
git commit -m "feat(notifications): per-event-type filtering + quiet hours

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 2: "Ready to merge" / "needs attention" derived status

**What:** A pure classifier over existing `PullRequest` fields, surfaced as a clear status on My PRs.

**Files:**
- Create: `src/renderer/src/components/pr-status.ts`
- Test: `src/renderer/src/components/pr-status.test.ts`
- Modify: `src/renderer/src/components/MyPullRequestsTable.tsx` (`StatusCell`)

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/pr-status.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mergeReadiness } from './pr-status'
import type { PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p', number: 1, title: 't', url: 'u', repo: 'o/r', branch: 'feature',
    author: { login: 'me', avatarUrl: '' }, reviewers: [],
    reviewState: 'none', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'success', passed: 1, failed: 0, total: 1 },
    updatedAt: '2026-06-01T00:00:00Z', isStale: false, isDraft: false, ...over
  }
}

describe('mergeReadiness', () => {
  it('is ready when approved + green + mergeable', () => {
    expect(mergeReadiness(pr({ reviewState: 'approved' }))).toBe('ready')
  })
  it('needs attention on changes requested, failing CI, or conflicts', () => {
    expect(mergeReadiness(pr({ reviewState: 'changes_requested' }))).toBe('needs_attention')
    expect(mergeReadiness(pr({ checks: { state: 'failure', passed: 0, failed: 1, total: 1 } }))).toBe('needs_attention')
    expect(mergeReadiness(pr({ reviewState: 'approved', mergeable: 'conflicting' }))).toBe('needs_attention')
  })
  it('is draft for drafts regardless of state', () => {
    expect(mergeReadiness(pr({ isDraft: true, reviewState: 'approved' }))).toBe('draft')
  })
  it('is waiting_review otherwise', () => {
    expect(mergeReadiness(pr())).toBe('waiting_review')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- pr-status`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pr-status.ts`**

```typescript
import { PullRequest } from '@shared/types'

export type MergeReadiness = 'ready' | 'needs_attention' | 'waiting_review' | 'draft'

export function mergeReadiness(pr: PullRequest): MergeReadiness {
  if (pr.isDraft) return 'draft'
  if (pr.reviewState === 'changes_requested' || pr.checks.state === 'failure' || pr.mergeable === 'conflicting') {
    return 'needs_attention'
  }
  if (pr.reviewState === 'approved' && pr.checks.state === 'success' && pr.mergeable === 'mergeable') {
    return 'ready'
  }
  return 'waiting_review'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- pr-status`
Expected: PASS.

- [ ] **Step 5: Surface "ready to merge" in `StatusCell`**

In `src/renderer/src/components/MyPullRequestsTable.tsx`, replace `StatusCell` so a ready PR shows a distinct badge (other states keep current rendering):

```tsx
import { mergeReadiness } from './pr-status'

function StatusCell({ pr }: { pr: PullRequest }) {
  if (mergeReadiness(pr) === 'ready') {
    return <span className="good">✓ ready to merge</span>
  }
  if (pr.reviewState === 'changes_requested') return <span className="warn">⟳ changes requested</span>
  if (pr.reviewState === 'approved') {
    const mergeNote = pr.mergeable === 'conflicting' ? ' · conflicts' : ''
    return <span className="good">✓ {pr.approvals} approval{pr.approvals === 1 ? '' : 's'}{mergeNote}</span>
  }
  if (pr.isDraft) return <span className="muted">draft</span>
  return <span className="muted">review required</span>
}
```

- [ ] **Step 6: Verify green and commit**

Run: `pnpm test && pnpm run typecheck`
Expected: PASS.

```bash
git add src/renderer/src/components/pr-status.ts src/renderer/src/components/pr-status.test.ts src/renderer/src/components/MyPullRequestsTable.tsx
git commit -m "feat(prs): derive and surface 'ready to merge' status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 3: Triage sorting (deterministic)

**What:** Order Needs-review oldest-waiting-first and My PRs actionable-first. `sortNeedsReview` is extended in M11 to honor AI verdicts; for now it is deterministic.

**Files:**
- Create: `src/renderer/src/components/sort-prs.ts`
- Test: `src/renderer/src/components/sort-prs.test.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/sort-prs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { sortNeedsReview, sortMyPrs } from './sort-prs'
import type { PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p', number: 1, title: 't', url: 'u', repo: 'o/r', branch: 'b',
    author: { login: 'me', avatarUrl: '' }, reviewers: [],
    reviewState: 'none', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'success', passed: 1, failed: 0, total: 1 },
    updatedAt: '2026-06-01T00:00:00Z', isStale: false, isDraft: false, ...over
  }
}

describe('sortNeedsReview', () => {
  it('puts the longest-waiting (oldest updatedAt) first', () => {
    const recent = pr({ id: 'recent', updatedAt: '2026-06-02T00:00:00Z' })
    const old = pr({ id: 'old', updatedAt: '2026-05-30T00:00:00Z' })
    expect(sortNeedsReview([recent, old]).map((p) => p.id)).toEqual(['old', 'recent'])
  })
})

describe('sortMyPrs', () => {
  it('floats actionable PRs above ready/draft', () => {
    const ready = pr({ id: 'ready', reviewState: 'approved' })
    const attention = pr({ id: 'attention', reviewState: 'changes_requested' })
    const draft = pr({ id: 'draft', isDraft: true })
    expect(sortMyPrs([ready, draft, attention]).map((p) => p.id)).toEqual(['attention', 'ready', 'draft'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- sort-prs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sort-prs.ts`**

```typescript
import { PullRequest, TriageSort } from '@shared/types'
import { mergeReadiness, MergeReadiness } from './pr-status'

// Deterministic for now. M11 adds an optional verdict map to honor
// 'quick-first' / 'risky-first'; 'oldest-first' stays the default.
export function sortNeedsReview(prs: PullRequest[], _order: TriageSort = 'oldest-first'): PullRequest[] {
  return [...prs].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
}

const MY_RANK: Record<MergeReadiness, number> = { needs_attention: 0, waiting_review: 1, ready: 2, draft: 3 }

export function sortMyPrs(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => {
    const r = MY_RANK[mergeReadiness(a)] - MY_RANK[mergeReadiness(b)]
    return r !== 0 ? r : Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- sort-prs`
Expected: PASS.

- [ ] **Step 5: Apply sorting in `App.tsx`**

In `src/renderer/src/App.tsx`, import the sorters and sort before passing to the tables:

```tsx
import { sortNeedsReview, sortMyPrs } from './components/sort-prs'
```

Replace the `items` props:

```tsx
              items={sortNeedsReview(snapshot?.needsReview ?? [])}
```
```tsx
              items={sortMyPrs(snapshot?.myPullRequests ?? [])}
```

- [ ] **Step 6: Verify green and commit**

Run: `pnpm test && pnpm run typecheck`
Expected: PASS (existing PrTables tests still pass — sorting is order-only).

```bash
git add src/renderer/src/components/sort-prs.ts src/renderer/src/components/sort-prs.test.ts src/renderer/src/App.tsx
git commit -m "feat(triage): sort needs-review oldest-first, my-PRs actionable-first

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 4: Quick filter box

**What:** A single text box that narrows both PR lists and the activity feed by repo/title/author substring.

**Files:**
- Create: `src/renderer/src/components/match.ts`
- Test: `src/renderer/src/components/match.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/TopBar.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/match.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { matchesPr, matchesEvent } from './match'
import type { PullRequest, FeedEvent } from '@shared/types'

const pr = { repo: 'o/web', title: 'Fix nav', author: { login: 'asmith' } } as PullRequest
const ev = { repo: 'o/api', title: 'Retry', actor: { login: 'bob' } } as FeedEvent

describe('matchesPr', () => {
  it('matches empty query, repo, title, and author case-insensitively', () => {
    expect(matchesPr(pr, '')).toBe(true)
    expect(matchesPr(pr, 'WEB')).toBe(true)
    expect(matchesPr(pr, 'nav')).toBe(true)
    expect(matchesPr(pr, 'asmith')).toBe(true)
    expect(matchesPr(pr, 'nope')).toBe(false)
  })
})

describe('matchesEvent', () => {
  it('matches repo, title, and actor login', () => {
    expect(matchesEvent(ev, 'api')).toBe(true)
    expect(matchesEvent(ev, 'bob')).toBe(true)
    expect(matchesEvent(ev, 'zzz')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- match`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `match.ts`**

```typescript
import { PullRequest, FeedEvent } from '@shared/types'

export function matchesPr(pr: PullRequest, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [pr.repo, pr.title, pr.author.login].some((f) => f.toLowerCase().includes(q))
}

export function matchesEvent(ev: FeedEvent, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [ev.repo, ev.title, ev.actor?.login ?? ''].some((f) => f.toLowerCase().includes(q))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- match`
Expected: PASS.

- [ ] **Step 5: Add the filter input to `TopBar` and thread the query through `App`**

In `TopBar.tsx`, add `query` and `onQueryChange` to the props type and render an input after `.summary`:

```tsx
export function TopBar({
  snapshot, onRefresh, onOpenSettings, isFetching, query, onQueryChange
}: {
  snapshot: DashboardSnapshot | null
  onRefresh: () => void
  onOpenSettings: () => void
  isFetching: boolean
  query: string
  onQueryChange: (q: string) => void
}) {
```

After the `<span className="summary">` line:

```tsx
      <input
        className="filter-input"
        type="search"
        placeholder="Filter…"
        aria-label="Filter"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
```

In `App.tsx`, add `const [query, setQuery] = useState('')`, pass `query`/`onQueryChange={setQuery}` to `TopBar`, and filter each list:

```tsx
import { matchesPr, matchesEvent } from './components/match'
```
```tsx
              items={sortNeedsReview((snapshot?.needsReview ?? []).filter((p) => matchesPr(p, query)))}
```
```tsx
              items={sortMyPrs((snapshot?.myPullRequests ?? []).filter((p) => matchesPr(p, query)))}
```
```tsx
          <ActivityFeed events={(snapshot?.events ?? []).filter((e) => matchesEvent(e, query))} onRead={onRead} loading={loading} />
```

- [ ] **Step 6: Add minimal CSS for the filter input**

In `src/renderer/src/styles.css`, after the `.top-bar .summary` rule:

```css
.top-bar .filter-input { background: var(--bg); border: 1px solid var(--border);
  color: var(--text); border-radius: 7px; padding: 4px 10px; font-size: 13px; width: 180px; }
.top-bar .filter-input:focus { outline: none; border-color: var(--blue); }
```

- [ ] **Step 7: Verify green, build, commit**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Expected: all pass.

```bash
git add src/renderer/src/components/match.ts src/renderer/src/components/match.test.ts src/renderer/src/App.tsx src/renderer/src/components/TopBar.tsx src/renderer/src/styles.css
git commit -m "feat(ui): quick filter box across PR lists and activity feed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 5: Copy-to-clipboard quick actions (PR URL + branch)

**What:** Copy a PR's URL or branch name from its row. Requires wiring `headRefName` through the GraphQL query (M0 already added the `branch` field + safe default) and a clipboard IPC handler in main.

**Files:**
- Modify: `src/main/github/queries.ts`
- Modify: `src/main/github/normalize-prs.test.ts` (add `headRefName` to fixture + assertion)
- Modify: `src/main/index.ts` (replace `copyToClipboard` stub)
- Modify: `src/renderer/src/components/NeedsReviewTable.tsx` (row actions)
- Test: `src/renderer/src/components/PrTables.test.tsx`

- [ ] **Step 1: Add `headRefName` to the GraphQL PR fragment**

In `src/main/github/queries.ts`, inside `PR_FIELDS`, add after `url`:

```
  url
  headRefName
```

- [ ] **Step 2: Write the failing normalize test for `branch`**

In `src/main/github/normalize-prs.test.ts`, add `headRefName: 'feature/x'` to the `prNode` fixture defaults, then add a test:

```typescript
  it('maps the head branch name', () => {
    const [pr] = normalizePullRequests([prNode()], { now, staleThresholdMs: staleMs })
    expect(pr.branch).toBe('feature/x')
  })
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test -- normalize-prs`
Expected: FAIL — `pr.branch` is `''` (the M0 default) because `normalizePullRequests` reads `n.headRefName` but the fixture had none; after adding the fixture field it should map. (If M0's `branch: n.headRefName ?? ''` line is present, adding the fixture field makes it pass — confirm the line exists.)

- [ ] **Step 4: Confirm `normalize-prs.ts` maps the field (added in M0)**

Verify `src/main/github/normalize-prs.ts` contains `branch: n.headRefName ?? '',`. Run: `pnpm test -- normalize-prs` → PASS.

- [ ] **Step 5: Implement the clipboard IPC handler**

In `src/main/index.ts`, add `clipboard` to the electron import and replace the `copyToClipboard` stub:

```typescript
import { app, BrowserWindow, ipcMain, Notification, shell, clipboard } from 'electron'
```
```typescript
  ipcMain.handle('copyToClipboard', (_e, text: string) => { clipboard.writeText(String(text)) })
```

- [ ] **Step 6: Add a copy action to the PR rows**

In `src/renderer/src/components/NeedsReviewTable.tsx`, add a `CopyCell` exported alongside `HideCell` (it's reused by `MyPullRequestsTable`):

```tsx
export function CopyCell({ pr }: { pr: PullRequest }) {
  return (
    <span className="copy-actions">
      <button className="row-action" title="Copy PR link" onClick={() => api.copyToClipboard(pr.url)}>link</button>
      <button className="row-action" title="Copy branch name" onClick={() => api.copyToClipboard(pr.branch)}>branch</button>
    </span>
  )
}
```

Render it in the actions cell of `NeedsReviewTable`'s `row` (before `HideCell`):

```tsx
      <td className="actions"><CopyCell pr={pr} /><HideCell pr={pr} hidden={isHidden} onHide={onHide} onUnhide={onUnhide} /></td>
```

Do the same in `MyPullRequestsTable.tsx` (import `CopyCell` from `./NeedsReviewTable`).

- [ ] **Step 7: Add a test for the copy action**

In `src/renderer/src/components/PrTables.test.tsx`, extend the `beforeEach` mock and add a test:

```typescript
beforeEach(() => { window.api = { openExternal: vi.fn(), copyToClipboard: vi.fn() } as any })
```
```typescript
  it('copies the PR link', async () => {
    render(<NeedsReviewTable items={[pr({ url: 'https://gh/88', branch: 'feat/x' })]} />)
    await userEvent.click(screen.getByRole('button', { name: /copy pr link/i }))
    expect(window.api.copyToClipboard).toHaveBeenCalledWith('https://gh/88')
  })
```

- [ ] **Step 8: Add CSS for the copy buttons**

In `src/renderer/src/styles.css`, add:

```css
.copy-actions { display: inline-flex; gap: 4px; margin-right: 6px; }
```

- [ ] **Step 9: Verify green, build, commit**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Expected: all pass.

```bash
git add src/main/github/queries.ts src/main/github/normalize-prs.test.ts src/main/index.ts src/renderer/src/components/NeedsReviewTable.tsx src/renderer/src/components/MyPullRequestsTable.tsx src/renderer/src/components/PrTables.test.tsx src/renderer/src/styles.css
git commit -m "feat(ui): copy PR link / branch from each row

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 6: Snooze (time-boxed hide)

**What:** Hide a PR until a chosen time, then it resurfaces. Extends `hidden-store` with an optional `snoozeUntil`; `resolveHidden` gains a `now` parameter so expired snoozes prune themselves.

**Files:**
- Modify: `src/shared/types.ts` (none — `HiddenPr` lives in `hidden-store.ts`)
- Modify: `src/main/hidden-store.ts`
- Test: `src/main/hidden-store.test.ts`
- Modify: `src/main/poller.ts` + `src/main/index.ts` (pass `now`; add `snoozePr` handler)
- Create: `src/renderer/src/components/snooze.ts`
- Test: `src/renderer/src/components/snooze.test.ts`
- Modify: `src/renderer/src/components/NeedsReviewTable.tsx` + `MyPullRequestsTable.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write failing `hidden-store` tests for `snoozeUntil` + `now`**

In `src/main/hidden-store.test.ts`, add tests (the existing `resolveHidden` calls also need a `now` arg — update them to pass `Date.parse('2026-06-02T12:00:00Z')`):

```typescript
const NOW = Date.parse('2026-06-02T12:00:00Z')

it('keeps a snoozed PR hidden until its snoozeUntil passes', () => {
  const prs = [{ id: 'p1', updatedAt: '2026-06-01T00:00:00Z' }]
  const future = [{ id: 'p1', updatedAt: '2026-06-01T00:00:00Z', snoozeUntil: '2026-06-02T18:00:00Z' }]
  expect(resolveHidden(prs, future, NOW).hiddenIds).toEqual(['p1'])
  const past = [{ id: 'p1', updatedAt: '2026-06-01T00:00:00Z', snoozeUntil: '2026-06-02T06:00:00Z' }]
  expect(resolveHidden(prs, past, NOW).hiddenIds).toEqual([]) // expired -> resurfaced + pruned
})

it('applySnooze stores the until timestamp', () => {
  expect(applySnooze([], 'p1', '2026-06-01T00:00:00Z', '2026-06-02T18:00:00Z')).toEqual([
    { id: 'p1', updatedAt: '2026-06-01T00:00:00Z', snoozeUntil: '2026-06-02T18:00:00Z' }
  ])
})
```

Add `applySnooze` to the import line of the test.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- hidden-store`
Expected: FAIL — `applySnooze` not exported; `resolveHidden` arity.

- [ ] **Step 3: Implement in `hidden-store.ts`**

```typescript
export interface HiddenPr {
  id: string
  updatedAt: string // PR.updatedAt captured at hide time
  snoozeUntil?: string // if set, the entry is a snooze that expires at this ISO time
}

export function resolveHidden(
  prs: { id: string; updatedAt: string }[],
  hidden: HiddenPr[],
  now: number
): { hiddenIds: string[]; kept: HiddenPr[] } {
  const byId = new Map(prs.map((p) => [p.id, p]))
  const kept = hidden.filter((h) => {
    const pr = byId.get(h.id)
    if (!pr) return false
    if (Date.parse(pr.updatedAt) > Date.parse(h.updatedAt)) return false // resurfaced on new activity
    if (h.snoozeUntil && now >= Date.parse(h.snoozeUntil)) return false // snooze expired
    return true
  })
  return { hiddenIds: kept.map((h) => h.id), kept }
}

export function applySnooze(hidden: HiddenPr[], id: string, updatedAt: string, until: string): HiddenPr[] {
  return [...hidden.filter((h) => h.id !== id), { id, updatedAt, snoozeUntil: until }]
}

export function snoozePr(id: string, updatedAt: string, until: string): HiddenPr[] {
  return saveHidden(applySnooze(loadHidden(), id, updatedAt, until))
}
```

(Keep `applyHide`, `applyUnhide`, `loadHidden`, `saveHidden`, `hidePr`, `unhidePr` as-is.)

- [ ] **Step 4: Pass `now` at the two call sites**

In `src/main/poller.ts`, change the `resolveHidden(...)` call to pass `now`:

```typescript
    const { hiddenIds, kept } = resolveHidden(
      [...needsReview, ...myPullRequests].map((p) => ({ id: p.id, updatedAt: p.updatedAt })),
      loadHidden(),
      now
    )
```

In `src/main/index.ts` `recomputeHidden()`, pass `Date.now()`:

```typescript
  const { hiddenIds } = resolveHidden(
    [...lastSnapshot.needsReview, ...lastSnapshot.myPullRequests].map((p) => ({ id: p.id, updatedAt: p.updatedAt })),
    loadHidden(),
    Date.now()
  )
```

- [ ] **Step 5: Replace the `snoozePr` IPC stub in `index.ts`**

Add `snoozePr as storeSnoozePr` to the hidden-store import, then:

```typescript
  ipcMain.handle('snoozePr', (_e, id: string, updatedAt: string, until: string) => {
    storeSnoozePr(id, updatedAt, until)
    return recomputeHidden() ?? lastSnapshot
  })
```

- [ ] **Step 6: Write the failing `snooze.ts` preset test**

Create `src/renderer/src/components/snooze.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeSnoozeUntil } from './snooze'

const now = new Date('2026-06-02T12:00:00') // a Tuesday, local

describe('computeSnoozeUntil', () => {
  it('1h adds an hour', () => {
    expect(computeSnoozeUntil(now, '1h')).toBe(new Date('2026-06-02T13:00:00').toISOString())
  })
  it('tomorrow is next day at 09:00 local', () => {
    expect(computeSnoozeUntil(now, 'tomorrow')).toBe(new Date('2026-06-03T09:00:00').toISOString())
  })
  it('monday is the next Monday at 09:00 local', () => {
    expect(computeSnoozeUntil(now, 'monday')).toBe(new Date('2026-06-08T09:00:00').toISOString())
  })
})
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm test -- snooze`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `snooze.ts`**

```typescript
export type SnoozePreset = '1h' | 'tomorrow' | 'monday'

export function computeSnoozeUntil(now: Date, preset: SnoozePreset): string {
  const d = new Date(now)
  if (preset === '1h') {
    d.setHours(d.getHours() + 1)
    return d.toISOString()
  }
  d.setHours(9, 0, 0, 0)
  if (preset === 'tomorrow') {
    d.setDate(d.getDate() + 1)
    return d.toISOString()
  }
  // 'monday': advance to the next Monday (1). If today is Monday, go a week out.
  const day = d.getDay() // 0=Sun..6=Sat
  const delta = ((1 - day + 7) % 7) || 7
  d.setDate(d.getDate() + delta)
  return d.toISOString()
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `pnpm test -- snooze`
Expected: PASS.

- [ ] **Step 10: Add a snooze control to the rows**

In `NeedsReviewTable.tsx`, extend `HideProps` with `onSnooze?` and add a `SnoozeCell` (only shown for visible rows):

```tsx
import { computeSnoozeUntil, SnoozePreset } from './snooze'

export interface HideProps {
  hiddenIds?: string[]
  onHide?: (pr: PullRequest) => void
  onUnhide?: (id: string) => void
  onSnooze?: (pr: PullRequest, until: string) => void
}

export function SnoozeCell({ pr, onSnooze }: { pr: PullRequest; onSnooze?: (pr: PullRequest, until: string) => void }) {
  if (!onSnooze) return null
  const snooze = (preset: SnoozePreset) => onSnooze(pr, computeSnoozeUntil(new Date(), preset))
  return (
    <span className="snooze-actions">
      <button className="row-action" title="Snooze 1 hour" onClick={() => snooze('1h')}>1h</button>
      <button className="row-action" title="Snooze until tomorrow 9am" onClick={() => snooze('tomorrow')}>1d</button>
      <button className="row-action" title="Snooze until Monday 9am" onClick={() => snooze('monday')}>wk</button>
    </span>
  )
}
```

Render `<SnoozeCell pr={pr} onSnooze={onSnooze} />` in the actions cell of both tables (only for `!isHidden` rows — guard with `{!isHidden && <SnoozeCell .../>}`). Thread `onSnooze` through both table prop lists.

- [ ] **Step 11: Wire `onSnooze` in `App.tsx`**

```tsx
  const onSnooze = (pr: PullRequest, until: string) => { void api.snoozePr(pr.id, pr.updatedAt, until).then(applySnapshot) }
```

Pass `onSnooze={onSnooze}` to both tables.

- [ ] **Step 12: Verify green, build, commit**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Expected: all pass.

```bash
git add src/main/hidden-store.ts src/main/hidden-store.test.ts src/main/poller.ts src/main/index.ts src/renderer/src/components/snooze.ts src/renderer/src/components/snooze.test.ts src/renderer/src/components/NeedsReviewTable.tsx src/renderer/src/components/MyPullRequestsTable.tsx src/renderer/src/App.tsx
git commit -m "feat(prs): snooze a PR until 1h / tomorrow / next week

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 7: Tray / dock badge + launch-at-login

**What:** A menubar tray showing the visible needs-review count, a macOS dock badge, and an opt-in login item. Tray wiring is glue (no unit test); the count/label math is a tiny tested pure helper.

**Files:**
- Create: `src/main/tray-label.ts`
- Test: `src/main/tray-label.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/components/Settings.tsx` + `Settings.test.tsx`

- [ ] **Step 1: Write the failing test for the label helper**

Create `src/main/tray-label.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { visibleNeedsReviewCount, dockBadge } from './tray-label'
import type { DashboardSnapshot } from '@shared/types'

function snap(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    fetchedAt: 'x', viewer: { login: 'me', avatarUrl: '' },
    needsReview: [], myPullRequests: [], events: [], hiddenPrIds: [],
    rateLimit: { remaining: 0, resetAt: '' }, ...over
  }
}

describe('visibleNeedsReviewCount', () => {
  it('counts needs-review excluding hidden', () => {
    const s = snap({
      needsReview: [{ id: 'a' }, { id: 'b' }] as any,
      hiddenPrIds: ['b']
    })
    expect(visibleNeedsReviewCount(s)).toBe(1)
  })
})

describe('dockBadge', () => {
  it('is empty for zero and the number otherwise', () => {
    expect(dockBadge(0)).toBe('')
    expect(dockBadge(3)).toBe('3')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- tray-label`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tray-label.ts`**

```typescript
import { DashboardSnapshot } from '@shared/types'

export function visibleNeedsReviewCount(snap: DashboardSnapshot): number {
  const hidden = new Set(snap.hiddenPrIds)
  return snap.needsReview.filter((p) => !hidden.has(p.id)).length
}

export function dockBadge(count: number): string {
  return count > 0 ? String(count) : ''
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- tray-label`
Expected: PASS.

- [ ] **Step 5: Wire the tray + dock badge in `index.ts`**

Add to the electron import: `Tray, Menu, nativeImage`. Add module state `let tray: Tray | null = null`. Add a function and call it from `sendSnapshot` (so it updates every poll) and create the tray in `app.whenReady`:

```typescript
import { app, BrowserWindow, ipcMain, Notification, shell, clipboard, Tray, Menu, nativeImage } from 'electron'
import { visibleNeedsReviewCount, dockBadge } from './tray-label'
```
```typescript
let tray: Tray | null = null

function updateTray(snap: DashboardSnapshot | null): void {
  const count = snap ? visibleNeedsReviewCount(snap) : 0
  if (tray) tray.setTitle(count > 0 ? ` ${count}` : '')
  if (process.platform === 'darwin' && app.dock) app.dock.setBadge(dockBadge(count))
}

function createTray(): void {
  if (tray) return
  // Empty image + text title is the lightest cross-platform tray on macOS,
  // avoiding a bundled icon asset; the count rides in the title.
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('githud')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open githud', click: () => { if (mainWindow) mainWindow.show(); else createWindow() } },
      { label: 'Refresh now', click: () => { if (hasToken()) void runPoll() } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
}
```

In `sendSnapshot`, after sending, call `updateTray(snap)`. In `app.whenReady().then(...)`, call `createTray()` right after `createWindow()`.

- [ ] **Step 6: Apply launch-at-login on save and startup**

In `index.ts`, add a helper and call it in `saveSettings` handler and `app.whenReady`:

```typescript
function applyLoginItem(settings: Settings): void {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
  }
}
```

In the `saveSettings` handler:

```typescript
  ipcMain.handle('saveSettings', (_e, settings: Settings): Settings => {
    const saved = saveSettings(settings)
    applyLoginItem(saved)
    void runPoll() // re-apply filters immediately
    return saved
  })
```

In `app.whenReady`, after loading settings/snapshot, call `applyLoginItem(loadSettings())`.

- [ ] **Step 7: Add the launch-at-login checkbox to Settings**

In `Settings.tsx`, add after the notifications fieldset:

```tsx
        <label>
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => setSettings({ ...settings, launchAtLogin: e.target.checked })}
          />
          Launch at login
        </label>
```

Add a `Settings.test.tsx` assertion that toggling it is saved:

```typescript
  it('saves launch-at-login', async () => {
    render(<Settings onClose={() => {}} />)
    await userEvent.click(await screen.findByLabelText(/launch at login/i))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(window.api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ launchAtLogin: true }))
  })
```

- [ ] **Step 8: Verify green, build, commit. Then smoke-test the tray manually.**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Manual: `pnpm run dev` → confirm the menubar shows the count and the dock badge appears when PRs need review.

```bash
git add src/main/tray-label.ts src/main/tray-label.test.ts src/main/index.ts src/renderer/src/components/Settings.tsx src/renderer/src/components/Settings.test.tsx
git commit -m "feat(tray): menubar count + dock badge + launch-at-login

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 8: Keyboard navigation + command palette

**What:** `j`/`k` move a selection through the visible PR rows, `Enter` opens, `e` hides the selected; `⌘K` opens a command palette. The selection math is a tested pure reducer; the wiring is a hook + a small modal.

**Files:**
- Create: `src/renderer/src/hooks/selection.ts` (pure)
- Test: `src/renderer/src/hooks/selection.test.ts`
- Create: `src/renderer/src/components/CommandPalette.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write the failing reducer test**

Create `src/renderer/src/hooks/selection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { moveSelection } from './selection'

describe('moveSelection', () => {
  it('clamps within [0, len)', () => {
    expect(moveSelection(0, 'down', 3)).toBe(1)
    expect(moveSelection(2, 'down', 3)).toBe(2) // no wrap past end
    expect(moveSelection(0, 'up', 3)).toBe(0)
    expect(moveSelection(-1, 'down', 3)).toBe(0) // from unselected, first down selects 0
  })
  it('returns -1 for an empty list', () => {
    expect(moveSelection(0, 'down', 0)).toBe(-1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- selection`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `selection.ts`**

```typescript
export function moveSelection(current: number, dir: 'up' | 'down', len: number): number {
  if (len === 0) return -1
  if (current < 0) return dir === 'down' ? 0 : len - 1
  const next = dir === 'down' ? current + 1 : current - 1
  return Math.max(0, Math.min(len - 1, next))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- selection`
Expected: PASS.

- [ ] **Step 5: Build the command palette component**

Create `src/renderer/src/components/CommandPalette.tsx`:

```tsx
import { useState } from 'react'

export interface Command {
  id: string
  label: string
  run: () => void
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const filtered = commands.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Run a command…"
          aria-label="Command palette"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) { filtered[0].run(); onClose() }
            if (e.key === 'Escape') onClose()
          }}
        />
        <ul className="palette-list">
          {filtered.map((c) => (
            <li key={c.id}>
              <button onClick={() => { c.run(); onClose() }}>{c.label}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Wire global keys + palette into `App.tsx`**

In the `Dashboard` component, add selection + palette state and a key handler over the visible needs-review list (the primary triage queue):

```tsx
import { useEffect, useState } from 'react'
import { moveSelection } from './hooks/selection'
import { CommandPalette, Command } from './components/CommandPalette'
```
```tsx
  const [selected, setSelected] = useState(-1)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const visibleReview = sortNeedsReview((snapshot?.needsReview ?? []).filter((p) => matchesPr(p, query)))
    .filter((p) => !hiddenSet.has(p.id))

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return // don't hijack typing
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); return }
      if (e.key === 'j') setSelected((i) => moveSelection(i, 'down', visibleReview.length))
      if (e.key === 'k') setSelected((i) => moveSelection(i, 'up', visibleReview.length))
      if (e.key === 'Enter' && selected >= 0 && visibleReview[selected]) api.openExternal(visibleReview[selected].url)
      if (e.key === 'e' && selected >= 0 && visibleReview[selected]) onHide(visibleReview[selected])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visibleReview, selected])

  const commands: Command[] = [
    { id: 'refresh', label: 'Refresh now', run: () => refetch() },
    { id: 'settings', label: 'Open settings', run: onOpenSettings },
    { id: 'readall', label: 'Mark all activity read', run: onReadAll }
  ]
```

Render the palette at the end of the returned JSX: `{paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}`.

Pass `selectedId={visibleReview[selected]?.id}` to `NeedsReviewTable` and add a `selectedId?: string` prop there that adds a `row-selected` class to the matching `<tr>`.

- [ ] **Step 7: Add palette + selection CSS**

In `styles.css`:

```css
.palette-overlay { position: fixed; inset: 0; background: #0008; display: flex;
  justify-content: center; align-items: flex-start; padding-top: 12vh; z-index: 50; }
.palette { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  width: 480px; max-width: 90vw; overflow: hidden; }
.palette-input { width: 100%; background: transparent; border: none; border-bottom: 1px solid var(--line);
  color: var(--bright); padding: 12px 14px; font-size: 15px; outline: none; }
.palette-list { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow: auto; }
.palette-list button { width: 100%; text-align: left; background: transparent; border: none;
  color: var(--text); padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 14px; }
.palette-list button:hover { background: var(--line); color: var(--bright); }
.pr-table tr.row-selected td { background: #58a6ff22; }
```

- [ ] **Step 8: Verify green, build, commit**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Expected: all pass. Manually verify `j/k/Enter/e` and `⌘K` in `pnpm run dev`.

```bash
git add src/renderer/src/hooks/selection.ts src/renderer/src/hooks/selection.test.ts src/renderer/src/components/CommandPalette.tsx src/renderer/src/App.tsx src/renderer/src/components/NeedsReviewTable.tsx src/renderer/src/styles.css
git commit -m "feat(ui): keyboard navigation (j/k/Enter/e) + command palette

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 9: Event-model extensions

**What:** Three new derived events: **CI regressed** (green→red), **review re-requested** (you were re-added as a reviewer), and **changes addressed** (a PR you requested changes on got new commits). The `FeedEventKind`s were added in M0.

**Files:**
- Modify: `src/main/github/pr-state.ts` (capture `reviewRequestedLogins`)
- Test: `src/main/github/pr-state.test.ts`
- Modify: `src/main/github/derive-events.ts`
- Test: `src/main/github/derive-events.test.ts`
- Modify: `src/main/notifier.ts` (`titleFor`), `src/renderer/src/components/ActivityFeed.tsx` (`ACTION`), `src/renderer/src/components/icons.tsx` (`KIND_ICON`), `src/renderer/src/components/activity-severity.ts` (+ test)

- [ ] **Step 1: Capture requested-reviewer logins in `PRState`**

In `src/main/github/pr-state.ts`, add `reviewRequestedLogins: string[]` to `PRState`, and in `toPrState` map it from the node (the query already fetches `reviewRequests`):

```typescript
export interface PRState {
  // ...existing fields...
  reviewRequestedLogins: string[]
}
```
```typescript
    reviewRequestedLogins: (node.reviewRequests?.nodes ?? [])
      .map((rr: any) => rr.requestedReviewer?.login)
      .filter(Boolean),
```

- [ ] **Step 2: Write the failing `pr-state` test**

In `pr-state.test.ts`, add `reviewRequests: { nodes: [{ requestedReviewer: { login: 'me', avatarUrl: '' } }] }` to the `node()` fixture, then:

```typescript
  it('captures requested-reviewer logins', () => {
    expect(toPrState(node(), 'review').reviewRequestedLogins).toEqual(['me'])
  })
```

Run `pnpm test -- pr-state` → fails, then passes after Step 1.

- [ ] **Step 3: Write failing `derive-events` tests for the three new kinds**

Add `reviewRequestedLogins: []` to the `pr()` helper defaults in `derive-events.test.ts`, then:

```typescript
it('emits ci_regressed when CI goes green -> red', () => {
  const [e] = deriveEvents([pr({ ciState: 'success' })], [pr({ ciState: 'failure' })], 'me', NOW)
  expect(e).toMatchObject({ kind: 'ci_regressed' })
})

it('emits review_re_requested when the viewer is re-added as a reviewer', () => {
  const before = pr({ id: 'X', source: 'review', reviewRequestedLogins: [] })
  const after = pr({ id: 'X', source: 'review', reviewRequestedLogins: ['me'] })
  const [e] = deriveEvents([before], [after], 'me', NOW)
  expect(e).toMatchObject({ id: 'review_re_requested:X', kind: 'review_re_requested' })
})

it('emits changes_addressed when a PR you blocked gets new commits', () => {
  const before = pr({
    id: 'Y', source: 'review', headOid: 'oid1',
    reviews: [{ id: 'r1', state: 'CHANGES_REQUESTED', authorLogin: 'me', authorAvatarUrl: '', url: 'u', submittedAt: NOW }]
  })
  const after = pr({
    id: 'Y', source: 'review', headOid: 'oid2',
    reviews: [{ id: 'r1', state: 'CHANGES_REQUESTED', authorLogin: 'me', authorAvatarUrl: '', url: 'u', submittedAt: NOW }]
  })
  const kinds = deriveEvents([before], [after], 'me', NOW).map((e) => e.kind)
  expect(kinds).toContain('changes_addressed')
})
```

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm test -- derive-events`
Expected: FAIL.

- [ ] **Step 5: Implement the three derivations in `derive-events.ts`**

Add a helper and extend the per-PR loop. First the helper (top of file):

```typescript
function latestViewerReviewState(reviews: PRState['reviews'], viewerLogin: string): string | undefined {
  const mine = reviews.filter((r) => r.authorLogin.toLowerCase() === viewerLogin.toLowerCase())
  return mine.length ? mine[mine.length - 1].state : undefined
}
```

Replace the CI block, and add re-request + changes-addressed inside the `if (before) { ... }` body:

```typescript
    // CI transition: distinguish a regression (was green) from a first failure.
    if (pr.ciState !== before.ciState && (pr.ciState === 'failure' || pr.ciState === 'success')) {
      const regressed = pr.ciState === 'failure' && before.ciState === 'success'
      const kind: FeedEventKind = pr.ciState === 'failure' ? (regressed ? 'ci_regressed' : 'ci_failed') : 'ci_succeeded'
      events.push({ ...base, id: `ci:${pr.id}:${pr.headOid}:${pr.ciState}`, kind, url: pr.url, createdAt: now, unread: true })
    }

    if (pr.source === 'review') {
      const reAdded =
        viewerLogin &&
        pr.reviewRequestedLogins.map((l) => l.toLowerCase()).includes(viewerLogin.toLowerCase()) &&
        !before.reviewRequestedLogins.map((l) => l.toLowerCase()).includes(viewerLogin.toLowerCase())
      if (reAdded) {
        events.push({ ...base, id: `review_re_requested:${pr.id}`, kind: 'review_re_requested', url: pr.url, createdAt: now, unread: true })
      }

      const blockedBefore = latestViewerReviewState(before.reviews, viewerLogin) === 'CHANGES_REQUESTED'
      if (blockedBefore && pr.headOid !== before.headOid) {
        events.push({ ...base, id: `changes_addressed:${pr.id}:${pr.headOid}`, kind: 'changes_addressed', url: pr.url, createdAt: now, unread: true })
      }
    }
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm test -- derive-events`
Expected: PASS.

- [ ] **Step 7: Add presentation for the new kinds**

In `notifier.ts` `titleFor`, add to the `byKind` record:

```typescript
    ci_regressed: 'CI regressed',
    review_re_requested: 'Re-review requested',
    changes_addressed: who ? `${who} addressed your review` : 'Your change request was addressed',
```

In `ActivityFeed.tsx` `ACTION`:

```typescript
  ci_regressed: 'CI regressed',
  review_re_requested: 're-review requested',
  changes_addressed: 'addressed your review',
```

In `icons.tsx` `KIND_ICON`:

```typescript
  ci_regressed: 'x',
  review_re_requested: 'eye',
  changes_addressed: 'check',
```

In `activity-severity.ts`, add `ci_regressed` to `FAILURE` and `changes_addressed` to `SUCCESS`; `review_re_requested` falls through to `info`. Update `activity-severity.test.ts` accordingly:

```typescript
const FAILURE = new Set<FeedEventKind>(['ci_failed', 'changes_requested', 'ci_regressed'])
const SUCCESS = new Set<FeedEventKind>(['ci_succeeded', 'approved', 'merged', 'changes_addressed'])
```

- [ ] **Step 8: Verify green, build, commit**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Expected: all pass.

```bash
git add src/main/github/pr-state.ts src/main/github/pr-state.test.ts src/main/github/derive-events.ts src/main/github/derive-events.test.ts src/main/notifier.ts src/renderer/src/components/ActivityFeed.tsx src/renderer/src/components/icons.tsx src/renderer/src/components/activity-severity.ts src/renderer/src/components/activity-severity.test.ts
git commit -m "feat(events): CI regression, re-review requested, change-request addressed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Phase 3 — AI layer (opt-in)

> **REQUIRED SUB-SKILL for every Phase 3 task:** Use the `claude-api` skill when writing any `@anthropic-ai/sdk` code — it carries the current model IDs, structured-output syntax (`output_config.format`), prompt-caching rules, and the Opus 4.8 request surface. The code below is correct as of this plan, but re-verify against the skill at execution.

**Design invariants for the whole phase:**
- **Key lives in main**, encrypted via `safeStorage`, exactly like the GitHub PAT (`token-store.ts`). It never crosses into the renderer.
- **Off the poll loop.** Every AI call is on-demand (user clicks / lazy per-visible-PR) and cached on disk keyed by `PR id + headOid` (triage/review) so an unchanged PR is never re-analyzed.
- **Model is `claude-opus-4-8`** (the default; configurable via a constant). Sonnet (`claude-sonnet-4-6`) is a cheaper option the user can opt into — leave a comment at the model constant.
- **Prompt caching** on the system prompt (the rubric) — stable across all PRs, so repeated analyses are cheap.
- **AI output is advisory and labeled**; it never posts to GitHub.

## Milestone 10: AI infrastructure

**Files:**
- Modify: `package.json` (add `@anthropic-ai/sdk`)
- Modify: `src/main/paths.ts`
- Create: `src/main/ai/key-store.ts`
- Test: `src/main/ai/key-store.test.ts` (pure parts only — `safeStorage` is glue)
- Create: `src/main/ai/client.ts`
- Create: `src/main/ai/cache.ts`
- Test: `src/main/ai/cache.test.ts`
- Create: `src/main/github/fetch-diff.ts`
- Modify: `src/main/index.ts` (replace `getAiStatus`/`saveAiKey` stubs)
- Modify: `src/renderer/src/components/Settings.tsx` + `Settings.test.tsx` (key entry)

- [ ] **Step 1: Add the SDK dependency**

Run: `pnpm add @anthropic-ai/sdk`
Expected: `@anthropic-ai/sdk` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Add file paths for the key and cache**

In `src/main/paths.ts`, add:

```typescript
export function aiKeyFilePath(): string {
  return join(app.getPath('userData'), 'ai-key.enc')
}
export function aiCacheFilePath(): string {
  return join(app.getPath('userData'), 'ai-cache.json')
}
```

- [ ] **Step 3: Implement the encrypted key store (mirrors token-store)**

Create `src/main/ai/key-store.ts`:

```typescript
import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { aiKeyFilePath } from '../paths'

export function hasAiKey(): boolean {
  return existsSync(aiKeyFilePath())
}

export function saveAiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available; cannot store the AI key securely.')
  }
  writeFileSync(aiKeyFilePath(), safeStorage.encryptString(key))
}

export function loadAiKey(): string | null {
  const path = aiKeyFilePath()
  if (!existsSync(path)) return null
  try {
    return safeStorage.decryptString(readFileSync(path))
  } catch {
    return null
  }
}

export function clearAiKey(): void {
  const path = aiKeyFilePath()
  if (existsSync(path)) rmSync(path, { force: true })
}
```

(No unit test — `safeStorage` is Electron glue, validated by the smoke test, per `CLAUDE.md`.)

- [ ] **Step 4: Write the failing cache test**

Create `src/main/ai/cache.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { cacheKey, readEntry, writeEntry } from './cache'

describe('cacheKey', () => {
  it('combines kind, prId, and headOid', () => {
    expect(cacheKey('triage', 'PR1', 'oidA')).toBe('triage:PR1:oidA')
  })
})

describe('in-memory entry round-trip', () => {
  it('reads back what was written for a matching key, null otherwise', () => {
    const store: Record<string, unknown> = {}
    writeEntry(store, 'triage:PR1:oidA', { label: 'quick_approve' })
    expect(readEntry(store, 'triage:PR1:oidA')).toEqual({ label: 'quick_approve' })
    expect(readEntry(store, 'triage:PR1:oidB')).toBeNull()
  })
})
```

- [ ] **Step 5: Implement the cache (pure helpers + fs glue)**

Create `src/main/ai/cache.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { aiCacheFilePath } from '../paths'

export type CacheKind = 'triage' | 'review'

export function cacheKey(kind: CacheKind, prId: string, headOid: string): string {
  return `${kind}:${prId}:${headOid}`
}

// --- pure helpers (unit-tested) ---
export function readEntry<T>(store: Record<string, unknown>, key: string): T | null {
  return (store[key] as T) ?? null
}
export function writeEntry(store: Record<string, unknown>, key: string, value: unknown): void {
  store[key] = value
}

// --- fs-backed store (glue) ---
export function loadCache(): Record<string, unknown> {
  const path = aiCacheFilePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}
export function saveCache(store: Record<string, unknown>): void {
  writeFileSync(aiCacheFilePath(), JSON.stringify(store))
}
```

- [ ] **Step 6: Run cache test to verify it passes**

Run: `pnpm test -- cache`
Expected: PASS.

- [ ] **Step 7: Implement the Anthropic client factory + validation**

Create `src/main/ai/client.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'

// Default to the most capable model. Switch to 'claude-sonnet-4-6' here if you
// prefer lower cost/latency for triage — it's a per-call quality/cost tradeoff.
export const AI_MODEL = 'claude-opus-4-8'

export function createAiClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

// Validate a key with a tiny request. Returns true if it authenticates.
export async function validateAiKey(apiKey: string): Promise<boolean> {
  try {
    const client = createAiClient(apiKey)
    await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4,
      messages: [{ role: 'user', content: 'ping' }]
    })
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 8: Implement the diff fetcher**

Create `src/main/github/fetch-diff.ts`:

```typescript
import { Octokit } from 'octokit'

export interface PrDiff {
  additions: number
  deletions: number
  changedFiles: number
  patch: string
  truncated: boolean
}

// Cap the diff we send to the model so a huge PR can't blow the token budget.
const MAX_PATCH_CHARS = 60_000

// repo is "owner/name".
export async function fetchPrDiff(octokit: Octokit, repo: string, number: number): Promise<PrDiff> {
  const [owner, name] = repo.split('/')
  // PR object carries the size stats deterministically (no AI needed).
  const meta: any = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner, repo: name, pull_number: number
  })
  // Diff body for the risk read.
  const diff: any = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner, repo: name, pull_number: number,
    headers: { accept: 'application/vnd.github.diff' }
  })
  const raw = String(diff.data ?? '')
  return {
    additions: meta.data?.additions ?? 0,
    deletions: meta.data?.deletions ?? 0,
    changedFiles: meta.data?.changed_files ?? 0,
    patch: raw.slice(0, MAX_PATCH_CHARS),
    truncated: raw.length > MAX_PATCH_CHARS
  }
}
```

- [ ] **Step 9: Replace the AI-status/key IPC stubs in `index.ts`**

Add imports and replace the two stub handlers (added in M0):

```typescript
import { hasAiKey, saveAiKey as storeAiKey, loadAiKey } from './ai/key-store'
import { validateAiKey } from './ai/client'
```
```typescript
  ipcMain.handle('getAiStatus', () => ({ hasKey: hasAiKey() }))
  ipcMain.handle('saveAiKey', async (_e, key: string) => {
    if (!(await validateAiKey(key))) return { ok: false, error: 'Anthropic rejected the key.' }
    storeAiKey(key)
    return { ok: true }
  })
```

- [ ] **Step 10: Add an API-key field to Settings**

In `Settings.tsx`, load AI status and add a key input that only saves when non-empty (so re-saving settings doesn't clear it). Add to the component:

```tsx
  const [aiKey, setAiKey] = useState('')
  const [aiConfigured, setAiConfigured] = useState(false)
  useEffect(() => { api.getAiStatus().then((s) => setAiConfigured(s.hasKey)) }, [])
```

In `save()`, before `onClose()`:

```tsx
    if (aiKey.trim()) await api.saveAiKey(aiKey.trim())
```

In the panel:

```tsx
        <label htmlFor="aikey">Anthropic API key {aiConfigured && <span className="muted">(configured)</span>}</label>
        <input
          id="aikey"
          type="password"
          value={aiKey}
          onChange={(e) => setAiKey(e.target.value)}
          placeholder={aiConfigured ? '•••••• (leave blank to keep)' : 'sk-ant-…'}
        />
```

Extend the `Settings.test.tsx` `beforeEach` mock with `getAiStatus: vi.fn().mockResolvedValue({ hasKey: false })` and `saveAiKey: vi.fn().mockResolvedValue({ ok: true })`.

- [ ] **Step 11: Verify green, build, commit**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Expected: all pass.

```bash
git add package.json pnpm-lock.yaml src/main/paths.ts src/main/ai/ src/main/github/fetch-diff.ts src/main/index.ts src/renderer/src/components/Settings.tsx src/renderer/src/components/Settings.test.tsx
git commit -m "feat(ai): infrastructure — encrypted key store, client, diff fetch, on-disk cache

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 11: Triage verdict (the headline feature)

**What:** A per-PR posture label — 🟢 quick approve / 🔵 careful read / 🟠 likely needs changes / 🟣 big effort. **Size** is computed deterministically from the diffstat (free); **risk** comes from one cached Claude call over the diff. The verdict is a pure rule combining them.

**Files:**
- Create: `src/main/ai/size.ts` + `size.test.ts`
- Create: `src/main/ai/verdict.ts` + `verdict.test.ts`
- Create: `src/main/ai/triage.ts` (the Claude call — glue)
- Modify: `src/main/index.ts` (replace `getTriage` stub)
- Modify: `src/renderer/src/components/NeedsReviewTable.tsx` (triage chip) + `sort-prs.ts` (verdict-aware sort)
- Modify: `src/renderer/src/App.tsx` (lazy-load verdicts) + `styles.css`

- [ ] **Step 1: Write the failing size test**

Create `src/main/ai/size.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { sizeBucket } from './size'

describe('sizeBucket', () => {
  it('buckets by lines changed and files touched (whichever is larger)', () => {
    expect(sizeBucket({ additions: 5, deletions: 5, changedFiles: 1 })).toBe('S')
    expect(sizeBucket({ additions: 80, deletions: 20, changedFiles: 4 })).toBe('M')
    expect(sizeBucket({ additions: 400, deletions: 100, changedFiles: 12 })).toBe('L')
    expect(sizeBucket({ additions: 2000, deletions: 500, changedFiles: 40 })).toBe('XL')
  })
  it('escalates on file count even when lines are few', () => {
    expect(sizeBucket({ additions: 10, deletions: 0, changedFiles: 25 })).toBe('XL')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- size` → FAIL (module not found).

- [ ] **Step 3: Implement `size.ts`**

```typescript
import { SizeBucket } from '@shared/types'

export function sizeBucket(d: { additions: number; deletions: number; changedFiles: number }): SizeBucket {
  const lines = d.additions + d.deletions
  const byLines: SizeBucket = lines <= 30 ? 'S' : lines <= 150 ? 'M' : lines <= 600 ? 'L' : 'XL'
  const byFiles: SizeBucket = d.changedFiles <= 2 ? 'S' : d.changedFiles <= 8 ? 'M' : d.changedFiles <= 20 ? 'L' : 'XL'
  const order: SizeBucket[] = ['S', 'M', 'L', 'XL']
  return order[Math.max(order.indexOf(byLines), order.indexOf(byFiles))]
}
```

Run: `pnpm test -- size` → PASS.

- [ ] **Step 4: Write the failing verdict test**

Create `src/main/ai/verdict.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { verdictLabel } from './verdict'

describe('verdictLabel', () => {
  it('high risk always means likely_changes', () => {
    expect(verdictLabel('S', 'high')).toBe('likely_changes')
    expect(verdictLabel('XL', 'high')).toBe('likely_changes')
  })
  it('XL (not high risk) means big_effort', () => {
    expect(verdictLabel('XL', 'low')).toBe('big_effort')
    expect(verdictLabel('XL', 'medium')).toBe('big_effort')
  })
  it('low risk + small/medium means quick_approve', () => {
    expect(verdictLabel('S', 'low')).toBe('quick_approve')
    expect(verdictLabel('M', 'low')).toBe('quick_approve')
  })
  it('everything else is careful_read', () => {
    expect(verdictLabel('L', 'low')).toBe('careful_read')
    expect(verdictLabel('M', 'medium')).toBe('careful_read')
  })
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm test -- verdict` → FAIL.

- [ ] **Step 6: Implement `verdict.ts`**

```typescript
import { SizeBucket, RiskLevel, TriageLabel } from '@shared/types'

export function verdictLabel(size: SizeBucket, risk: RiskLevel): TriageLabel {
  if (risk === 'high') return 'likely_changes'
  if (size === 'XL') return 'big_effort'
  if (risk === 'low' && (size === 'S' || size === 'M')) return 'quick_approve'
  return 'careful_read'
}
```

Run: `pnpm test -- verdict` → PASS.

- [ ] **Step 7: Implement the Claude risk call**

Create `src/main/ai/triage.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { RiskLevel, TriageVerdict } from '@shared/types'
import { PrDiff } from '../github/fetch-diff'
import { AI_MODEL } from './client'
import { sizeBucket } from './size'
import { verdictLabel } from './verdict'

const SYSTEM = `You are a senior code reviewer triaging a pull request diff. Judge the RISK that this PR has real problems a reviewer must catch (bugs, missing tests, risky/edge-case-prone changes, security-sensitive touch points). Be calibrated: most small mechanical changes are low risk. Respond ONLY with the requested JSON.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    rationale: { type: 'string', description: 'one sentence' },
    focusHint: { type: 'string', description: 'where to look, one short phrase' }
  },
  required: ['risk', 'rationale', 'focusHint']
} as const

export async function triagePr(
  client: Anthropic,
  prId: string,
  headOid: string,
  title: string,
  diff: PrDiff,
  now: string
): Promise<TriageVerdict> {
  const size = sizeBucket(diff)
  const userText = `PR title: ${title}\nSize: +${diff.additions}/-${diff.deletions} across ${diff.changedFiles} files${diff.truncated ? ' (diff truncated)' : ''}\n\nDiff:\n${diff.patch}`
  const res = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: userText }]
  })
  const text = res.content.find((b: any) => b.type === 'text') as any
  const parsed = JSON.parse(text?.text ?? '{}') as { risk: RiskLevel; rationale: string; focusHint: string }
  return {
    prId, headOid, size, risk: parsed.risk,
    label: verdictLabel(size, parsed.risk),
    rationale: parsed.rationale, focusHint: parsed.focusHint,
    generatedAt: now
  }
}
```

(No unit test for the SDK call — glue. `size`/`verdict` are tested; parsing is exercised by the smoke test.)

- [ ] **Step 8: Wire the `getTriage` IPC handler (on-demand + cached)**

In `index.ts`, replace the `getTriage` stub. It needs the poller's Octokit and the PR's repo/number/headOid — look them up from `lastSnapshot`:

```typescript
import { loadCache, saveCache, cacheKey } from './ai/cache'
import { createAiClient } from './ai/client'
import { triagePr } from './ai/triage'
import { fetchPrDiff } from './github/fetch-diff'
import { toPrState } from './github/pr-state' // only if you need headOid; see note
```
```typescript
  ipcMain.handle('getTriage', async (_e, prId: string): Promise<import('@shared/types').TriageVerdict | null> => {
    const key = loadAiKey()
    if (!key || !lastSnapshot) return null
    const pr = lastSnapshot.needsReview.find((p) => p.id === prId)
    if (!pr) return null
    // headOid identifies the commit; reuse updatedAt as a coarse cache-buster if
    // headOid isn't on PullRequest. (Add headOid to PullRequest + normalize-prs if
    // you want exact commit-keyed caching — recommended; mirrors pr-state.headOid.)
    const headKey = pr.updatedAt
    const cache = loadCache()
    const cached = cache[cacheKey('triage', prId, headKey)]
    if (cached) return cached as import('@shared/types').TriageVerdict
    if (!ensurePoller()) return null
    try {
      const diff = await fetchPrDiff((poller as any).octokit, pr.repo, pr.number)
      const verdict = await triagePr(createAiClient(key), prId, headKey, pr.title, diff, new Date().toISOString())
      cache[cacheKey('triage', prId, headKey)] = verdict
      saveCache(cache)
      return verdict
    } catch {
      return null
    }
  })
```

> **Note on `headOid`:** for exact commit-keyed caching, add `headOid: string` to `PullRequest` (M0-style) and map it in `normalize-prs.ts` from `n.commits?.nodes?.[0]?.commit?.oid`, then use it instead of `pr.updatedAt` above. `updatedAt` is a safe coarse fallback (it advances on new commits) and keeps this milestone self-contained. Also expose the poller's Octokit via a small getter rather than `(poller as any).octokit` if you prefer not to reach into a private field.

- [ ] **Step 9: Render the triage chip and lazy-load verdicts**

In `App.tsx`, hold a verdict map and fetch per visible needs-review PR (only when an AI key is configured):

```tsx
  const [verdicts, setVerdicts] = useState<Record<string, import('@shared/types').TriageVerdict>>({})
  const [aiOn, setAiOn] = useState(false)
  useEffect(() => { api.getAiStatus().then((s) => setAiOn(s.hasKey)) }, [])
  useEffect(() => {
    if (!aiOn) return
    for (const pr of visibleReview) {
      if (verdicts[pr.id]) continue
      api.getTriage(pr.id).then((v) => { if (v) setVerdicts((m) => ({ ...m, [pr.id]: v })) })
    }
  }, [aiOn, visibleReview, verdicts])
```

Pass `verdicts={verdicts}` to `NeedsReviewTable` and render a chip in each row. Add to `NeedsReviewTable`:

```tsx
const TRIAGE_META: Record<string, { cls: string; label: string }> = {
  quick_approve: { cls: 'triage-green', label: 'quick approve' },
  careful_read: { cls: 'triage-blue', label: 'careful read' },
  likely_changes: { cls: 'triage-amber', label: 'likely changes' },
  big_effort: { cls: 'triage-purple', label: 'big effort' }
}

export function TriageChip({ verdict }: { verdict?: import('@shared/types').TriageVerdict }) {
  if (!verdict) return null
  const m = TRIAGE_META[verdict.label]
  return <span className={`triage-chip ${m.cls}`} title={`${verdict.rationale} — focus: ${verdict.focusHint}`}>{m.label}</span>
}
```

Render `<TriageChip verdict={verdicts?.[pr.id]} />` in the PR cell (next to `PrTitleCell`), and thread a `verdicts?: Record<string, TriageVerdict>` prop into `NeedsReviewTable`.

- [ ] **Step 10: Make the needs-review sort verdict-aware**

Extend `sort-prs.ts` `sortNeedsReview` to honor `triageSort` when verdicts are supplied:

```typescript
import { PullRequest, TriageSort, TriageVerdict } from '@shared/types'

const QUICK_RANK = { quick_approve: 0, careful_read: 1, likely_changes: 2, big_effort: 3 }
const RISKY_RANK = { likely_changes: 0, careful_read: 1, big_effort: 2, quick_approve: 3 }

export function sortNeedsReview(
  prs: PullRequest[],
  order: TriageSort = 'oldest-first',
  verdicts: Record<string, TriageVerdict> = {}
): PullRequest[] {
  if (order === 'oldest-first') {
    return [...prs].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
  }
  const rank = order === 'quick-first' ? QUICK_RANK : RISKY_RANK
  const score = (p: PullRequest) => {
    const v = verdicts[p.id]
    return v ? (rank as any)[v.label] ?? 99 : 99 // un-triaged sinks to the bottom
  }
  return [...prs].sort((a, b) => score(a) - score(b) || Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
}
```

Update the `App.tsx` call to `sortNeedsReview(list, settings?.triageSort, verdicts)` (read `triageSort` from settings; default `'oldest-first'`). Update the existing `sort-prs.test.ts` import if the signature change breaks it (the default-arg keeps the 2-arg calls valid). Add a test:

```typescript
it('orders by verdict when quick-first with verdicts supplied', () => {
  const a = pr({ id: 'a', updatedAt: '2026-06-01T00:00:00Z' })
  const b = pr({ id: 'b', updatedAt: '2026-06-02T00:00:00Z' })
  const verdicts = {
    a: { label: 'big_effort' } as any,
    b: { label: 'quick_approve' } as any
  }
  expect(sortNeedsReview([a, b], 'quick-first', verdicts).map((p) => p.id)).toEqual(['b', 'a'])
})
```

- [ ] **Step 11: Add chip CSS**

In `styles.css`:

```css
.triage-chip { font-size: 11px; padding: 1px 7px; border-radius: 9px; margin-left: 8px; white-space: nowrap; }
.triage-chip.triage-green { background: #3fb95022; color: var(--green); }
.triage-chip.triage-blue { background: #58a6ff22; color: var(--blue); }
.triage-chip.triage-amber { background: #d2992222; color: var(--amber); }
.triage-chip.triage-purple { background: #a371f722; color: #a371f7; }
```

- [ ] **Step 12: Add a triage-sort selector to Settings**

In `Settings.tsx`, add a `<select>` bound to `settings.triageSort` with options `oldest-first` / `quick-first` / `risky-first`. (Straightforward; mirror the existing controls.)

- [ ] **Step 13: Verify green, build, commit. Smoke-test with a real key.**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Manual: configure a key in Settings, `pnpm run dev`, confirm chips appear on needs-review rows and the hover shows rationale + focus.

```bash
git add src/main/ai/ src/main/index.ts src/renderer/src/components/NeedsReviewTable.tsx src/renderer/src/components/sort-prs.ts src/renderer/src/components/sort-prs.test.ts src/renderer/src/App.tsx src/renderer/src/components/Settings.tsx src/renderer/src/styles.css
git commit -m "feat(ai): per-PR triage verdict (size + risk -> review posture)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 12: "Catch me up" digest

**What:** A button that turns the current snapshot (events + PR states) into a natural-language standup. Cheap — no diff fetch.

**Files:**
- Create: `src/main/ai/digest.ts`
- Modify: `src/main/index.ts` (replace `getDigest` stub)
- Create: `src/renderer/src/components/Digest.tsx`
- Modify: `src/renderer/src/App.tsx` + `styles.css`

- [ ] **Step 1: Implement the digest call**

Create `src/main/ai/digest.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { DashboardSnapshot, DigestResult } from '@shared/types'
import { AI_MODEL } from './client'

const SYSTEM = `You write a terse "while you were away" standup for an engineer's GitHub dashboard. Group by what needs action vs FYI. Be specific (repo #number, who did what). Markdown, no preamble, max ~8 bullets.`

export async function buildDigest(client: Anthropic, snap: DashboardSnapshot, now: string): Promise<DigestResult> {
  const payload = {
    needsReview: snap.needsReview.map((p) => ({ repo: p.repo, number: p.number, title: p.title, author: p.author.login, checks: p.checks.state })),
    myPullRequests: snap.myPullRequests.map((p) => ({ repo: p.repo, number: p.number, title: p.title, reviewState: p.reviewState, checks: p.checks.state, mergeable: p.mergeable })),
    recentEvents: snap.events.slice(0, 30).map((e) => ({ kind: e.kind, repo: e.repo, number: e.number, who: e.actor?.login, unread: e.unread }))
  }
  const res = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Dashboard state:\n${JSON.stringify(payload)}` }]
  })
  const text = res.content.find((b: any) => b.type === 'text') as any
  return { markdown: text?.text ?? '', generatedAt: now }
}
```

- [ ] **Step 2: Replace the `getDigest` IPC stub**

```typescript
import { buildDigest } from './ai/digest'
```
```typescript
  ipcMain.handle('getDigest', async () => {
    const key = loadAiKey()
    if (!key) throw new Error('No AI key configured')
    if (!lastSnapshot) throw new Error('No data yet')
    return buildDigest(createAiClient(key), lastSnapshot, new Date().toISOString())
  })
```

- [ ] **Step 3: Build the Digest modal**

Create `src/renderer/src/components/Digest.tsx` — a modal that calls `api.getDigest()` on mount, shows a loading state, then renders the returned markdown as preformatted text (no markdown lib needed; render in a `<pre className="digest-body">`). Include a close button. Reuse the `.settings-overlay` styling pattern.

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api'

export function Digest({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.getDigest().then((d) => setText(d.markdown)).catch((e) => setError(String(e?.message ?? e)))
  }, [])
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Catch me up</h2>
        {error ? <p className="empty">{error}</p> : text === null ? <p className="empty">Thinking…</p> : <pre className="digest-body">{text}</pre>}
        <div className="settings-actions"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire a button + the modal into the dashboard**

In `App.tsx`, add `const [showDigest, setShowDigest] = useState(false)`, a "Catch me up" button (only when `aiOn`) — e.g. in the Activity rail header next to "mark all read" — and render `{showDigest && <Digest onClose={() => setShowDigest(false)} />}`. Add the command `{ id: 'digest', label: 'Catch me up', run: () => setShowDigest(true) }` to the palette commands.

- [ ] **Step 5: Add `.digest-body` CSS**

```css
.digest-body { white-space: pre-wrap; font: 13px/1.6 inherit; color: var(--text); max-height: 60vh; overflow: auto; margin: 0; }
```

- [ ] **Step 6: Verify green, build, commit. Smoke-test.**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Manual: click "Catch me up" → a coherent standup appears.

```bash
git add src/main/ai/digest.ts src/main/index.ts src/renderer/src/components/Digest.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(ai): 'catch me up' activity digest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 13: First-pass AI review of the diff

**What:** On-demand, advisory pre-review of a PR's diff — a list of candidate findings you read before diving in. Highest token cost, so strictly user-triggered and cached by `PR id + headOid`.

**Files:**
- Create: `src/main/ai/review.ts`
- Modify: `src/main/index.ts` (replace `getReview` stub)
- Create: `src/renderer/src/components/ReviewPanel.tsx`
- Modify: `src/renderer/src/components/NeedsReviewTable.tsx` (a "pre-review" row action) + `App.tsx` + `styles.css`

- [ ] **Step 1: Implement the review call**

Create `src/main/ai/review.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { ReviewResult, ReviewFinding } from '@shared/types'
import { PrDiff } from '../github/fetch-diff'
import { AI_MODEL } from './client'

const SYSTEM = `You are doing a first-pass code review of a pull request diff for a senior engineer. Surface concrete candidate issues — bugs, missing tests, unhandled edge cases, risky changes. Be precise and skip style nits. You are advisory only; the human makes the call. Respond ONLY with the requested JSON.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['note', 'concern', 'blocker'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          note: { type: 'string' }
        },
        required: ['severity', 'file', 'note']
      }
    }
  },
  required: ['summary', 'findings']
} as const

export async function reviewPr(
  client: Anthropic, prId: string, headOid: string, title: string, diff: PrDiff, now: string
): Promise<ReviewResult> {
  const res = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `PR: ${title}\n\nDiff${diff.truncated ? ' (truncated)' : ''}:\n${diff.patch}` }]
  })
  const text = res.content.find((b: any) => b.type === 'text') as any
  const parsed = JSON.parse(text?.text ?? '{}') as { summary: string; findings: ReviewFinding[] }
  return { prId, headOid, summary: parsed.summary, findings: parsed.findings ?? [], generatedAt: now }
}
```

- [ ] **Step 2: Replace the `getReview` IPC stub**

Mirror `getTriage`: look up the PR in `lastSnapshot.needsReview` (fall back to `myPullRequests` too — you may want to pre-review your own PRs), check the `review` cache by `PR id + headKey`, fetch the diff, call `reviewPr`, cache, return. Reuse `fetchPrDiff`, `loadCache`/`saveCache`/`cacheKey('review', …)`.

- [ ] **Step 3: Build the ReviewPanel modal**

Create `src/renderer/src/components/ReviewPanel.tsx` — takes `prId` + `onClose`, calls `api.getReview(prId)` on mount, shows loading, then renders `summary` plus each finding as a colored row (severity → class). Mark it clearly as "AI pre-review — advisory". Reuse the overlay pattern.

- [ ] **Step 4: Add a "pre-review" row action and wire the modal**

In `NeedsReviewTable`, add a `row-action` button "pre-review" (only when an AI key is configured — pass an `aiOn` prop) that calls an `onReview(pr.id)` callback. In `App.tsx`, hold `const [reviewId, setReviewId] = useState<string | null>(null)`, pass `onReview={setReviewId}` + `aiOn`, and render `{reviewId && <ReviewPanel prId={reviewId} onClose={() => setReviewId(null)} />}`.

- [ ] **Step 5: Add finding-severity CSS**

```css
.finding { border-left: 3px solid var(--line); padding: 6px 10px; margin: 6px 0; }
.finding.blocker { border-left-color: var(--red); }
.finding.concern { border-left-color: var(--amber); }
.finding.note { border-left-color: var(--blue); }
.finding .finding-loc { color: var(--muted); font-size: 12px; }
```

- [ ] **Step 6: Verify green, build, commit. Smoke-test.**

Run: `pnpm test && pnpm run typecheck && pnpm run build`
Manual: click "pre-review" on a PR → findings render; advisory label present; re-opening is instant (cache hit).

```bash
git add src/main/ai/review.ts src/main/index.ts src/renderer/src/components/ReviewPanel.tsx src/renderer/src/components/NeedsReviewTable.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(ai): first-pass advisory review of a PR diff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 14: Secondary AI helpers (optional, build on demand)

These reuse the Milestone 10 infra (`createAiClient`, `loadAiKey`, the cache, `output_config.format`). Each is a small `src/main/ai/*.ts` + IPC handler + a renderer trigger, following the M12/M13 shapes. Build them when you want them; none blocks the others.

- [ ] **Thread TL;DR** — `src/main/ai/thread.ts`: summarize a PR's `comments` (already in `pr-state`; expose them or re-fetch via REST) into "the open question / what's blocking." IPC `getThreadSummary(prId)`. Trigger: a "summarize discussion" action on PRs with many comments. No diff fetch.
- [ ] **Mention triage** — `src/main/ai/mention.ts`: for a `mention` FeedEvent, fetch the surrounding comment thread, return `{ ask: string; suggestedReply: string }`. IPC `getMentionHelp(eventId)`. Trigger: an action on `mention` rows in the Activity feed; render with a copy-reply button (reuse `copyToClipboard`).
- [ ] **Standup / changelog generator** — `src/main/ai/standup.ts`: from merged-PR lifecycle events over a window, generate a standup/changelog. IPC `getStandup(days)`. Trigger: a command-palette entry. Reuse the `Digest` modal shell.

Each: write the `ai/*.ts` call (system prompt cached, `effort: 'low'` unless it needs reasoning), add the IPC handler guarded by `loadAiKey()`, add the renderer trigger + modal, verify `pnpm test && pnpm run typecheck && pnpm run build`, commit.

---

## Self-Review (completed during planning)

- **Spec coverage:** All nine accepted non-AI items map to M1–M9; the triage taxonomy (quick approve / careful read / likely changes / big effort, with the size-vs-risk split) maps to M11; catch-me-up (B) → M12; first-pass review (C) → M13; the secondary helpers (D/E/F) → M14. Assigned-issues panel intentionally excluded per the user.
- **Type consistency:** `FeedEventKind`, `Settings`, `PullRequest.branch`, `HiddenPr.snoozeUntil`, `TriageVerdict`/`SizeBucket`/`RiskLevel`/`TriageLabel`, `DigestResult`, `ReviewResult`/`ReviewFinding`, and the `GithudApi` additions are all defined in M0 and used consistently downstream. `mergeReadiness` (M2) is reused by `sortMyPrs` (M3). `sizeBucket`/`verdictLabel` (M11) consume the M0 types.
- **Known follow-ups flagged in-plan:** add `PullRequest.headOid` for exact commit-keyed AI caching (M11 uses `updatedAt` as a safe coarse fallback); expose the poller's Octokit via a getter instead of a private-field reach.

