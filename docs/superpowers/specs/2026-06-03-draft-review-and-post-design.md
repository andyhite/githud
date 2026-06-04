# Draft Review — generate, edit, and post PR reviews in Andy's voice

_Design — 2026-06-03_

## Summary

Evolve the existing advisory pre-review (`getReview` → `ReviewPanel`, generic
voice, view-only) into a **draft-review-and-post** flow on **needs-review PRs
only**. The kebab "Pre-review (AI)" item becomes **"Draft review"**. It opens a
modal showing a review summary plus inline comments written in Andy Hite's
`andy-code-review` voice. The user edits any of them, toggles which inline
comments to include, picks the review event, and posts a **single** GitHub
review. Nothing is posted to GitHub without an explicit click.

This is the **first write path** in a deliberately read-only app. The scope
exception is intentional and user-requested; CLAUDE.md's scope-discipline
section will be updated to record it.

## Goals

- One-click generation of a full PR review (summary + inline comments) in the
  user's reviewing voice, on demand only (never on the poll loop).
- The reviewing voice/focus is **editable from Settings**, seeded from a
  vendored snapshot of the `andy-code-review` skill.
- Selectively edit the summary and each inline comment, choose which inline
  comments to include, and choose the review event (Comment / Approve /
  Request changes) before posting.
- Post reliably: every posted inline comment resolves to a real diff line so
  GitHub never rejects the whole review.
- Never post without explicit confirmation; never pre-select a binding event.

## Non-goals (v1)

