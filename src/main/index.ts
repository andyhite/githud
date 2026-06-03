import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { join } from 'path'
import { DashboardSnapshot, Settings, AuthStatus } from '@shared/types'
import { hasToken, loadToken, saveToken, clearToken } from './token-store'
import { loadSettings, saveSettings } from './settings-store'
import { loadCachedSnapshot, cacheSnapshot } from './snapshot-cache'
import { markRead, markAllRead } from './event-store'
import { hidePr as storeHidePr, unhidePr as storeUnhidePr, snoozePr as storeSnoozePr, loadHidden, resolveHidden } from './hidden-store'
import { hasAiKey, saveAiKey as storeAiKey, loadAiKey } from './ai/key-store'
import { validateAiKey, createAiClient } from './ai/client'
import { loadCache, saveCache, cacheKey } from './ai/cache'
import { triagePr } from './ai/triage'
import { buildDigest } from './ai/digest'
import { reviewPr } from './ai/review'
import { fetchPrDiff } from './github/fetch-diff'
import type { TriageVerdict, ReviewResult } from '@shared/types'
import { createClient, validateToken } from './github/client'
import { filterEvents } from './github/filter-events'
import { Poller } from './poller'
import { diffSnapshots } from './notifier'
import { isSafeExternalUrl } from './safe-url'
import { visibleNeedsReviewCount, dockBadge } from './tray-label'

const POLL_INTERVAL_MS = 30_000

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let poller: Poller | null = null
let timer: ReturnType<typeof setInterval> | null = null
let lastSnapshot: DashboardSnapshot | null = null
let viewerLogin: string | undefined
let inFlightPoll: Promise<DashboardSnapshot> | null = null
let rerunRequested = false
// The notification baseline is gated on this flag, NOT on lastSnapshot===null:
// lastSnapshot is pre-seeded from the disk cache for the renderer, so the first
// live poll must be recognized explicitly to honor the "seed silently" contract.
let baselineSeeded = false

function sendSnapshot(snap: DashboardSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('snapshot', snap)
  }
  updateTray(snap)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'githud',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Defense in depth: the only sanctioned path to the OS browser is the
  // isSafeExternalUrl-gated openExternal IPC. Block in-window navigation and
  // window.open so stray markup/links can't load remote content into this
  // privileged window (which exposes the preload bridge) or spawn child windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const current = mainWindow?.webContents.getURL()
    try {
      // Allow same-origin navigations (dev server HMR / client routing / file load).
      if (current && new URL(url).origin === new URL(current).origin) return
    } catch {
      // unparseable — fall through to deny
    }
    e.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })

  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('focus', () => { if (hasToken()) void runPoll() })
}

function applyLoginItem(settings: Settings): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  try {
    // Only touch the OS when the desired state differs from the current one.
    // setLoginItemSettings logs a native "Operation not permitted" error to
    // stderr on unsigned/dev macOS builds (can't be caught — it doesn't throw),
    // so skipping the no-op call keeps the default (disabled) path silent.
    if (app.getLoginItemSettings().openAtLogin === settings.launchAtLogin) return
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
  } catch (err) {
    console.warn('[login-item] could not update launch-at-login (expected on unsigned/dev builds):', err)
  }
}

function updateTray(snap: DashboardSnapshot | null): void {
  const count = snap ? visibleNeedsReviewCount(snap) : 0
  if (tray) tray.setTitle(count > 0 ? ` ${count}` : '')
  if (process.platform === 'darwin' && app.dock) app.dock.setBadge(dockBadge(count))
}

