import { Octokit } from 'octokit'
import { classifyTokenError, TokenErrorReason } from './rate-limit'

export function createClient(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: 'githud/0.1.0' })
}

export type TokenValidation =
  | { ok: true; login: string; avatarUrl: string }
  | { ok: false; reason: TokenErrorReason; message: string }

function messageFor(reason: TokenErrorReason, resetAt?: string): string {
  switch (reason) {
    case 'rate_limit': {
      const when = resetAt
        ? new Date(resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'soon'
      // The GraphQL budget is per-user, shared across every PAT — so say so, to
      // stop the "regenerate the token" wild goose chase this error used to cause.
      return `GitHub rate limit reached — your token is fine. This budget is shared across all your tokens, so a new one won't help. Try again after ${when}.`
    }
    case 'auth':
      return 'Token rejected by GitHub. Check the value and scopes.'
    case 'network':
      return "Couldn't reach GitHub. Check your connection and try again."
  }
}

// Validate a token by resolving the viewer login. On failure, classify WHY so
// the caller can show an accurate message and avoid wiping a valid token during
// a transient rate-limit/network failure.
export async function validateToken(token: string): Promise<TokenValidation> {
  try {
    const octokit = createClient(token)
    const res: any = await octokit.graphql(`query { viewer { login avatarUrl } }`)
    return { ok: true, login: res.viewer.login, avatarUrl: res.viewer.avatarUrl }
  } catch (err: any) {
    const { reason, resetAt } = classifyTokenError(err, Date.now())
    return { ok: false, reason, message: messageFor(reason, resetAt) }
  }
}
