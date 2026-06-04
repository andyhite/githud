# Draft Review and Post Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user generate an AI PR review (summary + inline comments) in their `andy-code-review` voice on needs-review PRs, edit it in a modal, choose the event, and post a single review to GitHub — never auto-posting.

**Architecture:** Evolve the existing on-demand `getReview` → `ReviewPanel` advisory flow into an editable, postable draft. The reviewing voice is an editable, app-owned Markdown doc (seeded from a vendored snapshot of the skill) used as the system prompt. Inline comments are anchored to real diff lines (pure diff-parsing + nearest-line snapping) so GitHub never rejects the review. Posting is the app's first write path, gated entirely behind an explicit "Post review" click.

**Tech Stack:** Electron (main/preload/renderer), TypeScript, React, `@anthropic-ai/sdk`, Octokit, shadcn/ui, Vitest.

---

## Reference: existing patterns this plan follows

- AI Claude call shape: `src/main/ai/triage.ts` / `src/main/ai/review.ts` (`messages.create` with `output_config` + `cache_control`, the intentional `as any` casts, `AI_MODEL` from `ai/client.ts`).
- On-disk cache: `src/main/ai/cache.ts` (`cacheKey('review', prId, headKey)`, `loadCache`/`saveCache`), keyed by `headKey = pr.updatedAt`.
- fs store pattern: `src/main/settings-store.ts`, `src/main/ai/key-store.ts`, `src/main/paths.ts`.
- IPC handler pattern + AI gating: `src/main/index.ts` (`getReview` at ~`447`, `getTriage`, `getDigest`), `poller.client` exposes the Octokit.
- Diff fetch: `src/main/github/fetch-diff.ts` (`fetchPrDiff` → `PrDiff.patch`).
- Renderer modal: `src/renderer/src/components/ReviewPanel.tsx`; trigger wiring `App.tsx:149,228`, `PrTable.tsx:89`, `RowActions.tsx:36-38`.
- Settings tabs: `src/renderer/src/components/Settings.tsx`.
- Pure-logic TDD convention: colocated `*.test.ts` next to the module (see existing `derive-events`, `verdict`, etc.).

## File structure (created / modified)

**Create:**
- `src/main/github/parse-diff-anchors.ts` (+ `.test.ts`) — pure: unified diff → valid anchor lines per file.
- `src/main/ai/anchor-findings.ts` (+ `.test.ts`) — pure: snap findings to nearest valid anchor / mark unanchored.
- `src/main/github/post-review.ts` (+ `.test.ts` for the pure helpers) — `buildReviewRequest` + `classifyPostError` (pure) and `postReview` (Octokit glue).
- `src/main/ai/review-instructions-default.ts` — vendored seed string (generated).
- `src/main/ai/review-instructions-store.ts` — load/save/reset the editable instructions (fs glue).
- `src/renderer/src/components/ui/textarea.tsx` — vendored shadcn primitive.

**Modify:**
- `src/shared/types.ts` — extend `ReviewFinding`; add `PostReviewPayload`, `PostReviewResult`; extend `GithudApi`.
- `src/main/paths.ts` — `reviewInstructionsFilePath()`.
- `src/main/ai/review.ts` — accept instructions as system prompt; emit `side`; richer findings.
- `src/main/index.ts` — evolve `getReview` (parse+anchor), add `postReview`, add 3 instructions handlers.
- `src/preload/index.ts` — wire the 4 new IPC methods.
- `src/renderer/src/components/ReviewPanel.tsx` — rewrite into editable draft+post modal.
- `src/renderer/src/components/Settings.tsx` — new "Review" tab with the instructions editor.
- `src/renderer/src/components/RowActions.tsx` — rename "Pre-review (AI)" → "Draft review".
- `CLAUDE.md` — record the write-path scope exception + new files.

---

## Task 1: Shared types

**Files:**
- Modify: `src/shared/types.ts` (`ReviewFinding` ~174, `ReviewResult` ~181, `GithudApi` ~194)

- [ ] **Step 1: Extend `ReviewFinding` and add post types**

Replace the existing `ReviewFinding` interface (lines ~174-179) with:

```typescript
export type ReviewSide = 'LEFT' | 'RIGHT'

export interface ReviewFinding {
  severity: 'note' | 'concern' | 'blocker'
  file: string
  line?: number
  side?: ReviewSide
  note: string
  // Filled by anchor-findings in main before the result reaches the renderer:
  resolvedLine?: number
  resolvedSide?: ReviewSide
  anchored?: boolean // false => no valid anchor in the diff; fold into summary
  snappedFrom?: number // set only when resolvedLine differs from the model's line
}
```

Add, after the `ReviewResult` interface (~187):

```typescript
export interface PostReviewComment {
  path: string
  line: number
  side: ReviewSide
  body: string
}

export interface PostReviewPayload {
  body: string
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
  comments: PostReviewComment[]
}

export type PostReviewResult =
  | { ok: true; url: string }
  | { ok: false; kind: 'forbidden' | 'auth' | 'network' | 'unprocessable' | 'unknown'; message: string }
```

- [ ] **Step 2: Extend `GithudApi`**

In the `GithudApi` interface, replace the `getReview` line (~221) with:

