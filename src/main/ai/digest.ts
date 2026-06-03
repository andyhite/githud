import Anthropic from '@anthropic-ai/sdk'
import { DashboardSnapshot, DigestResult } from '@shared/types'
import { AI_MODEL } from './client'

const SYSTEM = `You write a terse "while you were away" standup for an engineer's GitHub dashboard. Group by what needs action vs FYI. Be specific (repo #number, who did what). Markdown, no preamble, max ~8 bullets.`

export async function buildDigest(client: Anthropic, snap: DashboardSnapshot, now: string): Promise<DigestResult> {
  const payload = {
    needsReview: snap.needsReview.map((p) => ({ repo: p.repo, number: p.number, title: p.title, author: p.author.login, checks: p.checks.state })),
    myPullRequests: snap.myPullRequests.map((p) => ({ repo: p.repo, number: p.number, title: p.title, reviewState: p.reviewState, checks: p.checks.state, mergeable: p.mergeable })),
    recentEvents: snap.events.slice(0, 30).map((e) => ({ kind: e.kind, repo: e.repo, number: e.number, who: e.actor?.login, unread: e.unread }))
  }
  const res: any = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Dashboard state:\n${JSON.stringify(payload)}` }]
  } as any)
  const textBlock = res.content.find((b: any) => b.type === 'text')
  return { markdown: textBlock?.text ?? '', generatedAt: now }
}
