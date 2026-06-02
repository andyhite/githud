# Derived PR Event Feed — Design

Date: 2026-06-02

## Problem

The activity panel is built on GitHub's `/notifications` API, whose payload
carries **no actor** — so events like "review requested" or "state changed"
can't say *who* did it or *what* it became. The API also only gives us a coarse
`reason` and the latest comment. We want a richer feed where every event is
clear about *what happened, to which PR, and by whom*.

## Decision

Stop consuming `/notifications` entirely. Instead, **derive events ourselves by
diffing the PR data we already poll** (PRs the user authors + PRs they're
requested to review). This data includes the actors the notifications API hides
(review authors, commenters, CI state). Scope is **PRs only** — issues and
discussions are explicitly out.

Coverage is intentionally limited to PRs the user authors or reviews; comments
or @mentions on PRs outside those two sets are not surfaced (accepted tradeoff
for a single, fully-controlled source).

## Event model (`src/shared/types.ts`)

`ActivityItem` is replaced by `FeedEvent`:

```ts
type FeedEventKind =
  | 'approved' | 'changes_requested' | 'review_commented' // reviews on a PR
  | 'comment' | 'mention'                                 // new comments
  | 'ci_failed' | 'ci_succeeded'                          // check transitions
  | 'review_requested'                                    // PR entered review queue
  | 'merged' | 'closed'                                   // PR left the open set

interface FeedEvent {
  id: string        // stable, content-derived (review id / comment id /
                    //   `ci:<prId>:<headOid>:<state>`); enables dedupe + read-state
  kind: FeedEventKind
  repo: string
  number: number
  title: string     // PR title
  url: string       // deep-links to the comment/review when possible
  actor?: User      // reviewer / commenter; absent for CI + lifecycle
  createdAt: string
  unread: boolean
}
```

Severity color reuses the existing system:
- red: `ci_failed`, `changes_requested`
- green: `ci_succeeded`, `approved`, `merged`
- blue: `comment`, `mention`, `review_commented`, `review_requested`, `closed`

## Data fetch (`src/main/github/queries.ts`)

Extend `PR_FIELDS` with:
- `reviews(last: 50) { nodes { id state author { login avatarUrl } submittedAt url } }`
- `comments(last: 20) { nodes { id author { login avatarUrl } createdAt url bodyText } }`
- head-commit `oid` (to key CI events per commit)

Cost note: this enlarges the GraphQL query. If rate-limit pressure appears, trim
`last:` counts. **Inline review-thread comments are deferred** — v1 covers issue
comments and review summaries only.

## Diff engine (`src/main/github/derive-events.ts`, pure, TDD'd)

`deriveEvents(prev: PRState[], next: PRState[], viewer: User): FeedEvent[]`

- **PR in both prev and next:**
  - review ids present in `next` but not `prev` → `approved` /
    `changes_requested` / `review_commented` (actor = review author)
  - comment ids new in `next` → `comment`; `mention` if `bodyText` contains
    `@<viewer.login>`
  - CI rollup transition to FAILURE or SUCCESS → `ci_failed` / `ci_succeeded`,
    id keyed by head `oid` so it fires once per commit (pending states ignored)
- **PR new in `next`, in the review set** → `review_requested` (PR author shown
  as context; resolving *who requested* is deferred — needs a timeline lookup)
- **PR gone from the open set (was the user's own):** poller resolves `merged`
  vs `closed` via the existing `subjectStateLabel` (REST) and emits the event

The first poll with no prior state seeds the baseline and emits nothing.

## Event store (`src/main/event-store.ts`, TDD'd)

Persists `events.json`:
- `append(newEvents)`: merge by `id`, preserving the read-state of events
  already present; cap to ~100, sorted newest-first
- `markRead(id)`, `markAllRead()`, `load()`

Prior PR state persisted separately (`pr-state.json`) so diffing survives a
relaunch and **catches up** on changes that happened while the app was closed.

## Poller / main (`src/main/poller.ts`, `src/main/index.ts`)

Per poll: fetch enriched PRs → build `PRState[]` → load prior state →
`deriveEvents` + lifecycle resolution → `eventStore.append` → fire native
notifications for the freshly-appended events (so `notifier.ts` collapses to
"notify the new events") → persist the new prior state.

Settings `excludedAuthors` / `hideBots` still apply, filtering `FeedEvent`s by
actor (the repurposed `filter-activity.ts`).

## IPC / renderer

- `DashboardSnapshot.activity: ActivityItem[]` → `events: FeedEvent[]`
- `GithudApi` (+ preload) gains `markRead(id)` and `markAllRead()`
- `ActivityFeed` renders `FeedEvent`s: icon + actor + per-kind action phrasing,
  severity color, sticky header + hover as today; click → `openExternal(url)` +
  `markRead(id)`; a **"mark all read"** control in the panel header

## Removed / repurposed

- Removed: `notifications.ts`, `enrich.ts`, `normalize-activity.ts`
- `enrich-state.ts`: keep the pure `subjectStateLabel`, drop the
  notification-thread plumbing
- `filter-activity.ts`: repurposed to filter `FeedEvent`s by actor

## Testing (TDD)

- `derive-events.ts` — the core; broad case coverage (new reviews, new comments,
  mention detection, CI transitions, fall-out lifecycle, baseline seed)
- `event-store.ts` — append/dedupe/read-state/cap
- `subjectStateLabel` — already tested; reused
- `ActivityFeed` component — renders each kind, click marks read

## Deferred (YAGNI)

Inline review-thread comments; resolving *who* requested a review; any non-PR
subject types.
