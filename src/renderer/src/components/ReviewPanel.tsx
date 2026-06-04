import { useEffect, useMemo, useState } from 'react'
import { ReviewResult, PostReviewPayload, PostReviewResult } from '@shared/types'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Chip } from './Chip'
import { DiffSnippet } from './DiffSnippet'

type Event = PostReviewPayload['event']

const SEVERITY_BORDER: Record<string, string> = {
  blocker: 'border-l-sev-failure',
  concern: 'border-l-sev-mention',
  note: 'border-l-sev-info'
}
const SEVERITY_TONE: Record<string, 'failure' | 'mention' | 'info'> = {
  blocker: 'failure',
  concern: 'mention',
  note: 'info'
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

export function ReviewPanel({ prId, onClose }: { prId: string; onClose: () => void }) {
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [findings, setFindings] = useState<DraftFinding[]>([])
  const [event, setEvent] = useState<Event>('COMMENT')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)

  function hydrate(r: ReviewResult) {
    setResult(r)
    setSummary(r.summary)
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
    setEvent('COMMENT') // never pre-select a binding event
  }

  function load(force = false) {
    setResult(null)
    setError(null)
    setPostError(null)
    api.getReview(prId, force).then(hydrate).catch((e) => setError(String(e?.message ?? e)))
  }
  useEffect(() => { load() }, [prId])

  // Included findings route three ways: anchored -> inline line comment;
  // un-anchored but file IS in the diff -> whole-file comment; un-anchored and
  // file absent from the diff -> folded into the summary (GitHub can't comment
  // on a file it doesn't have).
  const fileLevel = useMemo(
    () => findings.filter((f) => f.include && !f.anchored && f.fileInDiff),
    [findings]
  )
  const folded = useMemo(
    () => findings.filter((f) => f.include && !f.anchored && !f.fileInDiff),
    [findings]
  )

  async function post() {
    setPosting(true)
    setPostError(null)
    const comments = findings
      .filter((f) => f.include && f.anchored && typeof f.resolvedLine === 'number')
      .map((f) => ({ path: f.file, line: f.resolvedLine!, side: f.resolvedSide ?? 'RIGHT', body: f.note }))
    const fileComments = fileLevel.map((f) => ({ path: f.file, body: f.note }))
    const foldedText = folded.map((f) => `- ${f.file}: ${f.note}`).join('\n')
    const body = foldedText ? `${summary}\n\n---\n${foldedText}` : summary
    const payload: PostReviewPayload = { body, event, comments, fileComments }
    const res: PostReviewResult = await api.postReview(prId, payload)
    setPosting(false)
    if (res.ok) {
      if (res.warning) {
        // Review posted; some file-level comments didn't. Surface it instead of closing.
        setPostError(res.warning)
        return
      }
      if (res.url) api.openExternal(res.url)
      onClose()
    } else {
      setPostError(res.message)
    }
  }

  function patchFinding(i: number, p: Partial<DraftFinding>) {
    setFindings((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...p } : f)))
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-4rem)] max-w-6xl flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Draft review <span className="text-muted-foreground font-normal">— review before posting</span></DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="p-6 text-sm text-destructive">{error}</p>
        ) : result === null ? (
          <p className="p-6 text-muted-foreground">Generating…</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-6 py-5">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Summary</span>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} className="min-h-32 leading-relaxed" />
            </div>

            {findings.length === 0 ? (
              <p className="text-muted-foreground">No inline findings.</p>
            ) : (
              findings.map((f, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-r-md border-l-[3px] bg-background p-4',
                    SEVERITY_BORDER[f.severity] ?? 'border-l-border',
                    !f.include && 'opacity-50'
                  )}
                >
                  <div className="mb-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={f.include} onCheckedChange={(c) => patchFinding(i, { include: c === true })} aria-label="Include comment" />
                    <Chip tone={SEVERITY_TONE[f.severity] ?? 'neutral'}>{f.severity}</Chip>
                    {f.anchored ? (
                      <span>
                        → {f.file}:{f.resolvedLine} {f.resolvedSide === 'LEFT' ? '(old)' : ''}
                        {typeof f.snappedFrom === 'number' && <span className="text-sev-mention"> (snapped from :{f.snappedFrom})</span>}
                      </span>
                    ) : f.fileInDiff ? (
                      <span>→ {f.file} <span className="italic text-muted-foreground">(whole-file comment)</span></span>
                    ) : (
                      <span className="italic">folded into summary ({f.file})</span>
                    )}
                  </div>
                  {f.anchored && (
                    <DiffSnippet patch={result.patch} file={f.file} line={f.resolvedLine} side={f.resolvedSide} />
                  )}
                  <Textarea value={f.note} onChange={(e) => patchFinding(i, { note: e.target.value })} className="min-h-24 leading-relaxed" />
                </div>
              ))
            )}
          </div>
        )}

        {result && !error && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-4">
            <ToggleGroup type="single" value={event} onValueChange={(v) => v && setEvent(v as Event)} variant="outline" aria-label="Review event">
              <ToggleGroupItem value="COMMENT">Comment</ToggleGroupItem>
              <ToggleGroupItem value="APPROVE">Approve</ToggleGroupItem>
              <ToggleGroupItem value="REQUEST_CHANGES">Request changes</ToggleGroupItem>
            </ToggleGroup>
            <div className="flex items-center gap-2">
              {postError && <span className="mr-1 text-sm text-destructive">{postError}</span>}
              <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={posting}>Regenerate</Button>
              <Button variant="outline" size="sm" onClick={onClose} disabled={posting}>Cancel</Button>
              <Button size="sm" onClick={post} disabled={posting}>{posting ? 'Posting…' : 'Post review'}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
