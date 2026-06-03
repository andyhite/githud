# Trend strip — charts above the dashboard — Design

## Problem

The dashboard shows only the *current* state of PRs. There's no sense of
*motion*: is my review backlog growing, am I shipping at a steady rate, is my
work-in-flight piling up, how busy has it been? The user wants a compact strip
of trend charts above the tables to answer those at a glance.

The constraint that shapes everything: the app persists only the **latest
snapshot** plus the **last 100 feed events**. There is no time-series history.
Three of the four wanted charts therefore need a new, small history store that
samples each poll. (We accepted no backfill — charts start empty and fill as the
app runs.)

## Behavior

A single **collapsible row of four KPI cards** sits between `TopBar` and
`NeedsReviewTable`. Each card shows an uppercase label, the big current value, a
delta-vs-last-week (▲/▼/~, color-coded), and a small inline SVG sparkline.

| Card | Current value | Spark | Delta | Source |
|---|---|---|---|---|
| **Review queue** | `needsReview` count | line of daily depth | today vs ~7d ago | history store |
| **Merges / wk** | my PRs merged this week | bars per week | this week vs last week | history store |
| **Open WIP size** | total churn (adds+dels) of my open PRs | line of daily WIP | today vs ~7d ago | history store |
| **Activity / day** | events created today | bars per day | today vs prior day | 100-event feed |

Collapse state persists across launches. Cards are non-interactive in v1.

**Honest limits (documented in the UI/code):** the three history-backed cards
are empty on first launch and fill over days/weeks; while the app isn't running
no samples are taken, so lines have gaps; the activity card's window slides as
the 100-event feed rolls.

## Persistence

A new `src/main/history-store.ts`, mirroring `event-store.ts`, backed by
`history.json` in `userData`. A new `historyFilePath()` is added to `paths.ts`.

Record shape — one per local calendar day:

```ts
interface DailyMetric {
  date: string       // 'YYYY-MM-DD' (local)
  reviewQueue: number // needsReview count, last sample of the day
  openWipSize: number // sum of (additions + deletions) over my open PRs, last sample
  merges: number      // count of my PRs that merged that day (accumulated)
}
```

### Pure helpers (TDD'd)

- `upsertToday(metrics, today, { reviewQueue, openWipSize }) → DailyMetric[]`
  — create or overwrite today's row's *sampled* fields (queue + WIP), leaving
  `merges` untouched.
- `addMerges(metrics, today, n) → DailyMetric[]` — increment today's `merges`
  by `n` (create the row if absent). `n` is the count of newly-merged-PR events
  in *this poll's* `derive-events` output, so merges are never double-counted.
- `pruneOlderThan(metrics, cutoffDate) → DailyMetric[]` — drop rows older than
  ~90 days. Keeps the file bounded.
- `recentWindow(metrics, days) → DailyMetric[]` — the trailing slice attached to
  the snapshot (e.g. last 56 days).

All helpers take `today`/`cutoff` as injected strings (no `Date.now()` inside
pure code), matching the project's testable-pure-logic convention.

### fs-backed glue

`loadHistory()`, `saveHistory()`, and `recordSample({ reviewQueue, openWipSize,
mergeDelta }, now)` that loads, applies `upsertToday` + `addMerges` + prune,
saves, and returns the recent window.

## Contract change (`src/shared/types.ts`)

- New exported `DailyMetric` interface.
- `DashboardSnapshot` gains `history: DailyMetric[]` — the recent window
  (≈ last 56 days). Tens of small records; negligible over the IPC boundary and
  keeps the single-contract rule (no new IPC channel for chart data).
- `Settings` gains `chartsCollapsed: boolean` (default `false`), persisted via
  the existing settings store; `DEFAULT_SETTINGS` updated.

No `GithudApi` additions — the existing `saveSettings` carries the collapse flag,
and `history` rides on the snapshot already pushed every poll.

## Wiring

### Poller (`poller.ts`)

After normalizing both lists and deriving events for the poll:
1. Compute `reviewQueue = needsReview.length` and
   `openWipSize = Σ (pr.additions + pr.deletions)` over `myPullRequests`.
2. Count merged events in this poll's derived `FeedEvent[]`
   (`kind === 'merged'`) → `mergeDelta`. (Merged events are already produced only
   for the viewer's own PRs that dropped out of the open set — see `enrich-state`
   — so this is exactly "my merges.")
3. `history = recordSample({ reviewQueue, openWipSize, mergeDelta }, fetchedAt)`
   and set `snapshot.history`.

`poller.ts` stays glue (no unit tests); the math it calls lives in the pure
helpers.

### Renderer

- **`hooks/chart-geometry.ts`** (pure, TDD'd): `linePoints(values, w, h)` →
  SVG polyline points string with min/max scaling and empty/single-point
  guards; `barRects(values, w, h, gap)` → `{x,y,width,height}[]`. No DOM, no
  React — just number crunching.
- **`hooks/trend-metrics.ts`** (pure, TDD'd): derives each card's
  `{ current, series, delta }` from `history` + `events`:
  - queue/WIP series = `history.map(m => m.field)`; delta = latest row vs the
    row from ~7 calendar days earlier (nearest row at or before that date, since
    gaps mean row-count ≠ day-count). Null delta if no such earlier row.
  - merges = bucket `history` into ISO weeks; current = this week's sum, delta =
    this vs last week.
  - activity = bucket `events` by local day from `createdAt`; current = today,
    delta = today vs prior day.
- **`components/Sparkline.tsx` / `components/MiniBars.tsx`**: thin presentational
  SVG components consuming `chart-geometry` output. No data logic.
- **`components/TrendStrip.tsx`**: composes the four cards from
  `trend-metrics`; renders a collapse toggle that reads/writes
  `settings.chartsCollapsed` (via the existing settings save path in `App.tsx`).
  Renders an empty/"collecting data…" state per card when its series is empty.
- **`App.tsx`**: mounts `<TrendStrip>` between `TopBar` and `NeedsReviewTable`,
  passing `snapshot.history`, `snapshot.events`, and the collapse flag + setter.

### Styling (`styles.css`)

A `.trend-strip` grid (4 columns) of `.trend-card`s on-theme with the existing
`.pr-table` cards: muted uppercase label, large value, colored delta
(`.up`/`.down`/`.flat`), inline SVG. Collapsed state hides the grid, leaving a
slim toggle.

## Testing

- `history-store.test.ts` — `upsertToday` (create/overwrite, leaves merges),
  `addMerges` (accumulate, create-if-absent), `pruneOlderThan`, `recentWindow`.
- `chart-geometry.test.ts` — line points + bar rects scaling; empty / single /
  flat (all-equal) series guards.
- `trend-metrics.test.ts` — queue/WIP delta vs 7-days-back; merges weekly
  bucketing + this-vs-last-week; activity daily bucketing + today-vs-prior;
  empty-history → empty series + null delta.
- Component test (`TrendStrip.test.tsx`) — four cards render with values,
  empty-state copy when history is empty, collapse toggle flips and calls
  `saveSettings`.

Electron/poller glue stays unit-test-free per project convention; validated by
the manual smoke test.

## Out of scope (YAGNI)

No charting library (hand-rolled SVG). No backfill of history from the feed. No
click-to-drill-down, hover tooltips with exact daily values, or per-card
date-range controls. No instant/cross-sectional charts (size distribution, CI
donut, aging, by-repo) — the user chose trends only; these remain easy
follow-ups. No second throughput series (reviewed-PRs); "my merges" only.