- Persisting in-modal edits across modal close/reopen (edits are session-only;
  the cached generation is the model's original output).
- Multi-line (ranged) inline comments — single-line anchors only.
- Pre-validating the PAT's write scope (surfaced at post time instead).
- Draft review on the user's own PRs (needs-review only).
- Inline approve/comment/merge anywhere outside this review flow.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Post capability | **Full review events** — one PR review with summary body + selected inline comments; event selectable (Comment / Approve / Request changes), defaulting to Comment. |
| Relationship to existing pre-review | **Replace / evolve** it into this flow. No second review affordance. |
| Voice source | **Editable in Settings**, single combined Markdown doc, **seeded from a vendored snapshot** of `SKILL.md` + `voice-profile.md`. |
| Unanchorable line | **Best-effort nearest line** — snap to the nearest valid anchor in the same file; only fold into the summary when the file isn't in the diff at all. |

## Architecture

Three layers as today; the only new boundary crossing is the new write path
(`postReview`). All GitHub and Anthropic I/O stays in main.

### Voice instructions — editable, app-owned

- **`src/main/ai/review-instructions-default.ts`** (NEW) — the vendored default
  string: `andy-code-review` `SKILL.md` + `references/voice-profile.md`
  concatenated. Baked into the repo at author time; the plugin cache path is
  **never** read at runtime.
- **`src/main/ai/review-instructions-store.ts`** (NEW) — load/save the editable
  instructions to app data (fs glue, mirrors `settings-store`/`token-store`
  patterns). `load()` returns the saved text or the default when unset.
- IPC: `getReviewInstructions(): Promise<string>`,
  `saveReviewInstructions(text: string): Promise<void>`,
  `resetReviewInstructions(): Promise<string>` (writes + returns the default).
- The loaded text is the **system prompt** for the review call, prompt-cached
  via `cache_control: { type: 'ephemeral' }` like the other AI calls.

### Generation — on-demand, cached

- **`src/main/ai/review.ts`** (REWRITE) — system prompt = the editable
  instructions. Produces a summary in the "approve-with-notes" style plus
  findings `{ severity, file, line, side?, note }` in voice. Uses
  `output_config` + `json_schema` + prompt caching (keep the existing
  `as any` casts — the SDK surface still doesn't cover these).
- Result cached on disk keyed by `${'review'}:${prId}:${headKey}`
  (`headKey = pr.updatedAt`) exactly as today. Opening the modal reuses the
  cache; **Regenerate** forces a fresh call. Generation runs only on modal open
  or Regenerate — `poller.ts` keeps no AI imports.

### Anchoring — the load-bearing correctness piece

GitHub's create-review endpoint **422s the entire review** if any inline
comment's line is not part of the diff. So every posted inline comment must
resolve to a true anchor before posting.

- **`src/main/github/parse-diff-anchors.ts`** (NEW, pure, TDD) — parse the
  unified-diff patch (already fetched by `fetch-diff.ts`) into per-file valid
  anchors `{ line, side }` (`RIGHT` for added/context lines on the new side;
  `LEFT` for deleted lines). Output keyed by file path.
- **`src/main/ai/anchor-findings.ts`** (NEW, pure, TDD) — best-effort nearest
  line: for each finding, snap to the nearest valid anchor in the **same file**
  (tie-break toward the smaller line number; prefer `RIGHT` when both sides tie).
  If the file is not in the diff at all, the finding cannot be snapped → mark it
  `anchored: false` so it folds into the summary body. Returns findings enriched
  with `resolvedLine`, `resolvedSide`, `anchored`, and `snappedFrom` (the
  original line when it differs from `resolvedLine`).

### The modal (`src/renderer/src/components/ReviewPanel.tsx`, REWRITE)

- Editable summary `Textarea` (seeded from the model summary; folded-in
  unanchored notes are appended on generation).
- Per finding row: **include checkbox** (default on) · severity `Chip` ·
  editable note `Textarea` · an anchor line showing where it lands:
  - `→ file.ts:42` when anchored cleanly,
  - `→ file.ts:42 (snapped from :40)` when nearest-line snapping moved it,
  - `folded into summary` when the file isn't in the diff.
  A nearest-line snap is **never silent** — the destination is always visible.
- **Event** `ToggleGroup`: Comment / Approve / Request changes — **defaults to
  Comment** every render; binding events are never pre-selected.
- Footer: **Regenerate** · Cancel · **Post review**.
- Edits live in modal/component state for the session only.
- On post success: close (and surface the created review URL). On failure:
  show the classified message inline (see posting).

### Posting — the write path

- **`src/main/github/post-review.ts`** (NEW, glue) wrapping two **pure, TDD**
  helpers:
  - `buildReviewRequest(payload)` — assemble the
    `POST /repos/{owner}/{repo}/pulls/{n}/reviews` body: `{ body, event,
    comments: [{ path, line, side, body }] }` from the selected, anchored
    findings + edited summary + chosen event.
  - `classifyPostError(err)` — map Octokit errors to
    `'forbidden' | 'auth' | 'network' | 'unprocessable' | 'unknown'` with a
    user-facing message.
- IPC `postReview(prId, payload): Promise<{ ok: true; url: string } | { ok:
  false; kind: ...; message: string }>`. Looks up the PR in the last snapshot
  (needs-review), splits `repo` into owner/name, posts via the poller's
  Octokit.
- **Write scope:** posting needs classic `repo` or fine-grained **Pull
  requests: Read & write**. The token is likely read-only; we do **not**
  pre-validate scope. A 403 is classified `forbidden` with a specific message
  telling the user the PAT lacks PR-write and how to fix it.

## Data flow

1. User opens kebab on a needs-review PR → **Draft review** → modal mounts.
2. Renderer calls `getReview(prId)`. Main: load instructions → cache hit returns
   the stored draft; else `fetchPrDiff` → `parse-diff-anchors` →
   `reviewPr(instructions, …)` → `anchor-findings` → cache + return.
3. Modal renders summary + anchored findings; user edits / toggles / picks event.
4. **Post review** → `postReview(prId, payload)` → `buildReviewRequest` →
   Octokit create-review → success URL or classified error.
5. Generation and posting are **never** on the poll loop.

## Types (`src/shared/types.ts`)

- Extend `ReviewFinding`: add `side?: 'LEFT' | 'RIGHT'`, `resolvedLine?: number`,
  `resolvedSide?: 'LEFT' | 'RIGHT'`, `anchored?: boolean`, `snappedFrom?: number`.
- `ReviewResult` unchanged in shape (`prId`, `headOid`, `summary`, `findings`,
  `generatedAt`) — findings now carry the anchor fields.
- New `PostReviewPayload { body: string; event: 'COMMENT' | 'APPROVE' |
  'REQUEST_CHANGES'; comments: { path: string; line: number; side: 'LEFT' |
  'RIGHT'; body: string }[] }`.
- New `PostReviewResult` union (`{ ok: true; url } | { ok: false; kind;
  message }`).
- `GithudApi` gains: `postReview`, `getReviewInstructions`,
  `saveReviewInstructions`, `resetReviewInstructions`. (`getReview` retained,
  evolved.)

## UI surfaces

- **`RowActions.tsx`** — rename "Pre-review (AI)" → "Draft review"; gate it to
  needs-review (a `canReview`/`showReview` prop threaded through `PrTable`, set
  only for the needs-review panel). My-open-PRs no longer offers it.
- **`Settings.tsx`** — new **Review** tab: Markdown `Textarea` for the
  instructions + **Reset to default** + Save (loads on open via
  `getReviewInstructions`).
- **`ui/textarea.tsx`** (NEW) — vendored shadcn `textarea` primitive (not
  currently present); used by the modal and Settings.

## Testing

Pure logic is TDD'd with Vitest (per project convention):

- `parse-diff-anchors.test.ts` — multi-file patches, added/deleted/context
  lines, side assignment, files with no hunks.
- `anchor-findings.test.ts` — exact-line hit, nearest-line snap (and `snappedFrom`),
  tie-breaking, file-not-in-diff → `anchored:false`/folded.
- `buildReviewRequest.test.ts` — only included + anchored findings become inline
  comments; summary carries folded notes; event passthrough.
- `classifyPostError.test.ts` — 403→forbidden, 401→auth, network, 422→unprocessable.

Glue (`review.ts` Claude call, `post-review.ts` Octokit call,
`review-instructions-store.ts` fs, IPC handlers, modal) is validated by manual
smoke test, consistent with the existing AI layer.

## Gotchas to preserve

- Keep the `as any` casts on `messages.create` (`output_config`/`cache_control`).
- `AI_MODEL` stays the single constant in `ai/client.ts`.
- The `@shared` alias must be set for all three build targets if new shared
  imports are added.
- Renderer color via tokens/`Chip`, not hex; borders rely on the
  `--border` default.
- `isSafeExternalUrl` gate for opening the created-review URL externally.

## Scope-discipline update

CLAUDE.md's "Scope discipline (YAGNI)" section currently lists "inline
approve/comment/merge" as deferred and the app as read-only. Update it to record
that **posting PR reviews (summary + inline comments, event-selectable) is now a
deliberate, user-confirmed write exception**, scoped to the draft-review flow on
needs-review PRs. Everything else stays read-only.
