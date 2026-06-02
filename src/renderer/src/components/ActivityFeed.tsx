import { ActivityItem } from '@shared/types'
import { api } from '../api'
import { relativeAge } from './NeedsReviewTable'

const REASON_LABEL: Record<string, string> = {
  mention: 'mention',
  team_mention: 'team mention',
  comment: 'comment',
  review_requested: 'review requested',
  ci_activity: 'ci activity',
  assign: 'assigned',
  author: 'author',
  state_change: 'state change',
  subscribed: 'subscribed'
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <button className={`activity-item${item.unread ? ' unread' : ''}`} onClick={() => api.openExternal(item.url)}>
      <div className="activity-head">
        {item.latestComment && <span className="activity-author">{item.latestComment.author.login}</span>}
        <span className="reason-badge">{REASON_LABEL[item.reason] ?? item.reason}</span>
        <span className="activity-ctx">{item.repo}{item.number ? ` #${item.number}` : ''}</span>
        <span className="activity-time">{relativeAge(item.updatedAt)}</span>
      </div>
      <div className="activity-title">{item.title}</div>
      {item.latestComment && <div className="activity-body">{item.latestComment.body}</div>}
    </button>
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
