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
