import Anthropic from '@anthropic-ai/sdk'
import { ReviewResult, ReviewFinding } from '@shared/types'
import { PrDiff } from '../github/fetch-diff'
import { AI_MODEL } from './client'

const SYSTEM = `You are doing a first-pass code review of a pull request diff for a senior engineer. Surface concrete candidate issues — bugs, missing tests, unhandled edge cases, risky changes. Be precise and skip style nits. You are advisory only; the human makes the call. Respond ONLY with the requested JSON.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['note', 'concern', 'blocker'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          note: { type: 'string' }
        },
        required: ['severity', 'file', 'note']
      }
    }
  },
  required: ['summary', 'findings']
} as const

export async function reviewPr(
  client: Anthropic, prId: string, headOid: string, title: string, diff: PrDiff, now: string
): Promise<ReviewResult> {
  const res: any = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `PR: ${title}\n\nDiff${diff.truncated ? ' (truncated)' : ''}:\n${diff.patch}` }]
  } as any)
  const textBlock = res.content.find((b: any) => b.type === 'text')
  const parsed = JSON.parse(textBlock?.text ?? '{}') as { summary: string; findings: ReviewFinding[] }
  return { prId, headOid, summary: parsed.summary ?? '', findings: parsed.findings ?? [], generatedAt: now }
}
