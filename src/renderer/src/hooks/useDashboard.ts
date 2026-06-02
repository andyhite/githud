import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DashboardSnapshot } from '@shared/types'
import { api } from '../api'

export function useDashboard() {
  const qc = useQueryClient()

  const query = useQuery<DashboardSnapshot | null>({
    queryKey: ['dashboard'],
    queryFn: () => api.refresh(),
    initialData: undefined,
    refetchInterval: 30_000,
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
