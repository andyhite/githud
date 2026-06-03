# Hide PRs from the dashboard lists — Design

## Problem

PRs sometimes sit in **Needs my review** (or **My open PRs**) that the user wants
gone: a stalled PR the author never closed, or a review requested by accident.
There's no way to dismiss a row. The user wants to hide such PRs, but not
permanently — if the PR comes back to life, it should reappear.

## Behavior

- **Hide** a PR removes it from its list. Hiding captures the PR's current
  `updatedAt`.
- A hidden PR **reappears automatically when it gets new activity** — i.e. its
  `updatedAt` advances past the value captured at hide time.
- A hidden entry is also **dropped automatically** once its PR merges/closes and
  falls out of both lists (it can never reappear, so the entry is dead weight).
- Hiding applies to **both** lists (Needs Review and My Open PRs).
- The user restores a hidden PR via a per-list **`show hidden (N)`** toggle that
  reveals dimmed hidden rows, each with an **unhide** control.

## Persistence

A new `src/main/hidden-store.ts`, mirroring `event-store.ts`, backed by
`hidden.json` in `userData`. A new `hiddenFilePath()` is added to `paths.ts`.

Entry shape:

```ts
interface HiddenPr {
  id: string        // PullRequest.id (GraphQL node id)
  updatedAt: string // PR.updatedAt captured at hide time
}
```

### Pure helpers (TDD'd)

- `resolveHidden(prs: { id: string; updatedAt: string }[], hidden: HiddenPr[])
  → { hiddenIds: string[]; kept: HiddenPr[] }`
  - An entry **stays hidden** iff its PR is still present in `prs` **and**
    `pr.updatedAt <= entry.updatedAt`.
  - Otherwise it is pruned: PR absent → gone (merged/closed/fell out); PR
    `updatedAt` advanced → resurfaced.
  - `hiddenIds` is the live hidden set; `kept` is the pruned list to persist.
- `applyHide(hidden, id, updatedAt) → HiddenPr[]` (upsert).
- `applyUnhide(hidden, id) → HiddenPr[]` (remove).

### fs-backed glue

`loadHidden()`, `saveHidden()`, plus `hidePr(id, updatedAt)` / `unhidePr(id)`
that load, apply, save, and return the list.

## Contract change (`src/shared/types.ts`)

- `DashboardSnapshot` gains `hiddenPrIds: string[]`. The `needsReview` and
  `myPullRequests` arrays remain **full** (they include hidden PRs); the renderer
  partitions them. This keeps the resurface/prune logic in main while letting the
  UI both hide and restore.
- `GithudApi` gains:
  - `hidePr(id: string, updatedAt: string): Promise<DashboardSnapshot>`
  - `unhidePr(id: string): Promise<DashboardSnapshot>`

## Wiring

### Poller (`poller.ts`)

After normalizing both lists, build `{ id, updatedAt }` for every PR across both
lists, call `resolveHidden`, persist `kept`, and set `snapshot.hiddenPrIds`.

### Main IPC (`index.ts`)

`hidePr` / `unhidePr` handlers:
1. Update the store (`hidden-store`).
2. Recompute `hiddenPrIds` against the current `lastSnapshot` via `resolveHidden`
   (no network call).
3. Patch `lastSnapshot.hiddenPrIds`, `cacheSnapshot`, `sendSnapshot`, and return
   the patched snapshot.

This makes hide/unhide instant and offline. No-op guard returns the snapshot
unchanged when `lastSnapshot` is null.

### Renderer

- `App.tsx` passes `hiddenPrIds` and `onHide(pr)` / `onUnhide(id)` to both
  tables. Handlers call the api and `setQueryData` with the returned snapshot
  (the `onSnapshot` push also converges to the same data).
- `NeedsReviewTable` and `MyPullRequestsTable` accept `hiddenIds`, `onHide`,
  `onUnhide`. They partition `items` into visible / hidden and:
  - Add a trailing **actions cell** (no header) with a subtle hide button that
    fades in on `tr:hover`, matching the existing card hover theme.
  - Render a `show hidden (N)` toggle below the table when N > 0; expanded, it
    shows dimmed hidden rows each with an **unhide** control.
- The `<h2>` count badges in `App.tsx` reflect the **visible** count so hidden
  PRs don't inflate them.

### Styling (`styles.css`)

Add the hover-revealed hide/unhide affordance and the hidden-row dimming,
on-theme with the existing `.pr-table` cards.

## Testing

- `hidden-store.test.ts` — `resolveHidden` (keep / resurface-on-activity /
  prune-on-fallout), `applyHide`, `applyUnhide`.
- Extend `PrTables.test.tsx` — hide button removes a row, `show hidden` reveals
  it, unhide restores it, header counts reflect visible-only.

Electron glue (`index.ts`, `poller.ts`) stays unit-test-free per project
convention; validated by the manual smoke test.

## Out of scope (YAGNI)

No settings UI for hidden PRs, no "hide forever" mode, no GraphQL/network
changes, no bulk hide.
