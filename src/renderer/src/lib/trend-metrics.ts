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
    const idx = Math.floor((latest - dayOrdinal(m.date) + 1) / 7)
    if (idx >= 0 && idx < weeks) buckets[idx] += m.merges
  }
  const hasPrior = history.some((m) => dayOrdinal(m.date) <= latest - 6)
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
