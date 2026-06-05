import Anthropic from '@anthropic-ai/sdk'

// Default to the most capable model. Switch to 'claude-sonnet-4-6' here if you
// prefer lower cost/latency for triage — it's a per-call quality/cost tradeoff.
export const AI_MODEL = 'claude-opus-4-8'

export function createAiClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

// The text of the first text block in a messages.create response (the only block
// type these calls produce). Empty string if none, so callers can JSON.parse safely.
export function responseText(res: any): string {
  return res.content.find((b: any) => b.type === 'text')?.text ?? ''
}

// Validate a key with a tiny request. Returns true if it authenticates.
export async function validateAiKey(apiKey: string): Promise<boolean> {
  try {
    const client = createAiClient(apiKey)
    await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4,
      messages: [{ role: 'user', content: 'ping' }]
    })
    return true
  } catch {
    return false
  }
}
