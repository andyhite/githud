import { Octokit } from 'octokit'
import { TeamOption } from '@shared/types'

// Pure normalizers (tested). The Octokit fetch glue below is validated by the
// manual smoke test, per the repo's "test pure logic, not glue" convention.

export function normalizeOrgs(payload: any[]): string[] {
  const logins = (payload ?? []).map((o) => o?.login).filter((l): l is string => !!l)
  return Array.from(new Set(logins)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export function normalizeTeams(payload: any[]): TeamOption[] {
  return (payload ?? [])
    .map((t) => {
      const org = t?.organization?.login
      const teamSlug = t?.slug
      if (!org || !teamSlug) return null
      return { slug: `${org}/${teamSlug}`, name: t?.name || teamSlug, org }
    })
    .filter((t): t is TeamOption => t !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug, undefined, { sensitivity: 'base' }))
}

// Map an Octokit error to a reason the renderer can word. 401/403 on these
// endpoints almost always means the token lacks read:org (classic) / Members
// read (fine-grained); a status-less error is a transport/network failure.
export function classifyListError(err: any): 'scope' | 'network' | 'unknown' {
  const status = err?.status
  if (status === 401 || status === 403) return 'scope'
  if (status === undefined || status === null) return 'network'
  return 'unknown'
}

export async function fetchOrgs(octokit: Octokit): Promise<string[]> {
  const res = await octokit.paginate('GET /user/orgs', { per_page: 100 })
  return normalizeOrgs(res as any[])
}

export async function fetchTeams(octokit: Octokit): Promise<TeamOption[]> {
  const res = await octokit.paginate('GET /user/teams', { per_page: 100 })
  return normalizeTeams(res as any[])
}
