import Anthropic from '@anthropic-ai/sdk'
import { RiskLevel, TriageVerdict } from '@shared/types'
import { PrDiff } from '../github/fetch-diff'
import { AI_MODEL } from './client'
import { sizeBucket } from './size'
import { verdictLabel } from './verdict'

const SYSTEM = `You are a senior code reviewer triaging a pull request diff. Judge the RISK that this PR has real problems a reviewer must catch (bugs, missing tests, risky/edge-case-prone changes, security-sensitive touch points). Be calibrated: most small mechanical changes are low risk. Respond ONLY with the requested JSON.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    rationale: { type: 'string', description: 'one sentence' },
    focusHint: { type: 'string', description: 'where to look, one short phrase' }
  },
  required: ['risk', 'rationale', 'focusHint']
} as const

export async function triagePr(
  client: Anthropic,
  prId: string,
  headOid: string,
  title: string,
  diff: PrDiff,
  now: string
): Promise<TriageVerdict> {
  const size = sizeBucket(diff)
  const userText = `PR title: ${title}\nSize: +${diff.additions}/-${diff.deletions} across ${diff.changedFiles} files${diff.truncated ? ' (diff truncated)' : ''}\n\nDiff:\n${diff.patch}`
  const res: any = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: userText }]
  } as any)
  const textBlock = res.content.find((b: any) => b.type === 'text')
  const parsed = JSON.parse(textBlock?.text ?? '{}') as { risk: RiskLevel; rationale: string; focusHint: string }
  return {
    prId, headOid, size, risk: parsed.risk,
    label: verdictLabel(size, parsed.risk),
    rationale: parsed.rationale, focusHint: parsed.focusHint,
    generatedAt: now
  }
}
