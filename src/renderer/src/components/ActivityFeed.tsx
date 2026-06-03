import { FeedEvent } from '@shared/types'
import { api } from '../api'
import { relativeAge } from './pr-cells'
import { EventIcon } from './icons'
import { severityForKind } from './activity-severity'
import { EmptyState } from './EmptyState'
import { cn } from '@/lib/utils'

const ACTION: Record<FeedEvent['kind'], string> = {
  approved: 'approved',
  changes_requested: 'requested changes',
  review_commented: 'reviewed',
  comment: 'commented',
  mention: 'mentioned you',
  ci_failed: 'checks failed',
  ci_succeeded: 'checks passed',
  ci_regressed: 'CI regressed',
  review_requested: 'review requested',
  review_re_requested: 're-review requested',
  changes_addressed: 'addressed your review',
  merged: 'merged',
  closed: 'closed'
}

const SEV = {
  info: { border: 'border-l-sev-info', icon: 'text-sev-info', unread: 'bg-sev-info/10', hover: 'hover:bg-sev-info/20' },
  failure: { border: 'border-l-sev-failure', icon: 'text-sev-failure', unread: 'bg-sev-failure/10', hover: 'hover:bg-sev-failure/20' },
  success: { border: 'border-l-sev-success', icon: 'text-sev-success', unread: 'bg-sev-success/10', hover: 'hover:bg-sev-success/20' },
  mention: { border: 'border-l-sev-mention', icon: 'text-sev-mention', unread: 'bg-sev-mention/10', hover: 'hover:bg-sev-mention/20' }
} as const

function EventRow({ event, onRead }: { event: FeedEvent; onRead: (id: string) => void }) {
  const who = event.actor?.login
  const sev = SEV[severityForKind(event.kind)]
  const open = () => {
    api.openExternal(event.url)
    onRead(event.id)
  }
  return (
    <div
      className={cn(
        'flex w-full gap-2 rounded-md border border-l-[3px] bg-background p-2 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-sev-info',
        sev.border,
        sev.hover,
        event.unread && sev.unread
      )}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
    >
      <span className="flex-none pt-0.5">
        <EventIcon kind={event.kind} className={sev.icon} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          {who && <span className="font-semibold text-card-foreground">{who}</span>}
          <span className="text-muted-foreground">{ACTION[event.kind]}</span>
          <span className="ml-auto text-xs text-muted-foreground">{relativeAge(event.createdAt)}</span>
        </div>
        <div className="text-card-foreground break-words">{event.title}</div>
        <div className="text-xs text-sev-info">{event.repo} #{event.number}</div>
      </div>
    </div>
  )
}

export function ActivityFeed({
  events,
  onRead,
  loading
}: { events: FeedEvent[]; onRead: (id: string) => void; loading?: boolean }) {
  if (loading && events.length === 0) return <p className="empty">Loading…</p>
  if (events.length === 0) return <EmptyState variant="activity" />
  return (
    <div className="flex flex-col gap-2">
      {events.map((e) => <EventRow key={e.id} event={e} onRead={onRead} />)}
    </div>
  )
}
