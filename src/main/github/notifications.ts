import type { Octokit } from 'octokit'

export function parsePollInterval(headers: Record<string, string | undefined>): number {
  const raw = headers['x-poll-interval']
  const n = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) ? n * 1000 : 60_000
}

export function shouldPollNotifications(opts: {
  lastFetchedAt: number | null
  pollIntervalMs: number
  now: number
}): boolean {
  if (opts.lastFetchedAt === null) return true
  return opts.now - opts.lastFetchedAt >= opts.pollIntervalMs
}

export interface NotificationsResult {
  threads: any[] // raw GitHub notification thread objects
  etag?: string
  pollIntervalMs: number
  notModified: boolean
}

// Fetches notifications using a conditional request. On 304 returns notModified=true
// and no threads (caller reuses cached activity).
export async function fetchNotifications(
  octokit: Octokit,
  opts: { etag?: string }
): Promise<NotificationsResult> {
  try {
    const res = await octokit.request('GET /notifications', {
      all: false,
      participating: false,
      headers: opts.etag ? { 'if-none-match': opts.etag } : {}
    })
    const headers = res.headers as Record<string, string | undefined>
    return {
      threads: res.data as any[],
      etag: headers.etag,
      pollIntervalMs: parsePollInterval(headers),
      notModified: false
    }
  } catch (err: any) {
    if (err?.status === 304) {
      const headers = (err.response?.headers ?? {}) as Record<string, string | undefined>
      return { threads: [], etag: opts.etag, pollIntervalMs: parsePollInterval(headers), notModified: true }
    }
    throw err
  }
}
