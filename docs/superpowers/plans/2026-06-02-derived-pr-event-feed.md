# Derived PR Event Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/notifications`-based activity feed with a self-owned event feed derived by diffing the PR data we already poll, so every event states what happened, on which PR, and by whom.

**Architecture:** Each poll fetches enriched PR data (reviews, comments, CI, head oid) for PRs the user authors + is asked to review. A pure `deriveEvents(prev, next)` compares the prior persisted PR state against the new one and emits typed `FeedEvent`s with actors. Events are appended to a persistent capped store with read-state; the renderer renders the store and can mark events read. Native notifications fire for newly appended events. The notifications API and its enrichment code are removed.

**Tech Stack:** Electron (main), React 19 + TanStack Query (renderer), TypeScript, Vitest, Octokit GraphQL/REST. Package manager is **pnpm**.

---

## File Structure

**Create:**
- `src/main/github/pr-state.ts` — `PRState` type + `toPrState(node, source)` (pure)
- `src/main/github/pr-state.test.ts`
- `src/main/github/derive-events.ts` — `deriveEvents(...)` (pure)
- `src/main/github/derive-events.test.ts`
- `src/main/github/filter-events.ts` — `filterEvents`, `isBotLogin` (pure)
- `src/main/github/filter-events.test.ts`
- `src/main/event-store.ts` — pure `mergeEvents`/`applyRead`/`applyReadAll` + fs-backed store
- `src/main/event-store.test.ts`

**Modify:**
- `src/shared/types.ts` — add `FeedEvent`/`FeedEventKind`, change `DashboardSnapshot.activity` → `events`, drop `ActivityItem`, extend `GithudApi`
- `src/main/paths.ts` — add `eventsFilePath`, `prStateFilePath`
- `src/main/github/queries.ts` — extend `PR_FIELDS`
- `src/main/github/enrich-state.ts` — keep `subjectStateLabel`, drop `StateCache`/`enrichStates`
- `src/main/github/enrich-state.test.ts` — drop the removed tests
- `src/main/poller.ts` — rewrite `refresh` to derive events
- `src/main/notifier.ts` — rewrite `diffSnapshots` to diff `events`
- `src/main/index.ts` — `events: []` in degraded snapshot, add `markRead`/`markAllRead` IPC
- `src/preload/index.ts` — expose `markRead`/`markAllRead`
- `src/renderer/src/components/icons.tsx` — `iconForKind`
- `src/renderer/src/components/activity-severity.ts` — `severityForKind`
- `src/renderer/src/components/activity-severity.test.ts` — rewrite for kinds
- `src/renderer/src/components/ActivityFeed.tsx` — render `FeedEvent[]`
- `src/renderer/src/components/ActivityFeed.test.tsx` — rewrite
- `src/renderer/src/App.tsx` — pass `events`, add "mark all read"

**Delete:**
- `src/main/github/notifications.ts` + `notifications.test.ts`
- `src/main/github/enrich.ts` + `enrich.test.ts`
- `src/main/github/normalize-activity.ts` + `normalize-activity.test.ts`
- `src/main/github/filter-activity.ts` + `filter-activity.test.ts`

---

## Task 1: Add the event types to the shared contract

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `FeedEventKind` + `FeedEvent`, replace `activity`, drop `ActivityItem`, extend `GithudApi`**

In `src/shared/types.ts`, delete the entire `ActivityItem` interface (lines beginning `export interface ActivityItem {` through its closing `}`), and add this near the `PullRequest` interface:

```ts
export type FeedEventKind =
  | 'approved' | 'changes_requested' | 'review_commented'
  | 'comment' | 'mention'
  | 'ci_failed' | 'ci_succeeded'
  | 'review_requested'
  | 'merged' | 'closed'

export interface FeedEvent {
  id: string // stable, content-derived; enables dedupe + read-state
  kind: FeedEventKind
  repo: string // "owner/name"
  number: number
  title: string // PR title
  url: string // deep-link to the comment/review when possible
  actor?: User // reviewer / commenter; absent for CI + lifecycle
  createdAt: string
  unread: boolean
}
```

In `DashboardSnapshot`, replace `activity: ActivityItem[]` with `events: FeedEvent[]`.

In `GithudApi`, add these two methods after `openExternal`:

```ts
  markRead(id: string): Promise<FeedEvent[]>
  markAllRead(): Promise<FeedEvent[]>
```

- [ ] **Step 2: Verify the type compiles in isolation**

Run: `pnpm run typecheck`
Expected: FAILS, but only with errors in files that still reference `ActivityItem` / `snapshot.activity` (poller, notifier, index, ActivityFeed, filter-activity, normalize-activity). That is expected — later tasks fix them. Confirm there are **no** syntax errors reported inside `types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add FeedEvent contract, replace activity with events"
```

---

## Task 2: `PRState` and `toPrState`

