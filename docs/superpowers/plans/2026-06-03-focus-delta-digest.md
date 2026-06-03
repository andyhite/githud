# Focus-driven delta digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a brief, single-sentence "since you were away" digest in its own pane above the activity feed that regenerates when the window is brought to the foreground — only when something actually changed.

**Architecture:** Main detects foreground (`win.on('focus')` + macOS `did-become-active`), refreshes the snapshot, then if the feed has events newer than a tracked `lastFocusAt` it makes one terse Claude call and pushes the result to the renderer via a new `'digest'` channel. The event feed is already the diff stream, so "what changed" is a pure timestamp filter — no extra persistence. The existing detailed modal digest is untouched.

**Tech Stack:** Electron (main IPC + `webContents.send`), `@anthropic-ai/sdk` (`AI_MODEL = claude-opus-4-8`), React + TanStack-style subscription hook, Vitest + React Testing Library.

---

### Task 1: `eventsSince` pure helper

**Files:**
- Modify: `src/main/ai/digest.ts`
- Test: `src/main/ai/digest.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/main/ai/digest.test.ts` (the `pr`/`snap` helpers and imports already exist at the top of the file):

```typescript
import { eventsSince } from './digest'
import type { FeedEvent } from '@shared/types'

function evt(over: Partial<FeedEvent> = {}): FeedEvent {
  return { id: 'e1', kind: 'mention', repo: 'o/r', number: 1, title: 't', url: 'u', createdAt: '2026-06-03T10:00:00Z', unread: true, ...over }
}

describe('eventsSince', () => {
  it('returns only events strictly newer than sinceAt', () => {
    const events = [
      evt({ id: 'old', createdAt: '2026-06-03T09:00:00Z' }),
      evt({ id: 'same', createdAt: '2026-06-03T10:00:00Z' }),
      evt({ id: 'new', createdAt: '2026-06-03T11:00:00Z' })
    ]
    expect(eventsSince(events, '2026-06-03T10:00:00Z').map((e) => e.id)).toEqual(['new'])
  })

  it('returns [] when nothing is newer', () => {
    expect(eventsSince([evt({ createdAt: '2026-06-03T08:00:00Z' })], '2026-06-03T10:00:00Z')).toEqual([])
  })
})
```

