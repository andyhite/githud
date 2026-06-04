import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { join } from 'path'
import { DashboardSnapshot, Settings, AuthStatus } from '@shared/types'
import { hasToken, loadToken, saveToken, clearToken } from './token-store'
import { loadSettings, saveSettings } from './settings-store'
import { loadCachedSnapshot, cacheSnapshot } from './snapshot-cache'
import { markRead, markAllRead } from './event-store'
import { hidePr as storeHidePr, unhidePr as storeUnhidePr, snoozePr as storeSnoozePr, loadHidden, resolveHidden } from './hidden-store'
import { hasAiKey, saveAiKey as storeAiKey, loadAiKey, clearAiKey } from './ai/key-store'
import { validateAiKey, createAiClient } from './ai/client'
import { loadCache, saveCache, cacheKey, clearCache } from './ai/cache'
import { triagePr } from './ai/triage'
import { buildDigest, digestFingerprint, eventsSince, buildDeltaDigest } from './ai/digest'
import { reviewPr } from './ai/review'
import { parseDiffAnchors } from './github/parse-diff-anchors'
import { anchorFindings } from './ai/anchor-findings'
import { postReview as postReviewToGithub } from './github/post-review'
import { loadReviewInstructions, saveReviewInstructions, resetReviewInstructions } from './ai/review-instructions-store'
import { fetchPrDiff } from './github/fetch-diff'
import type { TriageVerdict, ReviewResult, PostReviewPayload, PostReviewResult } from '@shared/types'
import { createClient, validateToken } from './github/client'
import { filterEvents, applyAuthorFilters } from './github/filter-events'
import { Poller } from './poller'
import { diffSnapshots } from './notifier'
import { isSafeExternalUrl } from './safe-url'
import { visibleNeedsReviewCount, dockBadge } from './tray-label'
import { nextPollDelay } from '@shared/poll-schedule'
import { parseRateLimitError } from './github/rate-limit'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let poller: Poller | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
let polling = false
let lastSnapshot: DashboardSnapshot | null = null
let viewerLogin: string | undefined
let inFlightPoll: Promise<DashboardSnapshot> | null = null
let rerunRequested = false
// The notification baseline is gated on this flag, NOT on lastSnapshot===null:
// lastSnapshot is pre-seeded from the disk cache for the renderer, so the first
// live poll must be recognized explicitly to honor the "seed silently" contract.
let baselineSeeded = false
// Brief delta-digest state. lastFocusAt marks the start of the current "away"
// window; it advances only after a delta digest is generated. digestInFlight
// coalesces the win-focus / did-become-active double-fire on macOS.
let lastFocusAt = new Date().toISOString()
let digestInFlight = false

function sendSnapshot(snap: DashboardSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('snapshot', snap)
  }
  updateTray(snap)
}

// Generate the brief "since you were away" digest if the feed has anything new
// since lastFocusAt. No new events -> no Claude call, no token spend, and the
// renderer keeps showing its last digest. Quietly no-ops without an AI key.
async function maybeGenerateDeltaDigest(): Promise<void> {
  if (digestInFlight) return
  const key = loadAiKey()
  if (!key || !lastSnapshot) return
  const since = lastFocusAt
  if (eventsSince(lastSnapshot.events, since).length === 0) return
  digestInFlight = true
  try {
    const result = await buildDeltaDigest(createAiClient(key), lastSnapshot, since, new Date().toISOString())
    lastFocusAt = new Date().toISOString()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('digest', result)
  } catch (err: any) {
    console.error('[digest] delta refresh failed:', err?.message ?? err)
  } finally {
    digestInFlight = false
  }
}

// App brought to the foreground: refresh so the delta reflects current state,
// then regenerate the brief digest. Does NOT clear the tray/dock badge (that
// reflects the needs-review count, not unread).
//
// But the adaptive loop backs off when the shared GraphQL budget runs low, and
// each poll is expensive (~67 points). A foreground poll bypasses the loop's
// timer, so without this gate, rapidly switching back to the app would drain
// the budget the backoff is trying to protect. When we're throttled (the next
// scheduled delay exceeds the base cadence), skip the network poll and just
// regenerate the digest off the cached snapshot. The auto loop still polls on
// its (backed-off) schedule, and the manual Refresh button remains an explicit
// override that always hits GitHub.
function onForeground(): void {
  if (!hasToken()) return
  const { baseMs, reserveFraction } = pollCadence()
  const throttled =
    !!lastSnapshot && nextPollDelay(lastSnapshot.rateLimit, Date.now(), baseMs, reserveFraction) > baseMs
  if (throttled) {
    void maybeGenerateDeltaDigest()
    return
  }
  void runPoll().then(() => maybeGenerateDeltaDigest())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // Floor for the single-column/card layout — below this the cards, tab bar,
    // and top bar stop laying out sensibly, so don't let the window get smaller.
    minWidth: 440,
    minHeight: 520,
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
  mainWindow.on('focus', onForeground)
}

