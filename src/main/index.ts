import { app, BrowserWindow, clipboard, ipcMain, Notification, shell } from 'electron'
import { join } from 'path'
import { DashboardSnapshot, Settings, AuthStatus } from '@shared/types'
import { hasToken, loadToken, saveToken, clearToken } from './token-store'
import { loadSettings, saveSettings } from './settings-store'
import { loadCachedSnapshot, cacheSnapshot } from './snapshot-cache'
import { markRead, markAllRead } from './event-store'
import { hidePr as storeHidePr, unhidePr as storeUnhidePr, loadHidden, resolveHidden } from './hidden-store'
import { createClient, validateToken } from './github/client'
import { filterEvents } from './github/filter-events'
import { Poller } from './poller'
import { diffSnapshots } from './notifier'
import { isSafeExternalUrl } from './safe-url'

const POLL_INTERVAL_MS = 30_000

let mainWindow: BrowserWindow | null = null
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
    loadHidden()
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

  ipcMain.handle('snoozePr', () => { throw new Error('not implemented') })
  ipcMain.handle('copyToClipboard', (_e, text: string) => { clipboard.writeText(String(text)) })
  ipcMain.handle('getAiStatus', () => ({ hasKey: false }))
  ipcMain.handle('saveAiKey', () => { throw new Error('not implemented') })
  ipcMain.handle('getTriage', () => null)
  ipcMain.handle('getDigest', () => { throw new Error('not implemented') })
  ipcMain.handle('getReview', () => { throw new Error('not implemented') })
}

app.whenReady().then(async () => {
  registerIpc()
  lastSnapshot = loadCachedSnapshot()
  createWindow()

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
