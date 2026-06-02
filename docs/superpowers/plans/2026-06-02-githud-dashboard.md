# githud Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user Electron desktop dashboard that shows PRs needing my review, my open PRs (with review/check status), and an always-visible activity feed sourced from the GitHub Notifications API, refreshing every 30s with native notifications.

**Architecture:** Three layers — a **main** process that owns the PAT + Octokit clients + poll timer + notification diffing, a typed **preload** `contextBridge`, and a **React renderer**. All GitHub I/O happens in main; the renderer only ever sees a normalized `DashboardSnapshot` over IPC. Pure logic (normalizers, filtering, diffing, enrichment cache) is isolated from Electron so it can be unit-tested directly.

**Tech Stack:** Electron + electron-vite, React + TypeScript, TanStack Query, Octokit (GraphQL v4 for PR tables, REST for notifications), Electron `safeStorage` for the token, Vitest + React Testing Library.

Reference spec: `docs/superpowers/specs/2026-06-02-githud-dashboard-design.md`

---

## File Structure

```
githud/
  package.json                       # deps, scripts, "main": "./out/main/index.js"
  electron.vite.config.ts            # main/preload/renderer build config
  tsconfig.json / tsconfig.node.json # TS configs
  vitest.config.ts                   # jsdom env, globals, setup
  test/setup.ts                      # jest-dom matchers
  src/
    shared/
      types.ts                       # DashboardSnapshot, PullRequest, ActivityItem, User, Settings, NotificationSpec
    main/
      index.ts                       # app/window lifecycle + IPC registration
      paths.ts                       # userData file paths
      token-store.ts                 # safeStorage encrypt/decrypt of PAT          (tested)
      settings-store.ts              # JSON settings on disk                        (tested)
      snapshot-cache.ts              # JSON last-snapshot on disk                    (tested)
      notifier.ts                    # snapshot diff -> NotificationSpec[]           (tested)
      poller.ts                      # orchestrates a refresh into a DashboardSnapshot
      github/
        client.ts                    # Octokit factory (graphql + rest)
        queries.ts                   # GraphQL query strings
        normalize-prs.ts             # GraphQL JSON -> PullRequest[]                 (tested)
        notifications.ts             # REST fetch + ETag/X-Poll-Interval helpers     (helper tested)
        enrich.ts                    # resolve latest_comment_url with cache         (tested)
        normalize-activity.ts        # threads + comments -> ActivityItem[]          (tested)
        filter-activity.ts           # denylist + hide-bots                          (tested)
    preload/
      index.ts                       # contextBridge -> window.api
    renderer/
      index.html
      src/
        main.tsx                     # React root + QueryClientProvider
        App.tsx                      # top-level layout + token gate
        api.ts                       # typed wrapper over window.api
        hooks/useDashboard.ts        # TanStack Query hook
        components/
          TopBar.tsx
          NeedsReviewTable.tsx
          MyPullRequestsTable.tsx
          ActivityFeed.tsx
          TokenSetup.tsx             (tested)
          Settings.tsx
        styles.css
```

---

## Task 1: Project scaffold that boots an empty window

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `test/setup.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "githud",
  "version": "0.1.0",
  "description": "Personal GitHub engineering dashboard",
  "main": "./out/main/index.js",
  "author": "Andrew Hite",
  "license": "MIT",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "package": "electron-vite build && electron-builder --mac --dir",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install react react-dom @tanstack/react-query octokit
npm install -D electron electron-vite electron-builder vite @vitejs/plugin-react typescript \
  @types/react @types/react-dom @types/node vitest jsdom @testing-library/react \
  @testing-library/user-event @testing-library/jest-dom
```
Expected: installs complete with no errors; `node_modules/` populated.

- [ ] **Step 3: Create `electron.vite.config.ts`**

```typescript
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    plugins: [react()]
  }
})
```

- [ ] **Step 4: Create `tsconfig.json` and `tsconfig.node.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "skipLibCheck": true
  },
  "include": ["electron.vite.config.ts"]
}
```

- [ ] **Step 5: Create `vitest.config.ts` and `test/setup.ts`**

`vitest.config.ts`:
```typescript
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts']
  }
})
```

`test/setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 6: Create the minimal main process `src/main/index.ts`**

```typescript
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
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
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 7: Create a placeholder preload `src/preload/index.ts`**

```typescript
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
```

- [ ] **Step 8: Create the renderer entry files**

`src/renderer/index.html`:
```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>githud</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' https://avatars.githubusercontent.com https://*.githubusercontent.com data:; style-src 'self' 'unsafe-inline'" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/src/App.tsx`:
```tsx
export default function App() {
  return <h1>githud</h1>
}
```

- [ ] **Step 9: Run the app to confirm it boots**

Run: `npm run dev`
Expected: an Electron window titled "githud" opens showing the "githud" heading. Close it.

- [ ] **Step 10: Run typecheck and the (empty) test suite**

Run: `npm run typecheck && npm run test`
Expected: typecheck passes; vitest reports "No test files found" (exit 0) — acceptable at this stage.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Scaffold electron-vite + React + TS app that boots an empty window"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write `src/shared/types.ts`**

```typescript
export interface User {
  login: string
  avatarUrl: string
}

export interface ChecksSummary {
  state: 'success' | 'failure' | 'pending' | 'none'
  passed: number
  failed: number
  total: number
}

export interface PullRequest {
  id: string
  number: number
  title: string
  url: string
  repo: string // "owner/name"
  author: User
  reviewers: User[]
  reviewState: 'approved' | 'changes_requested' | 'review_required' | 'none'
  approvals: number
  mergeable: 'mergeable' | 'conflicting' | 'unknown'
  checks: ChecksSummary
  updatedAt: string
  isStale: boolean
  isDraft: boolean
}

export interface ActivityItem {
  id: string // notification thread id
  reason: string // 'mention' | 'team_mention' | 'comment' | 'review_requested' | 'ci_activity' | ...
  subjectType: string // 'PullRequest' | 'Issue' | 'Commit' | ...
  repo: string // "owner/name"
  number?: number
  title: string
  url: string
  unread: boolean
  updatedAt: string
  latestComment?: {
    author: User
    body: string
    createdAt: string
  }
}

export interface RateLimit {
  remaining: number
  resetAt: string
}

export interface DashboardSnapshot {
  fetchedAt: string
  viewer: User
  needsReview: PullRequest[]
  myPullRequests: PullRequest[]
  activity: ActivityItem[]
  rateLimit: RateLimit
  error?: string
}

export interface Settings {
  staleThresholdDays: number
  notificationsEnabled: boolean
  excludedAuthors: string[]
  hideBots: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  staleThresholdDays: 2,
  notificationsEnabled: true,
  excludedAuthors: [],
  hideBots: true
}

export interface NotificationSpec {
  title: string
  body: string
  url?: string
}

export interface AuthStatus {
  hasToken: boolean
  login?: string
}

// The typed surface exposed on window.api by preload.
export interface GithudApi {
  getSnapshot(): Promise<DashboardSnapshot | null>
  refresh(): Promise<DashboardSnapshot>
  onSnapshot(cb: (snap: DashboardSnapshot) => void): () => void
  getAuthStatus(): Promise<AuthStatus>
  saveToken(token: string): Promise<{ ok: boolean; login?: string; error?: string }>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  openExternal(url: string): Promise<void>
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "Add shared DashboardSnapshot and related types"
```

---

## Task 3: Token store (safeStorage)

**Files:**
- Create: `src/main/paths.ts`, `src/main/token-store.ts`
- Test: `src/main/token-store.test.ts`

- [ ] **Step 1: Create `src/main/paths.ts`**

```typescript
import { app } from 'electron'
import { join } from 'path'

export function tokenFilePath(): string {
  return join(app.getPath('userData'), 'token.enc')
}
export function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}
export function snapshotFilePath(): string {
  return join(app.getPath('userData'), 'snapshot.json')
}
```

- [ ] **Step 2: Write the failing test `src/main/token-store.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync } from 'fs'

// Mock electron: safeStorage round-trips via base64 so we can assert behavior;
// paths point at a temp dir.
const tmp = mkdtempSync(join(tmpdir(), 'githud-token-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmp },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

import { saveToken, loadToken, clearToken, hasToken } from './token-store'

describe('token-store', () => {
  beforeEach(() => clearToken())

  it('returns null when no token saved', () => {
    expect(loadToken()).toBeNull()
    expect(hasToken()).toBe(false)
  })

  it('round-trips a saved token through encryption', () => {
    saveToken('ghp_secret123')
    expect(hasToken()).toBe(true)
    expect(loadToken()).toBe('ghp_secret123')
  })

  it('clears a saved token', () => {
    saveToken('ghp_secret123')
    clearToken()
    expect(loadToken()).toBeNull()
  })
})

rmSync(tmp, { recursive: true, force: true })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- token-store`
Expected: FAIL — `saveToken` / `loadToken` not exported (module not found or undefined).

- [ ] **Step 4: Implement `src/main/token-store.ts`**

```typescript
import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tokenFilePath } from './paths'

export function hasToken(): boolean {
  return existsSync(tokenFilePath())
}

export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available; cannot store token securely.')
  }
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenFilePath(), encrypted)
}

export function loadToken(): string | null {
  const path = tokenFilePath()
  if (!existsSync(path)) return null
  try {
    return safeStorage.decryptString(readFileSync(path))
  } catch {
    return null
  }
}

export function clearToken(): void {
  const path = tokenFilePath()
  if (existsSync(path)) rmSync(path, { force: true })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- token-store`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/paths.ts src/main/token-store.ts src/main/token-store.test.ts
