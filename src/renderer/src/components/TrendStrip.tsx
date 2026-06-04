import { DailyMetric, FeedEvent } from '@shared/types'
import { queueMetric, wipMetric, mergesMetric, activityMetric, formatChurn, CardMetric } from './trend-metrics'
import { TrendChart } from './TrendChart'

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

function deltaText(
  metric: CardMetric,
  goodWhenUp: boolean,
  suffix: string
): { text: string; cls: string } | null {
  if (metric.delta === null || metric.delta === 0) {
    return metric.delta === 0 ? { text: `~ flat`, cls: 'flat' } : null
  }
  const up = metric.delta > 0
  const arrow = up ? '▲' : '▼'
  const cls = up === goodWhenUp ? 'up' : 'down'
  return { text: `${arrow} ${Math.abs(metric.delta)}${suffix}`, cls }
}

const DELTA_CLS: Record<string, string> = {
  up: 'text-sev-success',
  down: 'text-sev-failure',
  flat: 'text-muted-foreground'
}

export function TrendStrip({
  history,
  events
}: {
  history: DailyMetric[]
  events: FeedEvent[]
}) {
  const queue = queueMetric(history)
  const merges = mergesMetric(history)
  const wip = wipMetric(history)
  const activity = activityMetric(events, Date.now())

  const cards: Card[] = [
    { key: 'queue', label: 'Review queue', metric: queue, value: String(queue.current), viz: 'line', color: 'var(--sev-info)', goodWhenUp: false, deltaSuffix: '' },
    { key: 'merges', label: 'Merges / wk', metric: merges, value: String(merges.current), viz: 'bars', color: 'var(--sev-success)', goodWhenUp: true, deltaSuffix: '' },
    { key: 'wip', label: 'Open WIP', metric: wip, value: formatChurn(wip.current), viz: 'line', color: 'var(--sev-mention)', goodWhenUp: false, deltaSuffix: '' },
    { key: 'activity', label: 'Activity / day', metric: activity, value: String(activity.current), viz: 'bars', color: 'var(--sev-mention)', goodWhenUp: true, deltaSuffix: '' }
  ]

  return (
    <div className="hidden gap-3 px-3 pt-3 lg:grid lg:grid-cols-4">
      {cards.map((c) => {
        const empty = c.metric.series.length === 0
        const delta = deltaText(c.metric, c.goodWhenUp, c.deltaSuffix)
        return (
          <div key={c.key} className="rounded-lg border bg-card p-2 min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
            {empty ? (
              <div className="text-xs text-muted-foreground">collecting…</div>
            ) : (
              <>
                <div className="text-xl font-bold text-card-foreground">{c.value}</div>
                {delta ? (
                  <div className={`text-xs ${DELTA_CLS[delta.cls]}`}>{delta.text}</div>
                ) : (
                  <div className="text-xs text-muted-foreground">&nbsp;</div>
                )}
                <TrendChart values={c.metric.series} viz={c.viz} color={c.color} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
