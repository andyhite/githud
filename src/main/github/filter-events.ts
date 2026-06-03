import { FeedEvent } from '@shared/types'

export function isBotLogin(login: string): boolean {
  return /\[bot\]$/i.test(login)
}

export function filterEvents(
  events: FeedEvent[],
  opts: { excludedAuthors: string[]; hideBots: boolean }
): FeedEvent[] {
  const denied = new Set(opts.excludedAuthors.map((a) => a.toLowerCase()))
  return events.filter((e) => {
    const login = e.actor?.login
    if (!login) return true // keep events we can't attribute (CI, lifecycle)
    if (opts.hideBots && isBotLogin(login)) return false
    if (denied.has(login.toLowerCase())) return false
    return true
  })
}
