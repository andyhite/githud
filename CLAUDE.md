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

There is also an **opt-in AI layer** (`src/main/ai/`, `@anthropic-ai/sdk`,
model `claude-opus-4-8`): per-PR triage verdict, "catch me up" digest, and
first-pass review. It is dormant until the user adds an Anthropic key in
Settings, runs entirely in main, and is **on-demand only** (never on the poll
loop) — see the AI section below.

```
src/
  shared/types.ts          # DashboardSnapshot, PullRequest, FeedEvent, Settings, GithudApi, + AI types (TriageVerdict/DigestResult/ReviewResult) — the contract
  shared/size.ts           # sizeBucket(diffstat) -> S/M/L/XL  (pure; used by both the size column and the AI triage)
  main/
    index.ts               # window + IPC handlers + 30s poll loop + native notifications + navigation guard + tray/dock badge + login item
    poller.ts              # Poller.refresh(settings) -> DashboardSnapshot (orchestrates github/*); `get client()` exposes the Octokit to AI handlers
    notifier.ts            # diffSnapshots(prev, next, {notifyKinds, now, quietHours}) -> NotificationSpec[]  (pure; per-kind filter + quiet hours; caps at 5)
    event-store.ts         # FeedEvent merge/read-state + PRState persistence (pure helpers + fs glue)
    hidden-store.ts        # hide / unhide / snooze PRs; resolveHidden(prs, hidden, now) prunes on merge/resurface/snooze-expiry  (pure + fs glue)
    tray-label.ts          # visibleNeedsReviewCount + dockBadge  (pure)
    token-store.ts         # PAT encrypted via Electron safeStorage
    settings-store.ts, snapshot-cache.ts, paths.ts, safe-url.ts
    github/
      client.ts            # Octokit factory + validateToken
      queries.ts           # GraphQL query strings (PR tables + headRefName/baseRefName + diff stats + reviewThreads + per-PR reviews/comments/reviewRequests/checks windows)
      normalize-prs.ts     # GraphQL nodes -> PullRequest[]  (pure, heavily tested)
      pr-state.ts          # GraphQL node -> PRState (diffable: reviews/comments/CI/headOid/reviewRequestedLogins)  (pure)
      derive-events.ts     # diff prev vs next PRState -> FeedEvent[]  (pure, heavily tested)
      enrich-state.ts      # REST PR/issue payload -> merged/closed/reopened label  (pure)
      filter-events.ts     # denylist + hide-bots  (pure)
      fetch-diff.ts        # REST PR meta + .diff (capped) for the AI layer  (glue)
    ai/                    # opt-in; all glue EXCEPT size/verdict (pure, tested)
      key-store.ts         # Anthropic key encrypted via safeStorage (mirrors token-store)
      client.ts            # Anthropic factory + validateAiKey; AI_MODEL = 'claude-opus-4-8'
      cache.ts             # on-disk result cache keyed by `${kind}:${prId}:${headKey}`  (pure helpers + fs glue)
      verdict.ts           # (size,risk)→TriageLabel  (pure, tested; size bucket lives in src/shared/size.ts)
      triage.ts            # one cached Claude risk call -> TriageVerdict
      digest.ts            # "catch me up" standup from the snapshot
      review.ts            # first-pass advisory review of a diff
  preload/index.ts         # contextBridge exposing window.api (typed as GithudApi)
  renderer/src/
    App.tsx                # auth gate -> TokenSetup or Dashboard; composes filter+sort+verdicts+selection+lazy-load
    api.ts                 # lazy Proxy over window.api (see caveat below)
    hooks/useDashboard.ts  # TanStack Query: 30s refetch + onSnapshot push + cached seed
    hooks/selection.ts     # moveSelection (pure) — j/k keyboard nav
    components/
      TopBar.tsx           # summary + filter box + rate-limit/stale badges (ticking) + refresh/settings
      NeedsReviewTable.tsx # table + RowActions kebab (⋮) menu + TriageChip + the shared cell components
      MyPullRequestsTable.tsx, ActivityFeed.tsx, TokenSetup.tsx, Settings.tsx, CommandPalette.tsx (⌘K), Digest.tsx, ReviewPanel.tsx, icons.tsx
      pr-status.ts (mergeReadiness), sort-prs.ts, match.ts, snooze.ts, activity-severity.ts  # pure, tested
```

