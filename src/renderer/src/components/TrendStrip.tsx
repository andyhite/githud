import { DailyMetric, FeedEvent } from '@shared/types'
import { queueMetric, wipMetric, mergesMetric, activityMetric, formatChurn, CardMetric } from './trend-metrics'
import { Sparkline } from './Sparkline'
import { MiniBars } from './MiniBars'

type Viz = 'line' | 'bars'

interface Card {
  key: string
  label: string
  metric: CardMetric
  value: string
  viz: Viz
  color: string
  goodWhenUp: boolean
  deltaSuffix: string
}

function deltaText(metric: CardMetric, goodWhenUp: boolean, suffix: string): { text: string; cls: string } | null {
  if (metric.delta === null || metric.delta === 0) {
    return metric.delta === 0 ? { text: `~ flat`, cls: 'flat' } : null
  }
  const up = metric.delta > 0
  const arrow = up ? '▲' : '▼'
  const cls = up === goodWhenUp ? 'up' : 'down'
  return { text: `${arrow} ${Math.abs(metric.delta)}${suffix}`, cls }
}

export function TrendStrip({
  history,
  events,
  collapsed,
  onToggleCollapsed
}: {
  history: DailyMetric[]
  events: FeedEvent[]
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const queue = queueMetric(history)
  const merges = mergesMetric(history)
  const wip = wipMetric(history)
  const activity = activityMetric(events, Date.now())

  const cards: Card[] = [
    { key: 'queue', label: 'Review queue', metric: queue, value: String(queue.current), viz: 'line', color: 'var(--blue)', goodWhenUp: false, deltaSuffix: '' },
    { key: 'merges', label: 'Merges / wk', metric: merges, value: String(merges.current), viz: 'bars', color: 'var(--green)', goodWhenUp: true, deltaSuffix: '' },
    { key: 'wip', label: 'Open WIP', metric: wip, value: formatChurn(wip.current), viz: 'line', color: 'var(--amber)', goodWhenUp: false, deltaSuffix: '' },
    { key: 'activity', label: 'Activity / day', metric: activity, value: String(activity.current), viz: 'bars', color: 'var(--amber)', goodWhenUp: true, deltaSuffix: '' }
  ]

  return (
    <div className={`trend-strip${collapsed ? ' collapsed' : ''}`}>
      <button className="trend-toggle" onClick={onToggleCollapsed} aria-label={collapsed ? 'Show trends' : 'Hide trends'}>
        {collapsed ? '▸ Trends' : '▾ Trends'}
      </button>
      {!collapsed && (
        <div className="trend-cards">
          {cards.map((c) => {
            const empty = c.metric.series.length === 0
            const delta = deltaText(c.metric, c.goodWhenUp, c.deltaSuffix)
            return (
              <div key={c.key} className="trend-card">
                <div className="lbl">{c.label}</div>
                {empty ? (
                  <div className="collecting">collecting…</div>
                ) : (
                  <>
                    <div className="val">{c.value}</div>
                    {delta ? <div className={`delta ${delta.cls}`}>{delta.text}</div> : <div className="delta flat">&nbsp;</div>}
                    {c.viz === 'line' ? (
                      <Sparkline values={c.metric.series} color={c.color} />
                    ) : (
                      <MiniBars values={c.metric.series} color={c.color} />
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
