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
| Comment feed on PRs I review/author | **Activity** rail |
| My PRs with failing checks | Red `Checks` cell in **My open PRs** + a count badge in the top bar |
| @mentions inbox | Merged into the **Activity** rail (mention items styled distinctly) |
| Review status on my PRs | `Status` column in **My open PRs** (approvals / changes requested / mergeable) |
| Stale PR alerts | Amber `Age` cell + ⚠ marker on rows past the stale threshold |

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
- **Right rail (≈40%):** the **Activity** feed — chronological list of comment
  and mention events, each showing avatar, author, context (`repo #num`),
  relative time, and the full comment body (wraps, not truncated). Mentions are
  visually distinguished from plain comments.
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
  - `getSettings()/saveSettings()` — stale threshold, notification toggle.
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
  → GraphQL query (Octokit)
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
- **@octokit/graphql** for the GitHub GraphQL API v4, used in the main process.
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
  activity: ActivityItem[];     // comments + mentions on PRs I author/review, newest first
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
  id: string; type: 'comment' | 'review_comment' | 'mention';
  pr: { repo: string; number: number; title: string; url: string };
  author: User; body: string; url: string; createdAt: string;
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
- **Activity feed:** for the union of PRs in both lists, fetch recent
  `comments` and `reviewThreads.comments` (last N each, e.g. 10), merge, sort by
  `createdAt` desc, cap the feed (e.g. 50 items). Mentions are detected by
  scanning comment bodies for `@<viewer.login>` and tagging those items as
  `type: 'mention'` (also surfaced from the same comment data — no separate
  endpoint needed in v1).
- One aggregated request per poll where possible (GraphQL aliases); the
  `rateLimit` block is requested alongside to monitor headroom. At 30s polling a
  single-user app stays far under the 5000 points/hour budget.

## Authentication & Token Storage

- On first launch (or whenever no valid token is stored), the renderer shows a
  **`<TokenSetup>`** screen explaining which PAT scopes are needed (`repo` +
  `read:org` for a classic token, or equivalent fine-grained read permissions)
  with a link to GitHub's token-creation page.
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
  app-focus also trigger a poll.
- After each successful poll, main diffs the new snapshot against the previous
  to fire **native notifications** for:
  - A PR newly appearing in **needs-my-review**.
  - A new **activity item** (comment / mention) since last snapshot.
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
  - GraphQL response → `DashboardSnapshot` normalizer (fixtures of real-shaped
    GraphQL payloads → expected snapshot; covers reviewState, checks rollup,
    mergeable, staleness derivation, mention detection).
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
        client.ts         # Octokit GraphQL client factory
        queries.ts        # GraphQL query strings
        normalize.ts      # GraphQL → DashboardSnapshot  (unit tested)
      poller.ts           # timer + refresh orchestration
      notifications.ts    # snapshot diff → Notification  (unit tested)
      token-store.ts      # safeStorage encrypt/decrypt   (unit tested)
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
      hooks/useDashboard.ts
    shared/
      types.ts            # DashboardSnapshot & friends (imported by all layers)
```

## Future (explicitly deferred)

- Inline actions (approve / comment / merge from the app).
- Configurable watch lists and filters.
- GitHub Enterprise / multi-account.
- Tray icon + launch-at-login (deferred from earlier discussion; standard window
  for v1).
- Assigned issues panel.
- Auto-update and distribution.
