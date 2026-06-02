import { ActivityItem } from '@shared/types'
import { ResolvedComment } from './enrich'

// Reasons where the notification is *about* a comment, so the latest comment's
// author is the person who acted (commented / mentioned us).
const COMMENT_REASONS = new Set(['comment', 'mention', 'team_mention'])

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
  comments: Map<string, ResolvedComment>,
  states: Map<string, string> = new Map()
): ActivityItem[] {
  return (threads ?? [])
    .map((t) => {
      const repo: string = t.repository?.full_name ?? ''
      const subjectType: string = t.subject?.type ?? 'Unknown'
      const target = toHtmlTarget(repo, subjectType, t.subject?.url)
      // The notifications API points latest_comment_url at the subject itself
      // when there's no real comment yet — for most reasons that "comment" is
      // just the PR/issue description authored by someone unrelated to why we
      // were notified, so we drop it. But for comment-driven reasons the body's
      // author IS the actor (e.g. who @mentioned us), so keep it.
      const isRealComment =
        !!t.subject?.latest_comment_url && t.subject.latest_comment_url !== t.subject?.url
      const keepCommentAuthor = isRealComment || COMMENT_REASONS.has(t.reason)
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
        subjectState: states.get(t.id),
        latestComment: keepCommentAuthor ? comments.get(t.id) : undefined
      }
      return item
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
