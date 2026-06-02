# githud — Personal GitHub Engineering Dashboard

**Date:** 2026-06-02
**Status:** Approved design
**Author:** Andrew Hite

## Overview

`githud` is a single-user Electron desktop app that surfaces the GitHub
information an engineer cares about day to day: pull requests awaiting their
review, their own open PRs (with review and check status), and a live feed of
activity (comments and @-mentions) on PRs they author or review. It polls the
GitHub GraphQL API every ~30 seconds and fires native desktop notifications when
relevant things change.

This is a personal tool. It will only ever be used by its author on their own
machine, so it optimizes for simplicity and usefulness over multi-user
generality, configurability, or hardening against untrusted input.

## Goals

- See, at a glance, every PR that needs my review.
- See my own open PRs with their review status, mergeability, and check status.
- Read a roomy, always-visible feed of comments and @-mentions on PRs I author or
  review — with enough space to read full comment text.
- Be alerted (in-app and via native notification) to my PRs with failing checks,
  changes requested, and PRs that have gone stale.
- Stay current automatically (30s polling) with a manual refresh option.

## Non-Goals (v1)

- Multi-account or GitHub Enterprise support (github.com only).
- Multi-user / shared deployment.
- Writing to GitHub (approving, commenting, merging) — v1 is read-only; rows link
  out to GitHub in the browser.
- Configurable per-repo watch lists — scope is "everything involving me" via
  GitHub search.
- Auto-update / code signing / distribution. Built and run locally.

## Feature Set

The four originally-requested core panels plus the approved extras, mapped onto
the layout:

| Requested feature | Where it lives in the UI |
|---|---|
| PRs requiring my review | **Needs my review** table |
| My open PRs (as author) | **My open PRs** table |
| Comment / activity feed | **Activity** rail, sourced from the GitHub Notifications API (everything relevant to me, not just PRs I author/review) |
| My PRs with failing checks | Red `Checks` cell in **My open PRs** + a count badge in the top bar |
| @mentions inbox | Mention items in the **Activity** rail, distinguished by a `mention` reason badge |
| Review status on my PRs | `Status` column in **My open PRs** (approvals / changes requested / mergeable) |
| Stale PR alerts | Amber `Age` cell + ⚠ marker on rows past the stale threshold |
| Hide noisy bots / authors | Author denylist + "hide all bots" toggle, applied to the Activity feed |

**Stale threshold:** a PR is "stale" if it has had no activity (no new commit,
review, or comment) for **2 days**. (Constant, easily tweakable in code.)

## Layout (approved: "tables + activity rail")

A standard resizable window. Single screen, no in-app routing.

```
┌─────────────────────────────────────────────────────────────┐
│ githud · summary line            ✗2 failing  ↻ 30s   ⚙ settings│  top bar
├───────────────────────────────────────────┬─────────────────┤
│  Needs my review            [4]            │  Activity   [9]  │
│  ┌────────────────────────────────────┐   │  ┌────────────┐  │
│  │ PR | Author | Reviewers | Checks |Age│  │  │ avatar      │  │
│  └────────────────────────────────────┘   │  │ author · ctx│  │
│                                            │  │ full comment│  │
│  My open PRs                [3]            │  │ body text … │  │
│  ┌────────────────────────────────────┐   │  └────────────┘  │
│  │ PR | Status | Reviewers | Checks |Age│  │  (always         │
│  └────────────────────────────────────┘   │   visible,        │
│                                            │   scrolls within) │
└───────────────────────────────────────────┴─────────────────┘
        left column (~60%)                      right rail (~40%)
```

