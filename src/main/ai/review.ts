import Anthropic from '@anthropic-ai/sdk'
import { ReviewResult, ReviewFinding, ReviewRecommendation } from '@shared/types'
import { PrDiff } from '../github/fetch-diff'
import { AI_MODEL, responseText } from './client'

const TASK = `You are reviewing a pull request diff to help the REVIEWER (the person reading this, not the PR author) decide whether to approve it. Produce three things:

1. "recommendation": your ballpark verdict — one of "approve" (clean, ship it), "approve_with_nits" (fine to approve after a quick skim; only minor nits), "request_changes" (something blocking needs fixing first), or "needs_discussion" (unclear scope/design; needs a conversation before deciding).

2. "assessment": 2-4 sentences of PRIVATE notes written FOR THE REVIEWER (second person is natural, e.g. "safe to approve after a skim"). Summarize the risk, test coverage, and what to actually look at. These are shown only in the reviewer's dashboard and are NEVER posted to GitHub — write them for yourself, not the author.

3. "findings": inline findings, each anchored to a file and a line in the diff. These ARE posted as line-level comments, so adopt the reviewing voice, focus, and severity calibration described in the instructions above. For every finding, set "file" to the path copied VERBATIM from the diff's "+++ b/<path>" header for that hunk — character for character, including every directory segment. Do NOT abbreviate, normalize, infer, or reconstruct the path from memory; if you cannot find the file's "+++ b/" header in the diff, do not invent a path.

Respond ONLY with the requested JSON.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    recommendation: {
      type: 'string',
      enum: ['approve', 'approve_with_nits', 'request_changes', 'needs_discussion'],
      description: 'ballpark approve/not-approve verdict for the reviewer'
    },
    assessment: { type: 'string', description: 'private reviewer-facing notes; shown only in the dashboard, never posted' },
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
  required: ['recommendation', 'assessment', 'findings']
} as const

// `instructions` is the editable review-voice system prompt (Settings -> Review).
export async function reviewPr(
  client: Anthropic,
  instructions: string,
  prId: string,
  headKey: string,
  title: string,
  diff: PrDiff,
  now: string
): Promise<ReviewResult> {
  const res: any = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    // The review is the most analytically demanding call (triage/digest don't use
    // thinking) — adaptive lets the model reason over the diff before committing.
    thinking: { type: 'adaptive' },
    system: [
      { type: 'text', text: instructions, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: TASK }
    ],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `PR: ${title}\n\nDiff${diff.truncated ? ' (truncated)' : ''}:\n${diff.patch}` }]
  } as any)
  const parsed = JSON.parse(responseText(res) || '{}') as {
    recommendation?: ReviewRecommendation
    assessment?: string
    findings?: ReviewFinding[]
  }
  return {
    prId,
    headKey,
    recommendation: parsed.recommendation ?? 'needs_discussion',
    assessment: parsed.assessment ?? '',
    findings: parsed.findings ?? [],
    generatedAt: now
  }
}
