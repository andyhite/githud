import { User } from '@shared/types'

export interface ResolvedComment {
  author: User
  body: string
  createdAt: string
}

// Caches resolved comments keyed by latest_comment_url, with the thread's
// updated_at as the freshness token.
export class CommentCache {
  private map = new Map<string, { updatedAt: string; comment: ResolvedComment }>()

  get(url: string, updatedAt: string): ResolvedComment | undefined {
    const entry = this.map.get(url)
    if (entry && entry.updatedAt === updatedAt) return entry.comment
    return undefined
  }

  set(url: string, updatedAt: string, comment: ResolvedComment): void {
    this.map.set(url, { updatedAt, comment })
  }
}

type RequestFn = (url: string) => Promise<{ data: any }>

export async function enrichThreads(
  threads: any[],
  deps: { cache: CommentCache; request: RequestFn }
): Promise<Map<string, ResolvedComment>> {
  const out = new Map<string, ResolvedComment>()
  await Promise.all(
    threads.map(async (t) => {
      const url: string | null = t.subject?.latest_comment_url ?? null
      if (!url) return
      const updatedAt: string = t.updated_at
      const cached = deps.cache.get(url, updatedAt)
      if (cached) {
        out.set(t.id, cached)
        return
      }
      try {
        const res = await deps.request(url)
        const c = res.data
        const comment: ResolvedComment = {
          author: { login: c.user?.login ?? 'unknown', avatarUrl: c.user?.avatar_url ?? '' },
          body: c.body ?? '',
          createdAt: c.created_at ?? updatedAt
        }
        deps.cache.set(url, updatedAt, comment)
        out.set(t.id, comment)
      } catch {
        // leave this thread without an enriched comment; it renders from the subject
      }
    })
  )
  return out
}
