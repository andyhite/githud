import { useEffect, useState } from 'react'
import { ReviewResult, ReviewRecommendation, PostReviewPayload, PostReviewResult } from '@shared/types'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Chip } from './chip'
import { DiffSnippet } from './diff-snippet'
import { ExternalLink } from 'lucide-react'

const SEVERITY_META: Record<string, { border: string; tone: 'failure' | 'mention' | 'info' }> = {
  blocker: { border: 'border-l-sev-failure', tone: 'failure' },
  concern: { border: 'border-l-sev-mention', tone: 'mention' },
  note: { border: 'border-l-sev-info', tone: 'info' }
}

// The dashboard-only verdict chip (never posted) — a ballpark approve/not read.
const RECO_META: Record<ReviewRecommendation, { label: string; tone: 'success' | 'failure' | 'mention' }> = {
  approve: { label: 'Approve', tone: 'success' },
  approve_with_nits: { label: 'Approve w/ nits', tone: 'success' },
  request_changes: { label: 'Request changes', tone: 'failure' },
  needs_discussion: { label: 'Needs discussion', tone: 'mention' }
}

interface DraftFinding {
  include: boolean
  note: string
  severity: string
  file: string
  resolvedLine?: number
  resolvedSide?: 'LEFT' | 'RIGHT'
  anchored?: boolean
  snappedFrom?: number
  fileInDiff?: boolean
}

