import { useEffect, useState } from 'react'
import { ReviewResult } from '@shared/types'
import { api } from '../api'

export function ReviewPanel({ prId, onClose }: { prId: string; onClose: () => void }) {
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.getReview(prId).then(setResult).catch((e) => setError(String(e?.message ?? e)))
  }, [prId])
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel review-panel" onClick={(e) => e.stopPropagation()}>
        <h2>AI pre-review <span className="muted">— advisory</span></h2>
        {error ? (
          <p className="empty">{error}</p>
        ) : result === null ? (
          <p className="empty">Reviewing…</p>
        ) : (
          <>
            {result.summary && <p className="review-summary">{result.summary}</p>}
            {result.findings.length === 0 ? (
              <p className="empty">No issues flagged.</p>
            ) : (
              result.findings.map((f, i) => (
                <div key={i} className={`finding ${f.severity}`}>
                  <div className="finding-loc">{f.file}{f.line ? `:${f.line}` : ''} · {f.severity}</div>
                  <div>{f.note}</div>
                </div>
              ))
            )}
          </>
        )}
        <div className="settings-actions"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
