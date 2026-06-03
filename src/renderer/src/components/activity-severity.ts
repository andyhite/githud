import { FeedEventKind } from '@shared/types'

export type Severity = 'failure' | 'success' | 'mention' | 'info'

const FAILURE = new Set<FeedEventKind>(['ci_failed', 'changes_requested'])
const SUCCESS = new Set<FeedEventKind>(['ci_succeeded', 'approved', 'merged'])

export function severityForKind(kind: FeedEventKind): Severity {
  if (FAILURE.has(kind)) return 'failure'
  if (SUCCESS.has(kind)) return 'success'
  // A direct @mention is the highest-signal text event — give it its own accent
  // so it stands out from passive comments rather than falling through to info.
  if (kind === 'mention') return 'mention'
  return 'info'
}
