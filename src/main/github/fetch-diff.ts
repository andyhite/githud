import { Octokit } from 'octokit'

export interface PrDiff {
  additions: number
  deletions: number
  changedFiles: number
  patch: string
  truncated: boolean
}

// Cap the diff we send to the model so a huge PR can't blow the token budget.
const MAX_PATCH_CHARS = 60_000

// repo is "owner/name".
export async function fetchPrDiff(octokit: Octokit, repo: string, number: number): Promise<PrDiff> {
  const [owner, name] = repo.split('/')
  const meta: any = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner, repo: name, pull_number: number
  })
  const diff: any = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner, repo: name, pull_number: number,
    headers: { accept: 'application/vnd.github.diff' }
  })
  const raw = String(diff.data ?? '')
  return {
    additions: meta.data?.additions ?? 0,
    deletions: meta.data?.deletions ?? 0,
    changedFiles: meta.data?.changed_files ?? 0,
    patch: raw.slice(0, MAX_PATCH_CHARS),
    truncated: raw.length > MAX_PATCH_CHARS
  }
}
