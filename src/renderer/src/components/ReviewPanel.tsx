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
        include: true,
        note: f.note,
        severity: f.severity,
        file: f.file,
        resolvedLine: f.resolvedLine,
        resolvedSide: f.resolvedSide,
        anchored: f.anchored,
        snappedFrom: f.snappedFrom
      }))
    )
    setEvent('COMMENT') // never pre-select a binding event
  }

  function load() {
    setResult(null)
    setError(null)
    setPostError(null)
    api.getReview(prId).then(hydrate).catch((e) => setError(String(e?.message ?? e)))
  }
  useEffect(load, [prId])

  // Inline comments only post for anchored, included findings. Unanchored
  // findings are folded into the summary body so nothing is silently dropped.
  const folded = useMemo(
    () => findings.filter((f) => f.include && !f.anchored),
    [findings]
  )

  async function post() {
    setPosting(true)
    setPostError(null)
    const comments = findings
      .filter((f) => f.include && f.anchored && typeof f.resolvedLine === 'number')
      .map((f) => ({ path: f.file, line: f.resolvedLine!, side: f.resolvedSide ?? 'RIGHT', body: f.note }))
    const foldedText = folded
      .map((f) => `- ${f.file}${f.resolvedLine ? `:${f.resolvedLine}` : ''}: ${f.note}`)
      .join('\n')
    const body = foldedText ? `${summary}\n\n---\n${foldedText}` : summary
    const payload: PostReviewPayload = { body, event, comments }
    const res: PostReviewResult = await api.postReview(prId, payload)
    setPosting(false)
    if (res.ok) {
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Draft review <span className="text-muted-foreground font-normal">— review before posting</span></DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : result === null ? (
          <p className="text-muted-foreground">Generating…</p>
        ) : (
          <div className="flex flex-col gap-3 max-h-[65vh] overflow-auto">
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Summary</span>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} className="min-h-20" />
            </div>

            {findings.length === 0 ? (
              <p className="text-muted-foreground">No inline findings.</p>
            ) : (
              findings.map((f, i) => (
                <div
                  key={i}
                  className={cn(
                    'border-l-[3px] rounded-r-md bg-background p-2.5',
                    SEVERITY_BORDER[f.severity] ?? 'border-l-border',
                    !f.include && 'opacity-50'
                  )}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                    <Checkbox checked={f.include} onCheckedChange={(c) => patchFinding(i, { include: c === true })} aria-label="Include comment" />
                    <Chip tone={SEVERITY_TONE[f.severity] ?? 'neutral'}>{f.severity}</Chip>
                    {f.anchored ? (
                      <span>
                        → {f.file}:{f.resolvedLine} {f.resolvedSide === 'LEFT' ? '(old)' : ''}
                        {typeof f.snappedFrom === 'number' && <span className="text-sev-mention"> (snapped from :{f.snappedFrom})</span>}
                      </span>
                    ) : (
                      <span className="italic">folded into summary ({f.file})</span>
                    )}
                  </div>
                  <Textarea value={f.note} onChange={(e) => patchFinding(i, { note: e.target.value })} className="min-h-14" />
                </div>
              ))
            )}
          </div>
        )}

        {result && !error && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <ToggleGroup type="single" value={event} onValueChange={(v) => v && setEvent(v as Event)} variant="outline" aria-label="Review event">
              <ToggleGroupItem value="COMMENT">Comment</ToggleGroupItem>
              <ToggleGroupItem value="APPROVE">Approve</ToggleGroupItem>
              <ToggleGroupItem value="REQUEST_CHANGES">Request changes</ToggleGroupItem>
            </ToggleGroup>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={load} disabled={posting}>Regenerate</Button>
              <Button variant="outline" size="sm" onClick={onClose} disabled={posting}>Cancel</Button>
              <Button size="sm" onClick={post} disabled={posting}>{posting ? 'Posting…' : 'Post review'}</Button>
            </div>
          </div>
        )}
        {postError && <p className="text-sm text-destructive">{postError}</p>}
      </DialogContent>
    </Dialog>
  )
}
