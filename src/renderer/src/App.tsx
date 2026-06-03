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
import { matchesPr, matchesEvent } from './components/match'
import { moveSelection } from './hooks/selection'
import { CommandPalette, Command } from './components/CommandPalette'

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
  const [query, setQuery] = useState('')
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
  const onSnooze = (pr: PullRequest, until: string) => { void api.snoozePr(pr.id, pr.updatedAt, until).then(applySnapshot) }
  const hiddenIds = snapshot?.hiddenPrIds ?? []
  const hiddenSet = new Set(hiddenIds)
  const visibleNeedsReview = (snapshot?.needsReview ?? []).filter((p) => !hiddenSet.has(p.id)).length
  const visibleMine = (snapshot?.myPullRequests ?? []).filter((p) => !hiddenSet.has(p.id)).length

  const [selected, setSelected] = useState(-1)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const reviewItems = sortNeedsReview((snapshot?.needsReview ?? []).filter((p) => matchesPr(p, query)))
  const visibleReview = reviewItems.filter((p) => !hiddenSet.has(p.id))

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); return }
      if (e.key === 'j') setSelected((i) => moveSelection(i, 'down', visibleReview.length))
      if (e.key === 'k') setSelected((i) => moveSelection(i, 'up', visibleReview.length))
      if (e.key === 'Enter' && selected >= 0 && visibleReview[selected]) api.openExternal(visibleReview[selected].url)
      if (e.key === 'e' && selected >= 0 && visibleReview[selected]) onHide(visibleReview[selected])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visibleReview, selected])

  const commands: Command[] = [
    { id: 'refresh', label: 'Refresh now', run: () => refetch() },
    { id: 'settings', label: 'Open settings', run: onOpenSettings },
    { id: 'readall', label: 'Mark all activity read', run: onReadAll }
  ]

  return (
    <div className="app">
      <TopBar
        snapshot={snapshot ?? null}
        onRefresh={() => refetch()}
        onOpenSettings={onOpenSettings}
        isFetching={isFetching}
        query={query}
        onQueryChange={setQuery}
      />
      <main className="layout">
        <section className="tables">
          <div className="panel">
            <h2>Needs my review <span className="count">{visibleNeedsReview}</span></h2>
            <NeedsReviewTable
              items={reviewItems}
              hiddenIds={hiddenIds}
              onHide={onHide}
              onUnhide={onUnhide}
              onSnooze={onSnooze}
              selectedId={visibleReview[selected]?.id}
              loading={loading}
            />
          </div>
          <div className="panel">
            <h2>My open PRs <span className="count">{visibleMine}</span></h2>
            <MyPullRequestsTable
              items={sortMyPrs((snapshot?.myPullRequests ?? []).filter((p) => matchesPr(p, query)))}
              hiddenIds={hiddenIds}
              onHide={onHide}
              onUnhide={onUnhide}
              onSnooze={onSnooze}
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
          <ActivityFeed events={(snapshot?.events ?? []).filter((e) => matchesEvent(e, query))} onRead={onRead} loading={loading} />
        </aside>
      </main>
      {showSettings && <Settings onClose={onCloseSettings} />}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