function applyLoginItem(settings: Settings): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  // Only register a login item in a real production build. In dev (`pnpm run
  // dev`) `app.isPackaged` is false and the "app" is the Electron binary itself
  // — registering it as a login item would launch raw Electron at every boot.
  if (!app.isPackaged) return
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
    // viewerLogin scopes the team search to your own repos; pass whatever we know
    // (set at startup/saveToken, refreshed below) — the poll still works without it.
    const snapshot = await poller!.refresh(settings, viewerLogin)
    // First successful poll only seeds the baseline; it intentionally fires
    // nothing, even though lastSnapshot may be a non-null disk-cache seed.
    fireNotifications(baselineSeeded ? lastSnapshot : null, snapshot, settings)
    baselineSeeded = true
    lastSnapshot = snapshot
    // Keep viewerLogin current so the next poll can scope the team search even if
    // startup validation was skipped/rate-limited.
    if (snapshot.viewer?.login) viewerLogin = snapshot.viewer.login
    const rl = snapshot.rateLimit
    console.log(`[poll] graphql cost=${rl.cost ?? '?'} remaining=${rl.remaining}${rl.limit ? '/' + rl.limit : ''} resetAt=${rl.resetAt}`)
    cacheSnapshot(snapshot)
    sendSnapshot(snapshot)
    return snapshot
  } catch (err: any) {
    // Surface the underlying failure in the logs — the renderer only shows a
    // generic "offline — retrying" badge, so this is the only place to see why.
    console.error('[poll] refresh failed:', err?.status ?? '', err?.message ?? err, err?.errors ?? '')
    // If GitHub told us we're rate-limited, use the authoritative reset window
    // from the error headers so the adaptive loop backs off exactly — rather
    // than off the last successful poll's now-stale numbers.
    const parsedRl = parseRateLimitError(err, Date.now())
    if (parsedRl) {
      console.log(`[poll] rate-limited; resets at ${parsedRl.resetAt} (remaining=${parsedRl.remaining})`)
    }
    // Keep last good data; surface the error on a degraded snapshot. errorKind
    // lets the UI distinguish "rate limited (waiting for reset)" from "offline
    // (retrying)" — parsedRl is set only for rate-limit errors (incl. secondary
    // limits via retry-after), so everything else reads as offline.
    const errorKind: DashboardSnapshot['errorKind'] = parsedRl ? 'rate_limit' : 'offline'
    const degraded: DashboardSnapshot = lastSnapshot
      ? { ...lastSnapshot, error: err?.message ?? 'Refresh failed', errorKind, rateLimit: parsedRl ?? lastSnapshot.rateLimit }
      : {
          fetchedAt: new Date().toISOString(),
          viewer: { login: viewerLogin ?? '', avatarUrl: '' },
          needsReview: [], myPullRequests: [], teamPullRequests: [], events: [], hiddenPrIds: [],
          history: [],
          rateLimit: parsedRl ?? { remaining: 0, resetAt: '' },
          error: err?.message ?? 'Refresh failed',
          errorKind
        }
    // Persist the accurate rate limit so scheduleNextPoll reads it (the success
    // path overwrites lastSnapshot on the next good poll). Only when we actually
    // parsed one — otherwise leave the last good snapshot untouched.
    if (parsedRl) lastSnapshot = degraded
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

// The adaptive cadence inputs derived from the user's settings: the base floor
// (clamped >=30s so it can't hammer) and the reserve share we DON'T spend
// (1 - the % the user lets us use). Shared by the poll loop and the foreground
// gate so both reason about the same budget the same way.
function pollCadence(): { baseMs: number; reserveFraction: number } {
  const s = loadSettings()
  const baseMs = Math.max(30, s.refreshIntervalSeconds || 30) * 1000
  const reserveFraction = 1 - Math.min(Math.max(s.apiBudgetPercent ?? 80, 10), 100) / 100
  return { baseMs, reserveFraction }
}

// Self-scheduling poll loop. The next delay is derived from the last poll's
// GraphQL rate-limit state (nextPollDelay) so we back off as the hourly budget
// runs low instead of hammering the API into a "quota exhausted" error.
function scheduleNextPoll(): void {
  if (!polling) return
  if (pollTimer) clearTimeout(pollTimer)
  const { baseMs, reserveFraction } = pollCadence()
  const delay = lastSnapshot ? nextPollDelay(lastSnapshot.rateLimit, Date.now(), baseMs, reserveFraction) : baseMs
  if (delay > baseMs) {
    console.log(`[poll] backing off ${Math.round(delay / 1000)}s (remaining=${lastSnapshot?.rateLimit.remaining} resetAt=${lastSnapshot?.rateLimit.resetAt})`)
  }
  pollTimer = setTimeout(() => { void runPoll().finally(scheduleNextPoll) }, delay)
}

function startPolling(): void {
  if (polling) return
  polling = true
  void runPoll().finally(scheduleNextPoll)
}

// Halt the self-scheduling loop and cancel any pending tick. Used on sign-out;
// startPolling() resumes it after a new token is saved.
function stopPolling(): void {
  polling = false
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

// Recompute hiddenPrIds against the in-memory snapshot (no network) and push it.
function recomputeHidden(): DashboardSnapshot | null {
  if (!lastSnapshot) return null
  const { hiddenIds } = resolveHidden(
    [...lastSnapshot.needsReview, ...lastSnapshot.myPullRequests, ...lastSnapshot.teamPullRequests].map((p) => ({
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
    const v = await validateToken(token)
    // Surface the real reason (rate-limit / network / auth) rather than always
    // blaming the token — a rate-limited validation does NOT mean a bad token.
    if (!v.ok) return { ok: false, error: v.message }
    saveToken(token)
    viewerLogin = v.login
    poller = new Poller(createClient(token))
    // New token = new data source (possibly a different account). Drop the old
    // baseline so the first poll seeds silently instead of diffing across
    // identities and firing a spurious notification burst.
    lastSnapshot = null
    baselineSeeded = false
    startPolling()
    return { ok: true, login: v.login }
  })

  // Full local sign-out: remove both encrypted secrets, stop polling, and drop all
  // in-memory state. The renderer reloads to the first-run token screen.
  ipcMain.handle('resetCredentials', async (): Promise<{ ok: boolean }> => {
    stopPolling()
    clearToken()
    clearAiKey()
    poller = null
    lastSnapshot = null
    viewerLogin = undefined
    baselineSeeded = false
    inFlightPoll = null
    updateTray(null)
    return { ok: true }
  })

  ipcMain.handle('getSettings', (): Settings => loadSettings())
  ipcMain.handle('saveSettings', (_e, settings: Settings): Settings => {
    const saved = saveSettings(settings)
    applyLoginItem(saved)
    // Apply a changed author denylist to data already in memory right away, so
    // excluded PRs/events vanish instantly — independent of whether the follow-up
    // network poll succeeds (it may be rate-limited or offline).
    if (lastSnapshot) {
      lastSnapshot = applyAuthorFilters(lastSnapshot, saved.excludedAuthors)
      cacheSnapshot(lastSnapshot)
      sendSnapshot(lastSnapshot)
    }
    void runPoll() // then re-fetch fresh data with the new filters
    return saved
  })

  ipcMain.handle('openExternal', (_e, url: string) => {
    if (isSafeExternalUrl(url)) return shell.openExternal(url)
  })

  // The event store holds the full unfiltered set; the renderer only ever shows
  // the filtered feed (poller.refresh applies the same filter). Filter here too
  // so reading an event doesn't resurface hidden excluded-author events.
  const filterForUi = (events: ReturnType<typeof markRead>) =>
    filterEvents(events, loadSettings().excludedAuthors)
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
  // Fires a notification unconditionally (ignores notifyKinds/quiet hours) so the
  // user can confirm macOS delivery — and, on a true first run, this is the call
  // that triggers the one-time OS permission prompt (Electron can't re-prompt).
  ipcMain.handle('sendTestNotification', (): boolean => {
    if (!Notification.isSupported()) return false
    new Notification({ title: 'githud', body: 'Test notification — notifications are working.' }).show()
    return true
  })
  ipcMain.handle('getAiStatus', () => ({ hasKey: hasAiKey() }))
  ipcMain.handle('saveAiKey', async (_e, key: string) => {
    if (!(await validateAiKey(key))) return { ok: false, error: 'Anthropic rejected the key.' }
    storeAiKey(key)
    return { ok: true }
  })
  ipcMain.handle('clearAiCache', (): void => clearCache())
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
    // Reuse the last digest while the data it evaluates is unchanged (polls that
    // only bump fetchedAt don't invalidate it).
    const fp = digestFingerprint(lastSnapshot)
    const cache = loadCache()
    const cached = cache['digest'] as { fingerprint: string; result: import('@shared/types').DigestResult } | undefined
    if (cached && cached.fingerprint === fp) return cached.result
    const result = await buildDigest(createAiClient(key), lastSnapshot, new Date().toISOString())
    cache['digest'] = { fingerprint: fp, result }
    saveCache(cache)
    return result
  })
  ipcMain.handle('getReview', async (_e, prId: string, force?: boolean): Promise<ReviewResult> => {
    const key = loadAiKey()
    if (!key) throw new Error('No AI key configured')
    if (!lastSnapshot) throw new Error('No data yet')
    const pr = lastSnapshot.needsReview.find((p) => p.id === prId)
    if (!pr) throw new Error('PR not found')
    const headKey = pr.updatedAt
    const cache = loadCache()
    const cached = cache[cacheKey('review', prId, headKey)] as ReviewResult | undefined
    if (cached && !force) return cached
    if (!ensurePoller() || !poller) throw new Error('No token configured')
    const diff = await fetchPrDiff(poller.client, pr.repo, pr.number)
    const raw = await reviewPr(createAiClient(key), loadReviewInstructions(), prId, headKey, pr.title, diff, new Date().toISOString())
    const anchors = parseDiffAnchors(diff.patch)
    const result: ReviewResult = { ...raw, findings: anchorFindings(raw.findings, anchors), patch: diff.patch }
    cache[cacheKey('review', prId, headKey)] = result
    saveCache(cache)
    return result
  })
  ipcMain.handle('postReview', async (_e, prId: string, payload: PostReviewPayload): Promise<PostReviewResult> => {
    if (!lastSnapshot) return { ok: false, kind: 'unknown', message: 'No data yet' }
    const pr = lastSnapshot.needsReview.find((p) => p.id === prId)
    if (!pr) return { ok: false, kind: 'unknown', message: 'PR not found' }
    if (!ensurePoller() || !poller) return { ok: false, kind: 'auth', message: 'No token configured' }
    const [owner, name] = pr.repo.split('/')
    return postReviewToGithub(poller.client, owner, name, pr.number, payload)
  })
  ipcMain.handle('getReviewInstructions', async (): Promise<string> => loadReviewInstructions())
  ipcMain.handle('saveReviewInstructions', async (_e, text: string): Promise<void> => { saveReviewInstructions(text) })
  ipcMain.handle('resetReviewInstructions', async (): Promise<string> => resetReviewInstructions())
}

app.whenReady().then(async () => {
  // In dev (`app.isPackaged` false) the dock shows the raw Electron icon — a
  // packaged build picks up build/icon.icns automatically. Set it here so dev
  // matches. process.cwd() is the project root under `electron-vite dev`.
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(join(process.cwd(), 'build/icon.png'))
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }
  registerIpc()
  lastSnapshot = loadCachedSnapshot()
  applyLoginItem(loadSettings())
  createWindow()
  createTray()

  // If a token already exists, validate it (for viewer login) and start polling.
  const token = loadToken()
  if (token) {
    const v = await validateToken(token)
    if (v.ok) {
      viewerLogin = v.login
      startPolling()
    } else if (v.reason === 'auth') {
      clearToken() // genuinely rejected -> renderer will show setup
    } else {
      // Rate-limited or offline at startup: the token is almost certainly fine.
      // Keep it and start polling — the adaptive loop backs off and recovers
      // when the window resets, instead of wiping a valid token (the old bug).
      console.warn(`[startup] token not validated yet (${v.reason}); keeping it and polling`)
      startPolling()
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // macOS: did-become-active also fires on ⌘-Tab App-Switcher activations that
  // window 'focus' alone can miss. onForeground coalesces the overlap.
  if (process.platform === 'darwin') app.on('did-become-active', onForeground)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