**Files:**
- Create: `src/main/github/pr-state.ts`
- Test: `src/main/github/pr-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/github/pr-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toPrState } from './pr-state'

function node(over: any = {}) {
  return {
    id: 'PR1', number: 88, title: 'Fix nav', url: 'https://gh/88',
    repository: { nameWithOwner: 'o/web' },
    author: { login: 'bob', avatarUrl: 'av-bob' },
    reviews: { nodes: [{ id: 'r1', state: 'APPROVED', author: { login: 'alice', avatarUrl: 'av-a' }, submittedAt: '2026-06-02T00:00:00Z', url: 'https://gh/88#r1' }] },
    comments: { nodes: [{ id: 'c1', author: { login: 'carol', avatarUrl: 'av-c' }, createdAt: '2026-06-02T01:00:00Z', url: 'https://gh/88#c1', bodyText: 'hi' }] },
    commits: { nodes: [{ commit: { oid: 'deadbeef', statusCheckRollup: { state: 'FAILURE' } } }] },
    ...over
  }
}

describe('toPrState', () => {
  it('maps a GraphQL PR node into a diffable PRState', () => {
    const s = toPrState(node(), 'mine')
    expect(s).toMatchObject({
      id: 'PR1', number: 88, title: 'Fix nav', url: 'https://gh/88', repo: 'o/web',
      authorLogin: 'bob', source: 'mine', ciState: 'failure', headOid: 'deadbeef'
    })
    expect(s.reviews).toEqual([{ id: 'r1', state: 'APPROVED', authorLogin: 'alice', authorAvatarUrl: 'av-a', url: 'https://gh/88#r1', submittedAt: '2026-06-02T00:00:00Z' }])
    expect(s.comments).toEqual([{ id: 'c1', authorLogin: 'carol', authorAvatarUrl: 'av-c', url: 'https://gh/88#c1', createdAt: '2026-06-02T01:00:00Z', bodyText: 'hi' }])
  })

  it('maps rollup states and tolerates missing data', () => {
    expect(toPrState(node({ commits: { nodes: [{ commit: { oid: 'x', statusCheckRollup: { state: 'SUCCESS' } } }] } }), 'review').ciState).toBe('success')
    expect(toPrState(node({ commits: { nodes: [{ commit: { oid: 'x', statusCheckRollup: { state: 'PENDING' } } }] } }), 'review').ciState).toBe('pending')
    expect(toPrState(node({ commits: { nodes: [] }, reviews: { nodes: [] }, comments: { nodes: [] } }), 'review')).toMatchObject({ ciState: 'none', headOid: '', reviews: [], comments: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- pr-state`
Expected: FAIL — `Cannot find module './pr-state'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/github/pr-state.ts`:

```ts
export interface PrReview {
  id: string
  state: string
  authorLogin: string
  authorAvatarUrl: string
  url: string
  submittedAt: string
}

export interface PrComment {
  id: string
  authorLogin: string
  authorAvatarUrl: string
  url: string
  createdAt: string
  bodyText: string
}

export interface PRState {
  id: string
  number: number
  title: string
  url: string
  repo: string
  authorLogin: string
  source: 'mine' | 'review'
  ciState: 'success' | 'failure' | 'pending' | 'none'
  headOid: string
  reviews: PrReview[]
  comments: PrComment[]
}

function ciStateFromRollup(state: string | undefined): PRState['ciState'] {
  switch ((state ?? '').toUpperCase()) {
    case 'SUCCESS': return 'success'
    case 'FAILURE':
    case 'ERROR': return 'failure'
    case 'PENDING':
    case 'EXPECTED': return 'pending'
    default: return 'none'
  }
}

export function toPrState(node: any, source: 'mine' | 'review'): PRState {
  const commit = node.commits?.nodes?.[0]?.commit
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    repo: node.repository?.nameWithOwner ?? '',
    authorLogin: node.author?.login ?? 'unknown',
    source,
    ciState: ciStateFromRollup(commit?.statusCheckRollup?.state),
    headOid: commit?.oid ?? '',
    reviews: (node.reviews?.nodes ?? []).filter(Boolean).map((r: any) => ({
      id: r.id,
      state: r.state,
      authorLogin: r.author?.login ?? 'unknown',
      authorAvatarUrl: r.author?.avatarUrl ?? '',
      url: r.url ?? node.url,
      submittedAt: r.submittedAt ?? ''
    })),
    comments: (node.comments?.nodes ?? []).filter(Boolean).map((c: any) => ({
      id: c.id,
      authorLogin: c.author?.login ?? 'unknown',
      authorAvatarUrl: c.author?.avatarUrl ?? '',
      url: c.url ?? node.url,
      createdAt: c.createdAt ?? '',
      bodyText: c.bodyText ?? ''
    }))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- pr-state`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/github/pr-state.ts src/main/github/pr-state.test.ts
git commit -m "feat: add PRState and toPrState for event diffing"
```

---

## Task 3: `deriveEvents` (the diff engine)

**Files:**
- Create: `src/main/github/derive-events.ts`
- Test: `src/main/github/derive-events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/github/derive-events.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveEvents } from './derive-events'
import type { PRState } from './pr-state'

const NOW = '2026-06-02T12:00:00Z'

function pr(over: Partial<PRState> = {}): PRState {
  return {
    id: 'PR1', number: 88, title: 'Fix nav', url: 'https://gh/88', repo: 'o/web',
    authorLogin: 'me', source: 'mine', ciState: 'none', headOid: 'oid1',
    reviews: [], comments: [], ...over
  }
}

