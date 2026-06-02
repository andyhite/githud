// Resolves the "state_change" notification reason into a concrete label.
// The notifications API tells us a PR/issue's state changed but not what it
// changed to, so we fetch the subject and read its current state.

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

// Caches resolved state labels keyed by subject url, with the thread's
// updated_at as the freshness token (mirrors CommentCache).
export class StateCache {
  private map = new Map<string, { updatedAt: string; label: string }>()

  get(url: string, updatedAt: string): string | undefined {
    const entry = this.map.get(url)
    if (entry && entry.updatedAt === updatedAt) return entry.label
    return undefined
  }

  set(url: string, updatedAt: string, label: string): void {
    this.map.set(url, { updatedAt, label })
  }
}

type RequestFn = (url: string) => Promise<{ data: any }>

export async function enrichStates(
  threads: any[],
  deps: { cache: StateCache; request: RequestFn }
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  await Promise.all(
    threads.map(async (t) => {
      if (t.reason !== 'state_change') return
      const url: string | null = t.subject?.url ?? null
      if (!url) return
      const updatedAt: string = t.updated_at
      const cached = deps.cache.get(url, updatedAt)
      if (cached) {
        out.set(t.id, cached)
        return
      }
      try {
        const res = await deps.request(url)
        const label = subjectStateLabel(res.data, t.subject?.type ?? '')
        if (label) {
          deps.cache.set(url, updatedAt, label)
          out.set(t.id, label)
        }
      } catch {
        // leave this thread without a resolved state; it falls back to its reason
      }
    })
  )
  return out
}