git commit -m "Add encrypted token store backed by safeStorage"
```

---

## Task 4: Settings store

**Files:**
- Create: `src/main/settings-store.ts`
- Test: `src/main/settings-store.test.ts`

- [ ] **Step 1: Write the failing test `src/main/settings-store.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'

const tmp = mkdtempSync(join(tmpdir(), 'githud-settings-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

import { loadSettings, saveSettings } from './settings-store'
import { DEFAULT_SETTINGS } from '@shared/types'
import { existsSync, rmSync as rm } from 'fs'
import { settingsFilePath } from './paths'

describe('settings-store', () => {
  beforeEach(() => {
    if (existsSync(settingsFilePath())) rm(settingsFilePath(), { force: true })
  })

  it('returns defaults when no file exists', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists and reloads settings', () => {
    const next = { ...DEFAULT_SETTINGS, hideBots: false, excludedAuthors: ['noisybot'] }
    saveSettings(next)
    expect(loadSettings()).toEqual(next)
  })

  it('merges partial/legacy files onto defaults', () => {
    saveSettings({ staleThresholdDays: 5 } as any)
    const loaded = loadSettings()
    expect(loaded.staleThresholdDays).toBe(5)
    expect(loaded.notificationsEnabled).toBe(DEFAULT_SETTINGS.notificationsEnabled)
  })
})

rmSync(tmp, { recursive: true, force: true })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- settings-store`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement `src/main/settings-store.ts`**

```typescript
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { settingsFilePath } from './paths'
import { Settings, DEFAULT_SETTINGS } from '@shared/types'

export function loadSettings(): Settings {
  const path = settingsFilePath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  writeFileSync(settingsFilePath(), JSON.stringify(merged, null, 2))
  return merged
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- settings-store`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/settings-store.ts src/main/settings-store.test.ts
git commit -m "Add JSON settings store with defaults merge"
```

---

## Task 5: Snapshot disk cache

**Files:**
- Create: `src/main/snapshot-cache.ts`
- Test: `src/main/snapshot-cache.test.ts`

- [ ] **Step 1: Write the failing test `src/main/snapshot-cache.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import type { DashboardSnapshot } from '@shared/types'

const tmp = mkdtempSync(join(tmpdir(), 'githud-snap-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

import { loadCachedSnapshot, cacheSnapshot } from './snapshot-cache'

const sample: DashboardSnapshot = {
  fetchedAt: '2026-06-02T00:00:00Z',
  viewer: { login: 'me', avatarUrl: 'a' },
  needsReview: [],
  myPullRequests: [],
  activity: [],
  rateLimit: { remaining: 5000, resetAt: '2026-06-02T01:00:00Z' }
}

describe('snapshot-cache', () => {
  it('returns null when nothing cached', () => {
    expect(loadCachedSnapshot()).toBeNull()
  })
  it('round-trips a snapshot', () => {
    cacheSnapshot(sample)
    expect(loadCachedSnapshot()).toEqual(sample)
  })
})

rmSync(tmp, { recursive: true, force: true })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- snapshot-cache`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement `src/main/snapshot-cache.ts`**

```typescript
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { snapshotFilePath } from './paths'
import { DashboardSnapshot } from '@shared/types'

export function loadCachedSnapshot(): DashboardSnapshot | null {
  const path = snapshotFilePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DashboardSnapshot
  } catch {
    return null
  }
}

export function cacheSnapshot(snap: DashboardSnapshot): void {
  writeFileSync(snapshotFilePath(), JSON.stringify(snap))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- snapshot-cache`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/snapshot-cache.ts src/main/snapshot-cache.test.ts
git commit -m "Add disk cache for last dashboard snapshot"
```

---

## Task 6: GraphQL queries + PR normalizer

**Files:**
- Create: `src/main/github/queries.ts`, `src/main/github/normalize-prs.ts`
- Test: `src/main/github/normalize-prs.test.ts`

- [ ] **Step 1: Create `src/main/github/queries.ts`**

```typescript
// One PullRequest fragment reused by both search blocks.
const PR_FIELDS = `
  id
  number
  title
  url
  isDraft
  updatedAt
  mergeable
  repository { nameWithOwner }
  author { login avatarUrl }
  reviewRequests(first: 20) {
    nodes { requestedReviewer { ... on User { login avatarUrl } } }
  }
  reviews(last: 50) {
    nodes { state author { login avatarUrl } }
  }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { conclusion }
              ... on StatusContext { state }
            }
          }
        }
      }
    }
  }
`

export const DASHBOARD_QUERY = `
query Dashboard($needsReview: String!, $mine: String!) {
  viewer { login avatarUrl }
  rateLimit { remaining resetAt }
  needsReview: search(query: $needsReview, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
  mine: search(query: $mine, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
}`

export const NEEDS_REVIEW_QUERY = 'is:open is:pr review-requested:@me archived:false'
export const MY_PRS_QUERY = 'is:open is:pr author:@me archived:false'

export const VIEWER_QUERY = `query { viewer { login avatarUrl } }`
```

- [ ] **Step 2: Write the failing test `src/main/github/normalize-prs.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { normalizePullRequests } from './normalize-prs'

const now = Date.parse('2026-06-02T00:00:00Z')
const staleMs = 2 * 24 * 60 * 60 * 1000

function prNode(overrides: any = {}) {
  return {
    id: 'PR_1',
    number: 210,
    title: 'Add retry logic',
    url: 'https://github.com/o/api/pull/210',
    isDraft: false,
    updatedAt: '2026-06-01T20:00:00Z',
    mergeable: 'MERGEABLE',
    repository: { nameWithOwner: 'o/api' },
    author: { login: 'jdoe', avatarUrl: 'av' },
    reviewRequests: { nodes: [{ requestedReviewer: { login: 'me', avatarUrl: 'av-me' } }] },
    reviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    ...overrides
  }
}

describe('normalizePullRequests', () => {
  it('maps core fields and repo/author', () => {
    const [pr] = normalizePullRequests([prNode()], { now, staleThresholdMs: staleMs })
    expect(pr).toMatchObject({
      id: 'PR_1', number: 210, title: 'Add retry logic',
      url: 'https://github.com/o/api/pull/210', repo: 'o/api',
      author: { login: 'jdoe', avatarUrl: 'av' }, isDraft: false
    })
  })

  it('extracts requested reviewers', () => {
    const [pr] = normalizePullRequests([prNode()], { now, staleThresholdMs: staleMs })
    expect(pr.reviewers).toEqual([{ login: 'me', avatarUrl: 'av-me' }])
  })

  it('maps mergeable enum to lowercase union', () => {
    expect(normalizePullRequests([prNode({ mergeable: 'CONFLICTING' })], { now, staleThresholdMs: staleMs })[0].mergeable).toBe('conflicting')
    expect(normalizePullRequests([prNode({ mergeable: 'UNKNOWN' })], { now, staleThresholdMs: staleMs })[0].mergeable).toBe('unknown')
  })

  it('derives reviewState=approved and approvals count from latest review per author', () => {
    const node = prNode({
      reviews: { nodes: [
        { state: 'COMMENTED', author: { login: 'a', avatarUrl: '' } },
        { state: 'APPROVED', author: { login: 'a', avatarUrl: '' } },
        { state: 'APPROVED', author: { login: 'b', avatarUrl: '' } }
      ] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.reviewState).toBe('approved')
    expect(pr.approvals).toBe(2)
  })

  it('derives reviewState=changes_requested when any latest review requests changes', () => {
    const node = prNode({
      reviews: { nodes: [
        { state: 'APPROVED', author: { login: 'a', avatarUrl: '' } },
        { state: 'CHANGES_REQUESTED', author: { login: 'b', avatarUrl: '' } }
      ] }
    })
    expect(normalizePullRequests([node], { now, staleThresholdMs: staleMs })[0].reviewState).toBe('changes_requested')
  })

  it('uses latest review per author (changes then re-approve = approved)', () => {
    const node = prNode({
      reviews: { nodes: [
        { state: 'CHANGES_REQUESTED', author: { login: 'a', avatarUrl: '' } },
        { state: 'APPROVED', author: { login: 'a', avatarUrl: '' } }
      ] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.reviewState).toBe('approved')
    expect(pr.approvals).toBe(1)
  })

  it('summarizes checks from statusCheckRollup contexts', () => {
    const node = prNode({
      commits: { nodes: [{ commit: { statusCheckRollup: {
        state: 'FAILURE',
        contexts: { nodes: [
          { __typename: 'CheckRun', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', conclusion: 'FAILURE' },
          { __typename: 'StatusContext', state: 'SUCCESS' },
          { __typename: 'CheckRun', conclusion: null } // in-progress
        ] }
      } } }] }
    })
    const [pr] = normalizePullRequests([node], { now, staleThresholdMs: staleMs })
    expect(pr.checks).toEqual({ state: 'failure', passed: 2, failed: 1, total: 4 })
  })

  it('reports checks state none when no rollup', () => {
    expect(normalizePullRequests([prNode()], { now, staleThresholdMs: staleMs })[0].checks)
      .toEqual({ state: 'none', passed: 0, failed: 0, total: 0 })
  })

  it('flags stale when updatedAt older than threshold', () => {
    const fresh = prNode({ updatedAt: '2026-06-01T23:00:00Z' })
    const stale = prNode({ updatedAt: '2026-05-28T00:00:00Z' })
    expect(normalizePullRequests([fresh], { now, staleThresholdMs: staleMs })[0].isStale).toBe(false)
    expect(normalizePullRequests([stale], { now, staleThresholdMs: staleMs })[0].isStale).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- normalize-prs`
Expected: FAIL — `normalizePullRequests` not defined.

- [ ] **Step 4: Implement `src/main/github/normalize-prs.ts`**

```typescript
import { PullRequest, ChecksSummary, User } from '@shared/types'

interface NormalizeOpts {
  now: number
  staleThresholdMs: number
}

const MERGEABLE_MAP: Record<string, PullRequest['mergeable']> = {
  MERGEABLE: 'mergeable',
  CONFLICTING: 'conflicting',
  UNKNOWN: 'unknown'
}

function user(node: any): User {
  return { login: node?.login ?? 'unknown', avatarUrl: node?.avatarUrl ?? '' }
}

function deriveReview(reviews: any[]): { state: PullRequest['reviewState']; approvals: number } {
  // Keep only the latest review per author, ignoring pure COMMENTED reviews.
  const latestByAuthor = new Map<string, string>()
  for (const r of reviews) {
    if (r.state === 'COMMENTED' || r.state === 'PENDING' || r.state === 'DISMISSED') continue
    const login = r.author?.login ?? 'unknown'
    latestByAuthor.set(login, r.state) // later entries overwrite earlier -> "last" wins
  }
  const states = [...latestByAuthor.values()]
  const approvals = states.filter((s) => s === 'APPROVED').length
  if (states.includes('CHANGES_REQUESTED')) return { state: 'changes_requested', approvals }
  if (approvals > 0) return { state: 'approved', approvals }
  return { state: 'none', approvals: 0 }
}

function summarizeChecks(rollup: any): ChecksSummary {
  if (!rollup) return { state: 'none', passed: 0, failed: 0, total: 0 }
  const nodes: any[] = rollup.contexts?.nodes ?? []
  let passed = 0
  let failed = 0
  for (const n of nodes) {
    if (n.__typename === 'CheckRun') {
      if (n.conclusion === 'SUCCESS') passed++
      else if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(n.conclusion)) failed++
    } else if (n.__typename === 'StatusContext') {
      if (n.state === 'SUCCESS') passed++
      else if (n.state === 'FAILURE' || n.state === 'ERROR') failed++
    }
  }
  const rollupState = (rollup.state ?? '').toUpperCase()
  let state: ChecksSummary['state'] = 'none'
  if (rollupState === 'SUCCESS') state = 'success'
  else if (rollupState === 'FAILURE' || rollupState === 'ERROR') state = 'failure'
  else if (rollupState === 'PENDING' || rollupState === 'EXPECTED') state = 'pending'
  return { state, passed, failed, total: nodes.length }
}

export function normalizePullRequests(nodes: any[], opts: NormalizeOpts): PullRequest[] {
  return (nodes ?? []).filter(Boolean).map((n) => {
    const review = deriveReview(n.reviews?.nodes ?? [])
    const updatedAtMs = Date.parse(n.updatedAt)
    return {
      id: n.id,
      number: n.number,
      title: n.title,
      url: n.url,
      repo: n.repository?.nameWithOwner ?? '',
      author: user(n.author),
      reviewers: (n.reviewRequests?.nodes ?? [])
        .map((rr: any) => rr.requestedReviewer)
        .filter((u: any) => u && u.login)
        .map(user),
      reviewState: review.state,
      approvals: review.approvals,
      mergeable: MERGEABLE_MAP[n.mergeable] ?? 'unknown',
      checks: summarizeChecks(n.commits?.nodes?.[0]?.commit?.statusCheckRollup),
      updatedAt: n.updatedAt,
      isStale: opts.now - updatedAtMs > opts.staleThresholdMs,
      isDraft: !!n.isDraft
    }
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- normalize-prs`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/github/queries.ts src/main/github/normalize-prs.ts src/main/github/normalize-prs.test.ts
git commit -m "Add GraphQL dashboard query and PR normalizer"
```

---

## Task 7: Notifications REST fetch + poll-interval/ETag helpers

**Files:**
- Create: `src/main/github/notifications.ts`
- Test: `src/main/github/notifications.test.ts`

The fetch itself is thin I/O; the testable logic is header parsing and the "should I poll yet?" gate. Those are pure functions exported alongside the fetch.

- [ ] **Step 1: Write the failing test `src/main/github/notifications.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { parsePollInterval, shouldPollNotifications } from './notifications'

describe('parsePollInterval', () => {
  it('reads x-poll-interval seconds into ms, defaulting to 60s', () => {
    expect(parsePollInterval({ 'x-poll-interval': '90' })).toBe(90_000)
    expect(parsePollInterval({})).toBe(60_000)
    expect(parsePollInterval({ 'x-poll-interval': 'bogus' })).toBe(60_000)
  })
})

describe('shouldPollNotifications', () => {
  const now = 1_000_000

  it('polls when never fetched before', () => {
    expect(shouldPollNotifications({ lastFetchedAt: null, pollIntervalMs: 60_000, now })).toBe(true)
  })

  it('skips when inside the poll interval', () => {
    expect(shouldPollNotifications({ lastFetchedAt: now - 30_000, pollIntervalMs: 60_000, now })).toBe(false)
  })

  it('polls when the interval has elapsed', () => {
    expect(shouldPollNotifications({ lastFetchedAt: now - 61_000, pollIntervalMs: 60_000, now })).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- notifications`
Expected: FAIL — helpers not defined.

- [ ] **Step 3: Implement `src/main/github/notifications.ts`**

```typescript
import type { Octokit } from 'octokit'

export function parsePollInterval(headers: Record<string, string | undefined>): number {
  const raw = headers['x-poll-interval']
  const n = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) ? n * 1000 : 60_000
}

export function shouldPollNotifications(opts: {
  lastFetchedAt: number | null
  pollIntervalMs: number
  now: number
}): boolean {
  if (opts.lastFetchedAt === null) return true
  return opts.now - opts.lastFetchedAt >= opts.pollIntervalMs
}

export interface NotificationsResult {
  threads: any[] // raw GitHub notification thread objects
  etag?: string
  pollIntervalMs: number
  notModified: boolean
}

// Fetches notifications using a conditional request. On 304 returns notModified=true
// and no threads (caller reuses cached activity).
export async function fetchNotifications(
  octokit: Octokit,
  opts: { etag?: string }
): Promise<NotificationsResult> {
  try {
    const res = await octokit.request('GET /notifications', {
      all: false,
      participating: false,
      headers: opts.etag ? { 'if-none-match': opts.etag } : {}
    })
    const headers = res.headers as Record<string, string | undefined>
    return {
      threads: res.data as any[],
      etag: headers.etag,
      pollIntervalMs: parsePollInterval(headers),
      notModified: false
    }
  } catch (err: any) {
    if (err?.status === 304) {
      const headers = (err.response?.headers ?? {}) as Record<string, string | undefined>
      return { threads: [], etag: opts.etag, pollIntervalMs: parsePollInterval(headers), notModified: true }
    }
    throw err
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- notifications`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/github/notifications.ts src/main/github/notifications.test.ts
git commit -m "Add notifications fetch with conditional requests and poll-interval gate"
```

---

## Task 8: Comment enrichment with cache

**Files:**
- Create: `src/main/github/enrich.ts`
- Test: `src/main/github/enrich.test.ts`

- [ ] **Step 1: Write the failing test `src/main/github/enrich.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { CommentCache, enrichThreads } from './enrich'

function thread(id: string, url: string | null, updatedAt: string) {
  return {
    id,
    updated_at: updatedAt,
    subject: { latest_comment_url: url }
  }
}

function fakeComment(login: string, body: string) {
  return {
    data: { user: { login, avatar_url: `av-${login}`, type: 'User' }, body, created_at: '2026-06-02T00:00:00Z' }
  }
}

describe('enrichThreads', () => {
  it('fetches and caches comment bodies by url', async () => {
    const cache = new CommentCache()
    const request = vi.fn().mockResolvedValue(fakeComment('asmith', 'hello'))
    const result = await enrichThreads([thread('t1', 'https://api/c/1', '2026-06-02T00:00:00Z')], { cache, request })

    expect(request).toHaveBeenCalledTimes(1)
    expect(result.get('t1')).toEqual({
      author: { login: 'asmith', avatarUrl: 'av-asmith' },
      body: 'hello',
      createdAt: '2026-06-02T00:00:00Z'
    })
  })

  it('reuses the cache when the thread updated_at is unchanged', async () => {
    const cache = new CommentCache()
    const request = vi.fn().mockResolvedValue(fakeComment('asmith', 'hello'))
    const t = thread('t1', 'https://api/c/1', '2026-06-02T00:00:00Z')

    await enrichThreads([t], { cache, request })
    await enrichThreads([t], { cache, request })
    expect(request).toHaveBeenCalledTimes(1) // second call served from cache
  })

  it('re-fetches when updated_at changes', async () => {
    const cache = new CommentCache()
    const request = vi.fn()
      .mockResolvedValueOnce(fakeComment('asmith', 'v1'))
      .mockResolvedValueOnce(fakeComment('asmith', 'v2'))

    await enrichThreads([thread('t1', 'https://api/c/1', '2026-06-02T00:00:00Z')], { cache, request })
    const r2 = await enrichThreads([thread('t1', 'https://api/c/1', '2026-06-02T05:00:00Z')], { cache, request })
    expect(request).toHaveBeenCalledTimes(2)
    expect(r2.get('t1')?.body).toBe('v2')
  })

  it('skips threads with no latest_comment_url', async () => {
    const cache = new CommentCache()
    const request = vi.fn()
    const result = await enrichThreads([thread('t1', null, '2026-06-02T00:00:00Z')], { cache, request })
    expect(request).not.toHaveBeenCalled()
    expect(result.has('t1')).toBe(false)
  })

  it('swallows fetch errors for a thread without failing the batch', async () => {
    const cache = new CommentCache()
    const request = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await enrichThreads([thread('t1', 'https://api/c/1', '2026-06-02T00:00:00Z')], { cache, request })
    expect(result.has('t1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- enrich`
Expected: FAIL — `CommentCache`/`enrichThreads` not defined.

- [ ] **Step 3: Implement `src/main/github/enrich.ts`**

```typescript
import { User } from '@shared/types'

export interface ResolvedComment {
  author: User
  body: string
  createdAt: string
}

// Caches resolved comments keyed by latest_comment_url, with the thread's
// updated_at as the freshness token.
export class CommentCache {
  private map = new Map<string, { updatedAt: string; comment: ResolvedComment }>()

  get(url: string, updatedAt: string): ResolvedComment | undefined {
    const entry = this.map.get(url)
    if (entry && entry.updatedAt === updatedAt) return entry.comment
    return undefined
  }

  set(url: string, updatedAt: string, comment: ResolvedComment): void {
    this.map.set(url, { updatedAt, comment })
  }
}

type RequestFn = (url: string) => Promise<{ data: any }>

export async function enrichThreads(
  threads: any[],
  deps: { cache: CommentCache; request: RequestFn }
): Promise<Map<string, ResolvedComment>> {
  const out = new Map<string, ResolvedComment>()
  await Promise.all(
    threads.map(async (t) => {
      const url: string | null = t.subject?.latest_comment_url ?? null
      if (!url) return
      const updatedAt: string = t.updated_at
      const cached = deps.cache.get(url, updatedAt)
      if (cached) {
        out.set(t.id, cached)
        return
      }
      try {
        const res = await deps.request(url)
        const c = res.data
        const comment: ResolvedComment = {
          author: { login: c.user?.login ?? 'unknown', avatarUrl: c.user?.avatar_url ?? '' },
          body: c.body ?? '',
          createdAt: c.created_at ?? updatedAt
        }
        deps.cache.set(url, updatedAt, comment)
        out.set(t.id, comment)
      } catch {
        // leave this thread without an enriched comment; it renders from the subject
      }
    })
  )
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- enrich`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/github/enrich.ts src/main/github/enrich.test.ts
git commit -m "Add comment enrichment with freshness-aware cache"
```

---

## Task 9: Activity normalizer

**Files:**
- Create: `src/main/github/normalize-activity.ts`
- Test: `src/main/github/normalize-activity.test.ts`

- [ ] **Step 1: Write the failing test `src/main/github/normalize-activity.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeActivity } from './normalize-activity'
import type { ResolvedComment } from './enrich'

function thread(over: any = {}) {
  return {
    id: 't1',
    reason: 'mention',
    unread: true,
    updated_at: '2026-06-02T00:00:00Z',
    repository: { full_name: 'o/web' },
    subject: {
      title: 'Fix nav focus trap',
      type: 'PullRequest',
      url: 'https://api.github.com/repos/o/web/pulls/88',
      latest_comment_url: 'https://api.github.com/repos/o/web/issues/comments/5'
    },
    ...over
  }
}

describe('normalizeActivity', () => {
  it('maps a thread into an ActivityItem with parsed number and html url', () => {
    const [item] = normalizeActivity([thread()], new Map())
    expect(item).toMatchObject({
      id: 't1', reason: 'mention', subjectType: 'PullRequest',
      repo: 'o/web', number: 88, title: 'Fix nav focus trap', unread: true,
      url: 'https://github.com/o/web/pull/88'
    })
  })

  it('attaches the resolved latest comment when present', () => {
    const comments = new Map<string, ResolvedComment>([
      ['t1', { author: { login: 'asmith', avatarUrl: 'av' }, body: 'please fix', createdAt: '2026-06-02T00:00:00Z' }]
    ])
    const [item] = normalizeActivity([thread()], comments)
    expect(item.latestComment).toEqual({ author: { login: 'asmith', avatarUrl: 'av' }, body: 'please fix', createdAt: '2026-06-02T00:00:00Z' })
  })

  it('builds an issue html url for Issue subjects', () => {
    const [item] = normalizeActivity([thread({ subject: { ...thread().subject, type: 'Issue', url: 'https://api.github.com/repos/o/web/issues/42' } })], new Map())
    expect(item.subjectType).toBe('Issue')
    expect(item.number).toBe(42)
    expect(item.url).toBe('https://github.com/o/web/issues/42')
  })

  it('sorts newest first by updated_at', () => {
    const a = thread({ id: 'a', updated_at: '2026-06-01T00:00:00Z' })
    const b = thread({ id: 'b', updated_at: '2026-06-02T00:00:00Z' })
    const items = normalizeActivity([a, b], new Map())
    expect(items.map((i) => i.id)).toEqual(['b', 'a'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- normalize-activity`
Expected: FAIL — `normalizeActivity` not defined.

- [ ] **Step 3: Implement `src/main/github/normalize-activity.ts`**

```typescript
import { ActivityItem } from '@shared/types'
import { ResolvedComment } from './enrich'

// Turns a notifications API subject URL into a github.com html url + number.
// API urls look like .../repos/o/web/pulls/88 or .../issues/42.
function toHtmlTarget(repo: string, subjectType: string, apiUrl: string | undefined): { url: string; number?: number } {
  const m = apiUrl?.match(/\/(\d+)(?:$|[/?#])/)
  const number = m ? parseInt(m[1], 10) : undefined
  const kind = subjectType === 'PullRequest' ? 'pull' : 'issues'
  if (number === undefined) return { url: `https://github.com/${repo}`, number }
  return { url: `https://github.com/${repo}/${kind}/${number}`, number }
}

export function normalizeActivity(
  threads: any[],
  comments: Map<string, ResolvedComment>
): ActivityItem[] {
  return (threads ?? [])
    .map((t) => {
      const repo: string = t.repository?.full_name ?? ''
      const subjectType: string = t.subject?.type ?? 'Unknown'
      const target = toHtmlTarget(repo, subjectType, t.subject?.url)
      const item: ActivityItem = {
        id: t.id,
        reason: t.reason,
        subjectType,
        repo,
        number: target.number,
        title: t.subject?.title ?? '',
        url: target.url,
        unread: !!t.unread,
        updatedAt: t.updated_at,
        latestComment: comments.get(t.id)
      }
      return item
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- normalize-activity`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/github/normalize-activity.ts src/main/github/normalize-activity.test.ts
git commit -m "Add activity normalizer (threads + comments -> ActivityItem[])"
```

---

## Task 10: Activity filtering (denylist + hide-bots)

**Files:**
- Create: `src/main/github/filter-activity.ts`
- Test: `src/main/github/filter-activity.test.ts`

- [ ] **Step 1: Write the failing test `src/main/github/filter-activity.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { filterActivity, isBotLogin } from './filter-activity'
import type { ActivityItem } from '@shared/types'

function item(id: string, login: string | null): ActivityItem {
  return {
    id, reason: 'comment', subjectType: 'PullRequest', repo: 'o/r', number: 1,
    title: 't', url: 'u', unread: true, updatedAt: '2026-06-02T00:00:00Z',
    latestComment: login ? { author: { login, avatarUrl: '' }, body: 'b', createdAt: '2026-06-02T00:00:00Z' } : undefined
  }
}

describe('isBotLogin', () => {
  it('detects the [bot] suffix case-insensitively', () => {
    expect(isBotLogin('dependabot[bot]')).toBe(true)
    expect(isBotLogin('github-actions[bot]')).toBe(true)
    expect(isBotLogin('Renovate[Bot]')).toBe(true)
    expect(isBotLogin('asmith')).toBe(false)
  })
})

describe('filterActivity', () => {
  const items = [item('a', 'asmith'), item('b', 'dependabot[bot]'), item('c', 'noisyuser'), item('d', null)]

  it('passes everything through when no filters set', () => {
    const out = filterActivity(items, { excludedAuthors: [], hideBots: false })
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops bots when hideBots is on', () => {
    const out = filterActivity(items, { excludedAuthors: [], hideBots: true })
    expect(out.map((i) => i.id)).toEqual(['a', 'c', 'd'])
  })

  it('drops denylisted authors case-insensitively', () => {
    const out = filterActivity(items, { excludedAuthors: ['NoisyUser'], hideBots: false })
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'd'])
  })

  it('keeps items with no resolved comment author', () => {
    const out = filterActivity(items, { excludedAuthors: ['anyone'], hideBots: true })
    expect(out.some((i) => i.id === 'd')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- filter-activity`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement `src/main/github/filter-activity.ts`**

```typescript
import { ActivityItem } from '@shared/types'

export function isBotLogin(login: string): boolean {
  return /\[bot\]$/i.test(login)
}

export function filterActivity(
  items: ActivityItem[],
  opts: { excludedAuthors: string[]; hideBots: boolean }
): ActivityItem[] {
  const denied = new Set(opts.excludedAuthors.map((a) => a.toLowerCase()))
  return items.filter((item) => {
    const login = item.latestComment?.author.login
    if (!login) return true // keep items we can't attribute (e.g. ci_activity)
    if (opts.hideBots && isBotLogin(login)) return false
    if (denied.has(login.toLowerCase())) return false
    return true
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- filter-activity`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/github/filter-activity.ts src/main/github/filter-activity.test.ts
git commit -m "Add activity filtering by denylist and bot detection"
```

---

## Task 11: Notification diffing

**Files:**
- Create: `src/main/notifier.ts`
- Test: `src/main/notifier.test.ts`

- [ ] **Step 1: Write the failing test `src/main/notifier.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { diffSnapshots } from './notifier'
import type { DashboardSnapshot, PullRequest, ActivityItem } from '@shared/types'

function pr(id: string, over: Partial<PullRequest> = {}): PullRequest {
  return {
    id, number: 1, title: `PR ${id}`, url: `https://gh/${id}`, repo: 'o/r',
    author: { login: 'me', avatarUrl: '' }, reviewers: [], reviewState: 'none',
    approvals: 0, mergeable: 'mergeable',
    checks: { state: 'success', passed: 1, failed: 0, total: 1 },
    updatedAt: '2026-06-02T00:00:00Z', isStale: false, isDraft: false, ...over
  }
}
function act(id: string, updatedAt = '2026-06-02T00:00:00Z'): ActivityItem {
  return { id, reason: 'comment', subjectType: 'PullRequest', repo: 'o/r', number: 1, title: 't', url: 'u', unread: true, updatedAt }
}
function snap(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    fetchedAt: '2026-06-02T00:00:00Z', viewer: { login: 'me', avatarUrl: '' },
    needsReview: [], myPullRequests: [], activity: [],
    rateLimit: { remaining: 5000, resetAt: '' }, ...over
  }
}

describe('diffSnapshots', () => {
  it('returns no notifications on first poll (prev is null)', () => {
    expect(diffSnapshots(null, snap({ needsReview: [pr('a')] }))).toEqual([])
  })

  it('notifies for a newly requested review', () => {
    const prev = snap()
    const next = snap({ needsReview: [pr('a', { title: 'Review me', repo: 'o/api', number: 7 })] })
    const specs = diffSnapshots(prev, next)
    expect(specs).toHaveLength(1)
    expect(specs[0].title).toMatch(/review/i)
    expect(specs[0].url).toBe('https://gh/a')
  })

  it('coalesces multiple new reviews into one notification', () => {
    const next = snap({ needsReview: [pr('a'), pr('b')] })
    const specs = diffSnapshots(snap(), next)
    expect(specs).toHaveLength(1)
    expect(specs[0].title).toMatch(/2/)
  })

  it('notifies for new activity items not seen before', () => {
    const prev = snap({ activity: [act('x')] })
    const next = snap({ activity: [act('y'), act('x')] })
    const specs = diffSnapshots(prev, next)
    expect(specs.some((s) => s.title.toLowerCase().includes('activity') || s.title.toLowerCase().includes('comment'))).toBe(true)
  })

  it('notifies when one of my PRs starts failing checks', () => {
    const prev = snap({ myPullRequests: [pr('a', { checks: { state: 'success', passed: 1, failed: 0, total: 1 } })] })
    const next = snap({ myPullRequests: [pr('a', { checks: { state: 'failure', passed: 0, failed: 1, total: 1 } })] })
    const specs = diffSnapshots(prev, next)
    expect(specs.some((s) => s.title.toLowerCase().includes('check'))).toBe(true)
  })

  it('notifies when one of my PRs flips to changes requested', () => {
    const prev = snap({ myPullRequests: [pr('a', { reviewState: 'none' })] })
    const next = snap({ myPullRequests: [pr('a', { reviewState: 'changes_requested' })] })
    const specs = diffSnapshots(prev, next)
    expect(specs.some((s) => s.title.toLowerCase().includes('change'))).toBe(true)
  })

  it('emits nothing when nothing changed', () => {
    const s = snap({ needsReview: [pr('a')], myPullRequests: [pr('b')], activity: [act('x')] })
    expect(diffSnapshots(s, s)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- notifier`
Expected: FAIL — `diffSnapshots` not defined.

- [ ] **Step 3: Implement `src/main/notifier.ts`**

```typescript
import { DashboardSnapshot, NotificationSpec, PullRequest } from '@shared/types'

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.id, i]))
}

export function diffSnapshots(
  prev: DashboardSnapshot | null,
  next: DashboardSnapshot
): NotificationSpec[] {
  if (!prev) return [] // first poll seeds the baseline; never notify

  const specs: NotificationSpec[] = []

  // 1. Newly requested reviews.
  const prevReview = byId(prev.needsReview)
  const newReviews = next.needsReview.filter((pr) => !prevReview.has(pr.id))
  if (newReviews.length === 1) {
    specs.push({ title: 'New review requested', body: `${newReviews[0].repo} #${newReviews[0].number} — ${newReviews[0].title}`, url: newReviews[0].url })
  } else if (newReviews.length > 1) {
    specs.push({ title: `${newReviews.length} new reviews requested`, body: newReviews.map((p) => `${p.repo} #${p.number}`).join(', '), url: newReviews[0].url })
  }

  // 2. New activity items (by id+updatedAt so an updated thread re-notifies once).
  const prevActivityKeys = new Set(prev.activity.map((a) => `${a.id}@${a.updatedAt}`))
  const newActivity = next.activity.filter((a) => !prevActivityKeys.has(`${a.id}@${a.updatedAt}`))
  if (newActivity.length === 1) {
    const a = newActivity[0]
    const who = a.latestComment?.author.login
    specs.push({ title: who ? `New activity from ${who}` : 'New activity', body: `${a.repo} #${a.number ?? ''} — ${a.title}`, url: a.url })
  } else if (newActivity.length > 1) {
    specs.push({ title: `${newActivity.length} new activity updates`, body: newActivity.slice(0, 3).map((a) => `${a.repo} #${a.number ?? ''}`).join(', '), url: newActivity[0].url })
  }

  // 3. My PRs transitioning into a bad state.
  const prevMine = byId(prev.myPullRequests)
  for (const pr of next.myPullRequests) {
    const before = prevMine.get(pr.id)
    if (!before) continue
    if (pr.checks.state === 'failure' && before.checks.state !== 'failure') {
      specs.push({ title: 'Checks failing', body: `${pr.repo} #${pr.number} — ${pr.title}`, url: pr.url })
    }
    if (pr.reviewState === 'changes_requested' && before.reviewState !== 'changes_requested') {
      specs.push({ title: 'Changes requested', body: `${pr.repo} #${pr.number} — ${pr.title}`, url: pr.url })
    }
  }

  return specs
}

export type { PullRequest }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- notifier`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/notifier.ts src/main/notifier.test.ts
git commit -m "Add snapshot diffing to derive native notification specs"
```

---

## Task 12: Octokit client factory

**Files:**
- Create: `src/main/github/client.ts`

This is thin glue (no new logic to test). It builds an Octokit instance from a token.

- [ ] **Step 1: Implement `src/main/github/client.ts`**

```typescript
import { Octokit } from 'octokit'

export function createClient(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: 'githud/0.1.0' })
}

// Validate a token by resolving the viewer login. Returns null on failure.
export async function validateToken(token: string): Promise<{ login: string; avatarUrl: string } | null> {
  try {
    const octokit = createClient(token)
    const res: any = await octokit.graphql(`query { viewer { login avatarUrl } }`)
    return { login: res.viewer.login, avatarUrl: res.viewer.avatarUrl }
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/github/client.ts
git commit -m "Add Octokit client factory and token validation"
```

---

## Task 13: Poller orchestration

**Files:**
- Create: `src/main/poller.ts`

Wires the unit-tested pieces into one `refresh()` that returns a `DashboardSnapshot`. Holds the per-process notifications state (etag, lastFetchedAt, comment cache, cached activity).

- [ ] **Step 1: Implement `src/main/poller.ts`**

```typescript
import { Octokit } from 'octokit'
import { DashboardSnapshot, ActivityItem, Settings } from '@shared/types'
import { DASHBOARD_QUERY, NEEDS_REVIEW_QUERY, MY_PRS_QUERY } from './github/queries'
import { normalizePullRequests } from './github/normalize-prs'
import { fetchNotifications, shouldPollNotifications } from './github/notifications'
import { CommentCache, enrichThreads } from './github/enrich'
import { normalizeActivity } from './github/normalize-activity'
import { filterActivity } from './github/filter-activity'

export class Poller {
  private commentCache = new CommentCache()
  private etag: string | undefined
  private lastNotificationsFetch: number | null = null
  private notificationsPollIntervalMs = 60_000
  private cachedActivity: ActivityItem[] = []

  constructor(private octokit: Octokit) {}

  async refresh(settings: Settings): Promise<DashboardSnapshot> {
    const now = Date.now()
    const staleThresholdMs = settings.staleThresholdDays * 24 * 60 * 60 * 1000

    // --- PR tables via GraphQL (every poll) ---
    const data: any = await this.octokit.graphql(DASHBOARD_QUERY, {
      needsReview: NEEDS_REVIEW_QUERY,
      mine: MY_PRS_QUERY
    })

    const needsReview = normalizePullRequests(data.needsReview?.nodes ?? [], { now, staleThresholdMs })
    const myPullRequests = normalizePullRequests(data.mine?.nodes ?? [], { now, staleThresholdMs })

    // --- Activity via REST notifications (rate-limited by X-Poll-Interval) ---
    let activity = this.cachedActivity
    if (shouldPollNotifications({ lastFetchedAt: this.lastNotificationsFetch, pollIntervalMs: this.notificationsPollIntervalMs, now })) {
      const result = await fetchNotifications(this.octokit, { etag: this.etag })
      this.lastNotificationsFetch = now
      this.notificationsPollIntervalMs = result.pollIntervalMs
      this.etag = result.etag
      if (!result.notModified) {
        const comments = await enrichThreads(result.threads, {
          cache: this.commentCache,
          request: (url: string) => this.octokit.request(`GET ${url}`)
        })
        activity = normalizeActivity(result.threads, comments).slice(0, 50)
        this.cachedActivity = activity
      }
    }

    const filteredActivity = filterActivity(activity, {
      excludedAuthors: settings.excludedAuthors,
      hideBots: settings.hideBots
    })

    return {
      fetchedAt: new Date(now).toISOString(),
      viewer: { login: data.viewer.login, avatarUrl: data.viewer.avatarUrl },
      needsReview,
      myPullRequests,
      activity: filteredActivity,
      rateLimit: { remaining: data.rateLimit?.remaining ?? 0, resetAt: data.rateLimit?.resetAt ?? '' }
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/poller.ts
git commit -m "Add poller orchestrating GraphQL PRs + REST activity into a snapshot"
```

---

## Task 14: Main process — window, IPC, poll loop, notifications

**Files:**
- Modify: `src/main/index.ts` (replace the Task 1 skeleton)

- [ ] **Step 1: Replace `src/main/index.ts` with the full implementation**

```typescript
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "Wire main process: window, IPC, poll loop, native notifications"
```

---

## Task 15: Preload bridge

**Files:**
- Modify: `src/preload/index.ts` (replace the Task 1 placeholder)

- [ ] **Step 1: Replace `src/preload/index.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import type { GithudApi, DashboardSnapshot, Settings } from '../shared/types'

const api: GithudApi = {
  getSnapshot: () => ipcRenderer.invoke('getSnapshot'),
  refresh: () => ipcRenderer.invoke('refresh'),
  onSnapshot: (cb) => {
    const listener = (_e: unknown, snap: DashboardSnapshot) => cb(snap)
    ipcRenderer.on('snapshot', listener)
    return () => ipcRenderer.removeListener('snapshot', listener)
  },
  getAuthStatus: () => ipcRenderer.invoke('getAuthStatus'),
  saveToken: (token: string) => ipcRenderer.invoke('saveToken', token),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('saveSettings', settings),
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url)
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "Expose typed window.api over the preload bridge"
```

---

## Task 16: Renderer API wrapper + dashboard hook

**Files:**
- Create: `src/renderer/src/api.ts`, `src/renderer/src/hooks/useDashboard.ts`
- Create: `src/renderer/src/global.d.ts`

- [ ] **Step 1: Create `src/renderer/src/global.d.ts`**

```typescript
import type { GithudApi } from '@shared/types'

declare global {
  interface Window {
    api: GithudApi
  }
}

export {}
```

- [ ] **Step 2: Create `src/renderer/src/api.ts`**

```typescript
export const api = window.api
```

- [ ] **Step 3: Create `src/renderer/src/hooks/useDashboard.ts`**

```typescript
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DashboardSnapshot } from '@shared/types'
import { api } from '../api'

export function useDashboard() {
  const qc = useQueryClient()

  const query = useQuery<DashboardSnapshot | null>({
    queryKey: ['dashboard'],
    queryFn: () => api.refresh(),
    initialData: undefined,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false
  })

  // Seed from the cached snapshot once on mount.
  useEffect(() => {
    let active = true
    api.getSnapshot().then((snap) => {
      if (active && snap) qc.setQueryData(['dashboard'], snap)
    })
    return () => { active = false }
  }, [qc])

  // Apply pushed snapshots from the main process poll loop.
  useEffect(() => {
    return api.onSnapshot((snap) => qc.setQueryData(['dashboard'], snap))
  }, [qc])

  return query
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/api.ts src/renderer/src/hooks/useDashboard.ts src/renderer/src/global.d.ts
git commit -m "Add renderer API wrapper and useDashboard query hook"
```

---

## Task 17: TokenSetup component

**Files:**
- Create: `src/renderer/src/components/TokenSetup.tsx`
- Test: `src/renderer/src/components/TokenSetup.test.tsx`

- [ ] **Step 1: Write the failing test `src/renderer/src/components/TokenSetup.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TokenSetup } from './TokenSetup'

describe('TokenSetup', () => {
  beforeEach(() => {
    window.api = {
      saveToken: vi.fn().mockResolvedValue({ ok: true, login: 'me' })
    } as any
  })

  it('disables submit until a token is entered', () => {
    render(<TokenSetup onSaved={() => {}} />)
    expect(screen.getByRole('button', { name: /save token/i })).toBeDisabled()
  })

  it('saves the token and calls onSaved on success', async () => {
    const onSaved = vi.fn()
    render(<TokenSetup onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'ghp_x')
    await userEvent.click(screen.getByRole('button', { name: /save token/i }))
    expect(window.api.saveToken).toHaveBeenCalledWith('ghp_x')
    expect(onSaved).toHaveBeenCalledWith('me')
  })

  it('shows an error when the token is rejected', async () => {
    window.api.saveToken = vi.fn().mockResolvedValue({ ok: false, error: 'Token rejected' })
    render(<TokenSetup onSaved={() => {}} />)
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'bad')
    await userEvent.click(screen.getByRole('button', { name: /save token/i }))
    expect(await screen.findByText(/token rejected/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- TokenSetup`
Expected: FAIL — component not defined.

- [ ] **Step 3: Implement `src/renderer/src/components/TokenSetup.tsx`**

```tsx
import { useState } from 'react'
import { api } from '../api'

export function TokenSetup({ onSaved }: { onSaved: (login: string) => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await api.saveToken(token.trim())
    setBusy(false)
    if (res.ok && res.login) onSaved(res.login)
    else setError(res.error ?? 'Failed to save token')
  }

  return (
    <div className="token-setup">
      <h1>Connect githud to GitHub</h1>
      <p>
        Create a Personal Access Token with <code>repo</code>, <code>read:org</code>, and{' '}
        <code>notifications</code> scopes (or a fine-grained token with read access to PRs, checks,
        and notifications), then paste it below.
      </p>
      <p>
        <a href="#" onClick={(e) => { e.preventDefault(); api.openExternal('https://github.com/settings/tokens') }}>
          Open GitHub token settings →
        </a>
      </p>
      <label htmlFor="token">Personal access token</label>
      <input
        id="token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="ghp_…"
        autoFocus
      />
      <button onClick={submit} disabled={!token.trim() || busy}>
        {busy ? 'Validating…' : 'Save token'}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- TokenSetup`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TokenSetup.tsx src/renderer/src/components/TokenSetup.test.tsx
git commit -m "Add TokenSetup component with validation flow"
```

---

## Task 18: PR table components

**Files:**
- Create: `src/renderer/src/components/NeedsReviewTable.tsx`, `src/renderer/src/components/MyPullRequestsTable.tsx`
- Test: `src/renderer/src/components/PrTables.test.tsx`

- [ ] **Step 1: Write the failing test `src/renderer/src/components/PrTables.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeedsReviewTable } from './NeedsReviewTable'
import { MyPullRequestsTable } from './MyPullRequestsTable'
import type { PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p1', number: 88, title: 'Fix nav focus trap', url: 'https://gh/88', repo: 'o/web',
    author: { login: 'asmith', avatarUrl: '' }, reviewers: [{ login: 'me', avatarUrl: '' }],
    reviewState: 'changes_requested', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'failure', passed: 11, failed: 1, total: 12 },
    updatedAt: '2026-06-01T00:00:00Z', isStale: true, isDraft: false, ...over
  }
}

beforeEach(() => { window.api = { openExternal: vi.fn() } as any })

describe('NeedsReviewTable', () => {
  it('renders an empty state with no rows', () => {
    render(<NeedsReviewTable items={[]} />)
    expect(screen.getByText(/nothing needs your review/i)).toBeInTheDocument()
  })

  it('renders a row and opens the PR on click', async () => {
    render(<NeedsReviewTable items={[pr()]} />)
    expect(screen.getByText('Fix nav focus trap')).toBeInTheDocument()
    expect(screen.getByText(/o\/web #88/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Fix nav focus trap'))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://gh/88')
  })
})

describe('MyPullRequestsTable', () => {
  it('shows failing checks and changes-requested status', () => {
    render(<MyPullRequestsTable items={[pr()]} />)
    expect(screen.getByText(/1 failing/i)).toBeInTheDocument()
    expect(screen.getByText(/changes requested/i)).toBeInTheDocument()
  })

  it('renders an empty state with no rows', () => {
    render(<MyPullRequestsTable items={[]} />)
    expect(screen.getByText(/no open pull requests/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- PrTables`
Expected: FAIL — components not defined.

- [ ] **Step 3: Implement the shared cell helpers + both tables**

Create `src/renderer/src/components/NeedsReviewTable.tsx`:
```tsx
import { PullRequest } from '@shared/types'
import { api } from '../api'

export function ChecksCell({ pr }: { pr: PullRequest }) {
  const c = pr.checks
  if (c.state === 'none') return <span className="muted">—</span>
  if (c.state === 'failure') return <span className="bad">✗ {c.failed} failing</span>
  if (c.state === 'pending') return <span className="warn">● {c.total} running</span>
  return <span className="good">✓ {c.passed}/{c.total}</span>
}

export function AgeCell({ pr }: { pr: PullRequest }) {
  const rel = relativeAge(pr.updatedAt)
  return <span className={pr.isStale ? 'warn' : ''}>{rel}{pr.isStale ? ' ⚠' : ''}</span>
}

export function relativeAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function PrTitleCell({ pr }: { pr: PullRequest }) {
  return (
    <button className="pr-link" onClick={() => api.openExternal(pr.url)}>
      <span className="pr-title">{pr.title}</span>
      <span className="pr-repo">{pr.repo} #{pr.number}</span>
    </button>
  )
}

export function NeedsReviewTable({ items }: { items: PullRequest[] }) {
  if (items.length === 0) return <p className="empty">Nothing needs your review. 🎉</p>
  return (
    <table className="pr-table">
      <thead>
        <tr><th>PR</th><th>Author</th><th>Checks</th><th>Age</th></tr>
      </thead>
      <tbody>
        {items.map((pr) => (
          <tr key={pr.id}>
            <td><PrTitleCell pr={pr} /></td>
            <td>{pr.author.login}</td>
            <td><ChecksCell pr={pr} /></td>
            <td><AgeCell pr={pr} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

Create `src/renderer/src/components/MyPullRequestsTable.tsx`:
```tsx
import { PullRequest } from '@shared/types'
import { ChecksCell, AgeCell, PrTitleCell } from './NeedsReviewTable'

function StatusCell({ pr }: { pr: PullRequest }) {
  if (pr.reviewState === 'changes_requested') return <span className="warn">⟳ changes requested</span>
  if (pr.reviewState === 'approved') {
    const mergeNote = pr.mergeable === 'conflicting' ? ' · conflicts' : ''
    return <span className="good">✓ {pr.approvals} approval{pr.approvals === 1 ? '' : 's'}{mergeNote}</span>
  }
  if (pr.isDraft) return <span className="muted">draft</span>
  return <span className="muted">review required</span>
}

export function MyPullRequestsTable({ items }: { items: PullRequest[] }) {
  if (items.length === 0) return <p className="empty">No open pull requests authored by you.</p>
  return (
    <table className="pr-table">
      <thead>
        <tr><th>PR</th><th>Status</th><th>Checks</th><th>Age</th></tr>
      </thead>
      <tbody>
        {items.map((pr) => (
          <tr key={pr.id}>
            <td><PrTitleCell pr={pr} /></td>
            <td><StatusCell pr={pr} /></td>
            <td><ChecksCell pr={pr} /></td>
            <td><AgeCell pr={pr} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- PrTables`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/NeedsReviewTable.tsx src/renderer/src/components/MyPullRequestsTable.tsx src/renderer/src/components/PrTables.test.tsx
git commit -m "Add Needs-my-review and My-open-PRs table components"
```

---

## Task 19: ActivityFeed component

**Files:**
- Create: `src/renderer/src/components/ActivityFeed.tsx`
- Test: `src/renderer/src/components/ActivityFeed.test.tsx`

- [ ] **Step 1: Write the failing test `src/renderer/src/components/ActivityFeed.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityFeed } from './ActivityFeed'
import type { ActivityItem } from '@shared/types'

function item(over: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 't1', reason: 'mention', subjectType: 'PullRequest', repo: 'o/web', number: 88,
    title: 'Fix nav focus trap', url: 'https://gh/88', unread: true, updatedAt: '2026-06-02T00:00:00Z',
    latestComment: { author: { login: 'asmith', avatarUrl: '' }, body: 'Please also handle the browser-chrome case.', createdAt: '2026-06-02T00:00:00Z' },
    ...over
  }
}

beforeEach(() => { window.api = { openExternal: vi.fn() } as any })

describe('ActivityFeed', () => {
  it('renders the full comment body and a reason badge', () => {
    render(<ActivityFeed items={[item()]} />)
    expect(screen.getByText(/please also handle the browser-chrome case/i)).toBeInTheDocument()
    expect(screen.getByText(/mention/i)).toBeInTheDocument()
    expect(screen.getByText(/o\/web #88/)).toBeInTheDocument()
  })

  it('opens the thread on click', async () => {
    render(<ActivityFeed items={[item()]} />)
    await userEvent.click(screen.getByText(/fix nav focus trap/i))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://gh/88')
  })

  it('renders an empty state', () => {
    render(<ActivityFeed items={[]} />)
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument()
  })

  it('renders subject-only items without a comment body', () => {
    render(<ActivityFeed items={[item({ id: 't2', reason: 'ci_activity', latestComment: undefined, title: 'CI failed on main' })]} />)
    expect(screen.getByText(/ci failed on main/i)).toBeInTheDocument()
    expect(screen.getByText(/ci.activity/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- ActivityFeed`
Expected: FAIL — component not defined.

- [ ] **Step 3: Implement `src/renderer/src/components/ActivityFeed.tsx`**

```tsx
import { ActivityItem } from '@shared/types'
import { api } from '../api'
import { relativeAge } from './NeedsReviewTable'

const REASON_LABEL: Record<string, string> = {
  mention: 'mention',
  team_mention: 'team mention',
  comment: 'comment',
  review_requested: 'review requested',
  ci_activity: 'ci activity',
  assign: 'assigned',
  author: 'author',
  state_change: 'state change',
  subscribed: 'subscribed'
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <button className={`activity-item${item.unread ? ' unread' : ''}`} onClick={() => api.openExternal(item.url)}>
      <div className="activity-head">
        {item.latestComment && <span className="activity-author">{item.latestComment.author.login}</span>}
        <span className="reason-badge">{REASON_LABEL[item.reason] ?? item.reason}</span>
        <span className="activity-ctx">{item.repo}{item.number ? ` #${item.number}` : ''}</span>
        <span className="activity-time">{relativeAge(item.updatedAt)}</span>
      </div>
      <div className="activity-title">{item.title}</div>
      {item.latestComment && <div className="activity-body">{item.latestComment.body}</div>}
    </button>
  )
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="empty">No recent activity.</p>
  return (
    <div className="activity-feed">
      {items.map((item) => <ActivityRow key={item.id} item={item} />)}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- ActivityFeed`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ActivityFeed.tsx src/renderer/src/components/ActivityFeed.test.tsx
git commit -m "Add ActivityFeed component with reason badges and full comment bodies"
```

---

## Task 20: TopBar + Settings components

**Files:**
- Create: `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/components/Settings.tsx`
- Test: `src/renderer/src/components/Settings.test.tsx`

- [ ] **Step 1: Write the failing test `src/renderer/src/components/Settings.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from './Settings'
import { DEFAULT_SETTINGS } from '@shared/types'

beforeEach(() => {
  window.api = {
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockImplementation((s) => Promise.resolve(s))
  } as any
})

describe('Settings', () => {
  it('loads current settings and saves edits', async () => {
    render(<Settings onClose={() => {}} />)
    const hideBots = await screen.findByLabelText(/hide bot/i)
    expect(hideBots).toBeChecked() // default true
    await userEvent.click(hideBots)

    const authors = screen.getByLabelText(/excluded authors/i)
    await userEvent.clear(authors)
    await userEvent.type(authors, 'noisybot, anotherbot')

    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(window.api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ hideBots: false, excludedAuthors: ['noisybot', 'anotherbot'] })
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- Settings`
Expected: FAIL — component not defined.

- [ ] **Step 3: Implement `src/renderer/src/components/Settings.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Settings as SettingsType, DEFAULT_SETTINGS } from '@shared/types'
import { api } from '../api'

export function Settings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS)
  const [authorsText, setAuthorsText] = useState('')

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s)
      setAuthorsText(s.excludedAuthors.join(', '))
    })
  }, [])

  async function save() {
    const excludedAuthors = authorsText.split(',').map((a) => a.trim()).filter(Boolean)
    await api.saveSettings({ ...settings, excludedAuthors })
    onClose()
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <h2>Settings</h2>

        <label>
          <input
            type="checkbox"
            checked={settings.notificationsEnabled}
            onChange={(e) => setSettings({ ...settings, notificationsEnabled: e.target.checked })}
          />
          Enable desktop notifications
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.hideBots}
            onChange={(e) => setSettings({ ...settings, hideBots: e.target.checked })}
          />
          Hide bot authors in activity
        </label>

        <label htmlFor="stale">Stale threshold (days)</label>
        <input
          id="stale"
          type="number"
          min={1}
          value={settings.staleThresholdDays}
          onChange={(e) => setSettings({ ...settings, staleThresholdDays: Number(e.target.value) || 1 })}
        />

        <label htmlFor="authors">Excluded authors (comma-separated)</label>
        <input
          id="authors"
          type="text"
          value={authorsText}
          onChange={(e) => setAuthorsText(e.target.value)}
          placeholder="dependabot[bot], some-user"
        />

        <div className="settings-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Implement `src/renderer/src/components/TopBar.tsx`**

```tsx
import { DashboardSnapshot } from '@shared/types'
import { relativeAge } from './NeedsReviewTable'

export function TopBar({
  snapshot,
  onRefresh,
  onOpenSettings,
  isFetching
}: {
  snapshot: DashboardSnapshot | null
  onRefresh: () => void
  onOpenSettings: () => void
  isFetching: boolean
}) {
  const failing = snapshot?.myPullRequests.filter((p) => p.checks.state === 'failure').length ?? 0
  const needs = snapshot?.needsReview.length ?? 0
  const summary = needs === 0 && failing === 0 ? 'all caught up' : `${needs} to review${failing ? ` · ${failing} failing` : ''}`

  return (
    <header className="top-bar">
      <span className="brand">githud</span>
      <span className="summary">{summary}</span>
      {failing > 0 && <span className="badge bad">✗ {failing} failing</span>}
      <span className="spacer" />
      {snapshot?.error && <span className="badge warn" title={snapshot.error}>offline — retrying</span>}
      <span className="refreshed">
        {snapshot ? `updated ${relativeAge(snapshot.fetchedAt)} ago` : ''}
      </span>
      <button onClick={onRefresh} disabled={isFetching}>{isFetching ? '↻…' : '↻'}</button>
      <button onClick={onOpenSettings}>⚙</button>
    </header>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- Settings`
Expected: PASS (1 test). Then `npm run typecheck` PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/TopBar.tsx src/renderer/src/components/Settings.tsx src/renderer/src/components/Settings.test.tsx
git commit -m "Add TopBar and Settings components"
```

---

## Task 21: App wiring + styles

**Files:**
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`
- Create: `src/renderer/src/styles.css`

- [ ] **Step 1: Replace `src/renderer/src/main.tsx` to add the QueryClient + styles**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
```

- [ ] **Step 2: Replace `src/renderer/src/App.tsx`**

```tsx
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
  if (!hasToken) return <TokenSetup onSaved={() => setHasToken(true)} />

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
```

- [ ] **Step 3: Create `src/renderer/src/styles.css`**

```css
:root {
  --bg: #0d1117; --panel: #161b22; --border: #30363d; --line: #21262d;
  --text: #c9d1d9; --bright: #e6edf3; --muted: #8b949e;
  --blue: #58a6ff; --green: #3fb950; --red: #f85149; --amber: #d29922;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.app { display: flex; flex-direction: column; height: 100vh; }
.loading { padding: 40px; color: var(--muted); }

.top-bar { display: flex; align-items: center; gap: 12px; padding: 8px 14px;
  background: var(--panel); border-bottom: 1px solid var(--border); }
.top-bar .brand { font-weight: 700; color: var(--bright); }
.top-bar .summary { color: var(--muted); }
.top-bar .spacer { flex: 1; }
.top-bar button { background: transparent; border: 1px solid var(--border);
  color: var(--text); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.badge { border-radius: 10px; padding: 1px 8px; font-size: 11px; }
.badge.bad { background: #f8514922; color: var(--red); }
.badge.warn { background: #d2992222; color: var(--amber); }
.refreshed { color: var(--muted); font-size: 11px; }

.layout { display: grid; grid-template-columns: 1.5fr 1fr; gap: 12px;
  padding: 12px; overflow: hidden; flex: 1; }
.tables { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.rail { overflow-y: auto; }
.panel { background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px 12px; }
.panel h2 { font-size: 13px; color: var(--bright); margin: 0 0 8px;
  display: flex; align-items: center; gap: 8px; }
.count { background: #1f6feb33; color: var(--blue); border-radius: 10px;
  padding: 0 7px; font-size: 11px; }
.empty { color: var(--muted); padding: 8px 2px; }

.pr-table { width: 100%; border-collapse: collapse; }
.pr-table th { text-align: left; color: var(--muted); font-weight: 500;
  font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
  padding: 4px 6px; border-bottom: 1px solid var(--border); }
.pr-table td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
.pr-link { display: flex; flex-direction: column; align-items: flex-start;
  background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
.pr-title { color: var(--bright); }
.pr-repo { color: var(--muted); font-size: 11px; }
.good { color: var(--green); } .bad { color: var(--red); }
.warn { color: var(--amber); } .muted { color: var(--muted); }

.activity-feed { display: flex; flex-direction: column; gap: 8px; }
.activity-item { width: 100%; text-align: left; cursor: pointer;
  background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
.activity-item.unread { border-left: 2px solid var(--blue); }
.activity-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-bottom: 4px; font-size: 11px; }
.activity-author { color: var(--bright); font-weight: 600; }
.reason-badge { background: #1f6feb22; color: var(--blue); border-radius: 8px; padding: 0 6px; }
.activity-ctx { color: var(--blue); } .activity-time { color: var(--muted); margin-left: auto; }
.activity-title { color: var(--bright); margin-bottom: 4px; }
.activity-body { color: var(--text); white-space: pre-wrap; }

.token-setup { max-width: 560px; margin: 60px auto; padding: 0 20px; }
.token-setup input { width: 100%; padding: 8px; margin: 6px 0 12px;
  background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; }
.token-setup button, .settings-panel button { background: var(--blue); color: #fff;
  border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; }
.token-setup button:disabled { opacity: .5; cursor: default; }
.error { color: var(--red); }

.settings-overlay { position: fixed; inset: 0; background: #000a;
  display: flex; align-items: center; justify-content: center; }
.settings-panel { background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; padding: 20px; width: 420px; display: flex; flex-direction: column; gap: 10px; }
.settings-panel label { display: block; }
.settings-panel input[type=text], .settings-panel input[type=number] {
  width: 100%; padding: 6px; background: var(--bg); border: 1px solid var(--border);
  color: var(--text); border-radius: 6px; }
.settings-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.settings-actions button:first-child { background: transparent; border: 1px solid var(--border); color: var(--text); }
```

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `npm run typecheck && npm run test`
Expected: typecheck PASS; all tests PASS (token-store, settings-store, snapshot-cache, normalize-prs, notifications, enrich, normalize-activity, filter-activity, notifier, TokenSetup, PrTables, ActivityFeed, Settings).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/main.tsx src/renderer/src/styles.css
git commit -m "Wire dashboard layout, token gate, settings overlay, and styles"
```

---

## Task 22: Manual smoke test + production build

**Files:** none (verification only)

- [ ] **Step 1: Run the app in dev and connect a real token**

Run: `npm run dev`
Then in the window:
1. Confirm the **TokenSetup** screen appears.
2. Paste a real classic PAT (scopes `repo`, `read:org`, `notifications`) and click **Save token**.
Expected: the dashboard appears; "Needs my review" and "My open PRs" tables populate; the Activity rail shows recent notifications with full comment bodies.

- [ ] **Step 2: Verify polling, filtering, and external links**

1. Wait ~30s and confirm `updated … ago` resets (data refreshes).
2. Open **⚙ Settings**, toggle **Hide bot authors** / add an excluded author, Save → confirm those rows disappear from Activity.
3. Click a PR row and an activity row → confirm each opens the correct page in your browser.

Expected: all behaviors work; no errors in the terminal or devtools console.

- [ ] **Step 3: Verify notifications**

With the app running, trigger (or wait for) a new comment/review request on a tracked PR.
Expected: a native desktop notification appears; clicking it opens the PR. (The first poll after launch must NOT produce a flood of notifications — it seeds the baseline silently.)

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: builds `out/main`, `out/preload`, `out/renderer` with no errors.

Optional packaged app: `npm run package` (produces an unsigned `.app` under `dist/` via electron-builder `--dir`).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "githud v1 complete: verified dashboard, polling, filtering, notifications"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** needs-my-review (T6/T18), my open PRs with review status + checks + stale (T6/T18), activity from Notifications API enriched + collapsed (T7–T9, T19), bot/author filtering (T10, T20), failing-checks badge (T20), native notifications by diffing (T11, T14), token via safeStorage (T3, T14), 30s polling + X-Poll-Interval (T7, T13, T14), disk cache for cold start (T5, T14, T16), error/empty/rate-limit handling (T14, T18/T19 empty states). All covered.
- **Type consistency:** `GithudApi` (T2) is implemented verbatim in preload (T15) and consumed via `window.api` (T16). `relativeAge` is defined once in `NeedsReviewTable.tsx` and reused by `MyPullRequestsTable`, `ActivityFeed`, and `TopBar`.
- **Rate-limit handling note:** the spec mentions backing off when `rateLimit.remaining` is near zero. v1 surfaces `rateLimit` in the snapshot and naturally throttles notifications via `X-Poll-Interval`; an explicit GraphQL back-off is deferred (single-user load stays far under budget). If desired later, gate `runPoll` on `lastSnapshot.rateLimit`.
