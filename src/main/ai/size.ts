import { SizeBucket } from '@shared/types'

export function sizeBucket(d: { additions: number; deletions: number; changedFiles: number }): SizeBucket {
  const lines = d.additions + d.deletions
  const byLines: SizeBucket = lines <= 30 ? 'S' : lines <= 150 ? 'M' : lines <= 600 ? 'L' : 'XL'
  const byFiles: SizeBucket = d.changedFiles <= 2 ? 'S' : d.changedFiles <= 8 ? 'M' : d.changedFiles <= 20 ? 'L' : 'XL'
  const order: SizeBucket[] = ['S', 'M', 'L', 'XL']
  return order[Math.max(order.indexOf(byLines), order.indexOf(byFiles))]
}
