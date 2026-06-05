import { useQueryClient } from '@tanstack/react-query'
import { DashboardSnapshot, PullRequest } from '@shared/types'
import { api } from '../api'

export function useHideActions(): {
  onHide: (pr: PullRequest) => void
  onUnhide: (id: string) => void
  onSnooze: (pr: PullRequest, until: string) => void
} {
  const qc = useQueryClient()
  const applySnapshot = (snap: DashboardSnapshot) => qc.setQueryData(['dashboard'], snap)
  const onHide = (pr: PullRequest) => { void api.hidePr(pr.id, pr.updatedAt).then(applySnapshot) }
  const onUnhide = (id: string) => { void api.unhidePr(id).then(applySnapshot) }
  const onSnooze = (pr: PullRequest, until: string) => { void api.snoozePr(pr.id, pr.updatedAt, until).then(applySnapshot) }
  return { onHide, onUnhide, onSnooze }
}
