import { useEffect, useState } from 'react'
import { api } from './api'
import { useDashboard } from './hooks/useDashboard'
import { TopBar } from './components/TopBar'
import { NeedsReviewTable } from './components/NeedsReviewTable'
import { MyPullRequestsTable } from './components/MyPullRequestsTable'
import { ActivityFeed } from './components/ActivityFeed'
import { TokenSetup } from './components/TokenSetup'
import { Settings } from './components/Settings'

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
            <h2>Needs my review <span className="count">{snapshot?.needsReview.length ?? 0}</span></h2>
            <NeedsReviewTable items={snapshot?.needsReview ?? []} />
          </div>
          <div className="panel">
            <h2>My open PRs <span className="count">{snapshot?.myPullRequests.length ?? 0}</span></h2>
            <MyPullRequestsTable items={snapshot?.myPullRequests ?? []} />
          </div>
        </section>
        <aside className="rail panel">
          <h2>Activity <span className="count">{snapshot?.activity.length ?? 0}</span></h2>
          <ActivityFeed items={snapshot?.activity ?? []} />
        </aside>
      </main>
      {showSettings && <Settings onClose={onCloseSettings} />}
    </div>
  )
}
