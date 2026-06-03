import { useEffect, useState } from 'react'
import { ReviewResult } from '@shared/types'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const SEVERITY_BORDER: Record<string, string> = {
  blocker: 'border-l-sev-failure',
  concern: 'border-l-sev-mention',
  note: 'border-l-sev-info'
}

export function ReviewPanel({ prId, onClose }: { prId: string; onClose: () => void }) {
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.getReview(prId).then(setResult).catch((e) => setError(String(e?.message ?? e)))
  }, [prId])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pre-review <span className="text-muted-foreground font-normal">— advisory</span></DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-muted-foreground">{error}</p>
        ) : result === null ? (
          <p className="text-muted-foreground">Reviewing…</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            {result.summary && <p className="text-card-foreground mb-1.5">{result.summary}</p>}
            {result.findings.length === 0 ? (
              <p className="text-muted-foreground">No issues flagged.</p>
            ) : (
              result.findings.map((f, i) => (
                <div
                  key={i}
                  className={cn(
                    'border-l-[3px] rounded-r-md bg-background p-2.5 my-1.5',
                    SEVERITY_BORDER[f.severity] ?? 'border-l-border'
                  )}
                >
                  <div className="text-xs text-muted-foreground">{f.file}{f.line ? `:${f.line}` : ''} · {f.severity}</div>
                  <div>{f.note}</div>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
