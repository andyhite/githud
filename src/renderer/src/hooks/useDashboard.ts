import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DashboardSnapshot } from '@shared/types'
import { api } from '../api'

export function useDashboard() {
  const qc = useQueryClient()

  // No refetchInterval: the main process is the SOLE network poll driver. It
  // polls on the adaptive, rate-limit-aware cadence (scheduleNextPoll →
  // nextPollDelay) and pushes each result here via api.onSnapshot below. A
  // renderer-side interval would fire api.refresh() (a real network poll) every
  // tick regardless of that backoff, draining the shared GraphQL budget the loop
  // is trying to protect. queryFn stays a real refresh so the manual Refresh
  // button / command palette can still force an on-demand poll via refetch().
  const query = useQuery<DashboardSnapshot | null>({
    queryKey: ['dashboard'],
    queryFn: () => api.refresh(),
    initialData: undefined,
    refetchOnWindowFocus: false
  })

  // Seed from the cached snapshot once on mount.
  useEffect(() => {
    let active = true
    api.getSnapshot().then((snap) => {
      if (active && snap) qc.setQueryData(['dashboard'], snap)
    })
    return () => { active = false }
  }, [qc])

  // Apply pushed snapshots from the main process poll loop.
  useEffect(() => {
    return api.onSnapshot((snap) => qc.setQueryData(['dashboard'], snap))
  }, [qc])

  return query
}
