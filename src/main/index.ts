import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import { join } from 'path'
import { DashboardSnapshot, Settings, AuthStatus } from '@shared/types'
import { hasToken, loadToken, saveToken, clearToken } from './token-store'
import { loadSettings, saveSettings } from './settings-store'
import { loadCachedSnapshot, cacheSnapshot } from './snapshot-cache'
import { createClient, validateToken } from './github/client'
import { Poller } from './poller'
import { diffSnapshots } from './notifier'

const POLL_INTERVAL_MS = 30_000

let mainWindow: BrowserWindow | null = null
let poller: Poller | null = null
let timer: ReturnType<typeof setInterval> | null = null
let lastSnapshot: DashboardSnapshot | null = null
let viewerLogin: string | undefined

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

  mainWindow.on('focus', () => { void runPoll() })
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
  for (const spec of diffSnapshots(prev, next)) {
    const n = new Notification({ title: spec.title, body: spec.body })
    if (spec.url) n.on('click', () => shell.openExternal(spec.url!))
    n.show()
  }
}

async function runPoll(): Promise<DashboardSnapshot> {
  if (!ensurePoller()) {
    throw new Error('No token configured')
  }
  const settings = loadSettings()
  try {
    const snapshot = await poller!.refresh(settings)
    fireNotifications(lastSnapshot, snapshot, settings)
    lastSnapshot = snapshot
    cacheSnapshot(snapshot)
    mainWindow?.webContents.send('snapshot', snapshot)
    return snapshot
  } catch (err: any) {
    // Keep last good data; surface the error on a degraded snapshot.
    const degraded: DashboardSnapshot = lastSnapshot
      ? { ...lastSnapshot, error: err?.message ?? 'Refresh failed' }
      : {
          fetchedAt: new Date().toISOString(),
          viewer: { login: viewerLogin ?? '', avatarUrl: '' },
          needsReview: [], myPullRequests: [], activity: [],
          rateLimit: { remaining: 0, resetAt: '' },
          error: err?.message ?? 'Refresh failed'
        }
    mainWindow?.webContents.send('snapshot', degraded)
    return degraded
  }
}

function startPolling(): void {
  if (timer) return
  timer = setInterval(() => { void runPoll() }, POLL_INTERVAL_MS)
  void runPoll()
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
    startPolling()
    return { ok: true, login: viewer.login }
  })

  ipcMain.handle('getSettings', (): Settings => loadSettings())
  ipcMain.handle('saveSettings', (_e, settings: Settings): Settings => {
    const saved = saveSettings(settings)
    void runPoll() // re-apply filters immediately
    return saved
  })

  ipcMain.handle('openExternal', (_e, url: string) => shell.openExternal(url))
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
