import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FeedEvent, DashboardSnapshot, PullRequest, TriageVerdict, Settings as SettingsType, DEFAULT_SETTINGS } from '@shared/types'
import { api } from './api'
import { useDashboard } from './hooks/useDashboard'
import { TopBar } from './components/TopBar'
import { NeedsReviewTable, ShowHiddenToggle } from './components/NeedsReviewTable'
import { MyPullRequestsTable } from './components/MyPullRequestsTable'
import { ActivityFeed } from './components/ActivityFeed'
import { TokenSetup } from './components/TokenSetup'
import { Settings } from './components/Settings'
import { Digest } from './components/Digest'
import { ReviewPanel } from './components/ReviewPanel'
import { sortNeedsReview, sortMyPrs } from './components/sort-prs'
import { moveSelection } from './hooks/selection'
import { CommandPalette, Command } from './components/CommandPalette'
import { TrendStrip } from './components/TrendStrip'

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

  const [aiOn, setAiOn] = useState(false)
  const [showDigest, setShowDigest] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [verdicts, setVerdicts] = useState<Record<string, TriageVerdict>>({})
  const requested = useRef<Set<string>>(new Set())
  useEffect(() => { api.getAiStatus().then((s) => setAiOn(s.hasKey)) }, [])

  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS)
  useEffect(() => { api.getSettings().then(setSettings) }, [])
  const onToggleCharts = () => {
    const next = { ...settings, chartsCollapsed: !settings.chartsCollapsed }
    setSettings(next)
    void api.saveSettings(next)
  }

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
  const [showHiddenReview, setShowHiddenReview] = useState(false)
  const [showHiddenMine, setShowHiddenMine] = useState(false)
  const reviewItems = sortNeedsReview(snapshot?.needsReview ?? [], verdicts)
  const visibleReview = reviewItems.filter((p) => !hiddenSet.has(p.id))
  const mineItems = sortMyPrs(snapshot?.myPullRequests ?? [])
  const hiddenReviewCount = reviewItems.length - visibleReview.length
  const hiddenMineCount = mineItems.filter((p) => hiddenSet.has(p.id)).length

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

  useEffect(() => {
    if (!aiOn) return
    for (const pr of visibleReview) {
      if (requested.current.has(pr.id)) continue
      requested.current.add(pr.id)
      api.getTriage(pr.id).then((v) => { if (v) setVerdicts((m) => ({ ...m, [pr.id]: v })) })
    }
  }, [aiOn, visibleReview])

  const commands: Command[] = [
    { id: 'refresh', label: 'Refresh now', run: () => refetch() },
    { id: 'settings', label: 'Open settings', run: onOpenSettings },
    { id: 'readall', label: 'Mark all activity read', run: onReadAll },
    { id: 'digest', label: 'Catch me up', run: () => setShowDigest(true) }
  ]

  return (
    <div className="app">
      <TopBar
        snapshot={snapshot ?? null}
        onRefresh={() => refetch()}
        onOpenSettings={onOpenSettings}
        isFetching={isFetching}
      />
      <TrendStrip
        history={snapshot?.history ?? []}
        events={snapshot?.events ?? []}
        collapsed={settings.chartsCollapsed}
        onToggleCollapsed={onToggleCharts}
      />
      <main className="layout">
        <section className="tables">
          <div className="panel">
            <h2>
              Needs my review <span className="count">{visibleNeedsReview}</span>
              <span className="spacer" />
              <ShowHiddenToggle count={hiddenReviewCount} open={showHiddenReview} onToggle={() => setShowHiddenReview((v) => !v)} />
            </h2>
            <NeedsReviewTable
              items={reviewItems}
              hiddenIds={hiddenIds}
              showHidden={showHiddenReview}
              onHide={onHide}
              onUnhide={onUnhide}
              onSnooze={onSnooze}
              selectedId={visibleReview[selected]?.id}
              loading={loading}
              verdicts={verdicts}
              aiOn={aiOn}
              onReview={setReviewId}
            />
          </div>
          <div className="panel">
            <h2>
              My open PRs <span className="count">{visibleMine}</span>
              <span className="spacer" />
              <ShowHiddenToggle count={hiddenMineCount} open={showHiddenMine} onToggle={() => setShowHiddenMine((v) => !v)} />
            </h2>
            <MyPullRequestsTable
              items={mineItems}
              hiddenIds={hiddenIds}
              showHidden={showHiddenMine}
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
            {aiOn && <button className="link-button" onClick={() => setShowDigest(true)}>catch me up</button>}
            {unread > 0 && <button className="link-button" onClick={onReadAll}>mark all read</button>}
          </h2>
          <ActivityFeed events={snapshot?.events ?? []} onRead={onRead} loading={loading} />
        </aside>
      </main>
      {showSettings && <Settings onClose={onCloseSettings} />}
      {showDigest && <Digest onClose={() => setShowDigest(false)} />}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {reviewId && <ReviewPanel prId={reviewId} onClose={() => setReviewId(null)} />}
    </div>
  )
}
