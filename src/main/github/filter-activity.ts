import { ActivityItem } from '@shared/types'

export function isBotLogin(login: string): boolean {
  return /\[bot\]$/i.test(login)
}

export function filterActivity(
  items: ActivityItem[],
  opts: { excludedAuthors: string[]; hideBots: boolean }
): ActivityItem[] {
  const denied = new Set(opts.excludedAuthors.map((a) => a.toLowerCase()))
  return items.filter((item) => {
    const login = item.latestComment?.author.login
    if (!login) return true // keep items we can't attribute (e.g. ci_activity)
    if (opts.hideBots && isBotLogin(login)) return false
    if (denied.has(login.toLowerCase())) return false
    return true
  })
}
