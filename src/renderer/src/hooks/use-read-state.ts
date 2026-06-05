import { useQueryClient } from '@tanstack/react-query'
import { DashboardSnapshot, FeedEvent } from '@shared/types'
import { api } from '../api'

export function useReadState(): { onRead: (id: string) => void; onReadAll: () => void } {
  const qc = useQueryClient()
  const applyEvents = (events: FeedEvent[]) =>
    qc.setQueryData<DashboardSnapshot | null>(['dashboard'], (old) => (old ? { ...old, events } : old))
  const onRead = (id: string) => { void api.markRead(id).then(applyEvents) }
  const onReadAll = () => { void api.markAllRead().then(applyEvents) }
  return { onRead, onReadAll }
}
