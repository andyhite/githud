import { Octokit } from 'octokit'
import { PostReviewFileComment, PostReviewPayload, PostReviewResult } from '@shared/types'

export interface ReviewRequest {
  owner: string
  repo: string
  pull_number: number
  body: string
  event: PostReviewPayload['event']
  comments?: { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }[]
}

export interface FileCommentRequest {
  owner: string
  repo: string
  pull_number: number
  commit_id: string
  path: string
  subject_type: 'file'
  body: string
}

// Pure: shape whole-file (subject_type:'file') review-comment requests. These are
// posted one-by-one against the create-review-comment endpoint AFTER the review,
// because the create-review `comments` array only accepts line/position anchors.
export function buildFileCommentRequests(
  owner: string,
  repo: string,
  pull_number: number,
  commit_id: string,
  fileComments: PostReviewFileComment[]
): FileCommentRequest[] {
  return fileComments.map((c) => ({
    owner,
    repo,
    pull_number,
    commit_id,
    path: c.path,
    subject_type: 'file',
    body: c.body
  }))
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
    const url = res.data?.html_url ?? ''
    const warning = await postFileComments(octokit, owner, repo, pull_number, payload.fileComments ?? [])
    return warning ? { ok: true, url, warning } : { ok: true, url }
  } catch (err) {
    return classifyPostError(err)
  }
}

// Whole-file comments can't ride in the create-review call, so post them
// separately and best-effort: the review already succeeded, so a file-comment
// failure becomes a warning rather than failing the whole post. Returns a
// warning string when some couldn't be posted, else undefined.
async function postFileComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  pull_number: number,
  fileComments: PostReviewFileComment[]
): Promise<string | undefined> {
  if (fileComments.length === 0) return undefined

  let commitId: string | undefined
  try {
    const meta: any = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo, pull_number })
    commitId = meta.data?.head?.sha
  } catch {
    commitId = undefined
  }
  if (!commitId) return `Posted the review, but couldn't resolve the head commit for ${fileComments.length} file-level comment(s).`

  const reqs = buildFileCommentRequests(owner, repo, pull_number, commitId, fileComments)
  let failed = 0
  for (const r of reqs) {
    try {
      await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/comments', r as any)
    } catch {
      failed++
    }
  }
  return failed > 0 ? `Posted the review, but ${failed} of ${reqs.length} file-level comment(s) failed.` : undefined
}
