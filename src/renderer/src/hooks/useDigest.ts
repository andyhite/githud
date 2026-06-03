import { useEffect, useState } from 'react'
import { api } from '../api'
import type { DigestResult } from '@shared/types'

// Subscribes to main's 'digest' push channel. Returns the latest brief delta
// digest, or null until the first foreground refresh produces one.
export function useDigest(enabled: boolean): DigestResult | null {
  const [digest, setDigest] = useState<DigestResult | null>(null)
  useEffect(() => {
    if (!enabled) return
    return api.onDigest((d) => setDigest(d))
  }, [enabled])
  return digest
}
