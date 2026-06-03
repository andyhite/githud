import { useEffect, useRef, useState } from 'react'
import { PullRequest, TriageVerdict } from '@shared/types'
import { api } from '../api'

export function useTriageVerdicts(
  aiOn: boolean,
  visibleReview: PullRequest[]
): Record<string, TriageVerdict> {
  const [verdicts, setVerdicts] = useState<Record<string, TriageVerdict>>({})
  const requested = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!aiOn) return
    for (const pr of visibleReview) {
      if (requested.current.has(pr.id)) continue
      requested.current.add(pr.id)
      api.getTriage(pr.id).then((v) => { if (v) setVerdicts((m) => ({ ...m, [pr.id]: v })) })
    }
  }, [aiOn, visibleReview])
  return verdicts
}
