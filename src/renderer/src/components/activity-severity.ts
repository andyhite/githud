import { ActivityItem } from '@shared/types'

export type Severity = 'failure' | 'success' | 'info'

const CI_SUCCESS = /\b(success|succeeded|passed|passing)\b/i

// Classifies a notification into a color-coded severity. We only read status
// keywords from CI events — for comments/mentions/etc. the title is the PR or
// issue title (which may itself contain words like "failure"), so those always
// map to info.
export function classifyActivity(item: ActivityItem): Severity {
  if (item.reason === 'ci_activity') {
    return CI_SUCCESS.test(item.title) ? 'success' : 'failure'
  }
  return 'info'
}
