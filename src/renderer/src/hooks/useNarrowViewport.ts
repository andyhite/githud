import { useEffect, useState } from 'react'

// The viewport width below which the app drops to its single-column layout — the
// same value as Tailwind's `lg` breakpoint used throughout the renderer. Both the
// PR table↔card switch (PrTable) and the tabbed PR/Notifications nav (App) key off
// this, so the whole UI flips between desktop and narrow layouts together.
export const NARROW_MAX_WIDTH = 1024

// True while the viewport is narrower than `maxWidthPx`. matchMedia is reliable in
// Electron and matches Tailwind's media-query breakpoints exactly. In jsdom (no
// matchMedia) it stays false → tests get the desktop layout unless they stub it.
export function useNarrowViewport(maxWidthPx: number = NARROW_MAX_WIDTH): boolean {
  const query = `(max-width: ${maxWidthPx - 0.02}px)`
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [narrow, setNarrow] = useState<boolean>(read)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setNarrow(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return narrow
}
