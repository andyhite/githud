import { ReviewSide } from '@shared/types'
import { diffSnippet, DiffSnippetLine } from './diff-snippet'
import { cn } from '@/lib/utils'

const ROW: Record<DiffSnippetLine['type'], string> = {
  add: 'bg-sev-success/10',
  del: 'bg-sev-failure/10',
  context: ''
}
const SIGN: Record<DiffSnippetLine['type'], { ch: string; color: string }> = {
  add: { ch: '+', color: 'text-sev-success' },
  del: { ch: '-', color: 'text-sev-failure' },
  context: { ch: ' ', color: 'text-muted-foreground' }
}

// A few lines of unified diff around a review finding's anchor. Renders nothing
// when there's no patch or the line can't be located in it.
export function DiffSnippet({
  patch,
  file,
  line,
  side
}: {
  patch?: string
  file: string
  line?: number
  side?: ReviewSide
}) {
  if (!patch || typeof line !== 'number') return null
  const lines = diffSnippet(patch, file, line, side ?? 'RIGHT', 3)
  if (!lines) return null

  return (
    <pre className="mb-2 overflow-x-auto rounded-md border bg-card font-mono text-xs leading-relaxed">
      {lines.map((l, i) => {
        const sign = SIGN[l.type]
        return (
          <div
            key={i}
            className={cn(
              'flex border-l-2 border-l-transparent',
              ROW[l.type],
              l.isTarget && 'border-l-sev-info bg-sev-info/10'
            )}
          >
            <span className="w-9 shrink-0 select-none px-1.5 text-right text-muted-foreground/70">{l.oldLine ?? ''}</span>
            <span className="w-9 shrink-0 select-none px-1.5 text-right text-muted-foreground/70">{l.newLine ?? ''}</span>
            <span className={cn('w-4 shrink-0 select-none text-center', sign.color)}>{sign.ch}</span>
            <span className="whitespace-pre pr-3 text-card-foreground">{l.text || ' '}</span>
          </div>
        )
      })}
    </pre>
  )
}
