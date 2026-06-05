import { useEffect } from 'react'
import { PullRequest } from '@shared/types'
import { api } from '../api'
import { moveSelection } from './selection'

export function useKeyboardNav({
  visibleReview,
  selected,
  setSelected,
  onHide,
  onOpenPalette
}: {
  visibleReview: PullRequest[]
  selected: number
  setSelected: React.Dispatch<React.SetStateAction<number>>
  onHide: (pr: PullRequest) => void
  onOpenPalette: () => void
}): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onOpenPalette(); return }
      if (e.key === 'j') setSelected((i) => moveSelection(i, 'down', visibleReview.length))
      if (e.key === 'k') setSelected((i) => moveSelection(i, 'up', visibleReview.length))
      if (e.key === 'Enter' && selected >= 0 && visibleReview[selected]) api.openExternal(visibleReview[selected].url)
      if (e.key === 'e' && selected >= 0 && visibleReview[selected]) onHide(visibleReview[selected])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visibleReview, selected, setSelected, onHide, onOpenPalette])
}
