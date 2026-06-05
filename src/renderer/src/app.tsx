import { useEffect, useState } from 'react'
import { api } from './api'
import { useDashboard } from './hooks/use-dashboard'
import { useHideActions } from './hooks/use-hide-actions'
import { useReadState } from './hooks/use-read-state'
import { useTriageVerdicts } from './hooks/use-triage-verdicts'
import { useKeyboardNav } from './hooks/use-keyboard-nav'
import { useSettings } from './hooks/use-settings'
import { TopBar } from './components/top-bar'
import { Panel } from './components/panel'
import { PrTable } from './components/pr-table'
import { ShowHiddenToggle } from './components/pr-table'
import { Button } from '@/components/ui/button'
import { ActivityFeed } from './components/activity-feed'
import { TokenSetup } from './components/token-setup'
import { Settings } from './components/settings'
import { Digest } from './components/digest'
import { DigestPane } from './components/digest-pane'
import { useDigest } from './hooks/use-digest'
import { ReviewPanel } from './components/review-panel'
import { sortNeedsReview, sortMyPrs, sortTeamPrs } from '@/lib/sort-prs'
import { CommandPalette, Command } from './components/command-palette'
import { TrendStrip } from './components/trend-strip'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Chip } from './components/chip'
import { useNarrowViewport } from './hooks/use-narrow-viewport'

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

  if (!authChecked) return <div className="p-10 text-muted-foreground">Loading…</div>
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
  const digest = useDigest(aiOn)
  const [reviewId, setReviewId] = useState<string | null>(null)
  useEffect(() => { api.getAiStatus().then((s) => setAiOn(s.hasKey)) }, [])

  const { settings } = useSettings()

  const { onRead, onReadAll } = useReadState()
  const unread = snapshot?.events?.filter((e) => e.unread).length ?? 0

  const { onHide, onUnhide, onSnooze } = useHideActions()
  const hiddenIds = snapshot?.hiddenPrIds ?? []
  const hiddenSet = new Set(hiddenIds)

  const [selected, setSelected] = useState(-1)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [showHiddenReview, setShowHiddenReview] = useState(false)
  const [showHiddenMine, setShowHiddenMine] = useState(false)
  const [showHiddenTeam, setShowHiddenTeam] = useState(false)

  const visibleReviewForTriage = (snapshot?.needsReview ?? []).filter((p) => !hiddenSet.has(p.id))
  const verdicts = useTriageVerdicts(aiOn, visibleReviewForTriage)

  const reviewItems = sortNeedsReview(snapshot?.needsReview ?? [], verdicts)
  const mineItems = sortMyPrs(snapshot?.myPullRequests ?? [])
  const teamItems = sortTeamPrs(snapshot?.teamPullRequests ?? [])

  const visibleReview = reviewItems.filter((p) => !hiddenSet.has(p.id))
  const visibleNeedsReview = visibleReview.length
  const visibleMine = mineItems.filter((p) => !hiddenSet.has(p.id)).length
  const teamVisibleCount = teamItems.filter((p) => !hiddenSet.has(p.id)).length
  const hiddenReviewCount = reviewItems.length - visibleReview.length
  const hiddenMineCount = mineItems.filter((p) => hiddenSet.has(p.id)).length
  const hiddenTeamCount = teamItems.length - teamVisibleCount

  // The Other-PRs panel is opt-in: shown once any source dimension is configured.
  const hasOtherConfig =
    (settings.teamLabels?.length ?? 0) > 0 ||
    (settings.teamOrgs?.length ?? 0) > 0 ||
    (settings.otherTeam?.trim() ?? '') !== ''

  useKeyboardNav({
    visibleReview,
    selected,
    setSelected,
    onHide,
    onOpenPalette: () => setPaletteOpen(true)
  })

  const commands: Command[] = [
    { id: 'refresh', label: 'Refresh now', run: () => refetch() },
    { id: 'settings', label: 'Open settings', run: onOpenSettings },
    { id: 'readall', label: 'Mark all activity read', run: onReadAll },
    { id: 'digest', label: 'Catch me up', run: () => setShowDigest(true) }
  ]

  // Below lg the layout collapses to a single column and PR lists + the activity
  // feed move onto separate tabs (PrTable also switches to cards at this width).
  const narrow = useNarrowViewport()
  const prTotal = visibleNeedsReview + teamVisibleCount + visibleMine

  // Panels extracted so the same instances render in both the desktop two-column
  // grid and the narrow tabbed layout. `lg:flex-1` lets them share height in the
  // grid; below lg it's inert, so they grow with their content under the tabs.
  const pullRequestsPanels = (
    <>
      <Panel
        title="Needs my review"
        count={visibleNeedsReview}
        className="lg:flex-1"
        flush
        actions={<ShowHiddenToggle count={hiddenReviewCount} open={showHiddenReview} onToggle={() => setShowHiddenReview((v) => !v)} />}
      >
        <PrTable
          items={reviewItems}
          columns={aiOn ? ['diff', 'status', 'triage', 'age'] : ['diff', 'status', 'age']}
          emptyVariant="review"
          showAuthor
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
      </Panel>
      {hasOtherConfig && (
        <Panel
          title="Other PRs"
          count={teamVisibleCount}
          className="lg:flex-1"
          flush
          actions={<ShowHiddenToggle count={hiddenTeamCount} open={showHiddenTeam} onToggle={() => setShowHiddenTeam((v) => !v)} />}
        >
          <PrTable
            items={teamItems}
            columns={['diff', 'status', 'reviewers', 'age']}
            emptyVariant="team"
            showAuthor
            hiddenIds={hiddenIds}
            showHidden={showHiddenTeam}
            onHide={onHide}
            onUnhide={onUnhide}
            loading={loading}
          />
        </Panel>
      )}
      <Panel
        title="My open PRs"
        count={visibleMine}
        className="lg:flex-1"
        flush
        actions={<ShowHiddenToggle count={hiddenMineCount} open={showHiddenMine} onToggle={() => setShowHiddenMine((v) => !v)} />}
      >
        <PrTable
          items={mineItems}
          columns={['diff', 'status', 'reviewers', 'age']}
          emptyVariant="mine"
          hiddenIds={hiddenIds}
          showHidden={showHiddenMine}
          onHide={onHide}
          onUnhide={onUnhide}
          onSnooze={onSnooze}
          loading={loading}
        />
      </Panel>
    </>
  )

  const activityPanel = (
    <Panel
      title="Activity"
      count={unread}
      className="lg:flex-1"
      actions={
        <>
          {aiOn && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setShowDigest(true)}>
              catch me up
            </Button>
          )}
          {unread > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onReadAll}>
              mark all read
            </Button>
          )}
        </>
      }
    >
      <ActivityFeed events={snapshot?.events ?? []} onRead={onRead} loading={loading} />
    </Panel>
  )

  return (
    <div className="flex flex-col h-screen">
      <TopBar
        snapshot={snapshot ?? null}
        onRefresh={() => refetch()}
        onOpenSettings={onOpenSettings}
        isFetching={isFetching}
        pollBaseMs={Math.max(30, settings.refreshIntervalSeconds || 30) * 1000}
        pollReserveFraction={1 - Math.min(Math.max(settings.apiBudgetPercent || 80, 10), 100) / 100}
      />
      {/* Everything under the TopBar scrolls as one region. Below lg it's a single
          scrolling page and the panels grow with their content; at lg it's a
          fixed-height area (lg:overflow-hidden) with recap/trend pinned at the top
          and the panel grid filling the remaining height (panels scroll internally). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
        {/* Recap + trend are desktop-only chrome; on narrow the page is just the
            tab nav + its content. */}
        {!narrow && aiOn && digest?.markdown?.trim() && (
          <section className="border-b px-3 pt-3 pb-3">
            <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Recap · since you were away
            </p>
            <DigestPane digest={digest} />
          </section>
        )}
        <TrendStrip history={snapshot?.history ?? []} events={snapshot?.events ?? []} />
        {narrow ? (
          // Single-column layout: PR lists and the activity feed split onto tabs.
          // The wrapper above scrolls; tab content grows with its panels.
          <Tabs defaultValue="prs" className="gap-0">
            <TabsList variant="line" className="mx-3 mt-3">
              <TabsTrigger value="prs">
                Pull Requests
                <Chip tone="count">{prTotal}</Chip>
              </TabsTrigger>
              <TabsTrigger value="notifs">
                Notifications
                {unread > 0 && <Chip tone="count">{unread}</Chip>}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="prs" className="flex flex-col gap-3 p-3">
              {pullRequestsPanels}
            </TabsContent>
            <TabsContent value="notifs" className="flex flex-col p-3">
              {activityPanel}
            </TabsContent>
          </Tabs>
        ) : (
          // Two-column grid filling the fixed-height region; panels scroll internally.
          <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 overflow-hidden p-3">
            <div className="flex flex-col gap-3 min-h-0 min-w-0">{pullRequestsPanels}</div>
            <aside className="flex flex-col gap-3 min-h-0 min-w-0 overflow-hidden">{activityPanel}</aside>
          </main>
        )}
      </div>
      {showSettings && <Settings onClose={onCloseSettings} />}
      {showDigest && <Digest onClose={() => setShowDigest(false)} />}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {reviewId && (
        <ReviewPanel
          prId={reviewId}
          prUrl={snapshot?.needsReview.find((p) => p.id === reviewId)?.url}
          prTitle={snapshot?.needsReview.find((p) => p.id === reviewId)?.title}
          onClose={() => setReviewId(null)}
        />
      )}
    </div>
  )
}
