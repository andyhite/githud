import { ActivityItem } from '@shared/types'
import { api } from '../api'
import { relativeAge } from './NeedsReviewTable'
import { ActivityIcon } from './icons'
import { classifyActivity } from './activity-severity'

// What happened, phrased as an action so each row reads "<who> <action>".
const REASON_LABEL: Record<string, string> = {
  mention: 'mentioned you',
  team_mention: 'mentioned your team',
  comment: 'commented',
  review_requested: 'requested your review',
  ci_activity: 'CI activity',
  assign: 'assigned you',
  author: 'updated your thread',
  state_change: 'changed state',
  subscribed: 'new activity'
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const who = item.latestComment?.author.login
  // A resolved state ("merged"/"closed"/"reopened") is clearer than "changed state".
  const action = item.subjectState ?? REASON_LABEL[item.reason] ?? item.reason
  const severity = classifyActivity(item)
  const open = () => api.openExternal(item.url)
  return (
    <div
      className={`activity-item sev-${severity}${item.unread ? ' unread' : ''}`}
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
      <ActivityIcon item={item} />
      <div className="activity-main">
        <div className="activity-head">
          {who && <span className="activity-author">{who}</span>}
          <span className="activity-action">{action}</span>
          <span className="activity-time">{relativeAge(item.updatedAt)}</span>
        </div>
        <div className="activity-title">{item.title}</div>
        <div className="activity-ctx">{item.repo}{item.number ? ` #${item.number}` : ''}</div>
      </div>
    </div>
  )
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="empty">No recent activity.</p>
  return (
    <div className="activity-feed">
      {items.map((item) => <ActivityRow key={item.id} item={item} />)}
    </div>
  )
}
