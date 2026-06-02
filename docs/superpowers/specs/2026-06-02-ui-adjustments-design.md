# githud UI Adjustments — Design

Date: 2026-06-02

Four focused UI improvements. No new dependencies. The only logic change is a
pure tweak to activity normalization; everything else is presentation.

## 1. Notifications scrollbar + no horizontal scroll

File: `src/renderer/src/styles.css`

- Thin, theme-matched custom scrollbar on scroll containers (`.rail`, `.tables`):
  8px width, transparent track, `var(--border)` thumb brightening to
  `var(--muted)` on hover. Add `scrollbar-width: thin` and
  `scrollbar-color: var(--border) transparent` for completeness.
- Eliminate horizontal overflow: `.rail { overflow-x: hidden }` and
  `overflow-wrap: anywhere` on activity text so long unbroken tokens/URLs wrap
  instead of widening the panel. (`box-sizing: border-box` is already global.)

## 2. Notifications content behavior

Files: `src/main/github/normalize-activity.ts`, `src/renderer/src/components/ActivityFeed.tsx`,
new `src/renderer/src/components/icons.tsx`, `src/renderer/src/styles.css`

- **Comment vs. description distinction (core logic, TDD'd):** in
  `normalizeActivity`, only attach `latestComment` when
  `subject.latest_comment_url !== subject.url`. When equal, the "latest comment"
  is really the PR/issue body → drop it. Result: PR/issue *descriptions* never
  show in the feed; real *comments* do.
- **Clamp + "…more":** comment bodies render as plain text, clamped to 4 lines
  via `-webkit-line-clamp`. A `useLayoutEffect` measures overflow
  (`scrollHeight > clientHeight`); if overflowing, show a `…more`/`less` toggle
  driven by local state. No markdown renderer added.
- **Octicons:** new `icons.tsx` module holding real GitHub Octicon SVG paths
  (PullRequest, Issue, Comment, Commit, Release/Discussion, mention/fallback).
  `iconFor(item)` selects by `subjectType`, with `reason === 'mention'`
  refinement. Icon renders at the left of each entry.
- **Markup change:** convert `.activity-item` from `<button>` to
  `<div role="button" tabIndex={0}>` with an Enter/Space keydown handler that
  opens the URL, so the inner `…more` `<button>` is not nested inside a button.
  The `…more` button calls `stopPropagation`.

## 3. Font sizes (readability pass)

File: `src/renderer/src/styles.css`

- Base `body` 13px → 14.5px; line-height 1.4 → 1.5.
- Proportional bumps: table headers 10→11px; repo subtitles / badges /
  `.activity-head` 11→12px; panel `h2` 13→15px. Not a redesign.

## 4. Reviewers column

Files: `src/renderer/src/components/NeedsReviewTable.tsx`,
`src/renderer/src/components/MyPullRequestsTable.tsx`, `src/renderer/src/styles.css`

- New **Reviewers** column in both tables, rendering `pr.reviewers` as small
  `@login` chips that wrap; muted `—` when none.
- Column order — NeedsReview: `PR · Author · Reviewers · Checks · Age`;
  MyPRs: `PR · Status · Reviewers · Checks · Age`.

## Testing

- New `normalize-activity` cases: comment attached when
  `latest_comment_url !== subject.url`; dropped when equal.
- Update `ActivityFeed.test.tsx` (button → `role="button"` div) and
  `PrTables.test.tsx` (new Reviewers column).
- Overflow-measurement glue left untested per "test pure logic, not glue".

## Scope / non-goals

No new dependencies (react-markdown explicitly dropped). No changes to the
main↔renderer contract beyond the existing `latestComment` field's population
rule. Read-only, single-account scope unchanged.
