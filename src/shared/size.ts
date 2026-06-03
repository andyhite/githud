import { SizeBucket } from './types'

// Deterministic diff-size bucket, shared by the AI triage (main) and the size
// column (renderer). Buckets by lines changed and files touched, whichever is larger.
export function sizeBucket(d: { additions: number; deletions: number; changedFiles: number }): SizeBucket {
  const lines = d.additions + d.deletions
  const byLines: SizeBucket = lines <= 30 ? 'S' : lines <= 150 ? 'M' : lines <= 600 ? 'L' : 'XL'
  const byFiles: SizeBucket = d.changedFiles <= 2 ? 'S' : d.changedFiles <= 8 ? 'M' : d.changedFiles <= 20 ? 'L' : 'XL'
  const order: SizeBucket[] = ['S', 'M', 'L', 'XL']
  return order[Math.max(order.indexOf(byLines), order.indexOf(byFiles))]
}