```typescript
  getReview(prId: string): Promise<ReviewResult>
  postReview(prId: string, payload: PostReviewPayload): Promise<PostReviewResult>
  getReviewInstructions(): Promise<string>
  saveReviewInstructions(text: string): Promise<void>
  resetReviewInstructions(): Promise<string>
```

- [ ] **Step 3: Verify typecheck still passes for the contract**

Run: `pnpm run typecheck`
Expected: PASS (no implementors yet reference the new methods — interface-only change compiles).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): review anchoring fields + post-review/instructions contract"
```

---

## Task 2: Parse diff anchors (pure, TDD)

**Files:**
- Create: `src/main/github/parse-diff-anchors.ts`
- Test: `src/main/github/parse-diff-anchors.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { parseDiffAnchors } from './parse-diff-anchors'

const PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1
-const y = 2
+const y = 3
+const z = 4
 const w = 5
diff --git a/src/new.ts b/src/new.ts
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const a = 1
+export const b = 2
`

describe('parseDiffAnchors', () => {
  it('maps added and context lines to RIGHT-side new line numbers', () => {
    const anchors = parseDiffAnchors(PATCH)
    // a.ts new side: line 1 (context), 2 (added y), 3 (added z), 4 (context w)
    const aRight = anchors['src/a.ts'].filter((x) => x.side === 'RIGHT').map((x) => x.line)
    expect(aRight).toEqual([1, 2, 3, 4])
  })

  it('maps deleted lines to LEFT-side old line numbers', () => {
    const anchors = parseDiffAnchors(PATCH)
    const aLeft = anchors['src/a.ts'].filter((x) => x.side === 'LEFT').map((x) => x.line)
    expect(aLeft).toEqual([2]) // "const y = 2" was old line 2
  })

  it('handles a new file (--- /dev/null)', () => {
    const anchors = parseDiffAnchors(PATCH)
    expect(anchors['src/new.ts'].filter((x) => x.side === 'RIGHT').map((x) => x.line)).toEqual([1, 2])
  })

  it('returns {} for an empty patch', () => {
    expect(parseDiffAnchors('')).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- parse-diff-anchors`
Expected: FAIL with "parseDiffAnchors is not a function" / module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { ReviewSide } from '@shared/types'

export interface DiffAnchor {
  line: number
  side: ReviewSide
}

