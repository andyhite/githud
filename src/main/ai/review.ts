import Anthropic from '@anthropic-ai/sdk'
import { ReviewResult, ReviewFinding } from '@shared/types'
import { PrDiff } from '../github/fetch-diff'
import { AI_MODEL } from './client'

const TASK = `You are reviewing a pull request diff. Produce a PR-level review summary and a list of inline findings, each anchored to a file and a line in the diff. Adopt the reviewing voice, focus, and severity calibration described in the instructions above.

For every finding, set "file" to the path copied VERBATIM from the diff's "+++ b/<path>" header for that hunk — character for character, including every directory segment. Do NOT abbreviate, normalize, infer, or reconstruct the path from memory; if you cannot find the file's "+++ b/" header in the diff, do not invent a path. Respond ONLY with the requested JSON.`

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
          file: { type: 'string', description: 'path copied verbatim from the diff "+++ b/<path>" header — every directory segment, no abbreviation' },
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
