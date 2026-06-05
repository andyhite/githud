# CLAUDE.md — githud

Single-user Electron + React + TypeScript GitHub dashboard. Read-only
(one narrow write path: starting a *draft* PR review — inline comments only, never
submitted; see Scope discipline), github.com only, built to run locally for one user
on one machine.

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
  shared/types.ts          # DashboardSnapshot (now includes `history: DailyMetric[]` + `teamPullRequests: PullRequest[]` — the "Other PRs" panel source; field name kept for back-compat), PullRequest (now includes `labels: string[]` + `isQueued: boolean` — in the repo's merge queue, from GraphQL `isInMergeQueue`), FeedEvent, Settings (now includes `teamLabels: string[]` + `teamOrgs: string[]` + `otherTeam: string` (a SINGLE "org/team" slug feeding the Other-PRs panel) + `refreshIntervalSeconds: number` + `apiBudgetPercent: number`), TeamOption + ListResult<T> (for the org/team source pickers), GithudApi (includes `postReview`, `getReviewInstructions`, `saveReviewInstructions`, `resetReviewInstructions`, `resetCredentials` (removes BOTH stored secrets + stops polling), `clearAiCache`, `listOrgs`/`listTeams` (on-demand; auto-populate the Settings source pickers; need the token's read:org scope, degrade to a `reason`)), DailyMetric, + AI types (TriageVerdict/DigestResult/ReviewResult/ReviewFinding — ReviewFinding carries anchor fields file/line/side; ReviewResult carries a dashboard-only `recommendation` (ReviewRecommendation) + `assessment` that are NEVER posted; PostReviewPayload is comments-only — no body/event) — the contract
  shared/size.ts           # sizeBucket(diffstat) -> S/M/L/XL  (pure; used by both the size column and the AI triage)
  shared/poll-schedule.ts  # nextPollDelay(rateLimit, now, baseMs?, reserveFraction?) + formatInterval  (pure, tested; adaptive poll backoff, used by the main loop AND the TopBar interval display). Spreads only the SPENDABLE budget (remaining minus a reserve) over the window so githud never drains the per-user/shared GraphQL budget to zero; paces against the SMOOTHED cost (rateLimit.avgCost, an EWMA the poller maintains) not the last single sample; floors at baseMs (default BASE_POLL_MS=30s ← Settings.refreshIntervalSeconds); reserve defaults to RESERVE_FRACTION=20% ← (1 - Settings.apiBudgetPercent/100).
  main/
    index.ts               # window + IPC handlers + adaptive poll loop (self-scheduling setTimeout via nextPollDelay; base = Settings.refreshIntervalSeconds (default 30s, clamped ≥30s), backs off as the GraphQL budget runs low and keeps a reserve = 1 - Settings.apiBudgetPercent/100 (default 20%); on a quota error, parseRateLimitError pins the backoff to the authoritative reset window) + native notifications + navigation guard + tray/dock badge + login item
    poller.ts              # Poller.refresh(settings) -> DashboardSnapshot (orchestrates github/*); `get client()` exposes the Octokit to AI handlers
    notifier.ts            # diffSnapshots(prev, next, {notifyKinds, now, quietHours}) -> NotificationSpec[]  (pure; per-kind filter + quiet hours; caps at 5)
    event-store.ts         # FeedEvent merge/read-state + PRState persistence (pure helpers + fs glue)
    hidden-store.ts        # hide / unhide / snooze PRs; resolveHidden(prs, hidden, now) prunes on merge/resurface/snooze-expiry  (pure + fs glue)
    history-store.ts       # daily-metric samples (reviewQueue/openWipSize/merges) -> trend strip; pure helpers + fs glue (90-day retention)
    tray-label.ts          # visibleNeedsReviewCount + dockBadge  (pure)
    token-store.ts         # PAT encrypted via Electron safeStorage
    settings-store.ts, snapshot-cache.ts, paths.ts, safe-url.ts
    json-file.ts           # readJsonFile<T>(path, fallback) — the single guarded JSON read path shared by every on-disk store
    github/
      client.ts            # Octokit factory + validateToken (returns a classified TokenValidation: ok | auth | rate_limit | network — never just null)
      queries.ts           # GraphQL query strings. PR_FIELDS = the heavy per-PR fragment (reviews/comments-with-bodyText/reviewThreads/checks windows) for needsReview+mine, which feed event derivation. TEAM_PR_FIELDS = a LEAN display-only fragment (adds labels; drops the comment-body window, trims connections) for the Other-PRs search — those PRs aren't diffed, and the lean fragment keeps the alias well under GitHub's secondary-rate-limit (query-complexity) ceiling. NEEDS_REVIEW_QUERY uses `user-review-requested:@me` (individual requests ONLY — team-level requests are excluded; they belong in the Other-PRs panel via otherTeam), NOT the broader `review-requested:@me`. buildDashboardQuery(includeTeam) adds ONE `team: search(first:50)` alias on top of needsReview+mine; the poller includes it whenever there's an owner scope AND any Other-source config (orgs/team/labels). otherSearchQuery(ownerClause, labels, team) builds it (sorted updated-desc, `draft:false` — drafts excluded since it's a review-ready overview; My-PRs is NOT draft-filtered): owner scope + optional comma-OR'd labels + — when a team is set — `team-review-requested:org/team` (precise). SINGLE team only: GitHub issue/PR search can't reliably OR multiple `team-review-requested:` qualifiers (**space-separated qualifiers AND**, which would zero the result; there's no working OR for them) — so the source takes one team slug, not a list. The owner clause covers every owner because GitHub's **issues/PR search** (NOT boolean code-search syntax) treats space-separated `user:`/`org:` qualifiers as OR and comma-separated values in one `label:"a","b"` qualifier as OR (separate `label:` qualifiers AND). ⚠️ Do NOT use the boolean `OR` operator / `(a OR b)` group here — code-search syntax, silently returns ZERO for issues/PR search; that exact bug blanked the panel once a viewer login AND an org were both present. ownerScopeClause(viewerLogin, orgs) space-joins your own repos (always) + orgs (`user:me org:a org:b`, capped at 16); orgFromTeamSlug(slug) extracts the team's org so its PRs are always in range; labelSearchClause(labels) builds the comma-OR'd `label:` clause. ownerScopeClause returns null when there's nothing to scope to, and the poller then SKIPS the search rather than searching globally. needsReview/mine are deliberately NOT owner-scoped — they're personal (`user-review-requested:@me`/`author:@me`) and must keep surfacing cross-org PRs. viewerLogin is passed into `poller.refresh(settings, viewerLogin)` from index.ts (set at startup/saveToken, refreshed from each successful snapshot).
      normalize-prs.ts     # GraphQL nodes -> PullRequest[]  (pure, heavily tested)
      pr-state.ts          # GraphQL node -> PRState (diffable: reviews/comments/CI/headOid/reviewRequestedLogins)  (pure)
      derive-events.ts     # diff prev vs next PRState -> FeedEvent[]  (pure, heavily tested)
      enrich-state.ts      # REST PR/issue payload -> merged/closed/reopened label  (pure)
      filter-events.ts     # author denylist: isExcludedAuthor + filterEvents + applyAuthorFilters (pure); shared by events, PR lists, and thread counts
      rate-limit.ts        # parseRateLimitError(err, now) -> RateLimit from Octokit error headers  (pure, tested; feeds the adaptive backoff on quota errors)
      fetch-diff.ts        # REST PR meta + .diff (capped) for the AI layer  (glue)
      orgs-teams.ts        # listOrgs/listTeams (REST /user/orgs + /user/teams) for the Settings source pickers. normalizeOrgs/normalizeTeams/classifyListError are pure + tested; fetchOrgs/fetchTeams are Octokit glue. Needs read:org; classifyListError maps 401/403 → 'scope'.
      parse-diff-anchors.ts  # unified diff → valid review-comment anchors per file (pure, tested)
      post-review.ts       # buildReviewRequest/reviewUrl/classifyPostError (pure, tested) + postReview Octokit glue. Creates the PR review WITHOUT an `event` (→ PENDING/draft; user finishes & submits on github.com) AND WITHOUT a body (→ no summary comment is posted). Posts ONLY the inline line comments — the AI `assessment`/`recommendation` and any un-anchored findings stay in the dashboard, never posted.
    ai/                    # opt-in; all glue EXCEPT size/verdict (pure, tested)
      key-store.ts         # Anthropic key encrypted via safeStorage (mirrors token-store)
      client.ts            # Anthropic factory + validateAiKey; AI_MODEL = 'claude-opus-4-8'
      cache.ts             # on-disk result cache keyed by `${kind}:${prId}:${headKey}`  (pure helpers + fs glue)
      verdict.ts           # (size,risk)→TriageLabel  (pure, tested; size bucket lives in src/shared/size.ts)
      triage.ts            # one cached Claude risk call -> TriageVerdict
      digest.ts            # "catch me up" full standup + buildDeltaDigest (brief since-last-focus delta); eventsSince/deltaPayload are pure/tested
      review.ts            # draft review: fetches diff, calls Claude using the EDITABLE system prompt from `ai/review-instructions-store.ts` (seeded from `ai/review-instructions-default.ts`, a neutral collaborative-reviewer seed). Returns a `recommendation` (approve | approve_with_nits | request_changes | needs_discussion) + an `assessment` (private reviewer-facing read, dashboard-only) + line `findings`; snaps findings to real diff lines via `anchor-findings.ts`, posts the line comments via `github/post-review.ts`. Modal lets the user edit/select line comments before posting; assessment + un-anchored findings are read-only context (never posted); never auto-posted.
      anchor-findings.ts   # best-effort nearest-line snapping of AI findings to diff anchors  (pure, tested)
      review-instructions-store.ts  # editable review-voice prompt persisted on disk; falls back to review-instructions-default  (fs glue)
      review-instructions-default.ts  # the seed default review-voice prompt — a neutral, collaborative-reviewer starting point; editable in-app (Settings → Review), don't hand-edit
  preload/index.ts         # contextBridge exposing window.api (typed as GithudApi)
  renderer/src/            # UI is Tailwind v4 + shadcn/ui (Zinc base, light+dark) + recharts. NO hand-rolled CSS — everything lives in styles/tailwind.css (design tokens + a `.markdown` block + base/scrollbar rules). See the redesign spec/plan dated 2026-06-03.
    styles/tailwind.css    # the ONLY stylesheet: `@import "tailwindcss"`, Zinc tokens + semantic --sev-{info,success,failure,mention,effort} (defined for :root AND .dark, mapped under `@theme inline` as --color-sev-*), the @layer base border reset (see gotcha), `.markdown` rules, scrollbar polish
    app.tsx                # auth gate -> TokenSetup or Dashboard; thin composition of <Panel>s over the orchestration hooks (filter+sort+verdicts+selection). Responsive: desktop = two-column grid (PR panels + Activity); below lg (useNarrowViewport) it collapses to a single column with PR-lists/Activity split onto tabs (Pull Requests / Notifications), and the recap/trend chrome is desktop-only.
    api.ts                 # lazy Proxy over window.api (see caveat below) — all components call `api`, not `window.api`
    lib/                   # ALL pure renderer logic — NO components, NO hooks. The home for anything tested in isolation. (pure, tested unless noted):
      utils.ts             # cn() = clsx + tailwind-merge (the shadcn classname helper)
      pr-status.ts         # mergeReadiness
      sort-prs.ts          # sortNeedsReview / sortMyPrs / sortTeamPrs
      snooze.ts            # computeSnoozeUntil
      activity-severity.ts # severityForKind
      trend-metrics.ts     # queue/wip/merges/activity metrics + formatChurn
      diff-snippet.ts      # pure diff-hunk formatter (used by the DiffSnippet component)
      relative-age.ts      # relativeAge (used by AgeCell, ActivityFeed, TopBar)
      selection.ts         # moveSelection — j/k keyboard nav
      hide-types.ts        # HideProps interface (onHide/onUnhide/onSnooze) — type-only
    hooks/                 # React hooks ONLY, each named use-*.ts:
      use-dashboard.ts     # TanStack Query: NO refetchInterval (main is the sole poll driver) + onSnapshot push + cached seed; queryFn=api.refresh() so the manual Refresh button/⌘K can still force an on-demand poll
      use-digest.ts        # subscribes to main's 'digest' push (brief on-focus delta digest)
      {use-hide-actions,use-read-state,use-triage-verdicts,use-keyboard-nav,use-settings}.ts  # App orchestration extracted into focused hooks (hide/snooze, mark-read, lazy triage, j/k/⌘K nav, settings load)
      use-narrow-viewport.ts  # matchMedia hook → true below NARROW_MAX_WIDTH=1024 (Tailwind `lg`). Drives the desktop↔narrow flip in lockstep: PrTable's table↔card switch AND App's grid↔tabbed layout. In jsdom (no matchMedia) it stays false → tests get the desktop layout.
    components/            # NAMING: kebab-case files, ONE component per file. Related components group into a feature dir + an index.ts barrel (pr-table/, theme-provider/). Pure logic lives in lib/, hooks in hooks/ — never here. `ui/` is the ONE exemption (kept on shadcn's own conventions).
      ui/                  # vendored shadcn primitives (button/card/badge/dialog/dropdown-menu/table/switch/slider/toggle/toggle-group/tabs/input/label/command/checkbox/textarea) — generated by the CLI; don't hand-edit. EXEMPT from the kebab-case/one-per-file rules above.
      # Feature directories (barrel re-exports the public components; internals stay unexported):
      pr-table/            # index.ts → PrTable + PrColumn + ShowHiddenToggle + RowActions. pr-table.tsx = ONE configurable table (`columns: PrColumn[]`) for all three PR panels (needs-review/team/mine), emptyVariant + showAuthor props; below lg (useNarrowViewport) it renders a card layout instead of a table (kebab pinned top-right). One file per cell — pr-title-cell / diff-stat / status-cell / age-cell / reviewers-cell / triage-chip — each carrying its own private helpers (statusTag/checksMeta/TRIAGE_META). row-actions.tsx = per-row kebab (⋮) on shadcn DropdownMenu; show-hidden-toggle.tsx = the "show hidden (N)" link. Reused by every PR panel.
      theme-provider/      # index.ts → ThemeProvider + useTheme + Theme. theme-provider.tsx (component) + use-theme.ts (hook) + theme-context.ts (the shared private React context). Toggles .dark on <html>, persisted in localStorage ('githud-theme'), defaultTheme dark. Renderer-only — NOT in Settings/shared types. (index.html ships `<html class="dark">` for a dark first paint.)
      # Shared building blocks (the DRY core):
      panel.tsx            # card shell: sticky header (title + count Chip + actions slot) + scroll body. EVERY panel renders through it.
      chip.tsx             # cva chip (tones neutral/info/success/failure/mention/effort/count) over the semantic --sev-* tokens — the single source for status/triage/severity/reviewer/label coloring
      chip-input.tsx       # array editor (add on Enter/comma/blur, remove on ✕/Backspace, dedupe) — used by Settings for excluded-authors/team-labels/team-orgs
      org-team-fields.tsx  # Settings Other-PRs "Organizations" + "Team" fields, enhanced with auto-populate from listOrgs/listTeams (org suggestion chips + a team picker dropdown). Always free-text first — pickers only ADD; degrades to plain entry + a read:org hint if the token lacks scope or GitHub is unreachable.
      # Panels & views:
      top-bar.tsx          # brand + ONE consolidated connection/freshness status ("updated Nm ago" / "stale · …" / "offline · retrying" / "rate limited · waiting ~Nm", keyed off snapshot.error + snapshot.errorKind, ticking) + refresh button carrying the next interval (amber when throttled) + theme toggle + settings. (Review/failing COUNTS were intentionally removed — shown per-row.)
      activity-feed.tsx    # event feed; severity-tinted left border + lucide EventIcon (color from --sev-*); row click marks read + opens
      settings.tsx         # shadcn Dialog + vertical Tabs (General/Notifications/Filters&Team/Review/Connections/Appearance). UPDATES the GitHub PAT post-setup via saveToken (validates+restarts polling); refresh-interval/api-budget/stale-threshold/launch-at-login/notify-kinds/quiet-hours + the Other-PRs source (orgs/team/labels via OrgTeamFields) + the Appearance theme toggle (useTheme). Connections has a "Maintenance" group: "Clear AI cache" (clearAiCache) and a two-click "Reset credentials" (resetCredentials → window.location.reload() back to TokenSetup). Grouped via a SettingsGroup helper (uppercase-muted section header + divider, distinct from field labels).
      token-setup.tsx      # first-run PAT screen (Card/Input/Button)
      command-palette.tsx  # ⌘K — shadcn Command (cmdk handles fuzzy filter + nav)
      digest.tsx, digest-pane.tsx, review-panel.tsx  # AI modals/pane (Dialog); markdown via react-markdown styled by the `.markdown` rules in tailwind.css. ReviewPanel renders diff context around each finding via DiffSnippet.
      diff-snippet.tsx     # renders the diff hunk around a finding's anchor line (from ReviewResult.patch) — used by ReviewPanel; pure formatting in lib/diff-snippet.ts
      event-icon.tsx       # EventIcon — exhaustive Record<FeedEventKind, LucideIcon>
      empty-state.tsx      # blank-slate (review/mine/team/activity) with a lucide icon
      trend-strip.tsx, trend-chart.tsx   # trend KPI strip above the tables; TrendChart = axis-less recharts line/bars micro-chart