- **Top bar:** app title + one-line summary ("all caught up" / "2 need
  attention"), a failing-checks count badge, last-refresh indicator with manual
  refresh button, and a settings gear (token entry, stale threshold).
- **Left column (≈60%):** two stacked tables.
  - **Needs my review:** columns `PR` (title + `repo #num`), `Author`,
    `Reviewers` (avatars + count), `Checks` (✓/✗ with pass/fail counts), `Age`
    (amber + ⚠ when stale).
  - **My open PRs:** columns `PR`, `Status` (approvals / changes requested /
    mergeable), `Reviewers`, `Checks`, `Age`.
- **Right rail (≈40%):** the **Activity** feed — a chronological list of
  notification threads relevant to me (regardless of whether I author or review
  the PR). Each row shows: the latest comment author's avatar + name, a **reason
  badge** (mention / comment / review requested / CI activity / …), the context
  (`repo #num` + title), an **unread** dot, relative time, and the full body of
  the latest comment (wraps, not truncated). Threads are collapsed to one row
  each (latest message shown). Authors on the denylist — and all bots when "hide
  bots" is on — are filtered out entirely.
- **Interaction:** clicking any PR row or activity item opens that PR/comment on
  github.com in the default browser (`shell.openExternal`). Empty tables show a
  friendly empty state.

## Architecture

Three clean layers with a single well-defined data contract between main and
renderer.

### 1. Main process (owns secrets & I/O)
- Holds the PAT (read from encrypted storage) and the Octokit GraphQL client.
- Runs the poll timer (~30s) and a manual-refresh trigger.
- Executes the aggregated GraphQL query, normalizes the response into a
  `DashboardSnapshot`.
- Diffs each new snapshot against the previous one to decide which native
  notifications to fire.
- Exposes IPC handlers; pushes new snapshots to the renderer.
- Caches the latest snapshot to disk (userData) so the window shows last-known
  data instantly on launch before the first poll completes.

### 2. Preload (typed bridge)
- `contextBridge` exposes a small, typed `window.api`:
  - `getSnapshot(): Promise<DashboardSnapshot | null>` — last known snapshot.
  - `refresh(): Promise<DashboardSnapshot>` — force a poll now.
  - `onSnapshot(cb)` — subscribe to pushed snapshot updates.
  - `getAuthStatus(): Promise<{ hasToken: boolean; login?: string }>`.
  - `saveToken(token): Promise<{ ok: boolean; login?: string; error?: string }>`.
  - `getSettings()/saveSettings()` — stale threshold, notification toggle,
    `excludedAuthors: string[]`, `hideBots: boolean`.
- Context isolation **on**, node integration **off**, sandbox on.

### 3. Renderer (React dashboard)
- React + TypeScript. **TanStack Query** owns fetching/caching/polling state.
  - A single query keyed `["dashboard"]` whose `queryFn` calls
    `window.api.refresh()`; `refetchInterval` = 30s; also seeded by
    `getSnapshot()` and updated via the `onSnapshot` push.
- Independent, individually-testable panel components fed slices of the one
  `DashboardSnapshot`: `<NeedsReviewTable>`, `<MyPullRequestsTable>`,
  `<ActivityFeed>`, `<TopBar>`, plus a `<TokenSetup>` gate when no token exists.

### Data flow
```
poll timer / manual refresh (main)
  → GraphQL query (PR tables)  +  REST notifications (activity, conditional/304)
  → enrich notifications (resolve latest comment bodies, cached)
  → filter activity (denylist + hide-bots)
  → normalize → DashboardSnapshot
  → diff vs previous snapshot → fire notifications
  → cache to disk + push over IPC
  → TanStack Query updates → panels re-render
```

## Tech Stack

- **Electron** scaffolded with **electron-vite** (TS + HMR), packaged with
  **electron-builder** (local build only).
- **React + TypeScript** renderer.
- **TanStack Query** for renderer data/polling state.
- **Octokit** in the main process: **@octokit/graphql** for the GraphQL v4 API
  (PR tables) and **@octokit/rest** for the REST Notifications API (activity feed).
- **Electron `safeStorage`** for encrypting the PAT at rest (no native keychain
  dependency); ciphertext stored in a file under `app.getPath('userData')`.
- **Electron `Notification`** for native desktop notifications.
- **Vitest** for unit tests; **React Testing Library** for component tests.

## Data Layer

### The `DashboardSnapshot` contract
The single shape exchanged between main and renderer:

```ts
interface DashboardSnapshot {
  fetchedAt: string;            // ISO timestamp
  viewer: { login: string; avatarUrl: string };
  needsReview: PullRequest[];   // PRs where I'm a requested reviewer, not yet reviewed
  myPullRequests: PullRequest[];// PRs I authored, open
  activity: ActivityItem[];     // notification threads relevant to me, newest first, post-filter
  rateLimit: { remaining: number; resetAt: string };
  error?: string;               // populated when a poll fails; UI shows last-good data + banner
}

interface PullRequest {
  id: string; number: number; title: string; url: string;
  repo: string;                 // "owner/name"
  author: User;
  reviewers: User[];
  reviewState: 'approved' | 'changes_requested' | 'review_required' | 'none';
  approvals: number;
  mergeable: 'mergeable' | 'conflicting' | 'unknown';
  checks: { state: 'success' | 'failure' | 'pending' | 'none'; passed: number; failed: number; total: number };
  updatedAt: string;
  isStale: boolean;             // derived from updatedAt + threshold
  isDraft: boolean;
}

interface ActivityItem {
  id: string;                   // notification thread id
  reason: 'mention' | 'team_mention' | 'comment' | 'review_requested'
        | 'ci_activity' | 'assign' | 'author' | 'state_change' | 'subscribed' | string;
  subjectType: 'PullRequest' | 'Issue' | 'Commit' | string;
  repo: string;                 // "owner/name"
  number?: number;              // PR/issue number (parsed from subject url)
  title: string;                // subject title
  url: string;                  // html url to open in browser
  unread: boolean;
  updatedAt: string;            // thread updated_at (sort key, newest first)
  latestComment?: {             // resolved from latest_comment_url; absent for some reasons (e.g. ci_activity)
    author: User; body: string; createdAt: string;
  };
}

interface User { login: string; avatarUrl: string; }
```

### Fetch strategy
- **PR lists** via GraphQL `search` queries (type `ISSUE`) — efficient and
  scope-free:
  - Needs my review: `is:open is:pr review-requested:@me`
  - My open PRs: `is:open is:pr author:@me`
- For each returned PR, the same query requests nested `reviews`, `reviewRequests`,
  `commits.last.statusCheckRollup`, and `mergeable` so reviewers/status/checks
  come back in one round trip.
- One aggregated GraphQL request per poll where possible (aliases); the
  `rateLimit` block is requested alongside to monitor headroom. At 30s polling a
  single-user app stays far under the 5000 points/hour budget.

**Activity feed — via the REST Notifications API** (`@octokit/rest` /
`octokit.request` in the main process):
- `GET /notifications` with `participating=false` (everything relevant to me)
  and an incremental `since` cursor. Conditional requests (ETag / `If-Modified-Since`)
  are used so unchanged polls return `304` and **don't** consume rate limit.
- Each thread carries `reason`, `subject` (type, title, url, `latest_comment_url`),
  `unread`, `repository`, and `updated_at`.
- **Enrichment:** resolve `subject.latest_comment_url` to get the latest comment's
  author, body, and timestamp. Only fetch for threads that are **new or whose
  `updated_at` changed** since the last poll; cache resolved bodies keyed by
  `latest_comment_url`. Threads without a resolvable comment (e.g. `ci_activity`)
  keep `latestComment` undefined and render from the subject alone.
- **Filtering (in main, before snapshot/notifications):** drop items whose latest
  comment author is on the user's denylist, and — when "hide bots" is enabled —
  drop authors whose login matches `*[bot]` or whose account `type` is `Bot`.
- Sort by `updated_at` desc, cap the feed (e.g. 50 items after filtering).

## Authentication & Token Storage

- On first launch (or whenever no valid token is stored), the renderer shows a
  **`<TokenSetup>`** screen explaining which PAT scopes are needed — for a
  classic token: `repo` (PR/check data on private repos), `read:org`, and
  `notifications` (the Notifications API); or equivalent fine-grained read
  permissions including **Notifications: read** — with a link to GitHub's
  token-creation page.
- The token is sent to main via `saveToken`, which validates it with a
  lightweight `viewer { login }` query. On success it encrypts the token with
  `safeStorage.encryptString` and writes the ciphertext to
  `userData/token.enc`; the resolved `login` is cached for display.
- On launch, main decrypts the token and constructs the Octokit client. If
  decryption fails or the token is rejected (401), the app falls back to the
  setup screen.
- The token never crosses into the renderer or appears in any snapshot.

## Polling & Notifications

- A timer in main fires every 30s (configurable constant); manual refresh and
  app-focus also trigger a poll. The GraphQL PR query runs every poll; the REST
  notifications fetch additionally honors GitHub's **`X-Poll-Interval`** header
  (often ~60s) — if the last notifications fetch was more recent than that
  interval, the poll reuses the cached activity rather than re-requesting.
- After each successful poll, main diffs the new snapshot against the previous
  to fire **native notifications** for:
  - A PR newly appearing in **needs-my-review**.
  - A new (or newly-updated) **activity item** since the last snapshot — using
    the post-filter feed, so denylisted/bot authors never notify.
  - One of **my PRs** transitioning into a failing-checks or changes-requested
    state.
- Notifications are coalesced (e.g. "3 new comments") to avoid spam, can be
  toggled off in settings, and clicking one opens the relevant PR. The very
  first poll after launch seeds the baseline and does **not** notify.

## Error Handling & Edge Cases

- **No / invalid token:** show `<TokenSetup>`; never crash.
- **Network or API failure:** keep showing the last-good snapshot, set
  `snapshot.error`, and display a non-blocking banner ("Couldn't refresh —
  retrying"). Polling continues.
- **Rate limit low:** if `rateLimit.remaining` is near zero, back off polling
  until `resetAt` and show a subtle indicator.
- **Empty states:** each table/feed shows a friendly "nothing here" message.
- **First launch:** cached snapshot may be absent → show a loading state until
  the first poll returns.
- **Cold start speed:** render the disk-cached snapshot immediately, then update
  when the first live poll completes.

## Testing Strategy

- **Unit (Vitest), main process:**
  - GraphQL response → PR-table normalizer (fixtures of real-shaped GraphQL
    payloads → expected `PullRequest[]`; covers reviewState, checks rollup,
    mergeable, staleness derivation).
  - Notifications → `ActivityItem[]` normalizer + **enrichment** (thread payload
    + resolved comment → activity item; cache-hit path skips re-fetch).
  - **Activity filtering** (denylist match + `*[bot]`/type-`Bot` detection;
    case-insensitive logins; ensures filtered authors are excluded from both feed
    and notifications).
  - Snapshot **diff → notifications** logic (given prev/next snapshots, assert the
    correct notification set, including "no notify on first poll" and
    coalescing).
  - Token storage round-trip (`safeStorage` mocked).
- **Component (RTL):** each panel renders correctly from snapshot slices,
  including empty/stale/failing states; `<TokenSetup>` validation flow.
- **Manual smoke:** run against a real PAT and confirm the dashboard populates,
  polls, and notifies.
- TDD: write the normalizer and diff tests first — they are the core logic and
  the most fixture-friendly.

## Proposed Project Structure

```
githud/
  electron.vite.config.ts
  package.json
  src/
    main/
      index.ts            # app/window lifecycle, IPC registration
      github/
        client.ts         # Octokit graphql + rest client factory
        queries.ts        # GraphQL query strings (PR tables)
        normalize-prs.ts  # GraphQL → PullRequest[]        (unit tested)
        notifications.ts  # REST fetch (conditional/ETag) + X-Poll-Interval
        enrich.ts         # resolve latest_comment_url → body, with cache (unit tested)
        normalize-activity.ts # threads + comments → ActivityItem[]  (unit tested)
        filter-activity.ts# denylist + hide-bots                     (unit tested)
      poller.ts           # timer + refresh orchestration → DashboardSnapshot
      notifier.ts         # snapshot diff → native Notification       (unit tested)
      token-store.ts      # safeStorage encrypt/decrypt               (unit tested)
      settings-store.ts   # stale threshold, notif toggle, denylist, hideBots
      snapshot-cache.ts   # disk cache of last snapshot
    preload/
      index.ts            # contextBridge window.api
    renderer/
      main.tsx
      App.tsx
      api.ts              # typed wrapper over window.api
      components/
        TopBar.tsx
        NeedsReviewTable.tsx
        MyPullRequestsTable.tsx
        ActivityFeed.tsx
        TokenSetup.tsx
        Settings.tsx        # token, stale threshold, author denylist, hide-bots
      hooks/useDashboard.ts
    shared/
      types.ts            # DashboardSnapshot & friends (imported by all layers)
```

## Future (explicitly deferred)

- Inline actions (approve / comment / merge from the app).
- Configurable per-repo watch lists (author/bot filtering ships in v1; repo
  scoping does not).
- GitHub Enterprise / multi-account.
- Tray icon + launch-at-login (deferred from earlier discussion; standard window
  for v1).
- Assigned issues panel.
- Auto-update and distribution.
