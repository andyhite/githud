// Maps a fetched PR/issue REST payload to a human label. Pure.
export function subjectStateLabel(data: any, subjectType: string): string | undefined {
  if (subjectType === 'PullRequest') {
    if (data.merged || data.merged_at) return 'merged'
    if (data.state === 'closed') return 'closed'
    if (data.state === 'open') return 'reopened'
    return undefined
  }
  if (subjectType === 'Issue') {
    if (data.state === 'closed') return data.state_reason === 'not_planned' ? 'closed as not planned' : 'closed'
    if (data.state === 'open') return 'reopened'
    return undefined
  }
  return undefined
}
