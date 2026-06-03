import { FeedEvent } from '@shared/types'
import { api } from '../api'
import { relativeAge } from './NeedsReviewTable'
import { EventIcon } from './icons'
import { severityForKind } from './activity-severity'

const ACTION: Record<FeedEvent['kind'], string> = {
  approved: 'approved',
  changes_requested: 'requested changes',
  review_commented: 'reviewed',
  comment: 'commented',
  mention: 'mentioned you',
  ci_failed: 'checks failed',
  ci_succeeded: 'checks passed',
  ci_regressed: 'checks regressed',
  review_requested: 'review requested',
  review_re_requested: 'review re-requested',
  changes_addressed: 'changes addressed',
  merged: 'merged',
  closed: 'closed'
}

function EventRow({ event, onRead }: { event: FeedEvent; onRead: (id: string) => void }) {
  const who = event.actor?.login
  const severity = severityForKind(event.kind)
  const open = () => {
    api.openExternal(event.url)
    onRead(event.id)
  }
  return (
    <div
      className={`activity-item sev-${severity}${event.unread ? ' unread' : ''}`}
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
      <EventIcon kind={event.kind} />
      <div className="activity-main">
        <div className="activity-head">
          {who && <span className="activity-author">{who}</span>}
          <span className="activity-action">{ACTION[event.kind]}</span>
          <span className="activity-time">{relativeAge(event.createdAt)}</span>
        </div>
        <div className="activity-title">{event.title}</div>
        <div className="activity-ctx">{event.repo} #{event.number}</div>
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
  if (events.length === 0) return <p className="empty">No recent activity.</p>
  return (
    <div className="activity-feed">
      {events.map((e) => <EventRow key={e.id} event={e} onRead={onRead} />)}
    </div>
  )
}
