# Trend Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact, collapsible row of four trend KPI cards above the dashboard tables (review-queue depth, my merges/week, open WIP size, activity/day).

**Architecture:** A new `history-store.ts` in main samples three metrics into one compact JSON record per local day on every poll. The recent history rides on `DashboardSnapshot.history`. The renderer derives per-card `{current, series, delta}` with pure helpers and draws hand-rolled SVG sparklines/bars — no charting library. Collapse state persists via a new `Settings.chartsCollapsed` flag.

**Tech Stack:** TypeScript, Electron (main), React + Vitest + React Testing Library (renderer). pnpm. Pure logic is TDD'd; Electron/presentational glue is not (project convention).

---

## File Structure

**Create:**
- `src/main/history-store.ts` — daily-metric persistence: pure helpers (`toLocalDay`, `upsertToday`, `addMerges`, `pruneOlderThan`) + fs glue (`loadHistory`, `recordSample`).
- `src/main/history-store.test.ts` — tests for the pure helpers.
- `src/renderer/src/components/chart-geometry.ts` — pure SVG math (`linePoints`, `barRects`).
- `src/renderer/src/components/chart-geometry.test.ts`
- `src/renderer/src/components/trend-metrics.ts` — pure derivations (`queueMetric`, `wipMetric`, `mergesMetric`, `activityMetric`, `formatChurn`) + date helpers.
- `src/renderer/src/components/trend-metrics.test.ts`
- `src/renderer/src/components/Sparkline.tsx` — presentational SVG line (glue).
- `src/renderer/src/components/MiniBars.tsx` — presentational SVG bars (glue).
- `src/renderer/src/components/TrendStrip.tsx` — composes the four cards + collapse toggle.
- `src/renderer/src/components/TrendStrip.test.tsx`

**Modify:**
- `src/shared/types.ts` — add `DailyMetric`; add `history` to `DashboardSnapshot`; add `chartsCollapsed` to `Settings` + `DEFAULT_SETTINGS`.
- `src/main/paths.ts` — add `historyFilePath()`.
- `src/main/poller.ts` — record the sample, attach `history`.
- `src/main/index.ts:169` — add `history: []` to the degraded snapshot literal.
- Test fixtures constructing `DashboardSnapshot`: `src/main/snapshot-cache.test.ts`, `src/main/notifier.test.ts`, `src/main/tray-label.test.ts`, `src/main/ai/digest.test.ts` — add `history: []`.
- `src/renderer/src/App.tsx` — load settings, mount `<TrendStrip>`, wire collapse persistence.
- `src/renderer/src/styles.css` — `.trend-strip` and card styling.
- `CLAUDE.md` — document the new files and contract fields.

---

## Task 1: History store (DailyMetric type + main-process persistence)

**Files:**
- Modify: `src/shared/types.ts` (add the `DailyMetric` interface only — non-breaking)
- Modify: `src/main/paths.ts`
- Create: `src/main/history-store.ts`
- Test: `src/main/history-store.test.ts`

- [ ] **Step 1: Add the `DailyMetric` interface to `src/shared/types.ts`**

Add directly above `export interface DashboardSnapshot {`:

```ts
export interface DailyMetric {
  date: string // 'YYYY-MM-DD' in local time
  reviewQueue: number // needsReview count, last sample of the day
  openWipSize: number // sum of (additions + deletions) over my open PRs, last sample
  merges: number // count of my PRs that merged that day (accumulated)
}
```