// Parse a unified diff into the set of lines a GitHub review comment may anchor
// to, per file. Added/context lines anchor to the NEW line number on the RIGHT
// side; deleted lines anchor to the OLD line number on the LEFT side. Anything
// not in a hunk is not a valid anchor.
export function parseDiffAnchors(patch: string): Record<string, DiffAnchor[]> {
  const out: Record<string, DiffAnchor[]> = {}
  if (!patch) return out

  let file: string | null = null
  let oldLine = 0
  let newLine = 0
  const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).trim()
      file = path === '/dev/null' ? null : path.replace(/^b\//, '')
      if (file && !out[file]) out[file] = []
      continue
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git')) continue
    const m = raw.match(hunkHeader)
    if (m) {
      oldLine = Number(m[1])
      newLine = Number(m[2])
      continue
    }
    if (!file) continue
    const tag = raw[0]
    if (tag === '+') {
      out[file].push({ line: newLine, side: 'RIGHT' })
      newLine++
    } else if (tag === '-') {
      out[file].push({ line: oldLine, side: 'LEFT' })
      oldLine++
    } else if (tag === ' ') {
      out[file].push({ line: newLine, side: 'RIGHT' })
      oldLine++
      newLine++
    }
    // '\' (no newline at EOF) and any stray line: ignore
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- parse-diff-anchors`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/github/parse-diff-anchors.ts src/main/github/parse-diff-anchors.test.ts
git commit -m "feat(github): parse-diff-anchors (pure)"
```

---

## Task 3: Anchor findings to diff lines (pure, TDD)

**Files:**
- Create: `src/main/ai/anchor-findings.ts`
- Test: `src/main/ai/anchor-findings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { anchorFindings } from './anchor-findings'
import { ReviewFinding } from '@shared/types'

const ANCHORS = {
  'src/a.ts': [
    { line: 1, side: 'RIGHT' as const },
    { line: 2, side: 'RIGHT' as const },
    { line: 4, side: 'RIGHT' as const }
  ]
}

function f(p: Partial<ReviewFinding>): ReviewFinding {
  return { severity: 'note', file: 'src/a.ts', note: 'x', ...p }
}

describe('anchorFindings', () => {
  it('keeps an exact-line hit without snappedFrom', () => {
    const [r] = anchorFindings([f({ line: 2 })], ANCHORS)
    expect(r.anchored).toBe(true)
    expect(r.resolvedLine).toBe(2)
    expect(r.resolvedSide).toBe('RIGHT')
    expect(r.snappedFrom).toBeUndefined()
  })

  it('snaps to the nearest valid anchor and records snappedFrom', () => {
    const [r] = anchorFindings([f({ line: 3 })], ANCHORS)
    expect(r.anchored).toBe(true)
    expect(r.resolvedLine).toBe(2) // 3 is equidistant to 2 and 4; tie -> smaller line
    expect(r.snappedFrom).toBe(3)
  })

  it('snaps to the closest when not a tie', () => {
    const [r] = anchorFindings([f({ line: 5 })], ANCHORS)
    expect(r.resolvedLine).toBe(4)
    expect(r.snappedFrom).toBe(5)
  })

  it('marks anchored:false when the file is not in the diff', () => {
    const [r] = anchorFindings([f({ file: 'src/missing.ts', line: 2 })], ANCHORS)
    expect(r.anchored).toBe(false)
    expect(r.resolvedLine).toBeUndefined()
  })

  it('marks anchored:false when the finding has no line', () => {
    const [r] = anchorFindings([f({ line: undefined })], ANCHORS)
    expect(r.anchored).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- anchor-findings`
Expected: FAIL with "anchorFindings is not a function".

- [ ] **Step 3: Write the implementation**

```typescript
import { ReviewFinding } from '@shared/types'
import { DiffAnchor } from '../github/parse-diff-anchors'

// Best-effort nearest-line anchoring. For each finding with a line, snap to the
// nearest valid anchor in the SAME file (preferring the finding's side, else any
// side; ties break toward the smaller line number). Findings with no line or in
// a file absent from the diff are marked anchored:false so callers fold them
// into the review summary instead of posting an inline comment.
export function anchorFindings(
  findings: ReviewFinding[],
  anchorsByFile: Record<string, DiffAnchor[]>
): ReviewFinding[] {
  return findings.map((f) => {
    const anchors = anchorsByFile[f.file]
    if (!anchors || anchors.length === 0 || typeof f.line !== 'number') {
      return { ...f, anchored: false }
    }
    const wantSide = f.side ?? 'RIGHT'
    const sameSide = anchors.filter((a) => a.side === wantSide)
    const pool = sameSide.length > 0 ? sameSide : anchors

    let best = pool[0]
    let bestDist = Math.abs(best.line - f.line)
    for (const a of pool) {
      const d = Math.abs(a.line - f.line)
      if (d < bestDist || (d === bestDist && a.line < best.line)) {
        best = a
        bestDist = d
      }
    }
    return {
      ...f,
      anchored: true,
      resolvedLine: best.line,
      resolvedSide: best.side,
      snappedFrom: best.line === f.line ? undefined : f.line
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- anchor-findings`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/anchor-findings.ts src/main/ai/anchor-findings.test.ts
git commit -m "feat(ai): anchor-findings nearest-line snapping (pure)"
```

---

## Task 4: Post-review pure helpers (TDD)

**Files:**
- Create: `src/main/github/post-review.ts`
- Test: `src/main/github/post-review.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { buildReviewRequest, classifyPostError } from './post-review'

describe('buildReviewRequest', () => {
  it('shapes a create-review request and keeps valid inline comments', () => {
    const req = buildReviewRequest('me', 'repo', 7, {
      body: 'Overall nothing blocking.',
      event: 'COMMENT',
      comments: [{ path: 'a.ts', line: 4, side: 'RIGHT', body: 'Is there a reason we...?' }]
    })
    expect(req).toEqual({
      owner: 'me',
      repo: 'repo',
      pull_number: 7,
      body: 'Overall nothing blocking.',
      event: 'COMMENT',
      comments: [{ path: 'a.ts', line: 4, side: 'RIGHT', body: 'Is there a reason we...?' }]
    })
  })

  it('drops comments missing a numeric line', () => {
    const req = buildReviewRequest('me', 'repo', 7, {
      body: 's',
      event: 'COMMENT',
      comments: [
        { path: 'a.ts', line: 4, side: 'RIGHT', body: 'keep' },
        { path: 'b.ts', line: NaN as unknown as number, side: 'RIGHT', body: 'drop' }
      ]
    })
    expect(req.comments).toHaveLength(1)
    expect(req.comments[0].body).toBe('keep')
  })

  it('omits the comments key entirely when there are none', () => {
    const req = buildReviewRequest('me', 'repo', 7, { body: 's', event: 'APPROVE', comments: [] })
    expect('comments' in req).toBe(false)
  })
})

describe('classifyPostError', () => {
  it('classifies 403 as forbidden', () => {
    expect(classifyPostError({ status: 403 }).kind).toBe('forbidden')
  })
  it('classifies 401 as auth', () => {
    expect(classifyPostError({ status: 401 }).kind).toBe('auth')
  })
  it('classifies 422 as unprocessable', () => {
    expect(classifyPostError({ status: 422 }).kind).toBe('unprocessable')
  })
  it('classifies a network error', () => {
    expect(classifyPostError({ code: 'ENOTFOUND' }).kind).toBe('network')
  })
  it('falls back to unknown', () => {
    expect(classifyPostError({ status: 500 }).kind).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- post-review`
Expected: FAIL with "buildReviewRequest is not a function".

- [ ] **Step 3: Write the implementation**

```typescript
import { Octokit } from 'octokit'
import { PostReviewPayload, PostReviewResult } from '@shared/types'

export interface ReviewRequest {
  owner: string
  repo: string
  pull_number: number
  body: string
  event: PostReviewPayload['event']
  comments?: { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }[]
}

// Pure: turn the renderer's payload into the GitHub create-review request body.
// Drops any inline comment without a usable numeric line so a single bad anchor
// can't 422 the whole review; omits `comments` entirely when none remain.
export function buildReviewRequest(
  owner: string,
  repo: string,
  pull_number: number,
  payload: PostReviewPayload
): ReviewRequest {
  const comments = payload.comments.filter((c) => Number.isFinite(c.line))
  const req: ReviewRequest = { owner, repo, pull_number, body: payload.body, event: payload.event }
  if (comments.length > 0) {
    req.comments = comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body }))
  }
  return req
}

// Pure: map an Octokit/request error to a user-facing PostReviewResult failure.
export function classifyPostError(err: any): Extract<PostReviewResult, { ok: false }> {
  const status = err?.status
  if (status === 403)
    return { ok: false, kind: 'forbidden', message: 'This token lacks write access. Use a PAT with classic `repo` scope or fine-grained “Pull requests: Read & write”.' }
  if (status === 401)
    return { ok: false, kind: 'auth', message: 'GitHub rejected the token. Reconnect it in Settings → Connections.' }
  if (status === 422)
    return { ok: false, kind: 'unprocessable', message: `GitHub rejected the review: ${err?.message ?? 'unprocessable'}.` }
  if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' || /network|fetch failed/i.test(String(err?.message)))
    return { ok: false, kind: 'network', message: 'Network error reaching GitHub. Try again.' }
  return { ok: false, kind: 'unknown', message: String(err?.message ?? err) }
}

// Glue: post a single PR review. owner/repo split happens in the caller.
export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pull_number: number,
  payload: PostReviewPayload
): Promise<PostReviewResult> {
  try {
    const req = buildReviewRequest(owner, repo, pull_number, payload)
    const res: any = await octokit.request(
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      req
    )
    return { ok: true, url: res.data?.html_url ?? '' }
  } catch (err) {
    return classifyPostError(err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- post-review`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/github/post-review.ts src/main/github/post-review.test.ts
git commit -m "feat(github): post-review request builder + error classifier (pure) and Octokit glue"
```

---

## Task 5: Editable review instructions (vendored seed + store)

**Files:**
- Create: `src/main/ai/review-instructions-default.ts` (generated)
- Create: `src/main/ai/review-instructions-store.ts`
- Modify: `src/main/paths.ts`

- [ ] **Step 1: Generate the vendored default from the skill**

Run (one line; reads the two skill files on this machine and writes a TS module with the combined text as a JSON-escaped string literal):

```bash
node -e 'const fs=require("fs");const b="/Users/user/.claude-work/plugins/cache/andyhite-marketplace/andy-code-review/1.0.0/skills/andy-code-review";const skill=fs.readFileSync(b+"/SKILL.md","utf8");const voice=fs.readFileSync(b+"/references/voice-profile.md","utf8");const combined=skill+"\n\n---\n\n"+voice;const header="// Vendored snapshot of the andy-code-review skill (SKILL.md + references/voice-profile.md),\n// snapshotted 2026-06-03. This is only the SEED default; the live instructions are\n// editable in-app (Settings -> Review) and stored via review-instructions-store.\n// Re-snapshot by re-running the generator in docs/superpowers/plans/2026-06-03-draft-review-and-post.md.\n\n";fs.writeFileSync("src/main/ai/review-instructions-default.ts",header+"export const DEFAULT_REVIEW_INSTRUCTIONS = "+JSON.stringify(combined)+"\n");console.log("wrote",combined.length,"chars");'
```

Expected output: `wrote <N> chars` (N ≈ 13000+).

- [ ] **Step 2: Verify the generated file is valid TS**

Run: `pnpm run typecheck`
Expected: PASS (the file exports a single `const` string).

If the generator can't find the skill path on this machine, create `src/main/ai/review-instructions-default.ts` by hand: `export const DEFAULT_REVIEW_INSTRUCTIONS = ` followed by a JSON-stringified copy of the `andy-code-review` `SKILL.md` + `\n\n---\n\n` + `voice-profile.md` text.

- [ ] **Step 3: Add the file path**

In `src/main/paths.ts`, add after `aiCacheFilePath` (~30):

```typescript
export function reviewInstructionsFilePath(): string {
  return join(app.getPath('userData'), 'review-instructions.md')
}
```

- [ ] **Step 4: Write the store**

Create `src/main/ai/review-instructions-store.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { reviewInstructionsFilePath } from '../paths'
import { DEFAULT_REVIEW_INSTRUCTIONS } from './review-instructions-default'

// The live review-voice system prompt. App-owned and user-editable; falls back
// to the vendored snapshot of the andy-code-review skill until the user edits it.
export function loadReviewInstructions(): string {
  const path = reviewInstructionsFilePath()
  if (!existsSync(path)) return DEFAULT_REVIEW_INSTRUCTIONS
  try {
    const text = readFileSync(path, 'utf8')
    return text.trim() ? text : DEFAULT_REVIEW_INSTRUCTIONS
  } catch {
    return DEFAULT_REVIEW_INSTRUCTIONS
  }
}

export function saveReviewInstructions(text: string): void {
  writeFileSync(reviewInstructionsFilePath(), text)
}

// Reset to the vendored default by writing it back; returns the default text.
export function resetReviewInstructions(): string {
  writeFileSync(reviewInstructionsFilePath(), DEFAULT_REVIEW_INSTRUCTIONS)
  return DEFAULT_REVIEW_INSTRUCTIONS
}
```

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm run typecheck`
Expected: PASS.

```bash
git add src/main/ai/review-instructions-default.ts src/main/ai/review-instructions-store.ts src/main/paths.ts
git commit -m "feat(ai): vendored review-instructions seed + editable store"
```

---

## Task 6: Rewrite the review generator to use editable instructions and emit side

**Files:**
- Modify: `src/main/ai/review.ts`

- [ ] **Step 1: Rewrite `review.ts`**

Replace the whole file with:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { ReviewResult, ReviewFinding } from '@shared/types'
import { PrDiff } from '../github/fetch-diff'
import { AI_MODEL } from './client'

const TASK = `You are reviewing a pull request diff. Produce a PR-level review summary and a list of inline findings, each anchored to a file and a line in the diff. Adopt the reviewing voice, focus, and severity calibration described in the instructions above. Respond ONLY with the requested JSON.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: "PR-level review summary in the reviewer's voice" },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['note', 'concern', 'blocker'] },
          file: { type: 'string', description: 'path exactly as it appears in the diff' },
          line: { type: 'integer', description: 'line number in the new file (or old file for deletions)' },
          side: { type: 'string', enum: ['LEFT', 'RIGHT'], description: "RIGHT for added/changed lines, LEFT for deleted lines" },
          note: { type: 'string', description: "the inline comment, in the reviewer's voice" }
        },
        required: ['severity', 'file', 'note']
      }
    }
  },
  required: ['summary', 'findings']
} as const

