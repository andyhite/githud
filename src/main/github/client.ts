import { Octokit } from 'octokit'

export function createClient(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: 'githud/0.1.0' })
}

// Validate a token by resolving the viewer login. Returns null on failure.
export async function validateToken(token: string): Promise<{ login: string; avatarUrl: string } | null> {
  try {
    const octokit = createClient(token)
    const res: any = await octokit.graphql(`query { viewer { login avatarUrl } }`)
    return { login: res.viewer.login, avatarUrl: res.viewer.avatarUrl }
  } catch {
    return null
  }
}