```
The three PR panels (Needs-review, Other PRs [shown only when any Other-source config — orgs/team/labels — is set], My-open-PRs) all render through the SAME `<Panel><PrTable columns=…/></Panel>`; the column set is the only difference (needs-review adds `triage` only when `aiOn`; other/mine include `reviewers`). The Other-PRs panel sits between Needs-review and My-open-PRs. There is no client-side per-panel filtering — each panel just shows its (sorted) source set; the Other-PRs panel's contents are shaped entirely by its server-side source config (orgs/team/labels).

Data flow per poll: main timer → `poller.refresh()` → one GraphQL query for the
PR tables (`normalize-prs`) + diffable `pr-state`; `derive-events` diffs the
persisted previous `PRState` against the new one to produce `FeedEvent[]` (for
the user's own PRs (NOT team PRs) that dropped out of the open set, a REST call resolves
merged/closed via `enrich-state`); events are merged/capped in `event-store`,
filtered by `filter-events`, and hidden PRs resolved by `hidden-store` →
`DashboardSnapshot` → `diffSnapshots` fires the kinds the user opted into
(`settings.notifyKinds`, suppressed during quiet hours) → cache to disk +
`webContents.send('snapshot', …)` + tray/dock badge update → renderer TanStack
Query updates. The same GraphQL call also runs one "Other PRs" search (owner scope + optional labels + optional single-team review queue, in a single alias) whose nodes become `snapshot.teamPullRequests` for the Other-PRs panel. Those PRs are an overview only: they do NOT feed `pr-state`/event derivation, history sampling, or notifications. They DO participate in `hidden-store` (hide/unhide works in the Team panel like the other tables); the poller and `recomputeHidden` include `teamPullRequests` in the `resolveHidden` input set so a hidden team-only PR isn't pruned as "fell out". AI results are NOT part of this flow — they're fetched on demand. The poller also calls `recordSample(...)` each poll to append today's metrics to `history-store`; the three history-backed trend cards (review queue / open WIP / merges) are empty ("collecting…") until history accumulates over real days — there is no backfill and app-not-running leaves gaps. The activity/day card is derived in the renderer from `snapshot.events` (the 100-event feed) and is available immediately.

## AI layer (opt-in)

- **Dormant without a key.** No AI runs until the user saves an Anthropic key in Settings (`saveAiKey` validates it with a tiny call, then encrypts via `ai/key-store`). The renderer gates AI affordances on `getAiStatus().hasKey`.
- **On-demand, never on the poll loop.** The three AI IPC handlers (`getTriage`, `getDigest`, `getReview`) plus the on-focus delta digest (below) are the only entry points; `poller.ts` has no AI imports. Triage + review fetch the PR diff (`fetch-diff`) and call Claude; **results are cached on disk** (`ai/cache.ts`) keyed by `PR id + headKey` (`headKey = pr.updatedAt`, which advances on new commits → auto-invalidates).
- **Brief delta digest (on focus).** Bringing the window to the foreground (`win.on('focus')` + macOS `did-become-active`, coalesced via `digestInFlight` in `index.ts`) refreshes the snapshot, then — if the feed has events newer than the tracked `lastFocusAt` — makes one terse Claude call (`buildDeltaDigest`) and pushes a one-sentence summary to the renderer via `webContents.send('digest', …)` → `useDigest` → `DigestPane`. No new events → no call, no token spend; the pane keeps its last sentence (`lastFocusAt` advances only after a successful generation). The detailed modal digest (`getDigest`/`digest.tsx`) is unchanged, and the tray/dock badge is NOT cleared on focus (it reflects the needs-review count, not unread).
- **Triage verdict** = deterministic `size` (diffstat → S/M/L/XL, pure/tested) combined with an AI `risk` read via `verdict.ts` (pure/tested) → one of `quick_approve | careful_read | likely_changes | big_effort`. The renderer lazy-loads a verdict per visible needs-review PR **once per session** (a `useRef` set guards against refetch storms; a null result is not retried).
- **Structured output** uses `output_config: { effort, format: { type: 'json_schema', schema } }` and prompt-caches the system prompt (`cache_control: ephemeral`). The SDK's typed surface doesn't yet cover `output_config`/`cache_control` in all positions, so those `messages.create` calls carry intentional `as any` casts — keep them.
- **Model id is a single constant** `AI_MODEL = 'claude-opus-4-8'` in `ai/client.ts`. Don't scatter model strings. Use the `claude-api` skill when touching SDK code.
- `size`/`verdict`/`anchor-findings` and `github/parse-diff-anchors`/`post-review` (builder + error classifier) are TDD'd; the Claude calls (`triage`/`digest`/`review`) are glue (manual smoke test). Secret removal exists (Settings → Connections → Reset credentials, which clears the token AND the AI key); in-place key *rotation* is still overwrite-only.

## Conventions & patterns

- **Test pure logic, not glue.** Normalizers (`normalize-prs`, `pr-state`, `enrich-state`), filters (`filter-events`), diffing (`derive-events`, `notifier`), store helpers (`event-store`, `hidden-store`, `history-store`), and the pure renderer helpers (`pr-status`, `sort-prs`, `snooze`, `selection`, `activity-severity`, `tray-label`, `ai/size`, `ai/verdict`, `trend-metrics`) are TDD'd with Vitest. Electron/SDK-glue files (`index.ts`, `poller.ts`, `client.ts`, `ai/*` calls, `fetch-diff`, tray wiring) have no unit tests — they're validated by the manual smoke test. New pure logic should follow TDD.
- **Component tests** use React Testing Library; mock `window.api` in `beforeEach`.
- Keep files small and single-purpose; pure functions take `any` GraphQL/REST input and return typed shapes.
- **Adding a `FeedEventKind`** means updating four exhaustive `Record<FeedEventKind, …>` maps (`notifier.titleFor`, `activity-feed.tsx`'s `ACTION`, `event-icon.tsx`'s `KIND_ICON`, `lib/activity-severity`) — typecheck enforces this.

## Gotchas / caveats (non-obvious)

- **`@shared` alias must be configured per build target.** `electron.vite.config.ts` sets the `@shared` → `src/shared` alias separately for `main`, `preload`, AND `renderer`. Forgetting one builds fine in typecheck/test but fails `pnpm run build` for that process. (preload uses a relative `../shared/types` import instead.)
- **`renderer/src/api.ts` is a lazy `Proxy` over `window.api`**, not `export const api = window.api`. The eager form captures `window.api` at module-load (undefined in jsdom tests, since there's no preload). Components may import `api` and call it; the proxy reads `window.api` at call time so tests can set it in `beforeEach`.
- **Event windows can drop events under burst.** `derive-events` diffs the trailing `reviews(last:50)`/`comments(last:20)` windows (`queries.ts`) by id set-difference. An item pushed out of its window before a poll observes it is never surfaced — a deliberate v1 tradeoff (documented in `queries.ts`). To fix robustly, persist a per-PR last-seen timestamp and emit items newer than it.
- **The dashboard GraphQL query has a complexity budget — every search alias is expensive.** Each `search(first:N) { …PR_FIELDS }` block pulls deep nested connections (reviews/comments/reviewThreads/check-contexts) per PR. Two heavy aliases (needsReview+mine) is fine; a third full-cost one tripped GitHub's **secondary** rate limit (a query-complexity/CPU limiter, distinct from the hourly point budget) and surfaced as `SecondaryRateLimit detected` + a downstream `Cannot read properties of undefined (reading 'mine')` crash. That's why the team search uses the lean `TEAM_PR_FIELDS` (no comment-body window, trimmed connections, `first:50`) and collapses to a single alias (all owners + labels OR'd into one query). If you add fields/aliases, watch the cost. `createClient` (`github/client.ts`) configures the throttling plugin's `onRateLimit`/`onSecondaryRateLimit` to log clearly and return `false` (no in-request retry — the adaptive poll loop backs off instead). `poller.refresh` also guards `if (!data) throw` so an empty/limited response degrades cleanly rather than throwing a TypeError.
- **`isSafeExternalUrl`** gates `shell.openExternal` to http(s) only — keep that guard on any new external-link path. As defense in depth, `createWindow` (`index.ts`) also installs `setWindowOpenHandler` + a `will-navigate` guard so stray in-window navigation / `window.open` can't load remote content into the privileged window; route any new external-link path through the same gate.
- **Notification baseline is gated by a `baselineSeeded` flag in `index.ts`, NOT by `lastSnapshot === null`.** `lastSnapshot` is pre-seeded from the disk cache for the renderer, so it's non-null before the first live poll; the first successful poll (and the first poll after `saveToken`) seeds silently and fires nothing. `diffSnapshots` itself still returns `[]` when `prev` is null, and caps emitted notifications at 5.
- **`markRead`/`markAllRead` IPC handlers re-apply `filterEvents`** before returning, because the `event-store` holds the full unfiltered set but the renderer only ever shows the filtered feed — otherwise reading an event would resurface hidden bot/excluded-author events.
- **CSP** in `renderer/index.html` only allows images from `*.githubusercontent.com` and locks down `base-uri`/`form-action`/`object-src`/`frame-ancestors`; adding new remote resources means updating it. The renderer makes no network calls (all GitHub + Anthropic I/O is in main), so don't add a remote `connect-src`.
- **`validateToken` classifies failures; don't treat a failed validation as a bad token.** It returns `{ ok: true, login, … }` or `{ ok: false, reason: 'auth' | 'rate_limit' | 'network', message }` (via `classifyTokenError` in `github/rate-limit.ts`, pure/tested). The startup path in `index.ts` only `clearToken()`s on `reason === 'auth'` — on `rate_limit`/`network` it KEEPS the token and starts polling (the adaptive loop recovers at reset). The GraphQL budget is per-user/shared across all PATs, so a rate-limited validation must never tell the user to regenerate the token. (Earlier bug: a bare `catch { return null }` reported every failure as "Token rejected" and wiped valid tokens on a rate-limited startup.)
- **Both secrets live only in main.** The GitHub PAT (`token-store`) and Anthropic key (`ai/key-store`) are encrypted via `safeStorage` and never imported by the renderer/preload. `saveToken`/`saveAiKey` only accept the secret inward and return `{ ok, … }` — never the secret. The typed IPC results (`DashboardSnapshot`, `TriageVerdict`, `DigestResult`, `ReviewResult`, `AiStatus`) carry no key material. Keep it that way.
- **All per-row actions live in one kebab (⋮) menu** (`RowActions` in `components/pr-table/row-actions.tsx`, a shadcn `DropdownMenu`), reused by every PR panel via `PrTable` — hide/unhide/snooze/copy/pre-review. Add new row actions there, not as inline buttons. Component tests open the kebab (`getByRole('button', { name: /row actions/i })`) then click a `role="menuitem"` (shadcn `DropdownMenuItem` renders `role="menuitem"`).
- **Tailwind v4: the bare `border` utility defaults its COLOR to `currentColor`** — i.e. the near-white `--foreground` in dark mode. The `@layer base { * { border-color: var(--border) } }` rule in `styles/tailwind.css` is what makes every card/panel/table border render as the subtle `--border` token instead of a harsh full-opacity white outline. **Don't remove it** (omitting it was the original "everything has a white border" bug). The same applies to any new bordered element — rely on this default or set `border-<token>` explicitly; never assume `border` alone is subtle.
- **Renderer color comes from tokens, not hex.** Semantic meaning (severity / CI / status / triage) goes through `--sev-{info,success,failure,mention,effort}` (defined for light AND dark, mapped under `@theme inline`). Use `Chip` or the `text-sev-*` / `bg-sev-*` / `border-l-sev-*` utilities; don't hardcode colors. shadcn surface/border/ring tokens (`bg-card`, `bg-background`, `border`, `ring`) carry the elevation — `bg-card` is a step lighter than `bg-background`, which is the real panel separator.
- **Theme is renderer-only.** `ThemeProvider` (localStorage `githud-theme`, default dark) toggles `.dark` on `<html>` — it does NOT touch `Settings`/shared types, so the IPC contract is unaffected. `index.html` ships `<html class="dark">` so the first paint is dark.

## Scope discipline (YAGNI)

v1 is read-only and single-account. **Built** (was deferred): tray icon + dock
badge + launch-at-login; keyboard nav + command palette; the opt-in AI layer.
**Built (deliberate write exception):** starting a single PENDING (draft) PR
review (inline line comments ONLY — no summary body) from the **Draft review**
flow on needs-review PRs — the app's ONLY write path; otherwise still read-only.
The app never submits a verdict (Comment/Approve/Request-changes) and never posts
a body: it creates the review with no `event` and no body, so it stays a draft
the user finishes & submits on github.com. The AI `recommendation`/`assessment`
and any un-anchored findings are dashboard-only and never leave the app.
Generation and starting the draft are on-demand only (never on the poll loop).
Local macOS code signing exists for one reason: `safeStorage`'s Keychain ACL is
bound to the app's signature, so unsigned/ad-hoc rebuilds re-prompt for the
password. `build/make-signing-cert.sh` (`pnpm run signing:cert`) makes a stable
self-signed identity and `pnpm run package:signed` signs with it (via
`CSC_NAME`/`CSC_IDENTITY_AUTO_DISCOVERY=false` — kept OUT of the shared
`build` config so CI's plain `electron-builder` stays unsigned). Still deferred
(don't add without a reason): per-repo watch lists, GitHub Enterprise /
multi-account, assigned-issues panel, auto-update; distribution signing /
notarization (Developer ID, Gatekeeper) beyond the local self-signed convenience.
AI backlog: an in-place key-rotation UI (removal already exists), and secondary helpers (thread
TL;DR, mention triage, standup generator).
