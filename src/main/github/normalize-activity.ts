import { ActivityItem } from '@shared/types'
import { ResolvedComment } from './enrich'

// Turns a notifications API subject URL into a github.com html url + number.
// API urls look like .../repos/o/web/pulls/88 or .../issues/42.
function toHtmlTarget(repo: string, subjectType: string, apiUrl: string | undefined): { url: string; number?: number } {
  const m = apiUrl?.match(/\/(\d+)(?:$|[/?#])/)
  const number = m ? parseInt(m[1], 10) : undefined
  const kind = subjectType === 'PullRequest' ? 'pull' : 'issues'
  if (number === undefined) return { url: `https://github.com/${repo}`, number }
  return { url: `https://github.com/${repo}/${kind}/${number}`, number }
}

export function normalizeActivity(
  threads: any[],
  comments: Map<string, ResolvedComment>
): ActivityItem[] {
  return (threads ?? [])
    .map((t) => {
      const repo: string = t.repository?.full_name ?? ''
      const subjectType: string = t.subject?.type ?? 'Unknown'
      const target = toHtmlTarget(repo, subjectType, t.subject?.url)
      const item: ActivityItem = {
        id: t.id,
        reason: t.reason,
        subjectType,
        repo,
        number: target.number,
        title: t.subject?.title ?? '',
        url: target.url,
        unread: !!t.unread,
        updatedAt: t.updated_at,
        latestComment: comments.get(t.id)
      }
      return item
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