export function ReviewPanel({ prId, prUrl, prTitle, onClose }: { prId: string; prUrl?: string; prTitle?: string; onClose: () => void }) {
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [findings, setFindings] = useState<DraftFinding[]>([])
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  // Holding Option/Alt turns "Start review" into "Start review & open PR". We
  // track it so the label reflects the modifier; the click handler reads the
  // event's own modifier too, so a quick Alt-click works even without a keydown.
  const [openAfter, setOpenAfter] = useState(false)

  // The PR's Files-changed tab — where you finish & submit the pending review.
  const filesUrl = prUrl ? `${prUrl}/files` : undefined

  function hydrate(r: ReviewResult) {
    setResult(r)
    setFindings(
      r.findings.map((f) => ({
        // Default-check only the findings worth acting on; leave low-priority
        // notes/nits unchecked so the reviewer opts them in deliberately.
        include: f.severity === 'blocker' || f.severity === 'concern',
        note: f.note,
        severity: f.severity,
        file: f.file,
        resolvedLine: f.resolvedLine,
        resolvedSide: f.resolvedSide,
        anchored: f.anchored,
        snappedFrom: f.snappedFrom,
        fileInDiff: f.fileInDiff
      }))
    )
  }

  function load(force = false) {
    setResult(null)
    setError(null)
    setPostError(null)
    api.getReview(prId, force).then(hydrate).catch((e) => setError(String(e?.message ?? e)))
  }
  useEffect(() => { load() }, [prId])

  useEffect(() => {
    const sync = (e: KeyboardEvent) => setOpenAfter(e.altKey)
    const reset = () => setOpenAfter(false)
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', reset) // dropped keyup while unfocused would otherwise stick
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', reset)
    }
  }, [])

  // Only anchored, included findings are posted — as inline line comments on the
  // pending review. The assessment and un-anchored notes stay in the dashboard.
  const postable = findings.filter((f) => f.include && f.anchored && typeof f.resolvedLine === 'number')

  async function post(openPr: boolean) {
    setPosting(true)
    setPostError(null)
    const comments = postable.map((f) => ({
      path: f.file,
      line: f.resolvedLine!,
      side: f.resolvedSide ?? 'RIGHT',
      body: f.note
    }))
    const payload: PostReviewPayload = { comments }
    const res: PostReviewResult = await api.postReview(prId, payload)
    setPosting(false)
    if (res.ok) {
      if (openPr) api.openExternal(filesUrl ?? res.url)
      onClose()
    } else {
      setPostError(res.message)
    }
  }

  function patchFinding(i: number, p: Partial<DraftFinding>) {
    setFindings((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...p } : f)))
  }

  const reco = result ? RECO_META[result.recommendation] : null
  const otherNotes = findings.filter((f) => !f.anchored)
  const hasAnchored = findings.some((f) => f.anchored)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-4rem)] max-w-6xl flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          {/* pr-8 keeps the title clear of the Dialog's absolute top-right close (X). */}
          <DialogTitle className="flex min-w-0 items-center gap-2 pr-8">
            <span className="shrink-0">Draft review</span>
            {prTitle && (
              <>
                <span className="shrink-0 text-muted-foreground">—</span>
                {filesUrl ? (
                  <button
                    type="button"
                    onClick={() => api.openExternal(filesUrl)}
                    title={`${prTitle} — open on GitHub`}
                    className="inline-flex min-w-0 items-center gap-1.5 font-normal text-sev-info hover:underline"
                  >
                    <span className="truncate">{prTitle}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </button>
                ) : (
                  <span className="truncate font-normal text-muted-foreground">{prTitle}</span>
                )}
              </>
            )}
          </DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="p-6 text-sm text-destructive">{error}</p>
        ) : result === null ? (
          <p className="p-6 text-muted-foreground">Generating…</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-6 py-5">
            {/* Read-only assessment — your private read on the PR; NOT posted. */}
            <div className="grid gap-2 rounded-md border bg-background p-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Assessment</span>
                {reco && <Chip tone={reco.tone}>{reco.label}</Chip>}
                <span className="ml-auto text-xs italic text-muted-foreground">Dashboard only — not posted</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-card-foreground">
                {result.assessment || 'No assessment generated.'}
              </p>
            </div>

            {/* Line comments — the ONLY thing posted to GitHub (as a draft). */}
            <div className="grid gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Line comments {hasAnchored && <span className="normal-case tracking-normal">· {postable.length} selected</span>}
              </span>
            </div>
            {!hasAnchored ? (
              <p className="text-sm text-muted-foreground">No line-level comments — nothing to post.</p>
            ) : (
              findings.map((f, i) =>
                f.anchored ? (
                  <div
                    key={i}
                    className={cn(
                      'rounded-r-md border-l-[3px] bg-background p-4',
                      SEVERITY_META[f.severity]?.border ?? 'border-l-border',
                      !f.include && 'opacity-50'
                    )}
                  >
                    <div className="mb-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={f.include} onCheckedChange={(c) => patchFinding(i, { include: c === true })} aria-label="Include comment" />
                      <Chip tone={SEVERITY_META[f.severity]?.tone ?? 'neutral'}>{f.severity}</Chip>
                      <span>
                        → {f.file}:{f.resolvedLine} {f.resolvedSide === 'LEFT' ? '(old)' : ''}
                        {typeof f.snappedFrom === 'number' && <span className="text-sev-mention"> (snapped from :{f.snappedFrom})</span>}
                      </span>
                    </div>
                    <DiffSnippet patch={result.patch} file={f.file} line={f.resolvedLine} side={f.resolvedSide} />
                    <Textarea value={f.note} onChange={(e) => patchFinding(i, { note: e.target.value })} className="min-h-24 leading-relaxed" />
                  </div>
                ) : null
              )
            )}

            {/* Un-anchored findings: shown for context, never posted. */}
            {otherNotes.length > 0 && (
              <div className="grid gap-2 rounded-md border bg-background p-4">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Other notes <span className="normal-case tracking-normal italic">— not posted to GitHub</span>
                </span>
                <ul className="grid gap-1.5">
                  {otherNotes.map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed">
                      <Chip tone={SEVERITY_META[f.severity]?.tone ?? 'neutral'}>{f.severity}</Chip>
                      <span className="text-card-foreground"><span className="text-muted-foreground">{f.file}</span> — {f.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {result && !error && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-4">
            <span className="text-xs text-muted-foreground">
              Posts the selected line comments as a draft (pending) review — finish &amp; submit it on GitHub. Hold&nbsp;⌥ to open the PR after.
            </span>
            <div className="flex items-center gap-2">
              {postError && <span className="mr-1 text-sm text-destructive">{postError}</span>}
              <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={posting}>Regenerate</Button>
              <Button variant="outline" size="sm" onClick={onClose} disabled={posting}>Cancel</Button>
              <Button
                size="sm"
                onClick={(e) => post(e.altKey || openAfter)}
                disabled={posting || postable.length === 0}
              >
                {posting ? 'Starting…' : openAfter ? 'Start review & open PR' : 'Start review'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