describe('deriveEvents', () => {
  it('returns nothing when there is no prior baseline', () => {
    expect(deriveEvents(null, [pr()], 'me', NOW)).toEqual([])
  })

  it('emits a review event with the reviewer as actor', () => {
    const prev = [pr({ reviews: [] })]
    const next = [pr({ reviews: [{ id: 'r1', state: 'APPROVED', authorLogin: 'alice', authorAvatarUrl: 'av', url: 'https://gh/88#r1', submittedAt: NOW }] })]
    const [e] = deriveEvents(prev, next, 'me', NOW)
    expect(e).toMatchObject({ id: 'review:r1', kind: 'approved', actor: { login: 'alice', avatarUrl: 'av' }, url: 'https://gh/88#r1', unread: true })
  })

  it('classifies CHANGES_REQUESTED and COMMENTED reviews', () => {
    const prev = [pr()]
    const next = [pr({ reviews: [
      { id: 'r1', state: 'CHANGES_REQUESTED', authorLogin: 'a', authorAvatarUrl: '', url: 'u', submittedAt: NOW },
      { id: 'r2', state: 'COMMENTED', authorLogin: 'b', authorAvatarUrl: '', url: 'u', submittedAt: NOW }
    ] })]
    const kinds = deriveEvents(prev, next, 'me', NOW).map((e) => e.kind)
    expect(kinds).toEqual(['changes_requested', 'review_commented'])
  })

  it('emits a comment event, and a mention when the body @-mentions the viewer', () => {
    const prev = [pr()]
    const next = [pr({ comments: [
      { id: 'c1', authorLogin: 'x', authorAvatarUrl: '', url: 'u1', createdAt: NOW, bodyText: 'looks good' },
      { id: 'c2', authorLogin: 'y', authorAvatarUrl: '', url: 'u2', createdAt: NOW, bodyText: 'cc @ME please' }
    ] })]
    const events = deriveEvents(prev, next, 'me', NOW)
    expect(events.map((e) => e.kind)).toEqual(['comment', 'mention'])
  })

  it('emits a CI event only on transition into failure/success', () => {
    const prev = [pr({ ciState: 'pending' })]
    const next = [pr({ ciState: 'failure' })]
    const [e] = deriveEvents(prev, next, 'me', NOW)
    expect(e).toMatchObject({ id: 'ci:PR1:oid1:failure', kind: 'ci_failed', createdAt: NOW })
    // no transition -> nothing
    expect(deriveEvents([pr({ ciState: 'failure' })], [pr({ ciState: 'failure' })], 'me', NOW)).toEqual([])
  })

  it('emits review_requested for a newly appeared PR in the review set, not for new mine PRs', () => {
    const next = [pr({ id: 'NEW', source: 'review' }), pr({ id: 'NEWMINE', source: 'mine' })]
    const events = deriveEvents([], next, 'me', NOW)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: 'review_requested:NEW', kind: 'review_requested', createdAt: NOW })
  })

  it('emits merged/closed for mine PRs that fell out, using the resolved label', () => {
    const prev = [pr({ id: 'GONE', source: 'mine' })]
    const fallenOut = new Map<string, 'merged' | 'closed'>([['GONE', 'merged']])
    const [e] = deriveEvents(prev, [], 'me', NOW, fallenOut)
    expect(e).toMatchObject({ id: 'merged:GONE', kind: 'merged', createdAt: NOW })
  })

  it('does not emit a backlog of comments for a PR seen for the first time', () => {
    const next = [pr({ id: 'NEW', source: 'review', comments: [{ id: 'c9', authorLogin: 'z', authorAvatarUrl: '', url: 'u', createdAt: NOW, bodyText: 'old' }] })]
    const events = deriveEvents([], next, 'me', NOW)
    expect(events.map((e) => e.kind)).toEqual(['review_requested'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- derive-events`
Expected: FAIL — `Cannot find module './derive-events'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/github/derive-events.ts`:

```ts
import { FeedEvent, FeedEventKind } from '@shared/types'
import { PRState } from './pr-state'

const REVIEW_KIND: Record<string, FeedEventKind> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'review_commented'
}

// Compares the previous persisted PR state against the latest poll and emits
// the events that occurred in between. `prev === null` means no baseline yet
// (first run), so we emit nothing. `now` is the ISO timestamp for events that
// have no natural timestamp of their own (CI, review requests, lifecycle).
export function deriveEvents(
  prev: PRState[] | null,
  next: PRState[],
  viewerLogin: string,
  now: string,
  fallenOutStates: Map<string, 'merged' | 'closed'> = new Map()
): FeedEvent[] {
  if (!prev) return []
  const prevById = new Map(prev.map((p) => [p.id, p]))
  const mention = `@${viewerLogin.toLowerCase()}`
  const events: FeedEvent[] = []

  for (const pr of next) {
    const base = { repo: pr.repo, number: pr.number, title: pr.title }
    const before = prevById.get(pr.id)

    if (!before) {
      if (pr.source === 'review') {
        events.push({ ...base, id: `review_requested:${pr.id}`, kind: 'review_requested', url: pr.url, createdAt: now, unread: true })
      }
      continue
    }

    const seenReviews = new Set(before.reviews.map((r) => r.id))
    for (const r of pr.reviews) {
      if (seenReviews.has(r.id)) continue
      const kind = REVIEW_KIND[r.state]
      if (!kind) continue
      events.push({ ...base, id: `review:${r.id}`, kind, url: r.url, actor: { login: r.authorLogin, avatarUrl: r.authorAvatarUrl }, createdAt: r.submittedAt || now, unread: true })
    }

    const seenComments = new Set(before.comments.map((c) => c.id))
    for (const c of pr.comments) {
      if (seenComments.has(c.id)) continue
      const isMention = c.bodyText.toLowerCase().includes(mention)
      events.push({ ...base, id: `comment:${c.id}`, kind: isMention ? 'mention' : 'comment', url: c.url, actor: { login: c.authorLogin, avatarUrl: c.authorAvatarUrl }, createdAt: c.createdAt || now, unread: true })
    }

    if (pr.ciState !== before.ciState && (pr.ciState === 'failure' || pr.ciState === 'success')) {
      events.push({ ...base, id: `ci:${pr.id}:${pr.headOid}:${pr.ciState}`, kind: pr.ciState === 'failure' ? 'ci_failed' : 'ci_succeeded', url: pr.url, createdAt: now, unread: true })
    }
  }

  const nextIds = new Set(next.map((p) => p.id))
  for (const p of prev) {
    if (p.source !== 'mine' || nextIds.has(p.id)) continue
    const label = fallenOutStates.get(p.id)
    if (!label) continue
    events.push({ repo: p.repo, number: p.number, title: p.title, id: `${label}:${p.id}`, kind: label, url: p.url, createdAt: now, unread: true })
  }

  return events
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- derive-events`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/github/derive-events.ts src/main/github/derive-events.test.ts
git commit -m "feat: add deriveEvents diff engine"
```

---

## Task 4: Event store (merge / read-state + persistence)

**Files:**
- Create: `src/main/event-store.ts`
- Test: `src/main/event-store.test.ts`
- Modify: `src/main/paths.ts`

- [ ] **Step 1: Add the file paths**

In `src/main/paths.ts`, add after `snapshotFilePath`:

```ts
export function eventsFilePath(): string {
  return join(app.getPath('userData'), 'events.json')
}
export function prStateFilePath(): string {
  return join(app.getPath('userData'), 'pr-state.json')
}
```

- [ ] **Step 2: Write the failing test (pure logic only)**

Create `src/main/event-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mergeEvents, applyRead, applyReadAll } from './event-store'
import type { FeedEvent } from '@shared/types'

function ev(id: string, createdAt: string, unread = true): FeedEvent {
  return { id, kind: 'comment', repo: 'o/web', number: 1, title: 't', url: 'u', createdAt, unread }
}

describe('mergeEvents', () => {
  it('adds new events and keeps the read-state of ones already stored', () => {
    const existing = [ev('a', '2026-06-02T00:00:00Z', false)]
    const incoming = [ev('a', '2026-06-02T00:00:00Z', true), ev('b', '2026-06-02T01:00:00Z')]
    const merged = mergeEvents(existing, incoming, 100)
    expect(merged.find((e) => e.id === 'a')!.unread).toBe(false) // not reset to unread
    expect(merged.map((e) => e.id)).toEqual(['b', 'a']) // newest first
  })

  it('caps to the most recent N', () => {
    const incoming = [ev('a', '2026-06-01T00:00:00Z'), ev('b', '2026-06-02T00:00:00Z'), ev('c', '2026-06-03T00:00:00Z')]
    expect(mergeEvents([], incoming, 2).map((e) => e.id)).toEqual(['c', 'b'])
  })
})

describe('applyRead / applyReadAll', () => {
  it('marks one event read by id', () => {
    const out = applyRead([ev('a', 'x'), ev('b', 'x')], 'a')
    expect(out.find((e) => e.id === 'a')!.unread).toBe(false)
    expect(out.find((e) => e.id === 'b')!.unread).toBe(true)
  })

  it('marks everything read', () => {
    expect(applyReadAll([ev('a', 'x'), ev('b', 'x')]).every((e) => !e.unread)).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- event-store`
Expected: FAIL — `Cannot find module './event-store'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/main/event-store.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { FeedEvent } from '@shared/types'
import { PRState } from './github/pr-state'
import { eventsFilePath, prStateFilePath } from './paths'

const CAP = 100

// --- pure helpers (unit-tested) ---

export function mergeEvents(existing: FeedEvent[], incoming: FeedEvent[], cap = CAP): FeedEvent[] {
  const byId = new Map(existing.map((e) => [e.id, e]))
  for (const e of incoming) {
    if (!byId.has(e.id)) byId.set(e.id, e) // existing keep their (possibly read) state
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, cap)
}

export function applyRead(events: FeedEvent[], id: string): FeedEvent[] {
  return events.map((e) => (e.id === id ? { ...e, unread: false } : e))
}

export function applyReadAll(events: FeedEvent[]): FeedEvent[] {
  return events.map((e) => (e.unread ? { ...e, unread: false } : e))
}

// --- fs-backed store (glue) ---

export function loadEvents(): FeedEvent[] {
  const path = eventsFilePath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as FeedEvent[]
  } catch {
    return []
  }
}

function save(events: FeedEvent[]): FeedEvent[] {
  writeFileSync(eventsFilePath(), JSON.stringify(events))
  return events
}

export function appendEvents(incoming: FeedEvent[]): FeedEvent[] {
  return save(mergeEvents(loadEvents(), incoming))
}

export function markRead(id: string): FeedEvent[] {
  return save(applyRead(loadEvents(), id))
}

export function markAllRead(): FeedEvent[] {
  return save(applyReadAll(loadEvents()))
}

// Prior PR state for diffing. `null` means "no baseline yet" (first run).
export function loadPrState(): PRState[] | null {
  const path = prStateFilePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PRState[]
  } catch {
    return null
  }
}

export function savePrState(states: PRState[]): void {
  writeFileSync(prStateFilePath(), JSON.stringify(states))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- event-store`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/event-store.ts src/main/event-store.test.ts src/main/paths.ts
git commit -m "feat: add persistent event store and pr-state persistence"
```

---

## Task 5: `filterEvents`

**Files:**
- Create: `src/main/github/filter-events.ts`
- Test: `src/main/github/filter-events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/github/filter-events.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterEvents, isBotLogin } from './filter-events'
import type { FeedEvent } from '@shared/types'

function ev(over: Partial<FeedEvent> = {}): FeedEvent {
  return { id: 'a', kind: 'comment', repo: 'o/web', number: 1, title: 't', url: 'u', createdAt: 'x', unread: true, ...over }
}

describe('filterEvents', () => {
  it('drops bot actors when hideBots is on', () => {
    const out = filterEvents([ev({ actor: { login: 'dependabot[bot]', avatarUrl: '' } })], { excludedAuthors: [], hideBots: true })
    expect(out).toHaveLength(0)
  })

  it('drops excluded authors case-insensitively', () => {
    const out = filterEvents([ev({ actor: { login: 'Spammer', avatarUrl: '' } })], { excludedAuthors: ['spammer'], hideBots: false })
    expect(out).toHaveLength(0)
  })

  it('keeps actor-less events (CI, lifecycle)', () => {
    const out = filterEvents([ev({ kind: 'ci_failed', actor: undefined })], { excludedAuthors: ['x'], hideBots: true })
    expect(out).toHaveLength(1)
  })
})

describe('isBotLogin', () => {
  it('matches the [bot] suffix', () => {
    expect(isBotLogin('renovate[bot]')).toBe(true)
    expect(isBotLogin('alice')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- filter-events`
Expected: FAIL — `Cannot find module './filter-events'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/github/filter-events.ts`:

```ts
import { FeedEvent } from '@shared/types'

export function isBotLogin(login: string): boolean {
  return /\[bot\]$/i.test(login)
}

export function filterEvents(
  events: FeedEvent[],
  opts: { excludedAuthors: string[]; hideBots: boolean }
): FeedEvent[] {
  const denied = new Set(opts.excludedAuthors.map((a) => a.toLowerCase()))
  return events.filter((e) => {
    const login = e.actor?.login
    if (!login) return true // keep events we can't attribute (CI, lifecycle)
    if (opts.hideBots && isBotLogin(login)) return false
    if (denied.has(login.toLowerCase())) return false
    return true
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- filter-events`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/github/filter-events.ts src/main/github/filter-events.test.ts
git commit -m "feat: add filterEvents (bot/excluded-author filtering)"
```

---

## Task 6: Extend the GraphQL query

**Files:**
- Modify: `src/main/github/queries.ts`

- [ ] **Step 1: Replace the `reviews` block and `commits` block, add `comments`**

In `src/main/github/queries.ts`, inside `PR_FIELDS`, replace the existing `reviews(last: 50) { ... }` block with:

```graphql
  reviews(last: 50) {
    nodes { id state author { login avatarUrl } submittedAt url }
  }
  comments(last: 20) {
    nodes { id author { login avatarUrl } createdAt url bodyText }
  }
```

And replace the `commits(last: 1)` block's `commit { ... }` opening so it also selects `oid`:

```graphql
  commits(last: 1) {
    nodes {
      commit {
        oid
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
```

- [ ] **Step 2: Typecheck (query is a string; just confirm no syntax break)**

Run: `pnpm run typecheck`
Expected: same set of pre-existing errors as Task 1 (consumers not yet migrated) — no *new* errors from `queries.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/main/github/queries.ts
git commit -m "feat: fetch reviews/comments/head-oid for event derivation"
```

---

## Task 7: Trim `enrich-state.ts` to the pure label helper

**Files:**
- Modify: `src/main/github/enrich-state.ts`
- Modify: `src/main/github/enrich-state.test.ts`

- [ ] **Step 1: Remove `StateCache` and `enrichStates`, keep `subjectStateLabel`**

In `src/main/github/enrich-state.ts`, delete everything except the `subjectStateLabel` function (delete `StateCache`, `enrichStates`, the `RequestFn` type). The file should contain only the import-free `subjectStateLabel` function exactly as it is today.

- [ ] **Step 2: Trim the test to only `subjectStateLabel`**

In `src/main/github/enrich-state.test.ts`, delete the entire `describe('enrichStates', ...)` block and remove `StateCache, enrichStates` from the import (keep `subjectStateLabel`). Remove the now-unused `thread` helper and the `vi` import.

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm test -- enrich-state`
Expected: PASS (the `subjectStateLabel` describe block, 4 tests).

- [ ] **Step 4: Commit**

```bash
git add src/main/github/enrich-state.ts src/main/github/enrich-state.test.ts
git commit -m "refactor: reduce enrich-state to subjectStateLabel"
```

---

## Task 8: Rewrite the poller and delete the orphaned notifications pipeline

**Files:**
- Modify: `src/main/poller.ts`
- Delete: `src/main/github/notifications.ts` + `notifications.test.ts`, `enrich.ts` + `enrich.test.ts`, `normalize-activity.ts` + `normalize-activity.test.ts`, `filter-activity.ts` + `filter-activity.test.ts`

> The poller is the last importer of the old notifications pipeline. Once it's
> rewritten, those modules are orphaned **and** they reference the now-removed
> `ActivityItem`, so we delete them in the same task to keep `typecheck` clean.

- [ ] **Step 1: Replace the poller file contents**

Replace `src/main/poller.ts` entirely with:

```ts
import { Octokit } from 'octokit'
import { DashboardSnapshot, Settings } from '@shared/types'
import { DASHBOARD_QUERY, NEEDS_REVIEW_QUERY, MY_PRS_QUERY } from './github/queries'
import { normalizePullRequests } from './github/normalize-prs'
import { toPrState, PRState } from './github/pr-state'
import { deriveEvents } from './github/derive-events'
import { subjectStateLabel } from './github/enrich-state'
import { filterEvents } from './github/filter-events'
import { appendEvents, loadPrState, savePrState } from './event-store'

export class Poller {
  constructor(private octokit: Octokit) {}

  async refresh(settings: Settings): Promise<DashboardSnapshot> {
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const staleThresholdMs = settings.staleThresholdDays * 24 * 60 * 60 * 1000

    const data: any = await this.octokit.graphql(DASHBOARD_QUERY, {
      needsReview: NEEDS_REVIEW_QUERY,
      mine: MY_PRS_QUERY
    })

    const mineNodes: any[] = (data.mine?.nodes ?? []).filter(Boolean)
    const reviewNodes: any[] = (data.needsReview?.nodes ?? []).filter(Boolean)

    const needsReview = normalizePullRequests(reviewNodes, { now, staleThresholdMs })
    const myPullRequests = normalizePullRequests(mineNodes, { now, staleThresholdMs })
    const viewer = { login: data.viewer.login, avatarUrl: data.viewer.avatarUrl }

    const nextStates: PRState[] = [
      ...mineNodes.map((n) => toPrState(n, 'mine')),
      ...reviewNodes.map((n) => toPrState(n, 'review'))
    ]

    const prev = loadPrState()

    // Resolve merged/closed for the user's own PRs that dropped out of the open set.
    const fallenOut = new Map<string, 'merged' | 'closed'>()
    if (prev) {
      const nextIds = new Set(nextStates.map((s) => s.id))
      for (const p of prev) {
        if (p.source !== 'mine' || nextIds.has(p.id)) continue
        try {
          const res = await this.octokit.request(`GET /repos/${p.repo}/pulls/${p.number}`)
          const label = subjectStateLabel(res.data, 'PullRequest')
          if (label === 'merged' || label === 'closed') fallenOut.set(p.id, label)
        } catch {
          // ignore; we just won't emit a lifecycle event for this PR
        }
      }
    }

    const newEvents = deriveEvents(prev, nextStates, viewer.login, nowIso, fallenOut)
    const allEvents = appendEvents(newEvents)
    savePrState(nextStates)

    const events = filterEvents(allEvents, {
      excludedAuthors: settings.excludedAuthors,
      hideBots: settings.hideBots
    })

    return {
      fetchedAt: nowIso,
      viewer,
      needsReview,
      myPullRequests,
      events,
      rateLimit: { remaining: data.rateLimit?.remaining ?? 0, resetAt: data.rateLimit?.resetAt ?? '' }
    }
  }
}
```

- [ ] **Step 2: Commit the poller**

```bash
git add src/main/poller.ts
git commit -m "feat: derive events in the poller from PR-state diffs"
```

- [ ] **Step 3: Delete the orphaned files**

```bash
git rm src/main/github/notifications.ts src/main/github/notifications.test.ts \
       src/main/github/enrich.ts src/main/github/enrich.test.ts \
       src/main/github/normalize-activity.ts src/main/github/normalize-activity.test.ts \
       src/main/github/filter-activity.ts src/main/github/filter-activity.test.ts
```

- [ ] **Step 4: Grep for lingering references**

Run: `grep -rn "normalize-activity\|filter-activity\|enrichThreads\|fetchNotifications\|ActivityItem\|CommentCache" src`
Expected: **no matches**. (If any appear, it's a stale import to fix.)

- [ ] **Step 5: Typecheck**

Run: `pnpm run typecheck`
Expected: poller + dead-file errors gone; remaining errors only in `notifier.ts`, `index.ts`, and renderer files (`ActivityFeed.tsx`, `App.tsx`, `icons.tsx`, `activity-severity.ts`) — all migrated in later tasks.

- [ ] **Step 6: Commit the deletions**

```bash
git add -A
git commit -m "chore: remove the /notifications pipeline superseded by derived events"
```

---

## Task 9: Rewrite `notifier.ts` to diff events

**Files:**
- Modify: `src/main/notifier.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/notifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diffSnapshots } from './notifier'
import type { DashboardSnapshot, FeedEvent } from '@shared/types'

function ev(id: string, over: Partial<FeedEvent> = {}): FeedEvent {
  return { id, kind: 'approved', repo: 'o/web', number: 88, title: 'Fix nav', url: 'u', createdAt: 'x', unread: true, actor: { login: 'alice', avatarUrl: '' }, ...over }
}

function snap(events: FeedEvent[]): DashboardSnapshot {
  return { fetchedAt: 'x', viewer: { login: 'me', avatarUrl: '' }, needsReview: [], myPullRequests: [], events, rateLimit: { remaining: 0, resetAt: '' } }
}

describe('diffSnapshots', () => {
  it('returns nothing on the first snapshot', () => {
    expect(diffSnapshots(null, snap([ev('a')]))).toEqual([])
  })

  it('notifies only for events not present before', () => {
    const specs = diffSnapshots(snap([ev('a')]), snap([ev('a'), ev('b', { kind: 'ci_failed', actor: undefined })]))
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({ title: 'Checks failed', body: 'o/web #88 — Fix nav', url: 'u' })
  })

  it('phrases an approval with the actor', () => {
    const specs = diffSnapshots(snap([]), snap([ev('a')]))
    expect(specs[0].title).toBe('alice approved')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- notifier`
Expected: FAIL — current `diffSnapshots` references `prev.needsReview`/`prev.activity` and produces different output (compile error on `FeedEvent` import or assertion failures).

- [ ] **Step 3: Replace the file contents**

Replace `src/main/notifier.ts` entirely with:

```ts
import type { DashboardSnapshot, NotificationSpec, FeedEvent, FeedEventKind } from '@shared/types'

const MAX_NOTIFICATIONS = 5

function titleFor(e: FeedEvent): string {
  const who = e.actor?.login
  const byKind: Record<FeedEventKind, string> = {
    approved: who ? `${who} approved` : 'PR approved',
    changes_requested: who ? `${who} requested changes` : 'Changes requested',
    review_commented: who ? `${who} reviewed` : 'New review',
    comment: who ? `${who} commented` : 'New comment',
    mention: who ? `${who} mentioned you` : 'You were mentioned',
    ci_failed: 'Checks failed',
    ci_succeeded: 'Checks passed',
    review_requested: 'Review requested',
    merged: 'PR merged',
    closed: 'PR closed'
  }
  return byKind[e.kind]
}

export function diffSnapshots(
  prev: DashboardSnapshot | null,
  next: DashboardSnapshot
): NotificationSpec[] {
  if (!prev) return [] // first poll seeds the baseline; never notify
  const prevIds = new Set(prev.events.map((e) => e.id))
  return next.events
    .filter((e) => !prevIds.has(e.id))
    .slice(0, MAX_NOTIFICATIONS)
    .map((e) => ({ title: titleFor(e), body: `${e.repo} #${e.number} — ${e.title}`, url: e.url }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- notifier`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/notifier.ts src/main/notifier.test.ts
git commit -m "feat: fire native notifications from new feed events"
```

---

## Task 10: Wire `index.ts` (degraded snapshot + read IPC)

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Fix the degraded snapshot shape**

In `src/main/index.ts`, in `doPoll`'s catch block, change the degraded fallback object's `needsReview: [], myPullRequests: [], activity: [],` to:

```ts
          needsReview: [], myPullRequests: [], events: [],
```

- [ ] **Step 2: Import the store read functions**

Change the snapshot-cache import line to also import the store:

```ts
import { loadCachedSnapshot, cacheSnapshot } from './snapshot-cache'
import { markRead, markAllRead } from './event-store'
```

- [ ] **Step 3: Register the two new IPC handlers**

In `registerIpc()`, after the `openExternal` handler, add:

```ts
  ipcMain.handle('markRead', (_e, id: string) => markRead(id))
  ipcMain.handle('markAllRead', () => markAllRead())
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: main-process errors gone; only renderer files remain (next tasks).

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire markRead/markAllRead IPC and fix degraded snapshot"
```

---

## Task 11: Expose `markRead`/`markAllRead` in preload + api type

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the two methods to the preload bridge**

In `src/preload/index.ts`, add to the `api` object after `openExternal`:

```ts
  markRead: (id: string) => ipcRenderer.invoke('markRead', id),
  markAllRead: () => ipcRenderer.invoke('markAllRead')
```

(The `GithudApi` type already declares these from Task 1, so no separate type change is needed.)

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: preload OK; remaining errors only in renderer component files.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose markRead/markAllRead on window.api"
```

---

## Task 12: Event severity (renderer)

**Files:**
- Modify: `src/renderer/src/components/activity-severity.ts`
- Modify: `src/renderer/src/components/activity-severity.test.ts`

- [ ] **Step 1: Rewrite the test for kinds**

Replace `src/renderer/src/components/activity-severity.test.ts` entirely with:

```ts
import { describe, it, expect } from 'vitest'
import { severityForKind } from './activity-severity'

describe('severityForKind', () => {
  it('maps failures to red', () => {
    expect(severityForKind('ci_failed')).toBe('failure')
    expect(severityForKind('changes_requested')).toBe('failure')
  })
  it('maps positive outcomes to green', () => {
    expect(severityForKind('ci_succeeded')).toBe('success')
    expect(severityForKind('approved')).toBe('success')
    expect(severityForKind('merged')).toBe('success')
  })
  it('maps everything else to info', () => {
    for (const k of ['comment', 'mention', 'review_commented', 'review_requested', 'closed'] as const) {
      expect(severityForKind(k)).toBe('info')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- activity-severity`
Expected: FAIL — `severityForKind` is not exported.

- [ ] **Step 3: Replace the implementation**

Replace `src/renderer/src/components/activity-severity.ts` entirely with:

```ts
import { FeedEventKind } from '@shared/types'

export type Severity = 'failure' | 'success' | 'info'

const FAILURE = new Set<FeedEventKind>(['ci_failed', 'changes_requested'])
const SUCCESS = new Set<FeedEventKind>(['ci_succeeded', 'approved', 'merged'])

export function severityForKind(kind: FeedEventKind): Severity {
  if (FAILURE.has(kind)) return 'failure'
  if (SUCCESS.has(kind)) return 'success'
  return 'info'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- activity-severity`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/activity-severity.ts src/renderer/src/components/activity-severity.test.ts
git commit -m "feat: severityForKind for feed events"
```

---

## Task 13: Per-kind icons (renderer)

**Files:**
- Modify: `src/renderer/src/components/icons.tsx`

- [ ] **Step 1: Swap the top import**

In `src/renderer/src/components/icons.tsx`, replace the existing top-of-file import `import { ActivityItem } from '@shared/types'` with:

```ts
import { FeedEventKind } from '@shared/types'
```

- [ ] **Step 2: Add icon paths and a `kindIcon` export**

In `src/renderer/src/components/icons.tsx`, add these entries to the `PATHS` object (alongside the existing ones):

```ts
  check:
    'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
  x:
    'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z',
  gitMerge:
    'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z',
  eye:
    'M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.831.88 9.577.43 8.899a1.62 1.62 0 0 1 0-1.798c.45-.678 1.367-1.932 2.637-3.023C4.33 2.992 6.019 2 8 2ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'
```

Then replace the `ActivityIcon` function at the bottom of the file with a kind-based export (the `FeedEventKind` import was added at the top in Step 1):

```ts
const KIND_ICON: Record<FeedEventKind, IconName> = {
  approved: 'check',
  changes_requested: 'x',
  review_commented: 'comment',
  comment: 'comment',
  mention: 'comment',
  ci_failed: 'x',
  ci_succeeded: 'check',
  review_requested: 'eye',
  merged: 'gitMerge',
  closed: 'pullRequest'
}

// Icon shape conveys the kind of event; its *color* is set by severity at the
// row level, not here.
export function EventIcon({ kind }: { kind: FeedEventKind }) {
  return (
    <span className="activity-icon">
      <Octicon name={KIND_ICON[kind]} />
    </span>
  )
}
```

Note: remove the old `ActivityIcon` function entirely. Keep `Octicon`, `PATHS`, and `IconName`.

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: `icons.tsx` OK; only `ActivityFeed.tsx` / `App.tsx` errors remain.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/icons.tsx
git commit -m "feat: per-kind event icons"
```

---

## Task 14: Rewrite `ActivityFeed` to render `FeedEvent[]`

**Files:**
- Modify: `src/renderer/src/components/ActivityFeed.tsx`
- Modify: `src/renderer/src/components/ActivityFeed.test.tsx`

- [ ] **Step 1: Rewrite the test**

Replace `src/renderer/src/components/ActivityFeed.test.tsx` entirely with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityFeed } from './ActivityFeed'
import type { FeedEvent } from '@shared/types'

function ev(over: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id: 'e1', kind: 'approved', repo: 'o/web', number: 88, title: 'Fix nav focus trap',
    url: 'https://gh/88', createdAt: '2026-06-02T00:00:00Z', unread: true,
    actor: { login: 'alice', avatarUrl: '' }, ...over
  }
}

beforeEach(() => { window.api = { openExternal: vi.fn(), markRead: vi.fn().mockResolvedValue([]) } as any })

describe('ActivityFeed', () => {
  it('shows the actor, action phrasing, and subject', () => {
    render(<ActivityFeed events={[ev()]} onRead={vi.fn()} />)
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText(/approved/i)).toBeInTheDocument()
    expect(screen.getByText('Fix nav focus trap')).toBeInTheDocument()
    expect(screen.getByText(/o\/web #88/)).toBeInTheDocument()
  })

  it('phrases a mention and a CI failure', () => {
    render(<ActivityFeed events={[ev({ id: 'm', kind: 'mention' }), ev({ id: 'c', kind: 'ci_failed', actor: undefined })]} onRead={vi.fn()} />)
    expect(screen.getByText(/mentioned you/i)).toBeInTheDocument()
    expect(screen.getByText(/checks failed/i)).toBeInTheDocument()
  })

  it('opens the event and marks it read on click', async () => {
    const onRead = vi.fn()
    render(<ActivityFeed events={[ev()]} onRead={onRead} />)
    await userEvent.click(screen.getByText('Fix nav focus trap'))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://gh/88')
    expect(onRead).toHaveBeenCalledWith('e1')
  })

  it('renders an empty state', () => {
    render(<ActivityFeed events={[]} onRead={vi.fn()} />)
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- ActivityFeed`
Expected: FAIL — `ActivityFeed` still takes `items` / imports removed types.

- [ ] **Step 3: Replace the component**

Replace `src/renderer/src/components/ActivityFeed.tsx` entirely with:

```tsx
import { FeedEvent } from '@shared/types'
import { api } from '../api'
import { relativeAge } from './NeedsReviewTable'
import { EventIcon } from './icons'
import { severityForKind } from './activity-severity'

const ACTION: Record<FeedEvent['kind'], string> = {
  approved: 'approved',
  changes_requested: 'requested changes',
  review_commented: 'reviewed',
  comment: 'commented',
  mention: 'mentioned you',
  ci_failed: 'checks failed',
  ci_succeeded: 'checks passed',
  review_requested: 'review requested',
  merged: 'merged',
  closed: 'closed'
}

function EventRow({ event, onRead }: { event: FeedEvent; onRead: (id: string) => void }) {
  const who = event.actor?.login
  const severity = severityForKind(event.kind)
  const open = () => {
    api.openExternal(event.url)
    onRead(event.id)
  }
  return (
    <div
      className={`activity-item sev-${severity}${event.unread ? ' unread' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
    >
      <EventIcon kind={event.kind} />
      <div className="activity-main">
        <div className="activity-head">
          {who && <span className="activity-author">{who}</span>}
          <span className="activity-action">{ACTION[event.kind]}</span>
          <span className="activity-time">{relativeAge(event.createdAt)}</span>
        </div>
        <div className="activity-title">{event.title}</div>
        <div className="activity-ctx">{event.repo} #{event.number}</div>
      </div>
    </div>
  )
}

export function ActivityFeed({ events, onRead }: { events: FeedEvent[]; onRead: (id: string) => void }) {
  if (events.length === 0) return <p className="empty">No recent activity.</p>
  return (
    <div className="activity-feed">
      {events.map((e) => <EventRow key={e.id} event={e} onRead={onRead} />)}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- ActivityFeed`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ActivityFeed.tsx src/renderer/src/components/ActivityFeed.test.tsx
git commit -m "feat: render FeedEvent feed with click-to-read"
```

---

## Task 15: Wire the renderer (App: events + mark-all-read)

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Import `useQueryClient` and `FeedEvent`**

In `src/renderer/src/App.tsx`, change the React/query imports at the top of the `Dashboard` area. Add at the top of the file:

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { FeedEvent, DashboardSnapshot } from '@shared/types'
```

- [ ] **Step 2: Add read handlers and update the activity panel markup**

In the `Dashboard` function, after the `const { data: snapshot, refetch, isFetching } = useDashboard()` line, add:

```tsx
  const qc = useQueryClient()
  const applyEvents = (events: FeedEvent[]) =>
    qc.setQueryData<DashboardSnapshot | null>(['dashboard'], (old) => (old ? { ...old, events } : old))
  const onRead = (id: string) => { void api.markRead(id).then(applyEvents) }
  const onReadAll = () => { void api.markAllRead().then(applyEvents) }
  const unread = snapshot?.events.filter((e) => e.unread).length ?? 0
```

Then replace the activity `<aside>` block with:

```tsx
        <aside className="rail panel">
          <h2>
            Activity <span className="count">{unread}</span>
            <span className="spacer" />
            {unread > 0 && <button className="link-button" onClick={onReadAll}>mark all read</button>}
          </h2>
          <ActivityFeed events={snapshot?.events ?? []} onRead={onRead} />
        </aside>
```

- [ ] **Step 3: Add styles for the header button**

In `src/renderer/src/styles.css`, add near the `.panel h2` rules:

```css
.panel h2 .spacer { flex: 1; }
.link-button { background: none; border: none; padding: 0; cursor: pointer;
  color: var(--blue); font-size: 12px; font-weight: 400; transition: color .12s; }
.link-button:hover { color: var(--blue-hover); }
```

- [ ] **Step 4: Typecheck + run the full test suite**

Run: `pnpm run typecheck`
Expected: PASS (no errors).
Run: `pnpm test`
Expected: PASS — all suites. (The deleted-module suites are removed in Task 16; if any still exist referencing old code, they'll be removed there.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat: wire events feed and mark-all-read into the dashboard"
```

---

## Task 16: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm no stale references remain**

Run: `grep -rn "normalize-activity\|filter-activity\|enrichThreads\|fetchNotifications\|ActivityItem\|CommentCache" src`
Expected: **no matches**. (CSS class names like `.activity-item` in `styles.css` are unrelated and fine; this grep deliberately doesn't match them.)

- [ ] **Step 2: Full verification**

Run: `pnpm run typecheck`
Expected: PASS (no errors).
Run: `pnpm test`
Expected: PASS — all suites green.
Run: `pnpm run build`
Expected: builds all three processes with no errors.

- [ ] **Step 3: Commit (if the grep prompted any fixes; otherwise skip)**

```bash
git add -A
git commit -m "chore: final cleanup for derived event feed"
```

---

## Task 17: Manual smoke test

**Files:** none (manual)

- [ ] **Step 1: Run the app**

Run: `pnpm run dev` (in a real desktop session, not headless).

- [ ] **Step 2: Verify behavior**

- First launch with no `pr-state.json`: feed is empty (baseline seeded), no notification storm.
- Trigger an event (e.g., have someone comment/approve, or push a commit to fail CI on one of your PRs). Within ~30s the event appears with the correct actor, icon, color, and phrasing.
- Click an event → opens in GitHub and the row loses its unread tint. "mark all read" clears the rest and the count.
- Restart the app → events persist; events that occurred while closed are caught up on the next poll.

- [ ] **Step 3: Note any issues** for follow-up (no commit needed).

---

## Notes for the implementer

- **pnpm, not npm.** Filter tests with `pnpm test -- <name>`.
- If `pnpm run dev` errors with `Error: Electron uninstall`, run `pnpm rebuild electron`.
- The `@shared` alias is configured per build target in `electron.vite.config.ts` (main/preload/renderer). All new main files import from `@shared/types`; preload uses the relative `../shared/types`. Don't change those import styles.
- The CI lifecycle (`merged`/`closed`) relies on a REST call per fallen-out PR; this is bounded (only your own PRs that just left the open set) and failures are swallowed.
- Deferred by design: inline review-thread comments, and resolving *who* requested a review.
