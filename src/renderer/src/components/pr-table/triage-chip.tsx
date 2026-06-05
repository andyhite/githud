import { TriageVerdict, TriageLabel } from '@shared/types'
import { Chip, type ChipTone } from '@/components/chip'

const TRIAGE_META: Record<TriageLabel, { tone: ChipTone; label: string }> = {
  quick_approve: { tone: 'success', label: 'quick approve' },
  careful_read: { tone: 'info', label: 'careful read' },
  likely_changes: { tone: 'mention', label: 'likely changes' },
  big_effort: { tone: 'effort', label: 'big effort' }
}

export function TriageChip({ verdict }: { verdict?: TriageVerdict }) {
  if (!verdict) return <span className="text-muted-foreground">—</span>
  const m = TRIAGE_META[verdict.label]
  if (!m) return <span className="text-muted-foreground">—</span>
  return (
    <Chip tone={m.tone} title={`${verdict.rationale} — focus: ${verdict.focusHint}`}>
      {m.label}
    </Chip>
  )
}
