import { useEffect, useState } from 'react'
import { api } from './api'
import { useDashboard } from './hooks/useDashboard'
import { useHideActions } from './hooks/useHideActions'
import { useReadState } from './hooks/useReadState'
import { useTriageVerdicts } from './hooks/useTriageVerdicts'
import { useKeyboardNav } from './hooks/useKeyboardNav'
import { useSettings } from './hooks/useSettings'
import { TopBar } from './components/TopBar'
import { Panel } from './components/Panel'
import { PrTable } from './components/PrTable'
import { ShowHiddenToggle } from './components/RowActions'
import { Button } from '@/components/ui/button'
import { ActivityFeed } from './components/ActivityFeed'
import { TokenSetup } from './components/TokenSetup'
import { Settings } from './components/Settings'
import { Digest } from './components/Digest'
import { DigestPane } from './components/DigestPane'
import { useDigest } from './hooks/useDigest'
import { ReviewPanel } from './components/ReviewPanel'
import { sortNeedsReview, sortMyPrs, sortTeamPrs } from './components/sort-prs'
import { CommandPalette, Command } from './components/CommandPalette'
import { TrendStrip } from './components/TrendStrip'
import { LabelFilterChips } from './components/LabelFilterChips'
import { filterTeamPrs } from './components/team-filter'

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
  const visibleNeedsReview = (snapshot?.needsReview ?? []).filter((p) => !hiddenSet.has(p.id)).length
  const visibleMine = (snapshot?.myPullRequests ?? []).filter((p) => !hiddenSet.has(p.id)).length

  // Team panel: which configured labels the user has temporarily muted (chips
  // clicked off). Stays in renderer state — it's a transient view filter.
  const [mutedLabels, setMutedLabels] = useState<string[]>([])
  const toggleLabel = (label: string) =>
    setMutedLabels((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))
  const teamLabels = settings.teamLabels ?? []
  const teamItems = sortTeamPrs(snapshot?.teamPullRequests ?? [])
  const visibleTeam = filterTeamPrs(teamItems, teamLabels, mutedLabels)
  const teamVisibleCount = visibleTeam.filter((p) => !hiddenSet.has(p.id)).length
  const hiddenTeamCount = visibleTeam.length - teamVisibleCount

  const [selected, setSelected] = useState(-1)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [showHiddenReview, setShowHiddenReview] = useState(false)
  const [showHiddenMine, setShowHiddenMine] = useState(false)
  const [showHiddenTeam, setShowHiddenTeam] = useState(false)
  const visibleReviewForTriage = (snapshot?.needsReview ?? []).filter((p) => !hiddenSet.has(p.id))
  const verdicts = useTriageVerdicts(aiOn, visibleReviewForTriage)
  const reviewItems = sortNeedsReview(snapshot?.needsReview ?? [], verdicts)
  const visibleReview = reviewItems.filter((p) => !hiddenSet.has(p.id))
  const mineItems = sortMyPrs(snapshot?.myPullRequests ?? [])
  const hiddenReviewCount = reviewItems.length - visibleReview.length
  const hiddenMineCount = mineItems.filter((p) => hiddenSet.has(p.id)).length

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
      {aiOn && digest?.markdown?.trim() && (
        <section className="border-b px-3 pt-3 pb-3">
          <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Recap · since you were away
          </p>
          <DigestPane digest={digest} />
        </section>
      )}
      <TrendStrip history={snapshot?.history ?? []} events={snapshot?.events ?? []} />
      <main className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 p-3 flex-1 overflow-hidden">
        <div className="flex flex-col gap-3 min-h-0 min-w-0">
          <Panel
            title="Needs my review"
            count={visibleNeedsReview}
            className="flex-1"
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
          {teamLabels.length > 0 && (
            <Panel
              title="Team PRs"
              count={teamVisibleCount}
              className="flex-1"
              flush
              actions={
                <>
                  <LabelFilterChips labels={teamLabels} muted={mutedLabels} onToggle={toggleLabel} />
                  <ShowHiddenToggle count={hiddenTeamCount} open={showHiddenTeam} onToggle={() => setShowHiddenTeam((v) => !v)} />
                </>
              }
            >
              <PrTable
                items={visibleTeam}
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
            className="flex-1"
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
        </div>
        <aside className="flex flex-col gap-3 min-h-0 min-w-0 overflow-hidden">
          <Panel
            title="Activity"
            count={unread}
            className="flex-1"
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
        </aside>
      </main>
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
