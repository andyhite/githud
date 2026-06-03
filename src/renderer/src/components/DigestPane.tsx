import type { DigestResult } from '@shared/types'

export function DigestPane({ digest }: { digest: DigestResult | null }) {
  const text = digest?.markdown?.trim()
  return (
    <blockquote className={`digest-quote${text ? '' : ' empty'}`}>
      {text || "You're all caught up."}
    </blockquote>
  )
}