// `instructions` is the editable review-voice system prompt (Settings -> Review).
export async function reviewPr(
  client: Anthropic,
  instructions: string,
  prId: string,
  headOid: string,
  title: string,
  diff: PrDiff,
  now: string
): Promise<ReviewResult> {
  const res: any = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: [
      { type: 'text', text: instructions, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: TASK }
    ],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `PR: ${title}\n\nDiff${diff.truncated ? ' (truncated)' : ''}:\n${diff.patch}` }]
  } as any)
  const textBlock = res.content.find((b: any) => b.type === 'text')
  const parsed = JSON.parse(textBlock?.text ?? '{}') as { summary: string; findings: ReviewFinding[] }
  return { prId, headOid, summary: parsed.summary ?? '', findings: parsed.findings ?? [], generatedAt: now }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: FAIL — `src/main/index.ts` still calls `reviewPr` with the old signature (no `instructions`). That's fixed in Task 7. (If you prefer a green checkpoint, do Task 7 before committing.)

- [ ] **Step 3: Commit (with Task 7)**

Defer the commit to the end of Task 7 so the build is green.

---

## Task 7: Main IPC — evolve `getReview`, add `postReview` + instructions handlers

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add imports**

Near the existing AI imports (~14-16), add:

```typescript
import { reviewPr } from './ai/review'
import { parseDiffAnchors } from './github/parse-diff-anchors'
import { anchorFindings } from './ai/anchor-findings'
import { postReview as postReviewToGithub } from './github/post-review'
import { loadReviewInstructions, saveReviewInstructions, resetReviewInstructions } from './ai/review-instructions-store'
```

