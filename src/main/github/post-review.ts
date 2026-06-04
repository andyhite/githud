import { Octokit } from 'octokit'
import { PostReviewPayload, PostReviewResult } from '@shared/types'

export interface ReviewRequest {
  owner: string
  repo: string
  pull_number: number
  body: string
  event: PostReviewPayload['event']
  comments?: { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }[]
}

// Pure: turn the renderer's payload into the GitHub create-review request body.
// Drops any inline comment without a usable numeric line so a single bad anchor
// can't 422 the whole review; omits `comments` entirely when none remain.
export function buildReviewRequest(
  owner: string,
  repo: string,
  pull_number: number,
  payload: PostReviewPayload
): ReviewRequest {
  const comments = payload.comments.filter((c) => Number.isFinite(c.line))
  const req: ReviewRequest = { owner, repo, pull_number, body: payload.body, event: payload.event }
  if (comments.length > 0) {
    req.comments = comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body }))
  }
  return req
}

// Pure: map an Octokit/request error to a user-facing PostReviewResult failure.
export function classifyPostError(err: any): Extract<PostReviewResult, { ok: false }> {
  const status = err?.status
  if (status === 403)
    return { ok: false, kind: 'forbidden', message: 'This token lacks write access. Use a PAT with classic `repo` scope or fine-grained “Pull requests: Read & write”.' }
  if (status === 401)
    return { ok: false, kind: 'auth', message: 'GitHub rejected the token. Reconnect it in Settings → Connections.' }
  if (status === 422)
    return { ok: false, kind: 'unprocessable', message: `GitHub rejected the review: ${err?.message ?? 'unprocessable'}.` }
  if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' || /network|fetch failed/i.test(String(err?.message)))
    return { ok: false, kind: 'network', message: 'Network error reaching GitHub. Try again.' }
  return { ok: false, kind: 'unknown', message: String(err?.message ?? err) }
}

// Glue: post a single PR review. owner/repo split happens in the caller.
export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pull_number: number,
  payload: PostReviewPayload
): Promise<PostReviewResult> {
  try {
    const req = buildReviewRequest(owner, repo, pull_number, payload)
    const res: any = await octokit.request(
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      req as any
    )
    return { ok: true, url: res.data?.html_url ?? '' }
  } catch (err) {
    return classifyPostError(err)
  }
}
