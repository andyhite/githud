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

```
src/
  shared/types.ts          # DashboardSnapshot, PullRequest, ActivityItem, Settings, GithudApi — the contract
  main/
    index.ts               # window + IPC handlers + 30s poll loop + native notifications
    poller.ts              # Poller.refresh(settings) -> DashboardSnapshot (orchestrates the github/* pieces)
    notifier.ts            # diffSnapshots(prev, next) -> NotificationSpec[]  (pure)
    token-store.ts         # PAT encrypted via Electron safeStorage
    settings-store.ts, snapshot-cache.ts, paths.ts, safe-url.ts
    github/
      client.ts            # Octokit factory + validateToken
      queries.ts           # GraphQL query strings (PR tables)
      normalize-prs.ts     # GraphQL nodes -> PullRequest[]  (pure, heavily tested)
      notifications.ts     # REST /notifications fetch (conditional/ETag) + poll-interval helpers
      enrich.ts            # resolve latest_comment_url -> body, freshness-cached
      normalize-activity.ts# threads + comments -> ActivityItem[]  (pure)
      filter-activity.ts   # denylist + hide-bots  (pure)
  preload/index.ts         # contextBridge exposing window.api (typed as GithudApi)
  renderer/src/
    App.tsx                # auth gate -> TokenSetup or Dashboard
    api.ts                 # lazy Proxy over window.api (see caveat below)
    hooks/useDashboard.ts  # TanStack Query: 30s refetch + onSnapshot push + cached seed
    components/            # TopBar, NeedsReviewTable, MyPullRequestsTable, ActivityFeed, TokenSetup, Settings
```

Data flow per poll: main timer → `poller.refresh()` (GraphQL PRs + REST
notifications → enrich → normalize → filter) → `DashboardSnapshot` → `diffSnapshots`
fires notifications → cache to disk + `webContents.send('snapshot', …)` → renderer
TanStack Query updates.

## Conventions & patterns

- **Test pure logic, not glue.** Normalizers, filters, diffing, stores, enrichment cache are TDD'd with Vitest. Electron-glue files (`index.ts`, `poller.ts`, `client.ts`) have no unit tests — they're validated by the manual smoke test. New pure logic should follow TDD.
- **Component tests** use React Testing Library; mock `window.api` in `beforeEach`.
- Keep files small and single-purpose; pure functions take `any` GraphQL/REST input and return typed shapes.

## Gotchas / caveats (non-obvious)

- **`@shared` alias must be configured per build target.** `electron.vite.config.ts` sets the `@shared` → `src/shared` alias separately for `main`, `preload`, AND `renderer`. Forgetting one builds fine in typecheck/test but fails `pnpm run build` for that process. (preload uses a relative `../shared/types` import instead.)
- **`renderer/src/api.ts` is a lazy `Proxy` over `window.api`**, not `export const api = window.api`. The eager form captures `window.api` at module-load (undefined in jsdom tests, since there's no preload). Components may import `api` and call it; the proxy reads `window.api` at call time so tests can set it in `beforeEach`.
- **Octokit 304 handling is the one un-unit-tested live behavior.** `notifications.ts` assumes a conditional request throws with `status === 304`; if the activity feed ever looks stale, verify that path against the live API.
- **`isSafeExternalUrl`** gates `shell.openExternal` to http(s) only — keep that guard on any new external-link path.
- **Notifications:** the first poll after launch seeds the baseline and intentionally fires nothing; `diffSnapshots` returns `[]` when `prev` is null.
- **CSP** in `renderer/index.html` only allows images from `*.githubusercontent.com`; adding new remote resources means updating it.

## Scope discipline (YAGNI)

v1 is deliberately read-only and single-account. Deferred (don't add without a
reason): inline approve/comment/merge, per-repo watch lists, GitHub Enterprise /
multi-account, tray icon / launch-at-login, assigned-issues panel, auto-update /
code signing.