Data flow per poll: main timer → `poller.refresh()` → one GraphQL query for the
PR tables (`normalize-prs`) + diffable `pr-state`; `derive-events` diffs the
persisted previous `PRState` against the new one to produce `FeedEvent[]` (for
the user's own PRs that dropped out of the open set, a REST call resolves
merged/closed via `enrich-state`); events are merged/capped in `event-store`,
filtered by `filter-events`, and hidden PRs resolved by `hidden-store` →
`DashboardSnapshot` → `diffSnapshots` fires the kinds the user opted into
(`settings.notifyKinds`, suppressed during quiet hours) → cache to disk +
`webContents.send('snapshot', …)` + tray/dock badge update → renderer TanStack
Query updates. AI results are NOT part of this flow — they're fetched on demand.

## AI layer (opt-in)

- **Dormant without a key.** No AI runs until the user saves an Anthropic key in Settings (`saveAiKey` validates it with a tiny call, then encrypts via `ai/key-store`). The renderer gates AI affordances on `getAiStatus().hasKey`.
- **On-demand, never on the poll loop.** The three AI IPC handlers (`getTriage`, `getDigest`, `getReview`) are the only entry points; `poller.ts` has no AI imports. Triage + review fetch the PR diff (`fetch-diff`) and call Claude; **results are cached on disk** (`ai/cache.ts`) keyed by `PR id + headKey` (`headKey = pr.updatedAt`, which advances on new commits → auto-invalidates).
- **Triage verdict** = deterministic `size` (diffstat → S/M/L/XL, pure/tested) combined with an AI `risk` read via `verdict.ts` (pure/tested) → one of `quick_approve | careful_read | likely_changes | big_effort`. The renderer lazy-loads a verdict per visible needs-review PR **once per session** (a `useRef` set guards against refetch storms; a null result is not retried).
- **Structured output** uses `output_config: { effort, format: { type: 'json_schema', schema } }` and prompt-caches the system prompt (`cache_control: ephemeral`). The SDK's typed surface doesn't yet cover `output_config`/`cache_control` in all positions, so those `messages.create` calls carry intentional `as any` casts — keep them.
- **Model id is a single constant** `AI_MODEL = 'claude-opus-4-8'` in `ai/client.ts`. Don't scatter model strings. Use the `claude-api` skill when touching SDK code.
- `size`/`verdict` are TDD'd; the Claude calls (`triage`/`digest`/`review`) are glue (manual smoke test). There's no key-rotation UI yet (overwrite only) — backlog.

## Conventions & patterns

- **Test pure logic, not glue.** Normalizers (`normalize-prs`, `pr-state`, `enrich-state`), filters (`filter-events`), diffing (`derive-events`, `notifier`), store helpers (`event-store`, `hidden-store`), and the pure renderer helpers (`pr-status`, `sort-prs`, `match`, `snooze`, `selection`, `activity-severity`, `tray-label`, `ai/size`, `ai/verdict`) are TDD'd with Vitest. Electron/SDK-glue files (`index.ts`, `poller.ts`, `client.ts`, `ai/*` calls, `fetch-diff`, tray wiring) have no unit tests — they're validated by the manual smoke test. New pure logic should follow TDD.
- **Component tests** use React Testing Library; mock `window.api` in `beforeEach`.
- Keep files small and single-purpose; pure functions take `any` GraphQL/REST input and return typed shapes.
- **Adding a `FeedEventKind`** means updating four exhaustive `Record<FeedEventKind, …>` maps (`notifier.titleFor`, `ActivityFeed.ACTION`, `icons.KIND_ICON`, `activity-severity`) — typecheck enforces this.

