# Settings redesign — design

## Problem

The Settings modal (`src/renderer/src/components/Settings.tsx`) is a single
420px-wide card with ~12 stacked field groups (notifications toggle, 10
notify-kinds, quiet hours, launch-at-login, stale threshold, refresh interval,
API budget, excluded authors, team labels, team orgs, GitHub token, Anthropic
key). It scrolls long, mixes unrelated concerns, and uses plain checkboxes +
comma-separated text inputs + raw number fields throughout.

## Goal

A larger, sectioned settings window with a vertical nav rail and upgraded
inputs — without changing the `Settings` type, IPC contract, or save semantics.

## Layout

- **~760×560px centered modal**, backdrop preserved (reuse `.settings-overlay`).
- **Vertical sidebar nav** on the left listing sections; scrollable content
  pane on the right for the active section.
- **Footer** with Cancel / Save pinned at the bottom of the content pane so it
  is always reachable regardless of section length.
- Active section is local `useState`, default `"general"`.
- Escape / Cancel / Save behavior unchanged from today.

## Sections (4)

| Section | Fields |
|---|---|
| **General** | Refresh interval (segmented presets 30s / 60s / 2m / 5m, falls back to showing a custom value), API budget % (slider with live readout), Stale threshold days (number), Launch at login (toggle) |
| **Notifications** | Enable notifications (master toggle) gating a 2-column checkbox grid of the 10 notify-kinds + Quiet hours (toggle + time range) |
| **Filters & Team** | Excluded authors (chips), Team PR labels (chips), Team orgs (chips) |
| **Connections** | GitHub token (password, "connected as @x"), Anthropic key (password, "configured"), with their inline error messages |

## New input components

Small, reusable, colocated in the renderer (own files or within Settings as the
codebase prefers; keep each single-purpose):

- **`Toggle`** — accessible sliding switch (`role="switch"`), props `checked` +
  `onChange` + a label. Replaces checkboxes for the binary settings
  (notifications master, launch-at-login, quiet-hours). The 10 notify-kinds stay
  as a checkbox grid (clearer for a multi-select list than 10 switches).
- **`ChipInput`** — array editor: add on Enter/comma, remove via ✕ or Backspace
  on empty. Holds `string[]` directly, so the comma-string state
  (`authorsText` / `teamLabelsText` / `teamOrgsText`) and the split/trim/filter
  logic in `save()` are removed. Keeps a `<label>` association so each remains
  findable by accessible name.
- **`Slider`** — `<input type="range">` with a numeric value readout, for API
  budget %.
- **`Segmented`** — preset buttons for the refresh interval; if the stored value
  is not one of the presets, render it as a selected custom value (no data loss
  for hand-edited configs).

## Data flow / contract

No change to `Settings` (`src/shared/types.ts`), `GithudApi`, or the IPC
handlers. `save()` keeps the same flow: validate + persist a new GitHub token
first (bail and show error on rejection, keep panel open), then
`saveSettings({...})`, then `saveAiKey` if entered. The only internal change is
that list fields are held as `string[]` in state instead of comma strings.

## Testing

Rewrite `Settings.test.tsx` (TDD) against the new structure:

- Each test first clicks into the section tab that owns the field under test
  (General / Notifications / Filters & Team / Connections), since inactive
  sections are not rendered.
- Chip / toggle / slider / segmented interactions get their own assertions
  (e.g. adding/removing an author chip, flipping a toggle, dragging the budget
  slider via `fireEvent.change`, selecting an interval preset).
- Same `window.api` mock shape in `beforeEach`.
- Preserve the existing behavioral assertions: token-rejection keeps the panel
  open and skips `saveSettings`; save persists the expected
  `excludedAuthors` / `teamLabels` / `refreshIntervalSeconds` / `apiBudgetPercent`
  / `notifyKinds` / `quietHours` / `launchAtLogin` values.
- If a pure chip-parsing helper emerges, it gets its own unit test.

## CSS

New rules in `styles.css` reusing existing tokens (`--blue`, `--border`,
`--panel`, `--muted`, etc.):

- `.settings-panel` widened to the new size; internal grid for rail + pane.
- `.settings-nav` (rail) with active-item styling.
- `.settings-section` + scroll; `.settings-footer` pinned actions.
- `.toggle`, `.chip-input` (+ `.chip`), `.slider`, `.segmented`.
- Keep the existing `.settings-panel input[type=...]` rule covering every input
  type still used (text/number/password/range/time) so fields render styled.

## Out of scope (YAGNI)

- No new persisted settings or IPC. No key-rotation UI (still overwrite-only).
- No change to the token-setup-first-run flow (`TokenSetup.tsx`).