function createTray(): void {
  if (tray) return
  // Empty image + text title is the lightest cross-platform tray on macOS,
  // avoiding a bundled icon asset; the count rides in the title.
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('githud')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open githud', click: () => { if (mainWindow) mainWindow.show(); else createWindow() } },
      { label: 'Refresh now', click: () => { if (hasToken()) void runPoll() } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
}

function ensurePoller(): boolean {
  if (poller) return true
  const token = loadToken()
  if (!token) return false
  poller = new Poller(createClient(token))
  return true
}

function fireNotifications(prev: DashboardSnapshot | null, next: DashboardSnapshot, settings: Settings): void {
  if (!settings.notificationsEnabled || !Notification.isSupported()) return
  const specs = diffSnapshots(prev, next, {
    notifyKinds: settings.notifyKinds,
    now: new Date(),
    quietHours: settings.quietHours
  })
  for (const spec of specs) {
    const n = new Notification({ title: spec.title, body: spec.body })
    if (spec.url && isSafeExternalUrl(spec.url)) n.on('click', () => shell.openExternal(spec.url!))
    n.show()
  }
}

async function doPoll(): Promise<DashboardSnapshot> {
  if (!ensurePoller()) {
    throw new Error('No token configured')
  }
  const settings = loadSettings()
  try {
    const snapshot = await poller!.refresh(settings)
    // First successful poll only seeds the baseline; it intentionally fires
    // nothing, even though lastSnapshot may be a non-null disk-cache seed.
    fireNotifications(baselineSeeded ? lastSnapshot : null, snapshot, settings)
    baselineSeeded = true
    lastSnapshot = snapshot
    cacheSnapshot(snapshot)
    sendSnapshot(snapshot)
    return snapshot
  } catch (err: any) {
    // Surface the underlying failure in the logs — the renderer only shows a
    // generic "offline — retrying" badge, so this is the only place to see why.
    console.error('[poll] refresh failed:', err?.status ?? '', err?.message ?? err, err?.errors ?? '')
    // Keep last good data; surface the error on a degraded snapshot.
    const degraded: DashboardSnapshot = lastSnapshot
      ? { ...lastSnapshot, error: err?.message ?? 'Refresh failed' }
      : {
          fetchedAt: new Date().toISOString(),
          viewer: { login: viewerLogin ?? '', avatarUrl: '' },
          needsReview: [], myPullRequests: [], events: [], hiddenPrIds: [],
          rateLimit: { remaining: 0, resetAt: '' },
          error: err?.message ?? 'Refresh failed'
        }
    sendSnapshot(degraded)
    return degraded
  }
}

function runPoll(): Promise<DashboardSnapshot> {
  // Coalesce concurrent callers, but if a poll is requested while one is in
  // flight (e.g. saveSettings/focus), schedule exactly one fresh poll after it
  // so the latest persisted settings are honored rather than silently dropped.
  if (inFlightPoll) {
    rerunRequested = true
    return inFlightPoll
  }
  inFlightPoll = doPoll().finally(() => {
    inFlightPoll = null
    if (rerunRequested) {
      rerunRequested = false
      void runPoll()
    }
  })
  return inFlightPoll
}

function startPolling(): void {
  if (timer) return
  timer = setInterval(() => { void runPoll() }, POLL_INTERVAL_MS)
  void runPoll()
}

// Recompute hiddenPrIds against the in-memory snapshot (no network) and push it.
function recomputeHidden(): DashboardSnapshot | null {
  if (!lastSnapshot) return null
  const { hiddenIds } = resolveHidden(
    [...lastSnapshot.needsReview, ...lastSnapshot.myPullRequests].map((p) => ({
      id: p.id,
      updatedAt: p.updatedAt
    })),
    loadHidden(),
    Date.now()
  )
  const next = { ...lastSnapshot, hiddenPrIds: hiddenIds }
  lastSnapshot = next
  cacheSnapshot(next)
  sendSnapshot(next)
  return next
}

function registerIpc(): void {
  ipcMain.handle('getSnapshot', () => lastSnapshot ?? loadCachedSnapshot())

  ipcMain.handle('refresh', () => runPoll())

  ipcMain.handle('getAuthStatus', async (): Promise<AuthStatus> => {
    if (!hasToken()) return { hasToken: false }
    return { hasToken: true, login: viewerLogin }
  })

  ipcMain.handle('saveToken', async (_e, token: string) => {
    const viewer = await validateToken(token)
    if (!viewer) return { ok: false, error: 'Token rejected by GitHub. Check the value and scopes.' }
    saveToken(token)
    viewerLogin = viewer.login
    poller = new Poller(createClient(token))
    // New token = new data source (possibly a different account). Drop the old
    // baseline so the first poll seeds silently instead of diffing across
    // identities and firing a spurious notification burst.
    lastSnapshot = null
    baselineSeeded = false
    startPolling()
    return { ok: true, login: viewer.login }
  })

  ipcMain.handle('getSettings', (): Settings => loadSettings())
  ipcMain.handle('saveSettings', (_e, settings: Settings): Settings => {
    const saved = saveSettings(settings)
    applyLoginItem(saved)
    void runPoll() // re-apply filters immediately
    return saved
  })

  ipcMain.handle('openExternal', (_e, url: string) => {
    if (isSafeExternalUrl(url)) return shell.openExternal(url)
  })

  // The event store holds the full unfiltered set; the renderer only ever shows
  // the filtered feed (poller.refresh applies the same filter). Filter here too
  // so reading an event doesn't resurface hidden bot/excluded-author events.
  const filterForUi = (events: ReturnType<typeof markRead>) => {
    const { excludedAuthors, hideBots } = loadSettings()
    return filterEvents(events, { excludedAuthors, hideBots })
  }
  ipcMain.handle('markRead', (_e, id: string) => filterForUi(markRead(id)))
  ipcMain.handle('markAllRead', () => filterForUi(markAllRead()))

  ipcMain.handle('hidePr', (_e, id: string, updatedAt: string) => {
    storeHidePr(id, updatedAt)
    return recomputeHidden() ?? lastSnapshot
  })
  ipcMain.handle('unhidePr', (_e, id: string) => {
    storeUnhidePr(id)
    return recomputeHidden() ?? lastSnapshot
  })

  ipcMain.handle('snoozePr', (_e, id: string, updatedAt: string, until: string) => {
    storeSnoozePr(id, updatedAt, until)
    return recomputeHidden() ?? lastSnapshot
  })
  ipcMain.handle('copyToClipboard', (_e, text: string) => { clipboard.writeText(text ?? '') })
  ipcMain.handle('getAiStatus', () => ({ hasKey: hasAiKey() }))
  ipcMain.handle('saveAiKey', async (_e, key: string) => {
    if (!(await validateAiKey(key))) return { ok: false, error: 'Anthropic rejected the key.' }
    storeAiKey(key)
    return { ok: true }
  })
  ipcMain.handle('getTriage', async (_e, prId: string): Promise<TriageVerdict | null> => {
    const key = loadAiKey()
    if (!key || !lastSnapshot) return null
    // Triage is a needs-review affordance only (unlike getReview, which also
    // covers your own PRs); a non-needs-review prId legitimately resolves to null.
    const pr = lastSnapshot.needsReview.find((p) => p.id === prId)
    if (!pr) return null
    const headKey = pr.updatedAt // coarse head key; advances on new commits
    const cache = loadCache()
    const cached = cache[cacheKey('triage', prId, headKey)] as TriageVerdict | undefined
    if (cached) return cached
    if (!ensurePoller() || !poller) return null
    try {
      const diff = await fetchPrDiff(poller.client, pr.repo, pr.number)
      const verdict = await triagePr(createAiClient(key), prId, headKey, pr.title, diff, new Date().toISOString())
      cache[cacheKey('triage', prId, headKey)] = verdict
      saveCache(cache)
      return verdict
    } catch {
      return null
    }
  })
  ipcMain.handle('getDigest', async () => {
    const key = loadAiKey()
    if (!key) throw new Error('No AI key configured')
    if (!lastSnapshot) throw new Error('No data yet')
    return buildDigest(createAiClient(key), lastSnapshot, new Date().toISOString())
  })
  ipcMain.handle('getReview', async (_e, prId: string): Promise<ReviewResult> => {
    const key = loadAiKey()
    if (!key) throw new Error('No AI key configured')
    if (!lastSnapshot) throw new Error('No data yet')
    const pr = [...lastSnapshot.needsReview, ...lastSnapshot.myPullRequests].find((p) => p.id === prId)
    if (!pr) throw new Error('PR not found')
    const headKey = pr.updatedAt
    const cache = loadCache()
    const cached = cache[cacheKey('review', prId, headKey)] as ReviewResult | undefined
    if (cached) return cached
    if (!ensurePoller() || !poller) throw new Error('No token configured')
    const diff = await fetchPrDiff(poller.client, pr.repo, pr.number)
    const result = await reviewPr(createAiClient(key), prId, headKey, pr.title, diff, new Date().toISOString())
    cache[cacheKey('review', prId, headKey)] = result
    saveCache(cache)
    return result
  })
}

app.whenReady().then(async () => {
  registerIpc()
  lastSnapshot = loadCachedSnapshot()
  applyLoginItem(loadSettings())
  createWindow()
  createTray()

  // If a token already exists, validate it (for viewer login) and start polling.
  const token = loadToken()
  if (token) {
    const viewer = await validateToken(token)
    if (viewer) {
      viewerLogin = viewer.login
      startPolling()
    } else {
      clearToken() // stale/invalid token -> renderer will show setup
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