## Gotchas / caveats (non-obvious)

- **`@shared` alias must be configured per build target.** `electron.vite.config.ts` sets the `@shared` → `src/shared` alias separately for `main`, `preload`, AND `renderer`. Forgetting one builds fine in typecheck/test but fails `pnpm run build` for that process. (preload uses a relative `../shared/types` import instead.)
- **`renderer/src/api.ts` is a lazy `Proxy` over `window.api`**, not `export const api = window.api`. The eager form captures `window.api` at module-load (undefined in jsdom tests, since there's no preload). Components may import `api` and call it; the proxy reads `window.api` at call time so tests can set it in `beforeEach`.
- **Event windows can drop events under burst.** `derive-events` diffs the trailing `reviews(last:50)`/`comments(last:20)` windows (`queries.ts`) by id set-difference. An item pushed out of its window before a poll observes it is never surfaced — a deliberate v1 tradeoff (documented in `queries.ts`). To fix robustly, persist a per-PR last-seen timestamp and emit items newer than it.
- **`isSafeExternalUrl`** gates `shell.openExternal` to http(s) only — keep that guard on any new external-link path. As defense in depth, `createWindow` (`index.ts`) also installs `setWindowOpenHandler` + a `will-navigate` guard so stray in-window navigation / `window.open` can't load remote content into the privileged window; route any new external-link path through the same gate.
- **Notification baseline is gated by a `baselineSeeded` flag in `index.ts`, NOT by `lastSnapshot === null`.** `lastSnapshot` is pre-seeded from the disk cache for the renderer, so it's non-null before the first live poll; the first successful poll (and the first poll after `saveToken`) seeds silently and fires nothing. `diffSnapshots` itself still returns `[]` when `prev` is null, and caps emitted notifications at 5.
- **`markRead`/`markAllRead` IPC handlers re-apply `filterEvents`** before returning, because the `event-store` holds the full unfiltered set but the renderer only ever shows the filtered feed — otherwise reading an event would resurface hidden bot/excluded-author events.
- **CSP** in `renderer/index.html` only allows images from `*.githubusercontent.com` and locks down `base-uri`/`form-action`/`object-src`/`frame-ancestors`; adding new remote resources means updating it. The renderer makes no network calls (all GitHub + Anthropic I/O is in main), so don't add a remote `connect-src`.
- **Both secrets live only in main.** The GitHub PAT (`token-store`) and Anthropic key (`ai/key-store`) are encrypted via `safeStorage` and never imported by the renderer/preload. `saveToken`/`saveAiKey` only accept the secret inward and return `{ ok, … }` — never the secret. The typed IPC results (`DashboardSnapshot`, `TriageVerdict`, `DigestResult`, `ReviewResult`, `AiStatus`) carry no key material. Keep it that way.
- **All per-row actions live in one kebab (⋮) menu** (`RowActions` in `NeedsReviewTable.tsx`), reused by both tables — hide/unhide/snooze/copy/pre-review. Add new row actions there, not as more inline buttons. Component tests open the kebab (`getByRole('button', { name: /row actions/i })`) then click a `role="menuitem"`.
- **Settings inputs:** the `.settings-panel input[type=...]` rule must list every input type used (text/number/password) or the field renders unstyled; `<select>` has its own rule.

## Scope discipline (YAGNI)

v1 is read-only and single-account. **Built** (was deferred): tray icon + dock
badge + launch-at-login; keyboard nav + command palette; the opt-in AI layer.
Still deferred (don't add without a reason): inline approve/comment/merge,
per-repo watch lists, GitHub Enterprise / multi-account, assigned-issues panel,
auto-update / code signing. AI backlog: a key-rotation/removal UI, and the M14
secondary helpers (thread TL;DR, mention triage, standup generator) — see the
plan in `docs/superpowers/plans/`.
