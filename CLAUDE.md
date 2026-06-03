# CLAUDE.md — githud

Personal single-user Electron + React + TypeScript GitHub dashboard. Read-only,
github.com only, built for one user on one machine. Full rationale lives in
`docs/superpowers/specs/` (design) and `docs/superpowers/plans/` (implementation
plan); read those before large changes.

## Commands (pnpm — not npm)

- `pnpm run dev` — run with hot-reload (launches a GUI; don't run in a headless/agent context — it blocks).
- `pnpm test` — Vitest suite. `pnpm test -- <name>` to filter (e.g. `pnpm test -- normalize-prs`).
- `pnpm run typecheck` — `tsc --noEmit`.
- `pnpm run build` — bundle all three processes into `out/`.
- After a fresh install, if `dev` errors with `Error: Electron uninstall`, run `pnpm rebuild electron` (the binary download gets skipped sometimes). See README.

## Architecture

Three layers; the **only** data crossing the main↔renderer boundary is a
`DashboardSnapshot` (defined in `src/shared/types.ts`). All GitHub I/O and the
token live in main; the renderer never touches GitHub or the token.

The activity feed is **event-based**: instead of fetching GitHub's REST
`/notifications`, the poller derives `FeedEvent[]` by diffing each poll's PR
state against the previous poll's persisted state (new reviews/comments/CI
transitions/lifecycle changes).

```
src/
  shared/types.ts          # DashboardSnapshot, PullRequest, FeedEvent, Settings, GithudApi — the contract
  main/
    index.ts               # window + IPC handlers + 30s poll loop + native notifications + navigation guard
    poller.ts              # Poller.refresh(settings) -> DashboardSnapshot (orchestrates the github/* pieces)
    notifier.ts            # diffSnapshots(prev, next) -> NotificationSpec[]  (pure; caps at 5)
    event-store.ts         # FeedEvent merge/read-state + PRState persistence (pure helpers + fs glue)
    hidden-store.ts        # hide/unhide PRs; resolveHidden prunes on merge/resurface  (pure helpers + fs glue)
    token-store.ts         # PAT encrypted via Electron safeStorage
    settings-store.ts, snapshot-cache.ts, paths.ts, safe-url.ts
    github/
      client.ts            # Octokit factory + validateToken
      queries.ts           # GraphQL query strings (PR tables + per-PR reviews/comments/checks windows)
      normalize-prs.ts     # GraphQL nodes -> PullRequest[]  (pure, heavily tested)
      pr-state.ts          # GraphQL node -> PRState (diffable: reviews/comments/CI/headOid)  (pure)
      derive-events.ts     # diff prev vs next PRState -> FeedEvent[]  (pure, heavily tested)
      enrich-state.ts      # REST PR/issue payload -> merged/closed/reopened label  (pure)
      filter-events.ts     # denylist + hide-bots  (pure)
  preload/index.ts         # contextBridge exposing window.api (typed as GithudApi)
  renderer/src/
    App.tsx                # auth gate -> TokenSetup or Dashboard
    api.ts                 # lazy Proxy over window.api (see caveat below)
    hooks/useDashboard.ts  # TanStack Query: 30s refetch + onSnapshot push + cached seed
    components/            # TopBar, NeedsReviewTable, MyPullRequestsTable, ActivityFeed,
                           #   TokenSetup, Settings, icons, activity-severity
```

Data flow per poll: main timer → `poller.refresh()` → one GraphQL query for the
PR tables (`normalize-prs`) + diffable `pr-state`; `derive-events` diffs the
persisted previous `PRState` against the new one to produce `FeedEvent[]` (for
the user's own PRs that dropped out of the open set, a REST call resolves
merged/closed via `enrich-state`); events are merged/capped in `event-store`,
filtered by `filter-events`, and hidden PRs resolved by `hidden-store` →
`DashboardSnapshot` → `diffSnapshots` fires notifications → cache to disk +
`webContents.send('snapshot', …)` → renderer TanStack Query updates.

## Conventions & patterns

- **Test pure logic, not glue.** Normalizers (`normalize-prs`, `pr-state`, `enrich-state`), filters (`filter-events`), diffing (`derive-events`, `notifier`), and the pure store helpers (`event-store`, `hidden-store`) are TDD'd with Vitest. Electron-glue files (`index.ts`, `poller.ts`, `client.ts`) have no unit tests — they're validated by the manual smoke test. New pure logic should follow TDD.
- **Component tests** use React Testing Library; mock `window.api` in `beforeEach`.
- Keep files small and single-purpose; pure functions take `any` GraphQL/REST input and return typed shapes.

## Gotchas / caveats (non-obvious)

- **`@shared` alias must be configured per build target.** `electron.vite.config.ts` sets the `@shared` → `src/shared` alias separately for `main`, `preload`, AND `renderer`. Forgetting one builds fine in typecheck/test but fails `pnpm run build` for that process. (preload uses a relative `../shared/types` import instead.)
- **`renderer/src/api.ts` is a lazy `Proxy` over `window.api`**, not `export const api = window.api`. The eager form captures `window.api` at module-load (undefined in jsdom tests, since there's no preload). Components may import `api` and call it; the proxy reads `window.api` at call time so tests can set it in `beforeEach`.
- **Event windows can drop events under burst.** `derive-events` diffs the trailing `reviews(last:50)`/`comments(last:20)` windows (`queries.ts`) by id set-difference. An item pushed out of its window before a poll observes it is never surfaced — a deliberate v1 tradeoff (documented in `queries.ts`). To fix robustly, persist a per-PR last-seen timestamp and emit items newer than it.
- **`isSafeExternalUrl`** gates `shell.openExternal` to http(s) only — keep that guard on any new external-link path. As defense in depth, `createWindow` (`index.ts`) also installs `setWindowOpenHandler` + a `will-navigate` guard so stray in-window navigation / `window.open` can't load remote content into the privileged window; route any new external-link path through the same gate.
- **Notification baseline is gated by a `baselineSeeded` flag in `index.ts`, NOT by `lastSnapshot === null`.** `lastSnapshot` is pre-seeded from the disk cache for the renderer, so it's non-null before the first live poll; the first successful poll (and the first poll after `saveToken`) seeds silently and fires nothing. `diffSnapshots` itself still returns `[]` when `prev` is null, and caps emitted notifications at 5.
- **`markRead`/`markAllRead` IPC handlers re-apply `filterEvents`** before returning, because the `event-store` holds the full unfiltered set but the renderer only ever shows the filtered feed — otherwise reading an event would resurface hidden bot/excluded-author events.
- **CSP** in `renderer/index.html` only allows images from `*.githubusercontent.com` and locks down `base-uri`/`form-action`/`object-src`/`frame-ancestors`; adding new remote resources means updating it.

## Scope discipline (YAGNI)

v1 is deliberately read-only and single-account. Deferred (don't add without a
reason): inline approve/comment/merge, per-repo watch lists, GitHub Enterprise /
multi-account, tray icon / launch-at-login, assigned-issues panel, auto-update /
code signing.