> Note: `import { digestFingerprint } from './digest'` already exists at the top of the file — add `eventsSince` to that existing import line rather than duplicating it, and add the `FeedEvent` import if not present.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- digest`
Expected: FAIL — `eventsSince is not a function` (or an import error).

- [ ] **Step 3: Write minimal implementation**

Add to `src/main/ai/digest.ts` (after the imports, near the other exported helpers). Add `FeedEvent` to the existing `@shared/types` import:

```typescript
// Events newer than sinceAt. ISO-8601 strings of identical format compare
// lexicographically == chronologically, so a string > is the whole filter.
export function eventsSince(events: FeedEvent[], sinceAt: string): FeedEvent[] {
  return events.filter((e) => e.createdAt > sinceAt)
}
```

The import line at the top becomes:

```typescript
import { DashboardSnapshot, DigestResult, FeedEvent } from '@shared/types'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- digest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/digest.ts src/main/ai/digest.test.ts
git commit -m "feat(digest): eventsSince — events newer than a timestamp"
```

---

### Task 2: `deltaPayload` pure helper

**Files:**
- Modify: `src/main/ai/digest.ts`
- Test: `src/main/ai/digest.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/main/ai/digest.test.ts`. Add `deltaPayload` to the import from `./digest`:

```typescript
describe('deltaPayload', () => {
  it('includes only events since sinceAt and the PRs they touch', () => {
    const s = snap({
      needsReview: [pr({ repo: 'o/r', number: 7, title: 'Touched' }), pr({ repo: 'o/r', number: 9, title: 'Untouched' })],
      events: [
        evt({ id: 'old', repo: 'o/r', number: 7, createdAt: '2026-06-03T08:00:00Z' }),
        evt({ id: 'new', kind: 'approved', repo: 'o/r', number: 7, createdAt: '2026-06-03T11:00:00Z', actor: { login: 'alice', avatarUrl: '' } })
      ]
    })
    const out = deltaPayload(s, '2026-06-03T10:00:00Z')
    expect(out.newEvents).toEqual([{ kind: 'approved', repo: 'o/r', number: 7, who: 'alice' }])
    expect(out.context).toEqual([{ repo: 'o/r', number: 7, title: 'Touched', checks: 'success' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- digest`
Expected: FAIL — `deltaPayload is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/main/ai/digest.ts`:

```typescript
// The exact data the delta digest reasons over: the new events plus light
// grounding for the PRs those events touch. Pure so it's unit-testable.
export function deltaPayload(snap: DashboardSnapshot, sinceAt: string) {
  const newEvents = eventsSince(snap.events, sinceAt)
  const touched = new Set(newEvents.map((e) => `${e.repo}#${e.number}`))
  const context = [...snap.needsReview, ...snap.myPullRequests]
    .filter((p) => touched.has(`${p.repo}#${p.number}`))
    .map((p) => ({ repo: p.repo, number: p.number, title: p.title, checks: p.checks.state }))
  return {
    newEvents: newEvents.map((e) => ({ kind: e.kind, repo: e.repo, number: e.number, who: e.actor?.login })),
    context
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- digest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/digest.ts src/main/ai/digest.test.ts
git commit -m "feat(digest): deltaPayload — new events + touched-PR context"
```

---

### Task 3: Extend `DigestResult` with a mode

**Files:**
- Modify: `src/shared/types.ts:133-136`
- Modify: `src/main/ai/digest.ts` (existing `buildDigest` return)

- [ ] **Step 1: Extend the type**

Replace the `DigestResult` interface in `src/shared/types.ts` (currently lines 133-136):

```typescript
export interface DigestResult {
  markdown: string
  generatedAt: string
  mode: 'full' | 'delta'
  // delta-only metadata (the window the sentence covers + how many events)
  coveredSince?: string
  eventCount?: number
}
```

- [ ] **Step 2: Tag the existing full digest**

In `src/main/ai/digest.ts`, the existing `buildDigest` return must now set `mode`. Change its final return:

```typescript
  return { markdown: textBlock?.text ?? '', generatedAt: now, mode: 'full' }
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS (no errors). The renderer modal `Digest.tsx` only reads `.markdown`, so it is unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/ai/digest.ts
git commit -m "feat(types): DigestResult gains mode + delta metadata"
```

---

### Task 4: `buildDeltaDigest` (Claude call — glue)

**Files:**
- Modify: `src/main/ai/digest.ts`

- [ ] **Step 1: Add the terse system prompt and builder**

Add to `src/main/ai/digest.ts` (below `buildDigest`). This mirrors `buildDigest`'s SDK shape — the `as any` casts on `messages.create` and `system[].cache_control` are intentional and must stay (see CLAUDE.md "Structured output"):

```typescript
const DELTA_SYSTEM = `You summarize what changed on an engineer's GitHub dashboard since they last looked, in ONE dense sentence. No preamble, no bullets, no markdown headers. Be specific: name the repo #number and who acted. Group naturally (e.g. "alice approved o/web #88 and CI went green on o/api #12"). Max ~35 words.`

export async function buildDeltaDigest(
  client: Anthropic,
  snap: DashboardSnapshot,
  sinceAt: string,
  now: string
): Promise<DigestResult> {
  const payload = deltaPayload(snap, sinceAt)
  const res: any = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 256,
    system: [{ type: 'text', text: DELTA_SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Changes since the user was away:\n${JSON.stringify(payload)}` }]
  } as any)
  const textBlock = res.content.find((b: any) => b.type === 'text')
  return {
    markdown: textBlock?.text ?? '',
    generatedAt: now,
    mode: 'delta',
    coveredSince: sinceAt,
    eventCount: payload.newEvents.length
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/ai/digest.ts
git commit -m "feat(digest): buildDeltaDigest — one-sentence since-last-focus summary"
```

---

### Task 5: Add `onDigest` to the contract + preload

**Files:**
- Modify: `src/shared/types.ts` (the `GithudApi` interface, near `onSnapshot` at line ~161)
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Extend `GithudApi`**

In `src/shared/types.ts`, inside `interface GithudApi`, add a line right after `onSnapshot(...)`:

```typescript
  onDigest(cb: (digest: DigestResult) => void): () => void
```

- [ ] **Step 2: Implement it in preload**

In `src/preload/index.ts`, add to the `api` object (mirroring `onSnapshot`). Note preload imports types from `../shared/types`; add `DigestResult` to that import:

```typescript
  onDigest: (cb) => {
    const listener = (_e: unknown, digest: DigestResult) => cb(digest)
    ipcRenderer.on('digest', listener)
    return () => ipcRenderer.removeListener('digest', listener)
  },
```

The preload import line becomes:

```typescript
import type { GithudApi, DashboardSnapshot, Settings, DigestResult } from '../shared/types'
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts
git commit -m "feat(ipc): onDigest push channel for the delta digest"
```

---

### Task 6: Foreground wiring in main

**Files:**
- Modify: `src/main/index.ts` — import (line 13), state (near line 37), `createWindow` focus handler (line 86), `app.whenReady` (near line 366), and two new functions.

- [ ] **Step 1: Extend the digest import**

Change line 13 of `src/main/index.ts`:

```typescript
import { buildDigest, digestFingerprint, eventsSince, buildDeltaDigest } from './ai/digest'
```

- [ ] **Step 2: Add focus-tracking state**

After line 37 (`let baselineSeeded = false`), add:

```typescript
// Brief delta-digest state. lastFocusAt marks the start of the current "away"
// window; it advances only after a delta digest is generated. digestInFlight
// coalesces the win-focus / did-become-active double-fire on macOS.
let lastFocusAt = new Date().toISOString()
let digestInFlight = false
```

- [ ] **Step 3: Add the delta-digest generator and foreground handler**

Add these two functions after `sendSnapshot` (after line 44):

```typescript
// Generate the brief "since you were away" digest if the feed has anything new
// since lastFocusAt. No new events -> no Claude call, no token spend, and the
// renderer keeps showing its last digest. Quietly no-ops without an AI key.
async function maybeGenerateDeltaDigest(): Promise<void> {
  if (digestInFlight) return
  const key = loadAiKey()
  if (!key || !lastSnapshot) return
  const since = lastFocusAt
  if (eventsSince(lastSnapshot.events, since).length === 0) return
  digestInFlight = true
  try {
    const result = await buildDeltaDigest(createAiClient(key), lastSnapshot, since, new Date().toISOString())
    lastFocusAt = new Date().toISOString()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('digest', result)
  } catch (err: any) {
    console.error('[digest] delta refresh failed:', err?.message ?? err)
  } finally {
    digestInFlight = false
  }
}

// App brought to the foreground: refresh so the delta reflects current state,
// then regenerate the brief digest. Does NOT clear the tray/dock badge (that
// reflects the needs-review count, not unread).
function onForeground(): void {
  if (!hasToken()) return
  void runPoll().then(() => maybeGenerateDeltaDigest())
}
```

- [ ] **Step 4: Wire the window focus handler**

Replace line 86:

```typescript
  mainWindow.on('focus', () => { if (hasToken()) void runPoll() })
```

with:

```typescript
  mainWindow.on('focus', onForeground)
```

- [ ] **Step 5: Wire the macOS activation handler**

In `app.whenReady().then(...)`, alongside the existing `app.on('activate', ...)` (line 366), add:

```typescript
  // macOS: did-become-active also fires on ⌘-Tab App-Switcher activations that
  // window 'focus' alone can miss. onForeground coalesces the overlap.
  if (process.platform === 'darwin') app.on('did-become-active', onForeground)
```

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): regenerate the delta digest on foreground"
```

---

### Task 7: `DigestPane` presentational component

**Files:**
- Create: `src/renderer/src/components/DigestPane.tsx`
- Test: `src/renderer/src/components/DigestPane.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/DigestPane.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DigestPane } from './DigestPane'
import type { DigestResult } from '@shared/types'

describe('DigestPane', () => {
  it('renders the delta sentence when present', () => {
    const d: DigestResult = { markdown: 'alice approved o/web #88; CI went green on o/api #12', generatedAt: 'x', mode: 'delta', eventCount: 2 }
    render(<DigestPane digest={d} />)
    expect(screen.getByText(/alice approved o\/web #88/)).toBeInTheDocument()
  })

  it('shows a caught-up state when there is no digest', () => {
    render(<DigestPane digest={null} />)
    expect(screen.getByText(/caught up/i)).toBeInTheDocument()
  })

  it('shows a caught-up state when the digest text is empty', () => {
    render(<DigestPane digest={{ markdown: '', generatedAt: 'x', mode: 'delta' }} />)
    expect(screen.getByText(/caught up/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- DigestPane`
Expected: FAIL — cannot find module `./DigestPane`.

- [ ] **Step 3: Write the component**

Create `src/renderer/src/components/DigestPane.tsx`. Plain text by design — the prompt forbids markdown, and keeping it text avoids a markdown dependency for one sentence:

```tsx
import type { DigestResult } from '@shared/types'

export function DigestPane({ digest }: { digest: DigestResult | null }) {
  const text = digest?.markdown?.trim()
  return (
    <div className="digest-pane">
      {text ? (
        <>
          <p className="digest-sentence">{text}</p>
          <span className="digest-meta">since you were away</span>
        </>
      ) : (
        <p className="digest-sentence empty">You're all caught up.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- DigestPane`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DigestPane.tsx src/renderer/src/components/DigestPane.test.tsx
git commit -m "feat(ui): DigestPane — brief since-you-were-away sentence"
```

---

### Task 8: `useDigest` hook (glue)

**Files:**
- Create: `src/renderer/src/hooks/useDigest.ts`

- [ ] **Step 1: Write the hook**

Create `src/renderer/src/hooks/useDigest.ts`. It is pure subscription glue (no `getDigest` seed — the brief pane is focus-driven, so it starts empty and fills when the first foreground delta arrives):

```typescript
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { DigestResult } from '@shared/types'

// Subscribes to main's 'digest' push channel. Returns the latest brief delta
// digest, or null until the first foreground refresh produces one.
export function useDigest(enabled: boolean): DigestResult | null {
  const [digest, setDigest] = useState<DigestResult | null>(null)
  useEffect(() => {
    if (!enabled) return
    return api.onDigest((d) => setDigest(d))
  }, [enabled])
  return digest
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useDigest.ts
git commit -m "feat(ui): useDigest — subscribe to the delta-digest push"
```

---

### Task 9: Mount the pane in App + styles

**Files:**
- Modify: `src/renderer/src/App.tsx` (imports ~line 12, hook call near other hooks, render in the rail at line ~182)
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Import the pane and hook**

In `src/renderer/src/App.tsx`, near the existing component imports (around line 12, by `import { Digest } from './components/Digest'`), add:

```typescript
import { DigestPane } from './components/DigestPane'
import { useDigest } from './hooks/useDigest'
```

- [ ] **Step 2: Call the hook**

In the `App` component body, near the other hooks/derived values (anywhere `aiOn` is already in scope), add:

```typescript
  const digest = useDigest(aiOn)
```

> If `aiOn` is declared after this point, place the `useDigest(aiOn)` line below `aiOn`'s declaration. `aiOn` is already used in the rail header (line ~180), so it exists in this scope.

- [ ] **Step 3: Render the pane above the activity feed**

In the rail `<aside className="rail panel">`, between the closing `</h2>` (line ~182) and `<ActivityFeed ... />` (line ~183), add:

```tsx
          {aiOn && <DigestPane digest={digest} />}
```

Resulting region:

```tsx
            {unread > 0 && <button className="link-button" onClick={onReadAll}>mark all read</button>}
          </h2>
          {aiOn && <DigestPane digest={digest} />}
          <ActivityFeed events={snapshot?.events ?? []} onRead={onRead} loading={loading} />
```

- [ ] **Step 4: Add styles**

Append to `src/renderer/src/styles.css`:

```css
.digest-pane {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 8px;
  background: var(--panel-alt, rgba(255, 255, 255, 0.03));
}
.digest-pane .digest-sentence {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
}
.digest-pane .digest-sentence.empty {
  opacity: 0.55;
}
.digest-pane .digest-meta {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.55;
}
```

> The `var(...)` fallbacks make this resilient if those CSS variables aren't defined. Match neighboring custom-property names in `styles.css` if they differ from `--border`/`--panel-alt`.

- [ ] **Step 5: Verify typecheck + tests pass**

Run: `pnpm run typecheck && pnpm test`
Expected: PASS for both.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(ui): mount the delta-digest pane above the activity feed"
```

---

### Task 10: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (Architecture file map + data-flow paragraph)

- [ ] **Step 1: Run the full suite + build**

Run: `pnpm run typecheck && pnpm test && pnpm run build`
Expected: typecheck clean, all Vitest tests pass, build produces `out/` for all three processes. (The `@shared` alias is configured per target in `electron.vite.config.ts`; no new alias work is needed since no new top-level shared module was added.)

- [ ] **Step 2: Update CLAUDE.md**

In the `src/` file map, update the digest line and add the pane/hook. Under `ai/`, change the `digest.ts` description to note the delta path:

```
      digest.ts            # "catch me up" full digest + buildDeltaDigest/eventsSince/deltaPayload (brief since-last-focus delta; eventsSince/deltaPayload are pure/tested)
```

Under `renderer/src/components/`, add `DigestPane.tsx`, and under `hooks/` add `useDigest.ts`:

```
      DigestPane.tsx       # brief "since you were away" pane above the activity feed (focus-driven)
  ...
  hooks/useDigest.ts       # subscribes to main's 'digest' push (brief delta digest)
```

Add a sentence to the AI-layer section noting the new on-focus path:

```
- **Brief delta digest (on focus).** Bringing the window to the foreground (`win.on('focus')` + macOS `did-become-active`) refreshes the snapshot, then — if the feed has events newer than the tracked `lastFocusAt` — makes one terse Claude call (`buildDeltaDigest`) and pushes a one-sentence summary to the renderer via `webContents.send('digest', …)`. No new events → no call, no token spend; the pane keeps its last sentence. The detailed modal digest is unchanged. The badge is NOT cleared on focus.
```

- [ ] **Step 3: Manual smoke test (glue not unit-tested)**

With a GitHub token and an Anthropic key configured, run `pnpm run dev` (interactively, not in an agent context):
1. Confirm the digest pane shows "You're all caught up." on first launch.
2. Switch to another app; have a teammate (or a second account) review/comment on one of your needs-review PRs.
3. Switch back to githud → within a moment the pane should show a single sentence naming the repo/#number and actor.
4. Switch away and back again with no new activity → the sentence stays put and no new Claude call is made (check the dev console for absence of `[digest]` errors and no new request).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the focus-driven delta digest"
```

---

## Self-Review notes

- **Spec coverage:** foreground detection (Task 6), pure delta (Tasks 1-2), terse summary (Task 4), always-shown pane when AI on (Task 9), contract/push (Tasks 3, 5, 8), badge-not-cleared (Task 6 comment + Task 10 docs), detailed modal untouched (no task modifies `Digest.tsx`). Covered.
- **Type consistency:** `eventsSince(events, sinceAt)`, `deltaPayload(snap, sinceAt)`, `buildDeltaDigest(client, snap, sinceAt, now)`, `DigestResult.mode`, `onDigest(cb)`, `useDigest(enabled)`, `DigestPane({ digest })` are used identically across tasks.
- **Cold start:** `lastFocusAt` seeds to app-start; the first focus after launch shows either a real delta (if events arrived since launch) or the caught-up state. No `getDigest` seed for the brief pane by design.
