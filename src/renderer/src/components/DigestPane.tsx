import type { DigestResult } from '@shared/types'

export function DigestPane({ digest }: { digest: DigestResult | null }) {
  const text = digest?.markdown?.trim()
  return (
    <div className="digest-pane">
      {text ? (
        <>
          <p className="digest-sentence">{text}</p>
          <span className="digest-meta">since you were away</span>
        </>
      ) : (
        <p className="digest-sentence empty">You're all caught up.</p>
      )}
    </div>
  )
}
