# Renderer Refactor & Redesign — shadcn/ui + recharts

**Date:** 2026-06-03
**Status:** Approved (design)
**Scope:** `src/renderer/**` only. `src/shared/**` and `src/main/**` are untouched.

## Goal

Rebuild the renderer presentation layer on a real UI kit — **Tailwind v4 +
shadcn/ui** (Zinc neutral base, light+dark toggle) and **recharts** — and clean
the renderer up so it is DRY, composed from shared components, and easy to
reason about. **No functional change.** Same panels, same data, same
behaviors.

Chosen direction (from brainstorming): a **shadcn refresh** — stays dark-capable
and information-dense with the same information architecture, adopting shadcn's
design language (card surfaces, softer borders, refined neutral palette, tighter
type). Not a faithful 1:1 port, not a layout redesign.

## Guardrails (acceptance bar)

- `src/shared/**` (the `DashboardSnapshot` / `window.api` contract) and
  `src/main/**` are **not modified**. The fixed IPC seam is what we build the
  new UI against.
- Every pure-logic helper and its Vitest suite is preserved unchanged:
  `sort-prs`, `snooze`, `match`, `pr-status`, `trend-metrics`, `team-filter`,
  `selection`, `activity-severity`, and all of `main/`.
- Behavior parity is the bar: needs-review / team / mine / recap / activity
  panels; sort, label-filter, hide/unhide/snooze, AI triage chips + pre-review,
  catch-me-up + delta digest, j/k/Enter/e keyboard nav, ⌘K command palette,
  settings (token, AI key, notify kinds, quiet hours, intervals, team
  labels/orgs, charts collapse), trend strip + collapse, top-bar status +
  refresh interval.
- Definition of done: `pnpm test`, `pnpm run typecheck`, and `pnpm run build`
  all green, plus a manual smoke pass.

## Stack & infrastructure

Add dependencies: `tailwindcss`, `@tailwindcss/vite`, `class-variance-authority`,
`clsx`, `tailwind-merge`, `lucide-react`, `recharts`, plus the Radix primitives
shadcn pulls in per component.

- `electron.vite.config.ts`: register the Tailwind Vite plugin and add a `@` →
  `src/renderer/src` alias **to the `renderer` build target only**, alongside
  the existing `@shared`. Mirror `@` in `tsconfig`. (This is the documented
  per-target-alias footgun — set it for the right target.)
- `components.json` configures the shadcn CLI; generated components live in
  `src/renderer/src/components/ui/`.
- `styles.css` (407 lines, hand-rolled GitHub-dark theme) is replaced by a
  Tailwind entry (`@import "tailwindcss"` + the `@theme` / `:root` / `.dark`
  token blocks) and deleted once migration completes.

## Theme system

- **Zinc** neutral base for surfaces/borders/text.
- The semantic colors that carry *meaning* (blue/green/red/amber for activity
  severity, CI check state, PR status tags, triage labels) become named
  CSS-variable tokens (e.g. `--severity-failure`, `--status-ready`,
  `--triage-careful`) defined for **both** light and dark themes. This
  centralizes color (no hex scattered across CSS) and preserves color-coding
  across the theme switch.
- Light+dark via shadcn's `ThemeProvider` pattern: it toggles the `.dark` class
  on `<html>`, persisted in `localStorage` as `light | dark | system`. This
  keeps the toggle **renderer-only — no change to `Settings`/shared types.** The
  toggle control lives in the Settings modal (Appearance) with a quick toggle in
  the TopBar.

## Shared component layer (the DRY win)

Today `App.tsx` repeats the panel-header pattern (heading + count badge + spacer
+ `ShowHiddenToggle`/label chips) four times, and the two PR tables duplicate
table scaffolding.

- **`<Panel>`** — card shell with a sticky header (title, count badge,
  header-actions slot), scrollable body, and loading/empty handling. Every
  section renders through it (Needs-review, Team, Mine, Recap, Activity). Built
  on shadcn `Card`.
- **`<PrTable>`** — one configurable table (columns as config) used by both PR
  panels, replacing the near-duplicate `NeedsReviewTable` / `MyPullRequestsTable`
  bodies. Shared cells (`PrTitleCell`, `DiffStat`, `StatusCell`, `AgeCell`,
  `ReviewersCell`, `TriageChip`) keep their behavior, re-skinned with shadcn
  `Table` / `Badge`.
