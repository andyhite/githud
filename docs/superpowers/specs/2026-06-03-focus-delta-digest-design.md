# Focus-driven delta digest — design

## Problem

githud has an opt-in "catch me up" digest: an AI standup over the whole current
dashboard, opened on demand from a modal. It is useful but heavyweight — you ask
for it, and it summarizes everything.

There's a lighter want: when you bring the window back to the foreground after
being away, see at a glance *what changed while you were gone* — without asking,
and without re-reading the full feed.

## Goal

Add a **brief delta digest** that lives in its own pane above the activity feed
and regenerates when the window is focused, summarizing only what changed since
the last time you looked. Keep the existing detailed modal digest as-is.

## Scope

In scope:
- Detect when the app comes to the foreground.
- A pure "events since last focus" delta.
- A terse, single-sentence AI summary of that delta, regenerated on focus only
  when there is a delta.
- An always-visible inline pane (when an AI key is configured) rendering it.

Out of scope / unchanged:
- The detailed modal "catch me up" (full-snapshot digest) — kept verbatim,
  including the "catch me up" link and the ⌘K command.
- The 30s poll loop, notifier, tray/dock badge, AI key gating, CSP.

## Two digests, coexisting

| | Detailed digest (existing) | Brief delta digest (new) |
|---|---|---|
| Content | Full current dashboard | What changed since last focus |
| Length | Up to ~8 bullets | One dense sentence |
| Trigger | On demand (link / ⌘K) | Window focus |
| Surface | Modal overlay | Inline pane above activity |
| Token spend | Per request (fingerprint-cached) | Only when there's a delta |

## Foreground detection

In `index.ts`, wire a single coalesced `onForeground()` handler to:
- `win.on('focus')` — cross-platform window focus.
- `app.on('did-become-active')` on macOS — catches ⌘-Tab App-Switcher
  activations that window focus alone misses.

These can double-fire within a few hundred ms on macOS, so the handler coalesces
(a short time guard) to avoid redundant work.

The badge is **not** cleared on focus — it reflects the needs-review count, not
an unread indicator, so clearing it would be wrong.

`onForeground()`:
1. Triggers the existing refresh path so the snapshot reflects current state.
2. On that refresh resolving (or immediately from `lastSnapshot` if it fails),
   runs the delta-digest step.

## Delta semantics

Track a single `lastFocusAt: string` in main, initialized to app-start time.

On focus: `newEvents = eventsSince(snapshot.events, lastFocusAt)`.
- **Empty** → no Claude call, no token spend; the pane keeps showing the last
  digest. (This is the "still use the cache" behavior — nothing changed, nothing
  regenerates.)
- **Non-empty** → `buildDeltaDigest(...)`, push to the renderer, then advance
  `lastFocusAt = now`.

The event feed is already the diff stream (`derive-events`), so "what changed" is
just a timestamp filter over it — no extra persistence, no snapshot-diffing.

Cold start: the very first focus / initial mount has no meaningful `lastFocusAt`
window, so the pane seeds from the existing full `getDigest()` (detailed mode)
until the first real focus delta arrives.

## Components

**Pure logic (TDD, Vitest):**
- `eventsSince(events, sinceAt)` → events newer than `sinceAt`. Lives with the
  digest module.
- `deltaPayload(snap, sinceAt)` → `{ newEvents, context }` where context is the
  affected PRs (light grounding for the model). Shape only is tested.

**Glue (manual smoke test, per existing AI conventions):**
- `buildDeltaDigest(client, snap, sinceAt, now)` — one Claude call with a terse
  "since you were away, in one sentence" system prompt. Reuses `AI_MODEL`,
  ephemeral system-prompt caching, `output_config`.
- Focus wiring + `webContents.send('digest', result)` in `index.ts`.

**Contract (`shared/types.ts`):**
- `DigestResult` gains `mode: 'full' | 'delta'`, `coveredSince?: string`,
  `eventCount?: number` (so the pane can render "Since you were away · 3 updates").
- `GithudApi` gains `onDigest(cb)`. Preload exposes it.

**Renderer:**
- `hooks/useDigest.ts` — seeds from `getDigest()` on mount, subscribes to
  `onDigest` pushes (mirrors `useDashboard`).
- `components/DigestPane.tsx` — inline pane in the rail above `ActivityFeed`,
  rendered when `aiOn`: the single-sentence markdown + a header
  (timestamp / event count) + a manual refresh affordance. Opens links through
  the gated `openExternal` like the existing modal.
- The modal `Digest.tsx`, its "catch me up" link, and the ⌘K command are kept.

## Data flow

```
window focus / did-become-active
  -> onForeground() [coalesced]
     -> refresh()  (existing path)
        -> on resolve: newEvents = eventsSince(lastSnapshot.events, lastFocusAt)
           - empty -> noop (pane keeps last digest)
           - non-empty -> buildDeltaDigest() -> webContents.send('digest', r)
                          -> lastFocusAt = now
renderer: useDigest subscribes onDigest -> DigestPane re-renders
```

## Error handling

- No AI key or no snapshot → `onForeground` skips the digest step silently (the
  pane simply isn't shown without a key).
- A failed Claude call → leave the previous digest in place; surface nothing
  noisy (consistent with the modal's quiet failure).
- A failed focus refresh → fall back to the current `lastSnapshot` for the delta.

## Testing

- `eventsSince`, `deltaPayload`: Vitest TDD.
- `DigestPane`, `useDigest`: React Testing Library with mocked `window.api`.
- `buildDeltaDigest`, focus wiring: glue — manual smoke test.