Update the type-only import (~16) to include the new types:

```typescript
import type { TriageVerdict, ReviewResult, PostReviewPayload, PostReviewResult } from '@shared/types'
```

(Remove the now-duplicate `import { reviewPr } from './ai/review'` if one already exists at line ~14 — keep a single import.)

- [ ] **Step 2: Replace the `getReview` handler body**

Replace the existing `getReview` handler (~447-463) with one that parses + anchors. Note it is now needs-review only:

```typescript
  ipcMain.handle('getReview', async (_e, prId: string): Promise<ReviewResult> => {
    const key = loadAiKey()
    if (!key) throw new Error('No AI key configured')
    if (!lastSnapshot) throw new Error('No data yet')
    const pr = lastSnapshot.needsReview.find((p) => p.id === prId)
    if (!pr) throw new Error('PR not found')
    const headKey = pr.updatedAt
    const cache = loadCache()
    const cached = cache[cacheKey('review', prId, headKey)] as ReviewResult | undefined
    if (cached) return cached
    if (!ensurePoller() || !poller) throw new Error('No token configured')
    const diff = await fetchPrDiff(poller.client, pr.repo, pr.number)
    const raw = await reviewPr(createAiClient(key), loadReviewInstructions(), prId, headKey, pr.title, diff, new Date().toISOString())
    const anchors = parseDiffAnchors(diff.patch)
    const result: ReviewResult = { ...raw, findings: anchorFindings(raw.findings, anchors) }
    cache[cacheKey('review', prId, headKey)] = result
    saveCache(cache)
    return result
  })
```

- [ ] **Step 3: Add the `postReview` handler**

Immediately after the `getReview` handler, add:

