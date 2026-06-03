import { useEffect, useState, type ReactNode } from 'react'
import { DashboardSnapshot } from '@shared/types'
import { nextPollDelay, formatInterval, BASE_POLL_MS, RESERVE_FRACTION } from '@shared/poll-schedule'
import { RefreshCw, Settings, Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTheme } from './theme-provider'
import { relativeAge } from './pr-cells'

// Data older than ~2x the 30s poll interval is treated as stale.
const STALE_MS = 90_000

export function TopBar({
  snapshot,
  onRefresh,
  onOpenSettings,
  isFetching,
  pollBaseMs = BASE_POLL_MS,
  pollReserveFraction = RESERVE_FRACTION
}: {
  snapshot: DashboardSnapshot | null
  onRefresh: () => void
  onOpenSettings: () => void
  isFetching: boolean
  pollBaseMs?: number
  pollReserveFraction?: number
}) {
  const { theme, setTheme } = useTheme()

  // Tick so the relative age — and the stale escalation — keeps advancing even
  // when no snapshot arrives (silent timer stall / machine sleep), since the
  // component would otherwise only re-render on a snapshot push or refetch.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const ageMs = snapshot ? Date.now() - Date.parse(snapshot.fetchedAt) : 0
  const isStale = !!snapshot && !snapshot.error && ageMs > STALE_MS

  const rl = snapshot?.rateLimit
  const resetInMin = rl?.resetAt ? Math.max(1, Math.round((Date.parse(rl.resetAt) - Date.now()) / 60_000)) : 0

  // The interval the main poll loop will use next, derived from the same rate
  // limit (nextPollDelay is shared). Grows above the base when the budget is
  // low, which is why the count next to the refresh icon goes amber.
  const pollMs = rl ? nextPollDelay(rl, Date.now(), pollBaseMs, pollReserveFraction) : pollBaseMs
  const throttled = pollMs > pollBaseMs

  // One consolidated connection/freshness status (left, next to the brand).
  // Error states win over staleness; the happy path is a quiet "updated Nm ago".
  let status: ReactNode = null
  if (snapshot?.error) {
    status =
      snapshot.errorKind === 'rate_limit' ? (
        <span
          className="text-sm text-sev-mention"
          title={`GitHub API budget reached — auto-refresh is paused until it resets${resetInMin ? ` (~${resetInMin}m)` : ''}. Your token is fine; the budget is shared across all your tokens.`}
        >
          rate limited · waiting{resetInMin ? ` ~${resetInMin}m` : ''}
        </span>
      ) : (
        <span className="text-sm text-sev-mention" title="Can't reach GitHub — retrying automatically">
          offline · retrying
        </span>
      )
  } else if (isStale) {
    status = (
      <span
        className="text-sm text-sev-mention"
        title="Data may be out of date — the last refresh didn't complete recently"
      >
        stale · {relativeAge(snapshot.fetchedAt)} old
      </span>
    )
  } else if (snapshot) {
    status = <span className="text-sm text-muted-foreground">updated {relativeAge(snapshot.fetchedAt)} ago</span>
  }

  const refreshTitle = throttled
    ? `Refresh now · auto-refresh slowed to ${formatInterval(pollMs)} to conserve the GitHub API budget`
    : `Refresh now · auto-refreshes every ${formatInterval(pollMs)}`

  return (
    <header className="flex items-center gap-3 border-b bg-card px-3.5 py-2">
      <span className="font-bold text-card-foreground">githud</span>
      {status}
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={isFetching}
        aria-label="Refresh"
        title={refreshTitle}
      >
        <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        <span className={cn('text-xs', throttled && 'text-sev-mention')}>{formatInterval(pollMs)}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings" title="Settings">
        <Settings className="h-4 w-4" />
      </Button>
    </header>
  )
}
