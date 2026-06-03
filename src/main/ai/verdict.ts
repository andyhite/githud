import { SizeBucket, RiskLevel, TriageLabel } from '@shared/types'

export function verdictLabel(size: SizeBucket, risk: RiskLevel): TriageLabel {
  if (risk === 'high') return 'likely_changes'
  if (size === 'XL') return 'big_effort'
  if (risk === 'low' && (size === 'S' || size === 'M')) return 'quick_approve'
  return 'careful_read'
}