```typescript
  ipcMain.handle('postReview', async (_e, prId: string, payload: PostReviewPayload): Promise<PostReviewResult> => {
    if (!lastSnapshot) return { ok: false, kind: 'unknown', message: 'No data yet' }
    const pr = lastSnapshot.needsReview.find((p) => p.id === prId)
    if (!pr) return { ok: false, kind: 'unknown', message: 'PR not found' }
    if (!ensurePoller() || !poller) return { ok: false, kind: 'auth', message: 'No token configured' }
    const [owner, name] = pr.repo.split('/')
    return postReviewToGithub(poller.client, owner, name, pr.number, payload)
  })
```

- [ ] **Step 4: Add the instructions handlers**

After `postReview`, add:

```typescript
  ipcMain.handle('getReviewInstructions', async (): Promise<string> => loadReviewInstructions())
  ipcMain.handle('saveReviewInstructions', async (_e, text: string): Promise<void> => { saveReviewInstructions(text) })
  ipcMain.handle('resetReviewInstructions', async (): Promise<string> => resetReviewInstructions())
```

- [ ] **Step 5: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS (renderer/preload still missing the new methods is fine — `GithudApi` is implemented in preload next; main handlers don't need the renderer side. If typecheck flags preload's `api` object missing methods, that's resolved in Task 8 — run typecheck again after Task 8.)

- [ ] **Step 6: Commit (closes Task 6 + 7)**

```bash
git add src/main/ai/review.ts src/main/index.ts
git commit -m "feat(main): generate anchored reviews, post reviews, edit instructions over IPC"
```

---

## Task 8: Preload wiring

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the type import**

Update line 2 to add the payload type:

```typescript
import type { GithudApi, DashboardSnapshot, Settings, DigestResult, PostReviewPayload } from '../shared/types'
```

- [ ] **Step 2: Wire the new methods**

Replace the `getReview` line (~33) with:

```typescript
  getReview: (prId) => ipcRenderer.invoke('getReview', prId),
  postReview: (prId: string, payload: PostReviewPayload) => ipcRenderer.invoke('postReview', prId, payload),
  getReviewInstructions: () => ipcRenderer.invoke('getReviewInstructions'),
  saveReviewInstructions: (text: string) => ipcRenderer.invoke('saveReviewInstructions', text),
  resetReviewInstructions: () => ipcRenderer.invoke('resetReviewInstructions')
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS (preload now satisfies the full `GithudApi`).

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose postReview + review-instructions IPC"
```

---

## Task 9: Vendor the shadcn `textarea` primitive

**Files:**
- Create: `src/renderer/src/components/ui/textarea.tsx`

- [ ] **Step 1: Create the primitive**

```typescript
import * as React from 'react'
import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive flex min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ui/textarea.tsx
git commit -m "feat(ui): vendor shadcn textarea primitive"
```

---

## Task 10: Rewrite `ReviewPanel` into an editable, postable draft modal

**Files:**
- Modify: `src/renderer/src/components/ReviewPanel.tsx`

- [ ] **Step 1: Rewrite the component**

Replace the whole file with:

```typescript
import { useEffect, useMemo, useState } from 'react'
import { ReviewResult, PostReviewPayload, PostReviewResult } from '@shared/types'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Chip } from './Chip'

type Event = PostReviewPayload['event']

const SEVERITY_BORDER: Record<string, string> = {
  blocker: 'border-l-sev-failure',
  concern: 'border-l-sev-mention',
  note: 'border-l-sev-info'
}
const SEVERITY_TONE: Record<string, 'failure' | 'mention' | 'info'> = {
  blocker: 'failure',
  concern: 'mention',
  note: 'info'
}

interface DraftFinding {
  include: boolean
  note: string
  severity: string
  file: string
  resolvedLine?: number
  resolvedSide?: 'LEFT' | 'RIGHT'
  anchored?: boolean
  snappedFrom?: number
}

export function ReviewPanel({ prId, onClose }: { prId: string; onClose: () => void }) {
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [findings, setFindings] = useState<DraftFinding[]>([])
  const [event, setEvent] = useState<Event>('COMMENT')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)

  function hydrate(r: ReviewResult) {
    setResult(r)
    setSummary(r.summary)
    setFindings(
      r.findings.map((f) => ({
        include: true,
        note: f.note,
        severity: f.severity,
        file: f.file,
        resolvedLine: f.resolvedLine,
        resolvedSide: f.resolvedSide,
        anchored: f.anchored,
        snappedFrom: f.snappedFrom
      }))
    )
    setEvent('COMMENT') // never pre-select a binding event
  }

  function load() {
    setResult(null)
    setError(null)
    api.getReview(prId).then(hydrate).catch((e) => setError(String(e?.message ?? e)))
  }
  useEffect(load, [prId])

  // Inline comments only post for anchored, included findings. Unanchored
  // findings are folded into the summary body so nothing is silently dropped.
  const folded = useMemo(
    () => findings.filter((f) => f.include && !f.anchored),
    [findings]
  )

  async function post() {
    setPosting(true)
    setPostError(null)
    const comments = findings
      .filter((f) => f.include && f.anchored && typeof f.resolvedLine === 'number')
      .map((f) => ({ path: f.file, line: f.resolvedLine!, side: f.resolvedSide ?? 'RIGHT', body: f.note }))
    const foldedText = folded
      .map((f) => `- ${f.file}${f.resolvedLine ? `:${f.resolvedLine}` : ''}: ${f.note}`)
      .join('\n')
    const body = foldedText ? `${summary}\n\n---\n${foldedText}` : summary
    const payload: PostReviewPayload = { body, event, comments }
    const res: PostReviewResult = await api.postReview(prId, payload)
    setPosting(false)
    if (res.ok) {
      if (res.url) api.openExternal(res.url)
      onClose()
    } else {
      setPostError(res.message)
    }
  }

  function patchFinding(i: number, p: Partial<DraftFinding>) {
    setFindings((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...p } : f)))
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Draft review <span className="text-muted-foreground font-normal">— review before posting</span></DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : result === null ? (
          <p className="text-muted-foreground">Generating…</p>
        ) : (
          <div className="flex flex-col gap-3 max-h-[65vh] overflow-auto">
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Summary</span>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} className="min-h-20" />
            </div>

            {findings.length === 0 ? (
              <p className="text-muted-foreground">No inline findings.</p>
            ) : (
              findings.map((f, i) => (
                <div
                  key={i}
                  className={cn(
                    'border-l-[3px] rounded-r-md bg-background p-2.5',
                    SEVERITY_BORDER[f.severity] ?? 'border-l-border',
                    !f.include && 'opacity-50'
                  )}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                    <Checkbox checked={f.include} onCheckedChange={(c) => patchFinding(i, { include: c === true })} aria-label="Include comment" />
                    <Chip tone={SEVERITY_TONE[f.severity] ?? 'neutral'}>{f.severity}</Chip>
                    {f.anchored ? (
                      <span>
                        → {f.file}:{f.resolvedLine} {f.resolvedSide === 'LEFT' ? '(old)' : ''}
                        {typeof f.snappedFrom === 'number' && <span className="text-sev-mention"> (snapped from :{f.snappedFrom})</span>}
                      </span>
                    ) : (
                      <span className="italic">folded into summary ({f.file})</span>
                    )}
                  </div>
                  <Textarea value={f.note} onChange={(e) => patchFinding(i, { note: e.target.value })} className="min-h-14" />
                </div>
              ))
            )}
          </div>
        )}

        {result && !error && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <ToggleGroup type="single" value={event} onValueChange={(v) => v && setEvent(v as Event)} variant="outline" aria-label="Review event">
              <ToggleGroupItem value="COMMENT">Comment</ToggleGroupItem>
              <ToggleGroupItem value="APPROVE">Approve</ToggleGroupItem>
              <ToggleGroupItem value="REQUEST_CHANGES">Request changes</ToggleGroupItem>
            </ToggleGroup>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={load} disabled={posting}>Regenerate</Button>
              <Button variant="outline" size="sm" onClick={onClose} disabled={posting}>Cancel</Button>
              <Button size="sm" onClick={post} disabled={posting}>{posting ? 'Posting…' : 'Post review'}</Button>
            </div>
          </div>
        )}
        {postError && <p className="text-sm text-destructive">{postError}</p>}
      </DialogContent>
    </Dialog>
  )
}
```

Note: **Regenerate** here just re-calls `getReview`, which returns the cached draft (cache is keyed by `prId+headKey`). A true force-refresh would need a cache-busting param; that's out of scope for v1 — `load()` re-pulls the cached generation and resets edits. Confirm `Chip` accepts a `tone` prop with values `failure|mention|info|neutral` (per `Chip.tsx`); if the prop name differs, match the existing `Chip` API.

- [ ] **Step 2: Verify `Chip` API**

Run: `sed -n '1,40p' src/renderer/src/components/Chip.tsx`
Confirm the prop name (`tone`) and accepted values; adjust `SEVERITY_TONE`/usage if the real API differs (e.g. a `variant` prop).

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ReviewPanel.tsx
git commit -m "feat(renderer): editable draft-review modal with event picker + post"
```

---

## Task 11: Rename the row action + Settings "Review" tab

**Files:**
- Modify: `src/renderer/src/components/RowActions.tsx:37`
- Modify: `src/renderer/src/components/Settings.tsx`

- [ ] **Step 1: Rename the kebab item**

In `RowActions.tsx` line 37, change the label:

```typescript
          <DropdownMenuItem onClick={() => onReview(pr.id)}>Draft review</DropdownMenuItem>
```

(No gating change needed — `onReview` is only threaded into the needs-review `PrTable`, so it never shows on team/mine.)

- [ ] **Step 2: Add the Review section to Settings**

In `Settings.tsx`:

(a) Import `Textarea` after the other ui imports (~20):

```typescript
import { Textarea } from '@/components/ui/textarea'
```

(b) Extend the section id union + list (~43-50):

```typescript
type SectionId = 'general' | 'notifications' | 'filters' | 'review' | 'connections' | 'appearance'
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'filters', label: 'Filters & Team' },
  { id: 'review', label: 'Review' },
  { id: 'connections', label: 'Connections' },
  { id: 'appearance', label: 'Appearance' }
]
```

(c) Add state + load near the other `useState`/`useEffect` (~66-74):

```typescript
  const [reviewInstructions, setReviewInstructions] = useState('')
  const [reviewSaved, setReviewSaved] = useState(false)
