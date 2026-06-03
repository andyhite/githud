import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FeedEvent, DashboardSnapshot, PullRequest } from '@shared/types'
import { api } from './api'
import { useDashboard } from './hooks/useDashboard'
import { TopBar } from './components/TopBar'
import { NeedsReviewTable } from './components/NeedsReviewTable'
import { MyPullRequestsTable } from './components/MyPullRequestsTable'
import { ActivityFeed } from './components/ActivityFeed'
import { TokenSetup } from './components/TokenSetup'
import { Settings } from './components/Settings'
import { sortNeedsReview, sortMyPrs } from './components/sort-prs'

export default function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [hasToken, setHasToken] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    api.getAuthStatus().then((s) => {
      setHasToken(s.hasToken)
      setAuthChecked(true)
    })
  }, [])

  if (!authChecked) return <div className="loading">Loading…</div>
  if (!hasToken) return <TokenSetup onSaved={(_login) => setHasToken(true)} />

  return <Dashboard onOpenSettings={() => setShowSettings(true)} showSettings={showSettings} onCloseSettings={() => setShowSettings(false)} />
}

function Dashboard({
  onOpenSettings,
  showSettings,
  onCloseSettings
}: {
  onOpenSettings: () => void
  showSettings: boolean
  onCloseSettings: () => void
}) {
  const { data: snapshot, refetch, isFetching } = useDashboard()
  // Before any snapshot (cold start, no disk cache yet) data is undefined.
  // Distinguish that from a genuinely-empty result so we don't flash the
  // cheerful "all caught up" empty states before the first data arrives.
  const loading = snapshot === undefined

  const qc = useQueryClient()
  const applyEvents = (events: FeedEvent[]) =>
    qc.setQueryData<DashboardSnapshot | null>(['dashboard'], (old) => (old ? { ...old, events } : old))
  const onRead = (id: string) => { void api.markRead(id).then(applyEvents) }
  const onReadAll = () => { void api.markAllRead().then(applyEvents) }
  const unread = snapshot?.events?.filter((e) => e.unread).length ?? 0

  const applySnapshot = (snap: DashboardSnapshot) => qc.setQueryData(['dashboard'], snap)
  const onHide = (pr: PullRequest) => { void api.hidePr(pr.id, pr.updatedAt).then(applySnapshot) }
  const onUnhide = (id: string) => { void api.unhidePr(id).then(applySnapshot) }
  const hiddenIds = snapshot?.hiddenPrIds ?? []
  const hiddenSet = new Set(hiddenIds)
  const visibleNeedsReview = (snapshot?.needsReview ?? []).filter((p) => !hiddenSet.has(p.id)).length
  const visibleMine = (snapshot?.myPullRequests ?? []).filter((p) => !hiddenSet.has(p.id)).length

  return (
    <div className="app">
      <TopBar
        snapshot={snapshot ?? null}
        onRefresh={() => refetch()}
        onOpenSettings={onOpenSettings}
        isFetching={isFetching}
      />
      <main className="layout">
        <section className="tables">
          <div className="panel">
            <h2>Needs my review <span className="count">{visibleNeedsReview}</span></h2>
            <NeedsReviewTable
              items={sortNeedsReview(snapshot?.needsReview ?? [])}
              hiddenIds={hiddenIds}
              onHide={onHide}
              onUnhide={onUnhide}
              loading={loading}
            />
          </div>
          <div className="panel">
            <h2>My open PRs <span className="count">{visibleMine}</span></h2>
            <MyPullRequestsTable
              items={sortMyPrs(snapshot?.myPullRequests ?? [])}
              hiddenIds={hiddenIds}
              onHide={onHide}
              onUnhide={onUnhide}
              loading={loading}
            />
          </div>
        </section>
        <aside className="rail panel">
          <h2>
            Activity <span className="count">{unread}</span>
            <span className="spacer" />
            {unread > 0 && <button className="link-button" onClick={onReadAll}>mark all read</button>}
          </h2>
          <ActivityFeed events={snapshot?.events ?? []} onRead={onRead} loading={loading} />
        </aside>
      </main>
      {showSettings && <Settings onClose={onCloseSettings} />}
    </div>
  )
}
