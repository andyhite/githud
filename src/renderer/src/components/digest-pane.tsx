import type { DigestResult } from '@shared/types'
import { cn } from '@/lib/utils'

export function DigestPane({ digest }: { digest: DigestResult | null }) {
  const text = digest?.markdown?.trim()
  return (
    <blockquote
      className={cn(
        'font-serif italic leading-snug tracking-tight',
        text
          ? 'font-bold text-2xl text-foreground'
          : 'font-semibold text-2xl text-muted-foreground'
      )}
    >
      {text || "You're all caught up."}
    </blockquote>
  )
}