```

```typescript
  useEffect(() => { api.getReviewInstructions().then(setReviewInstructions) }, [])
```

(d) Save the instructions inside `save()` — add before `onClose()` (after the AI key block, ~99):

```typescript
    await api.saveReviewInstructions(reviewInstructions)
```

(e) Add the tab content — a new `<TabsContent>` block after the `filters` tab content (~284, before the `connections` block):

```tsx
            <TabsContent value="review" className="grid gap-3 mt-0">
              <div className="flex items-center justify-between">
                <Label htmlFor="review-instructions">Review voice & focus</Label>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={async () => { const t = await api.resetReviewInstructions(); setReviewInstructions(t); setReviewSaved(false) }}
                >
                  Reset to default
                </Button>
              </div>
              <Textarea
                id="review-instructions"
                className="min-h-[40vh] font-mono text-xs"
                value={reviewInstructions}
                onChange={(e) => { setReviewInstructions(e.target.value); setReviewSaved(false) }}
              />
              <p className={fieldHelp}>
                The system prompt used when drafting PR reviews. Seeded from your andy-code-review skill; edits are saved when you click Save.
              </p>
              {reviewSaved && <p className={fieldHelp}>Saved.</p>}
            </TabsContent>
```

(`reviewSaved` is wired for parity with other fields; it's set false on edit and reset. It is harmless if you choose not to surface a separate "saved" toast — remove the `{reviewSaved && …}` line and the `setReviewSaved` calls if unused, to avoid an unused-var lint.)

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS. (If `reviewSaved` is unused per your toolchain's lint, either keep the `{reviewSaved && …}` usage or drop the state entirely.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RowActions.tsx src/renderer/src/components/Settings.tsx
git commit -m "feat(renderer): rename row action to Draft review + Settings Review tab"
```

