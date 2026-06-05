export function moveSelection(current: number, dir: 'up' | 'down', len: number): number {
  if (len === 0) return -1
  if (current < 0) return dir === 'down' ? 0 : len - 1
  const next = dir === 'down' ? current + 1 : current - 1
  return Math.max(0, Math.min(len - 1, next))
}
