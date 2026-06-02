import { FeedEventKind } from '@shared/types'

export type Severity = 'failure' | 'success' | 'info'

const FAILURE = new Set<FeedEventKind>(['ci_failed', 'changes_requested'])
const SUCCESS = new Set<FeedEventKind>(['ci_succeeded', 'approved', 'merged'])

export function severityForKind(kind: FeedEventKind): Severity {
  if (FAILURE.has(kind)) return 'failure'
  if (SUCCESS.has(kind)) return 'success'
  return 'info'
}