---

## Task 12: Update CLAUDE.md scope + final verification

**Files:**
- Modify: `CLAUDE.md` (AI layer section + Scope discipline section + the `src/` file map)

- [ ] **Step 1: Record the write-path exception**

In CLAUDE.md's **"Scope discipline (YAGNI)"** section, move "inline approve/comment/merge" out of the deferred list and add a sentence:

> **Built (deliberate write exception):** posting a single PR review (summary + inline comments; event-selectable Comment/Approve/Request-changes) from the **Draft review** flow on needs-review PRs. This is the only write path; the app is otherwise read-only. Generation and posting are on-demand only (never on the poll loop).

- [ ] **Step 2: Update the AI layer section + file map**

In the **AI layer** section, update the review bullet to note: the review system prompt is the **editable** instructions (`ai/review-instructions-store.ts`, seeded from the vendored `ai/review-instructions-default.ts` snapshot of the `andy-code-review` skill); findings are anchored to diff lines (`github/parse-diff-anchors.ts` + `ai/anchor-findings.ts`, both pure/tested) and posted via `github/post-review.ts` (`buildReviewRequest`/`classifyPostError` pure/tested). Add these files to the `src/` map with one-line descriptions, and note the 4 new `GithudApi` methods (`postReview`, `get/save/resetReviewInstructions`).

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: PASS, including the new `parse-diff-anchors` (4), `anchor-findings` (5), `post-review` (8).

- [ ] **Step 4: Typecheck + build**

Run: `pnpm run typecheck && pnpm run build`
Expected: both PASS (the build confirms `@shared` resolves for all three targets and no bundler errors).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record draft-review write-path exception + new files in CLAUDE.md"
```

---

## Manual smoke test (glue not covered by unit tests)

Run `pnpm run dev` and verify:

1. Settings → **Review** tab shows the andy-code-review text; edit + Save persists (reopen shows the edit); **Reset to default** restores it.
2. On a needs-review PR, kebab → **Draft review** opens the modal and generates a summary + inline comments in voice.
3. Each finding shows its anchor (`→ file:line`), a "snapped from" note where applicable, or "folded into summary" for files not in the diff.
4. Toggle off a finding, edit a note, edit the summary, pick **Comment** → **Post review** → the review appears on the PR (opens the review URL). Inline comments land on real diff lines.
5. With a read-only PAT, posting shows the **forbidden** message (token lacks write access), no crash.
6. Reopen the modal → cached generation returns instantly (no second token spend); **Regenerate** re-pulls.

---

## Self-review notes (author)

- **Spec coverage:** voice-in-settings (T5, T11), on-demand generation + cache (T6, T7), anchoring incl. fold-to-summary (T2, T3, T8/T10 folding), best-effort nearest line (T3), editable modal + include toggles + event picker defaulting to Comment (T10), full review events (T1, T10), post path + 403 handling (T4, T7, T10), needs-review-only (T7 handler + existing wiring), CLAUDE.md scope update (T12). All covered.
- **Type consistency:** `reviewPr(client, instructions, prId, headOid, title, diff, now)` defined in T6, called identically in T7. `PostReviewPayload`/`PostReviewResult`/`ReviewFinding` fields used in T10/T8 match T1. `buildReviewRequest(owner, repo, pull_number, payload)` signature consistent T4↔T4 glue.
- **Known v1 tradeoffs (documented, intentional):** Regenerate returns the cached draft (no cache-bust); in-modal edits are session-only; single-line anchors only.
```
