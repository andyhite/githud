import { writeFileSync } from 'fs'
import { DailyMetric } from '@shared/types'
import { historyFilePath } from './paths'
import { readJsonFile } from './json-file'

const RETENTION_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

// --- pure helpers (unit-tested) ---

export function toLocalDay(ms: number): string {
  const d = new Date(ms)
  const y = String(d.getFullYear()).padStart(4, '0')
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
  return readJsonFile<DailyMetric[]>(historyFilePath(), [])
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
  // DAY_MS arithmetic can be ±1 day off across DST boundaries; fine for a soft 90-day cap.
  const cutoff = toLocalDay(now - RETENTION_DAYS * DAY_MS)
  let m = loadHistory()
  m = upsertToday(m, today, { reviewQueue: sample.reviewQueue, openWipSize: sample.openWipSize })
  if (sample.mergeDelta > 0) m = addMerges(m, today, sample.mergeDelta)
  m = pruneOlderThan(m, cutoff)
  return save(m)
}