(Do NOT touch `DashboardSnapshot` or `Settings` yet — that's Task 4, and adding a required field now would break fixtures.)

- [ ] **Step 2: Add `historyFilePath()` to `src/main/paths.ts`**

Add after `hiddenFilePath()`:

```ts
export function historyFilePath(): string {
  return join(app.getPath('userData'), 'history.json')
}
```

- [ ] **Step 3: Write the failing test `src/main/history-store.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { toLocalDay, upsertToday, addMerges, pruneOlderThan } from './history-store'
import { DailyMetric } from '@shared/types'

describe('toLocalDay', () => {
  it('formats a timestamp as local YYYY-MM-DD', () => {
    const ms = new Date(2026, 5, 3, 12, 30, 0).getTime() // local June 3 2026
    expect(toLocalDay(ms)).toBe('2026-06-03')
  })
  it('zero-pads month and day', () => {
    const ms = new Date(2026, 0, 9, 1, 0, 0).getTime() // local Jan 9 2026
    expect(toLocalDay(ms)).toBe('2026-01-09')
  })
})

describe('upsertToday', () => {
  it('appends a new row with merges defaulted to 0', () => {
    const out = upsertToday([], '2026-06-03', { reviewQueue: 5, openWipSize: 200 })
    expect(out).toEqual([{ date: '2026-06-03', reviewQueue: 5, openWipSize: 200, merges: 0 }])
  })
  it("overwrites today's sample fields but preserves merges", () => {
    const start: DailyMetric[] = [{ date: '2026-06-03', reviewQueue: 5, openWipSize: 200, merges: 3 }]
    const out = upsertToday(start, '2026-06-03', { reviewQueue: 8, openWipSize: 50 })
    expect(out).toEqual([{ date: '2026-06-03', reviewQueue: 8, openWipSize: 50, merges: 3 }])
  })
  it('keeps rows sorted by date ascending', () => {
    const start: DailyMetric[] = [{ date: '2026-06-01', reviewQueue: 1, openWipSize: 0, merges: 0 }]
    const out = upsertToday(start, '2026-06-03', { reviewQueue: 2, openWipSize: 0 })
    expect(out.map((m) => m.date)).toEqual(['2026-06-01', '2026-06-03'])
  })
})

describe('addMerges', () => {
  it("increments today's merge count", () => {
    const start: DailyMetric[] = [{ date: '2026-06-03', reviewQueue: 5, openWipSize: 200, merges: 1 }]
    const out = addMerges(start, '2026-06-03', 2)
    expect(out[0].merges).toBe(3)
  })
  it('creates a zeroed row when today is absent', () => {
    const out = addMerges([], '2026-06-03', 2)
    expect(out).toEqual([{ date: '2026-06-03', reviewQueue: 0, openWipSize: 0, merges: 2 }])
  })
})

describe('pruneOlderThan', () => {
  it('drops rows strictly older than the cutoff date', () => {
    const start: DailyMetric[] = [
      { date: '2026-03-01', reviewQueue: 1, openWipSize: 0, merges: 0 },
      { date: '2026-06-01', reviewQueue: 2, openWipSize: 0, merges: 0 }
    ]
    const out = pruneOlderThan(start, '2026-06-01')
    expect(out.map((m) => m.date)).toEqual(['2026-06-01'])
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test -- history-store`
Expected: FAIL — `history-store.ts` does not exist / exports undefined.

- [ ] **Step 5: Implement `src/main/history-store.ts`**

```ts
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { DailyMetric } from '@shared/types'
import { historyFilePath } from './paths'

const RETENTION_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

// --- pure helpers (unit-tested) ---

export function toLocalDay(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function upsertToday(
  metrics: DailyMetric[],
  today: string,
  sample: { reviewQueue: number; openWipSize: number }
): DailyMetric[] {
  const others = metrics.filter((m) => m.date !== today)
  const existing = metrics.find((m) => m.date === today)
  const row: DailyMetric = {
    date: today,
    reviewQueue: sample.reviewQueue,
    openWipSize: sample.openWipSize,
    merges: existing?.merges ?? 0
  }
  return [...others, row].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export function addMerges(metrics: DailyMetric[], today: string, n: number): DailyMetric[] {
  const existing = metrics.find((m) => m.date === today)
  if (existing) {
    return metrics.map((m) => (m.date === today ? { ...m, merges: m.merges + n } : m))
  }
  return [...metrics, { date: today, reviewQueue: 0, openWipSize: 0, merges: n }].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  )
}

export function pruneOlderThan(metrics: DailyMetric[], cutoff: string): DailyMetric[] {
  return metrics.filter((m) => m.date >= cutoff)
}

// --- fs-backed store (glue) ---

export function loadHistory(): DailyMetric[] {
  const path = historyFilePath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DailyMetric[]
  } catch {
    return []
  }
}

function save(metrics: DailyMetric[]): DailyMetric[] {
  writeFileSync(historyFilePath(), JSON.stringify(metrics))
  return metrics
}

// Update today's sample, fold in any merges observed this poll, prune, persist,
// and return the full retained history (<= ~90 small rows).
export function recordSample(
  sample: { reviewQueue: number; openWipSize: number; mergeDelta: number },
  now: number
): DailyMetric[] {
  const today = toLocalDay(now)
  const cutoff = toLocalDay(now - RETENTION_DAYS * DAY_MS)
  let m = loadHistory()
  m = upsertToday(m, today, { reviewQueue: sample.reviewQueue, openWipSize: sample.openWipSize })
  if (sample.mergeDelta > 0) m = addMerges(m, today, sample.mergeDelta)
  m = pruneOlderThan(m, cutoff)
  return save(m)
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- history-store`
Expected: PASS (all cases green).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/paths.ts src/main/history-store.ts src/main/history-store.test.ts
git commit -m "feat(history): add daily-metric history store (pure helpers + fs glue)"
```

---

## Task 2: Chart geometry (pure SVG math)

**Files:**
- Create: `src/renderer/src/components/chart-geometry.ts`
- Test: `src/renderer/src/components/chart-geometry.test.ts`

- [ ] **Step 1: Write the failing test `src/renderer/src/components/chart-geometry.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { linePoints, barRects } from './chart-geometry'

describe('linePoints', () => {
  it('returns an empty string for no values', () => {
    expect(linePoints([], 100, 10)).toBe('')
  })
  it('draws an ascending series from bottom-left to top-right', () => {
    // pad 0: min 0, max 2, span 2, stepX 50; y = h*(1 - (v-min)/span)
    expect(linePoints([0, 1, 2], 100, 10, 0)).toBe('0,10 50,5 100,0')
  })
  it('draws a flat series down the middle', () => {
    expect(linePoints([5, 5, 5], 100, 10, 0)).toBe('0,5 50,5 100,5')
  })
  it('centers a single value', () => {
    expect(linePoints([7], 100, 10)).toBe('0,5 100,5')
  })
})

describe('barRects', () => {
  it('returns an empty array for no values', () => {
    expect(barRects([], 100, 10)).toEqual([])
  })
  it('scales bar heights to the max value', () => {
    expect(barRects([2, 4], 20, 10, 0)).toEqual([
      { x: 0, y: 5, width: 10, height: 5 },
      { x: 10, y: 0, width: 10, height: 10 }
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- chart-geometry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/src/components/chart-geometry.ts`**

```ts
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const round = (n: number): number => Math.round(n * 10) / 10

// SVG polyline `points` string for a sparkline. `pad` insets the curve
// vertically so the stroke isn't clipped at the extremes.
export function linePoints(values: number[], width: number, height: number, pad = 2): string {
  if (values.length === 0) return ''
  if (values.length === 1) {
    const y = round(height / 2)
    return `0,${y} ${width},${y}`
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) {
    const y = round(height / 2)
    return values.map((_, i) => `${round((i * width) / (values.length - 1))},${y}`).join(' ')
  }
  const span = max - min
  const stepX = width / (values.length - 1)
  const usable = height - 2 * pad
  return values
    .map((v, i) => `${round(i * stepX)},${round(pad + usable * (1 - (v - min) / span))}`)
    .join(' ')
}

export function barRects(values: number[], width: number, height: number, gap = 2): Rect[] {
  if (values.length === 0) return []
  const max = Math.max(...values, 0) || 1
  const barW = (width - gap * (values.length - 1)) / values.length
  return values.map((v, i) => {
    const h = height * (v / max)
    return { x: round(i * (barW + gap)), y: round(height - h), width: round(barW), height: round(h) }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- chart-geometry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chart-geometry.ts src/renderer/src/components/chart-geometry.test.ts
git commit -m "feat(charts): pure SVG geometry helpers for sparkline + bars"
```

---

## Task 3: Trend metrics (pure per-card derivations)

**Files:**
- Create: `src/renderer/src/components/trend-metrics.ts`
- Test: `src/renderer/src/components/trend-metrics.test.ts`

- [ ] **Step 1: Write the failing test `src/renderer/src/components/trend-metrics.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { queueMetric, wipMetric, mergesMetric, activityMetric, formatChurn } from './trend-metrics'
import { DailyMetric, FeedEvent } from '@shared/types'

const day = (date: string, reviewQueue = 0, openWipSize = 0, merges = 0): DailyMetric => ({
  date,
  reviewQueue,
  openWipSize,
  merges
})

describe('queueMetric', () => {
  it('is empty for no history', () => {
    expect(queueMetric([])).toEqual({ current: 0, series: [], delta: null })
  })
  it('reports the latest value and the delta vs ~7 days earlier', () => {
    const h = [day('2026-05-27', 10), day('2026-06-01', 8), day('2026-06-03', 12)]
    const m = queueMetric(h)
    expect(m.current).toBe(12)
    expect(m.series).toEqual([10, 8, 12])
    expect(m.delta).toBe(2) // 12 vs 2026-05-27's 10 (nearest row <= 2026-05-27)
  })
  it('has a null delta when there is no row a week back', () => {
    expect(queueMetric([day('2026-06-01', 5), day('2026-06-03', 9)]).delta).toBeNull()
  })
})

describe('wipMetric', () => {
  it('reads the openWipSize field', () => {
    const h = [day('2026-05-27', 0, 100), day('2026-06-03', 0, 250)]
    const m = wipMetric(h)
    expect(m.current).toBe(250)
    expect(m.delta).toBe(150)
  })
})

describe('mergesMetric', () => {
  it('buckets merges into trailing 7-day weeks (oldest -> newest series)', () => {
    const h = [
      day('2026-05-20', 0, 0, 2), // ~2 weeks back
      day('2026-05-28', 0, 0, 3), // last week (6 days before latest)
      day('2026-06-02', 0, 0, 1), // this week
      day('2026-06-03', 0, 0, 1) // this week (latest)
    ]
    const m = mergesMetric(h, 3)
    expect(m.current).toBe(2) // this week: 1 + 1
    expect(m.delta).toBe(-1) // 2 (this week) - 3 (last week)
    expect(m.series).toEqual([2, 3, 2]) // [2wk-ago, last-wk, this-wk]
  })
  it('is empty for no history', () => {
    expect(mergesMetric([])).toEqual({ current: 0, series: [], delta: null })
  })
})

describe('activityMetric', () => {
  const ev = (createdAt: string): FeedEvent => ({
    id: createdAt,
    kind: 'comment',
    repo: 'o/r',
    number: 1,
    title: 't',
    url: 'u',
    createdAt,
    unread: false
  })
  it('counts events per local day and reports today vs yesterday', () => {
    const now = new Date(2026, 5, 3, 12, 0, 0).getTime() // local June 3
    const events = [
      ev(new Date(2026, 5, 3, 9, 0, 0).toISOString()),
      ev(new Date(2026, 5, 3, 10, 0, 0).toISOString()),
      ev(new Date(2026, 5, 2, 10, 0, 0).toISOString())
    ]
    const m = activityMetric(events, now, 3)
    expect(m.current).toBe(2) // two today
    expect(m.delta).toBe(1) // 2 today - 1 yesterday
    expect(m.series).toEqual([0, 1, 2]) // [2 days ago, yesterday, today]
  })
  it('is empty for no events', () => {
    expect(activityMetric([], Date.now(), 7)).toEqual({ current: 0, series: [0, 0, 0, 0, 0, 0, 0], delta: null })
  })
})

describe('formatChurn', () => {
  it('formats thousands compactly', () => {
    expect(formatChurn(1400)).toBe('1.4k')
    expect(formatChurn(950)).toBe('950')
    expect(formatChurn(0)).toBe('0')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- trend-metrics`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/src/components/trend-metrics.ts`**

```ts
import { DailyMetric, FeedEvent } from '@shared/types'

export interface CardMetric {
  current: number
  series: number[]
  delta: number | null // signed; null when there's no baseline to compare to
}

const DAY_MS = 24 * 60 * 60 * 1000

// Calendar-day arithmetic on a 'YYYY-MM-DD' string (TZ-independent: treats the
// date as UTC purely to add/subtract whole days).
function shiftDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d) + deltaDays * DAY_MS)
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${mm}-${dd}`
}

function dayOrdinal(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

function localDayFromMs(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// Shared body for queue/WIP: a daily series plus delta vs the nearest row at or
// before (latest date - 7 days). History is assumed sorted ascending by date.
function dailyMetric(history: DailyMetric[], pick: (m: DailyMetric) => number): CardMetric {
  if (history.length === 0) return { current: 0, series: [], delta: null }
  const series = history.map(pick)
  const current = series[series.length - 1]
  const target = shiftDay(history[history.length - 1].date, -7)
  let baseline: number | null = null
  for (const m of history) {
    if (m.date <= target) baseline = pick(m)
    else break
  }
  return { current, series, delta: baseline === null ? null : current - baseline }
}

export function queueMetric(history: DailyMetric[]): CardMetric {
  return dailyMetric(history, (m) => m.reviewQueue)
}

export function wipMetric(history: DailyMetric[]): CardMetric {
  return dailyMetric(history, (m) => m.openWipSize)
}

// Merges bucketed into trailing 7-day weeks aligned to the latest date.
// series runs oldest -> newest so the bars read left-to-right.
export function mergesMetric(history: DailyMetric[], weeks = 8): CardMetric {
  if (history.length === 0) return { current: 0, series: [], delta: null }
  const latest = dayOrdinal(history[history.length - 1].date)
  const buckets = new Array(weeks).fill(0)
  for (const m of history) {
    const idx = Math.floor((latest - dayOrdinal(m.date)) / 7)
    if (idx >= 0 && idx < weeks) buckets[idx] += m.merges
  }
  const hasPrior = history.some((m) => dayOrdinal(m.date) <= latest - 7)
  return { current: buckets[0], series: [...buckets].reverse(), delta: hasPrior ? buckets[0] - buckets[1] : null }
}

// Activity per local day from the event feed (oldest -> newest over `days`).
export function activityMetric(events: FeedEvent[], now: number, days = 14): CardMetric {
  const counts = new Map<string, number>()
  for (const e of events) {
    const d = localDayFromMs(Date.parse(e.createdAt))
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  const today = localDayFromMs(now)
  const series: number[] = []
  for (let i = days - 1; i >= 0; i--) series.push(counts.get(shiftDay(today, -i)) ?? 0)
  const current = counts.get(today) ?? 0
  const yesterday = counts.get(shiftDay(today, -1)) ?? 0
  return { current, series, delta: events.length === 0 ? null : current - yesterday }
}

export function formatChurn(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- trend-metrics`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/trend-metrics.ts src/renderer/src/components/trend-metrics.test.ts
git commit -m "feat(charts): pure per-card trend derivations (queue/wip/merges/activity)"
```

---

## Task 4: Contract wiring (snapshot.history + Settings.chartsCollapsed + poller)

This task makes the breaking type changes and updates every `DashboardSnapshot` literal + `poller.ts` in one commit so typecheck and tests stay green.

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/poller.ts`
- Modify: `src/main/index.ts` (degraded snapshot literal, ~line 169)
- Modify: `src/main/snapshot-cache.test.ts`, `src/main/notifier.test.ts`, `src/main/tray-label.test.ts`, `src/main/ai/digest.test.ts`

- [ ] **Step 1: Add `history` to `DashboardSnapshot` and `chartsCollapsed` to `Settings` in `src/shared/types.ts`**

In `DashboardSnapshot`, add after `hiddenPrIds: string[]`:

```ts
  history: DailyMetric[]
```

In `Settings`, add after `launchAtLogin: boolean`:

```ts
  // Charts: collapse state of the trend strip above the tables.
  chartsCollapsed: boolean
```

In `DEFAULT_SETTINGS`, add after `launchAtLogin: false`:

```ts
  chartsCollapsed: false
```

- [ ] **Step 2: Record the sample and attach `history` in `src/main/poller.ts`**

Add the import near the other store imports (after the `hidden-store` import):

```ts
import { recordSample } from './history-store'
```

Immediately before the final `return {` (after the `saveHidden(kept)` line), add:

```ts
    const openWipSize = myPullRequests.reduce((sum, p) => sum + p.additions + p.deletions, 0)
    const mergeDelta = newEvents.filter((e) => e.kind === 'merged').length
    const history = recordSample({ reviewQueue: needsReview.length, openWipSize, mergeDelta }, now)
```

Then add `history` to the returned object, after `hiddenPrIds: hiddenIds,`:

```ts
      history,
```

(Note: `newEvents` from `deriveEvents` already contains `merged` events only for the viewer's own PRs that fell out of the open set — see `enrich-state` — so `mergeDelta` is exactly "my merges this poll", with no double-counting across polls.)

- [ ] **Step 3: Add `history: []` to the degraded snapshot in `src/main/index.ts`**

Find the `else` branch literal (around line 169) and add `history: []` to it:

```ts
      : {
          fetchedAt: new Date().toISOString(),
          viewer: { login: viewerLogin ?? '', avatarUrl: '' },
          needsReview: [], myPullRequests: [], events: [], hiddenPrIds: [],
          history: [],
          rateLimit: { remaining: 0, resetAt: '' },
          error: err?.message ?? 'Refresh failed'
        }
```

- [ ] **Step 4: Add `history: []` to the four test fixtures**

In `src/main/notifier.test.ts:10`, add `history: [],` to the returned object (e.g. after `hiddenPrIds: [],`):

```ts
  return { fetchedAt: 'x', viewer: { login: 'me', avatarUrl: '' }, needsReview: [], myPullRequests: [], events, hiddenPrIds: [], history: [], rateLimit: { remaining: 0, resetAt: '' } }
```

In `src/main/snapshot-cache.test.ts` (the snapshot literal starting at line 13), `src/main/tray-label.test.ts` (line 7), and `src/main/ai/digest.test.ts` (line 18), add `history: [],` alongside the existing `hiddenPrIds` / `needsReview` fields in each literal. (Open each file, locate the object containing `fetchedAt:`, add the field.)

- [ ] **Step 5: Run typecheck and the full suite**

Run: `pnpm run typecheck && pnpm test`
Expected: typecheck passes; all tests PASS. If a `DashboardSnapshot` literal elsewhere errors, add `history: []` to it.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/poller.ts src/main/index.ts src/main/snapshot-cache.test.ts src/main/notifier.test.ts src/main/tray-label.test.ts src/main/ai/digest.test.ts
git commit -m "feat(history): carry daily metrics on DashboardSnapshot; add chartsCollapsed setting"
```

---

## Task 5: Sparkline + MiniBars presentational components

Presentational glue (no data logic) — no dedicated unit tests; covered by `TrendStrip.test.tsx` and typecheck.

**Files:**
- Create: `src/renderer/src/components/Sparkline.tsx`
- Create: `src/renderer/src/components/MiniBars.tsx`

- [ ] **Step 1: Create `src/renderer/src/components/Sparkline.tsx`**

```tsx
import { linePoints } from './chart-geometry'

export function Sparkline({
  values,
  width = 96,
  height = 24,
  color = 'var(--blue)'
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (values.length === 0) return null
  return (
    <svg className="spark" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={linePoints(values, width, height, 2)} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  )
}
```

- [ ] **Step 2: Create `src/renderer/src/components/MiniBars.tsx`**

```tsx
import { barRects } from './chart-geometry'

export function MiniBars({
  values,
  width = 96,
  height = 24,
  color = 'var(--green)'
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (values.length === 0) return null
  return (
    <svg className="spark" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {barRects(values, width, height, 3).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={color} rx={1} />
      ))}
    </svg>
  )
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Sparkline.tsx src/renderer/src/components/MiniBars.tsx
git commit -m "feat(charts): Sparkline + MiniBars presentational SVG components"
```

---

## Task 6: TrendStrip component

**Files:**
- Create: `src/renderer/src/components/TrendStrip.tsx`
- Test: `src/renderer/src/components/TrendStrip.test.tsx`

- [ ] **Step 1: Write the failing test `src/renderer/src/components/TrendStrip.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrendStrip } from './TrendStrip'
import { DailyMetric, FeedEvent } from '@shared/types'

const history: DailyMetric[] = [
  { date: '2026-05-27', reviewQueue: 10, openWipSize: 100, merges: 2 },
  { date: '2026-06-03', reviewQueue: 12, openWipSize: 1400, merges: 1 }
]
const events: FeedEvent[] = []

describe('TrendStrip', () => {
  it('renders the four card labels and current values when expanded', () => {
    render(<TrendStrip history={history} events={events} collapsed={false} onToggleCollapsed={() => {}} />)
    expect(screen.getByText(/review queue/i)).toBeInTheDocument()
    expect(screen.getByText(/merges \/ wk/i)).toBeInTheDocument()
    expect(screen.getByText(/open wip/i)).toBeInTheDocument()
    expect(screen.getByText(/activity \/ day/i)).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument() // queue current
    expect(screen.getByText('1.4k')).toBeInTheDocument() // wip current, formatted
  })

  it('shows a collecting-data state per card when history is empty', () => {
    render(<TrendStrip history={[]} events={[]} collapsed={false} onToggleCollapsed={() => {}} />)
    expect(screen.getAllByText(/collecting/i).length).toBeGreaterThan(0)
  })

  it('hides the cards when collapsed', () => {
    render(<TrendStrip history={history} events={events} collapsed={true} onToggleCollapsed={() => {}} />)
    expect(screen.queryByText(/review queue/i)).not.toBeInTheDocument()
  })

  it('calls onToggleCollapsed when the toggle is clicked', () => {
    const onToggle = vi.fn()
    render(<TrendStrip history={history} events={events} collapsed={false} onToggleCollapsed={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: /trends/i }))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- TrendStrip`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/src/components/TrendStrip.tsx`**

```tsx
import { DailyMetric, FeedEvent } from '@shared/types'
import { queueMetric, wipMetric, mergesMetric, activityMetric, formatChurn, CardMetric } from './trend-metrics'
import { Sparkline } from './Sparkline'
import { MiniBars } from './MiniBars'

type Viz = 'line' | 'bars'

interface Card {
  key: string
  label: string
  metric: CardMetric
  value: string
  viz: Viz
  color: string
  goodWhenUp: boolean
  deltaSuffix: string
}

function deltaText(metric: CardMetric, goodWhenUp: boolean, suffix: string): { text: string; cls: string } | null {
  if (metric.delta === null || metric.delta === 0) {
    return metric.delta === 0 ? { text: `~ flat`, cls: 'flat' } : null
  }
  const up = metric.delta > 0
  const arrow = up ? '▲' : '▼'
  const cls = up === goodWhenUp ? 'up' : 'down'
  return { text: `${arrow} ${Math.abs(metric.delta)}${suffix}`, cls }
}

export function TrendStrip({
  history,
  events,
  collapsed,
  onToggleCollapsed
}: {
  history: DailyMetric[]
  events: FeedEvent[]
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const queue = queueMetric(history)
  const merges = mergesMetric(history)
  const wip = wipMetric(history)
  const activity = activityMetric(events, Date.now())

  const cards: Card[] = [
    { key: 'queue', label: 'Review queue', metric: queue, value: String(queue.current), viz: 'line', color: 'var(--blue)', goodWhenUp: false, deltaSuffix: '' },
    { key: 'merges', label: 'Merges / wk', metric: merges, value: String(merges.current), viz: 'bars', color: 'var(--green)', goodWhenUp: true, deltaSuffix: '' },
    { key: 'wip', label: 'Open WIP', metric: wip, value: formatChurn(wip.current), viz: 'line', color: 'var(--amber)', goodWhenUp: false, deltaSuffix: '' },
    { key: 'activity', label: 'Activity / day', metric: activity, value: String(activity.current), viz: 'bars', color: 'var(--amber)', goodWhenUp: true, deltaSuffix: '' }
  ]

  return (
    <div className={`trend-strip${collapsed ? ' collapsed' : ''}`}>
      <button className="trend-toggle" onClick={onToggleCollapsed} aria-label={collapsed ? 'Show trends' : 'Hide trends'}>
        {collapsed ? '▸ Trends' : '▾ Trends'}
      </button>
      {!collapsed && (
        <div className="trend-cards">
          {cards.map((c) => {
            const empty = c.metric.series.length === 0
            const delta = deltaText(c.metric, c.goodWhenUp, c.deltaSuffix)
            return (
              <div key={c.key} className="trend-card">
                <div className="lbl">{c.label}</div>
                {empty ? (
                  <div className="collecting">collecting…</div>
                ) : (
                  <>
                    <div className="val">{c.value}</div>
                    {delta ? <div className={`delta ${delta.cls}`}>{delta.text}</div> : <div className="delta flat">&nbsp;</div>}
                    {c.viz === 'line' ? (
                      <Sparkline values={c.metric.series} color={c.color} />
                    ) : (
                      <MiniBars values={c.metric.series} color={c.color} />
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- TrendStrip`
Expected: PASS.

Note: the "collecting-data" test renders with empty history *and* empty events, so all four `series` are non-empty only for activity (which builds a zero-filled series). Confirm: `activityMetric([], now)` returns a `series` of zeros (length 14), so its card is NOT empty — it shows `0`. The three history cards ARE empty. The test asserts `getAllByText(/collecting/i).length > 0`, which holds (3 cards collecting). This is correct.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TrendStrip.tsx src/renderer/src/components/TrendStrip.test.tsx
git commit -m "feat(charts): TrendStrip — four trend KPI cards with collapse"
```

---

## Task 7: Mount in App + persist collapse + styles

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Import the type, settings default, and component in `App.tsx`**

Change the shared-types import (line 3) to also pull the Settings type (aliased) and default:

```ts
import { FeedEvent, DashboardSnapshot, PullRequest, TriageVerdict, Settings as SettingsType, DEFAULT_SETTINGS } from '@shared/types'
```

Add the component import near the other component imports:

```ts
import { TrendStrip } from './components/TrendStrip'
```

- [ ] **Step 2: Load settings and add the collapse handler in `Dashboard`**

Add this state + effect near the other `useState`/`useEffect` hooks in `Dashboard` (e.g. after the `aiOn` effect on line 56):

```tsx
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS)
  useEffect(() => { api.getSettings().then(setSettings) }, [])
  const onToggleCharts = () => {
    const next = { ...settings, chartsCollapsed: !settings.chartsCollapsed }
    setSettings(next)
    void api.saveSettings(next)
  }
```

- [ ] **Step 3: Mount `<TrendStrip>` between `<TopBar>` and `<main>`**

In the returned JSX, add immediately after the closing `/>` of `<TopBar ... />` and before `<main className="layout">`:

```tsx
      <TrendStrip
        history={snapshot?.history ?? []}
        events={snapshot?.events ?? []}
        collapsed={settings.chartsCollapsed}
        onToggleCollapsed={onToggleCharts}
      />
```

- [ ] **Step 4: Add styles to `src/renderer/src/styles.css`**

Append:

```css
/* Trend strip — KPI cards above the tables */
.trend-strip { padding: 8px 12px 0; }
.trend-toggle { background: none; border: none; color: var(--muted); cursor: pointer;
  font-size: 12px; padding: 0 0 6px; transition: color .12s; }
.trend-toggle:hover { color: var(--bright); }
.trend-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.trend-card { background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 10px; min-width: 0; }
.trend-card .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
  color: var(--muted); }
.trend-card .val { font-size: 20px; font-weight: 700; color: var(--bright); line-height: 1.2; }
.trend-card .delta { font-size: 11px; }
.trend-card .delta.up { color: var(--green); }
.trend-card .delta.down { color: var(--red); }
.trend-card .delta.flat { color: var(--muted); }
.trend-card .collecting { font-size: 12px; color: var(--muted); padding: 6px 0 12px; }
.trend-card .spark { display: block; margin-top: 4px; }
```

- [ ] **Step 5: Verify typecheck, tests, and build**

Run: `pnpm run typecheck && pnpm test && pnpm run build`
Expected: all PASS. The `@shared` alias is configured for the renderer in `electron.vite.config.ts`, so `Settings as SettingsType` / `DailyMetric` resolve in the build.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(charts): mount trend strip above the tables; persist collapse state"
```

---

## Task 8: Documentation + final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the architecture map in `CLAUDE.md`**

In the `src/` tree, add under `main/` (near `event-store.ts` / `hidden-store.ts`):

```
    history-store.ts         # daily-metric samples (reviewQueue/openWipSize/merges) -> trend strip; pure helpers + fs glue (CAP 90 days)
```

Add under `renderer/src/components/`:

```
      TrendStrip.tsx, Sparkline.tsx, MiniBars.tsx   # trend KPI strip above the tables
      chart-geometry.ts, trend-metrics.ts           # pure, tested (SVG math + per-card derivations)
```

In the contract description for `shared/types.ts`, note the new `DailyMetric` type and the `history` field on `DashboardSnapshot`, and `chartsCollapsed` on `Settings`. In the "Test pure logic" conventions list, append `chart-geometry`, `trend-metrics`, and `history-store` to the TDD'd helpers.

Add a short note (near the data-flow paragraph) that the poller now also calls `recordSample` each poll to append today's metrics, and that the trend cards are empty until history accumulates (no backfill).

- [ ] **Step 2: Run the full verification suite**

Run: `pnpm run typecheck && pnpm test && pnpm run build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the trend strip, history store, and new snapshot/settings fields"
```

- [ ] **Step 4: Manual smoke test (user-run — `dev` launches a GUI)**

Ask the user to run `pnpm run dev` and confirm:
- The trend strip renders above the tables with four cards.
- On first run the three history cards show "collecting…"; the activity card shows a number.
- The ▾/▸ Trends toggle collapses/expands the strip, and the state survives an app relaunch.
- After leaving the app running across a poll or two, the queue/WIP/merge cards begin to populate.

---

## Self-Review notes (addressed)

- **Spec coverage:** all four cards (queue/merges/wip/activity), the `history-store`, `chart-geometry`, `trend-metrics`, `Sparkline`/`MiniBars`, `TrendStrip`, the `history` contract field, `chartsCollapsed` persistence, poller wiring, styles, and docs each map to a task above.
- **Simplification vs spec:** the store attaches the full retained history (≤90 rows, tiny) rather than a separate 56-day `recentWindow`; the renderer owns any display windowing (activity uses 14 days, merges 8 weeks). This drops the unneeded `recentWindow` helper.
- **Type consistency:** `CardMetric`, `DailyMetric`, `recordSample`, `toLocalDay`, `linePoints`/`barRects`, and the `queue/wip/merges/activity` metric fns use identical names across the tasks that define and consume them.
- **Honest limits documented:** no backfill (cards empty on first launch), gaps when the app isn't running, sliding activity window — all noted in spec + CLAUDE.md step.