- **`<RowActions>`** → shadcn `DropdownMenu` (Radix provides outside-click/Esc/
  focus management for free, replacing the hand-rolled effect).
- **`<Chip variant=…>`** — one `cva`-driven chip for status / triage / severity,
  fed by the semantic tokens (replaces the `.triage-*` / `.status-*` / `.st-*`
  CSS families).

## Component mapping (bespoke → kit)

| Today | Becomes |
|---|---|
| `inputs.tsx`: `Toggle` / `Segmented` / `Slider` / `ChipInput` | shadcn `Switch` / `ToggleGroup` / `Slider` / a small composite over `Input` + `Badge` |
| Settings (custom overlay + nav rail) | shadcn `Dialog` + `Tabs` (or vertical nav), `Switch`, `Slider`, `Select` |
| `CommandPalette` (⌘K) | shadcn `Command` + `CommandDialog` (cmdk) |
| `Digest` / `ReviewPanel` modals | shadcn `Dialog` / `Sheet` |
| `TokenSetup`, buttons, link-buttons, badges | shadcn `Card` / `Input` / `Button` / `Badge` |
| `icons.tsx` glyphs | `lucide-react` (the `KIND_ICON` map stays an exhaustive `Record<FeedEventKind, …>`) |
| `EmptyState` | kept; re-skinned with a lucide icon |
| `ActivityFeed` rows | kept (severity left-border + icon + actor/action/subject); tokens instead of hex |

`react-markdown` stays for digest prose, re-skinned via Tailwind typography
utilities.

## Charts (recharts)

- `Sparkline` + `MiniBars` → recharts `LineChart` / `BarChart` as axis-less
  micro-charts inside the KPI cards.
- `chart-geometry.ts` and `chart-geometry.test.ts` are **deleted** — recharts
  owns the geometry.
- `trend-metrics.ts` is **untouched** (derives the series + deltas, pure);
  recharts only renders. `TrendStrip` keeps its 4-card layout and collapse.

## `App.tsx` orchestration tidy

Extract the state tangle from the 243-line component into focused hooks with
unchanged behavior:

- `useHideActions` — hide/unhide/snooze + `applySnapshot`.
- `useTriageVerdicts` — lazy per-PR verdict loading (the `useRef` request guard).
- `useKeyboardNav` — j/k/Enter/e selection + ⌘K palette open.
- `useReadState` — mark-read / mark-all-read + `applyEvents`.

`App.tsx` becomes thin composition over `<Panel>`s. Same handlers, relocated.

## Testing strategy

- Pure-logic suites stay green throughout (unchanged).
- Component tests (`PrTables`, `Settings`, `ActivityFeed`, `DigestPane`,
  `TrendStrip`, `TokenSetup`) are updated to the new markup, kept role/text-based
  (Radix is accessible, so most queries survive; class-based assertions are
  rewritten). `chart-geometry.test.ts` is removed.

## Risks / gotchas

- **CSP** (`renderer/index.html`): recharts sets inline SVG styles. Verify
  `style-src` covers the compiled Tailwind sheet and recharts; adjust minimally
  if needed. No new remote origins.
- **Per-target `@` alias** must be set for the renderer target specifically, or
  `pnpm run build` fails for that process while typecheck/test pass.
- **Radix portals** (Dialog/Dropdown/Command) render at `<body>`. Confirm they
  coexist with the `setWindowOpenHandler` / `will-navigate` guards; all external
  links keep routing through `api.openExternal` → `isSafeExternalUrl`.

## Sequencing

Big-bang on the renderer, landed as ordered commits on one branch so each step
builds and the app stays runnable from the first commit:

1. Infra + theme tokens (Tailwind, shadcn init, `@` alias, token CSS).
2. Shared primitives + `Panel` / `PrTable` / `Chip` / `RowActions`.
3. Migrate the PR panels & tables.
4. Settings / dialogs / command palette / token setup.
5. Charts (recharts).
6. Orchestration hooks; thin `App.tsx`.
7. Delete `styles.css` + dead files (`chart-geometry`, `inputs`, old icon glyphs).
8. `pnpm test` + `pnpm run typecheck` + `pnpm run build` green + manual smoke.

## Out of scope (YAGNI)

No changes to features, IPC, main, or shared types. No new panels or settings.
Light mode is the only net-new surface and was explicitly requested; it is
renderer-local. No GitHub Enterprise / multi-account / auto-update work.
