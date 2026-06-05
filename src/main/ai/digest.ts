import Anthropic from '@anthropic-ai/sdk'
import { DashboardSnapshot, DigestResult, FeedEvent } from '@shared/types'
import { AI_MODEL, responseText } from './client'

const SYSTEM = `You write a terse "while you were away" standup for an engineer's GitHub dashboard. Group by what needs action vs FYI. Be specific (repo #number, who did what). Markdown, no preamble, max ~8 bullets.`

// The exact data the digest reasons over. Used both to build the prompt and to
// fingerprint the input for caching — so it stays in sync by construction.
export function digestPayload(snap: DashboardSnapshot) {
  return {
    needsReview: snap.needsReview.map((p) => ({ repo: p.repo, number: p.number, title: p.title, author: p.author.login, checks: p.checks.state })),
    myPullRequests: snap.myPullRequests.map((p) => ({ repo: p.repo, number: p.number, title: p.title, reviewState: p.reviewState, checks: p.checks.state, mergeable: p.mergeable })),
    recentEvents: snap.events.slice(0, 30).map((e) => ({ kind: e.kind, repo: e.repo, number: e.number, who: e.actor?.login, unread: e.unread }))
  }
}

// Stable string identifying the digest input; ignores volatile fields like
// fetchedAt so the cached digest survives polls that change nothing meaningful.
export function digestFingerprint(snap: DashboardSnapshot): string {
  return JSON.stringify(digestPayload(snap))
}

export async function buildDigest(client: Anthropic, snap: DashboardSnapshot, now: string): Promise<DigestResult> {
  const res: any = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Dashboard state:\n${JSON.stringify(digestPayload(snap))}` }]
  } as any)
  return { markdown: responseText(res), generatedAt: now, mode: 'full' }
}

// Events newer than sinceAt. ISO-8601 strings of identical format compare
// lexicographically == chronologically, so a string > is the whole filter.
export function eventsSince(events: FeedEvent[], sinceAt: string): FeedEvent[] {
  return events.filter((e) => e.createdAt > sinceAt)
}

// The exact data the delta digest reasons over: the new events plus light
// grounding for the PRs those events touch. Pure so it's unit-testable.
export function deltaPayload(snap: DashboardSnapshot, sinceAt: string) {
  const newEvents = eventsSince(snap.events, sinceAt)
  const touched = new Set(newEvents.map((e) => `${e.repo}#${e.number}`))
  const context = [...snap.needsReview, ...snap.myPullRequests]
    .filter((p) => touched.has(`${p.repo}#${p.number}`))
    .map((p) => ({ repo: p.repo, number: p.number, title: p.title, checks: p.checks.state }))
  return {
    newEvents: newEvents.map((e) => ({ kind: e.kind, repo: e.repo, number: e.number, who: e.actor?.login })),
    context
  }
}

const DELTA_SYSTEM = `You summarize what changed on an engineer's GitHub dashboard since they last looked, in ONE dense sentence. No preamble, no bullets, no markdown headers. Be specific: name the repo #number and who acted. Group naturally (e.g. "alice approved o/web #88 and CI went green on o/api #12"). Max ~35 words.`

export async function buildDeltaDigest(
  client: Anthropic,
  snap: DashboardSnapshot,
  sinceAt: string,
  now: string
): Promise<DigestResult> {
  const payload = deltaPayload(snap, sinceAt)
  const res: any = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 256,
    system: [{ type: 'text', text: DELTA_SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Changes since the user was away:\n${JSON.stringify(payload)}` }]
  } as any)
  return {
    markdown: responseText(res),
    generatedAt: now,
    mode: 'delta',
    coveredSince: sinceAt,
    eventCount: payload.newEvents.length
  }
}
