// A friendly blank slate shown when a panel has nothing to show. The
// needs-review variant is the celebratory "inbox zero"; the others share its
// look with calmer wording. Octicon (16-viewBox) path data, scaled up via CSS.
const ICON_PATHS = {
  // Plain checkmark (not check-circle-fill): the circular badge supplies the
  // ring, and a solid glyph reads clearly as bright green against the tint —
  // a "fill" octicon's cutout would vanish against the same-hue background.
  check:
    'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
  paperAirplane:
    'M.989 8 .064 2.68a1.342 1.342 0 0 1 1.85-1.462l13.402 5.744a1.13 1.13 0 0 1 0 2.076L1.913 14.782a1.343 1.343 0 0 1-1.85-1.463L.99 8Zm.603-5.288L2.38 7.25h4.87a.75.75 0 0 1 0 1.5H2.38l-.788 4.538L13.929 8Z',
  bell:
    'M8 16a2 2 0 0 0 1.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 0 0 8 16ZM3 5a5 5 0 0 1 10 0v2.947c0 .05.015.098.042.139l1.703 2.555A1.519 1.519 0 0 1 13.482 13H2.518a1.516 1.516 0 0 1-1.263-2.36l1.703-2.554A.255.255 0 0 0 3 7.947Zm5-3.5A3.5 3.5 0 0 0 4.5 5v2.947c0 .346-.102.683-.294.97l-1.703 2.556a.018.018 0 0 0-.003.01l.001.006.004.006.006.004.007.001h10.964l.007-.001.006-.004.004-.006.001-.007a.017.017 0 0 0-.003-.01l-1.703-2.554a1.745 1.745 0 0 1-.294-.97V5A3.5 3.5 0 0 0 8 1.5Z'
} as const

type Variant = 'review' | 'mine' | 'activity' | 'team'

const VARIANTS: Record<Variant, { tone: 'celebrate' | 'calm'; icon: keyof typeof ICON_PATHS; title: string; subtitle: string }> = {
  review: {
    tone: 'celebrate',
    icon: 'check',
    title: 'Inbox zero',
    subtitle: 'Nothing is waiting on your review. Go enjoy the calm. 🎉'
  },
  mine: {
    tone: 'calm',
    icon: 'paperAirplane',
    title: 'Nothing in flight',
    subtitle: "None of your pull requests are open. Time to ship something."
  },
  activity: {
    tone: 'calm',
    icon: 'bell',
    title: 'All quiet',
    subtitle: 'New reviews, comments, and CI updates will land here.'
  },
  team: {
    tone: 'calm',
    icon: 'paperAirplane',
    title: 'No team PRs',
    subtitle: 'No open PRs match the labels in this panel right now.'
  }
}

export function EmptyState({ variant }: { variant: Variant }) {
  const { tone, icon, title, subtitle } = VARIANTS[variant]
  return (
    <div className={`empty-state ${tone}`}>
      <span className="empty-badge">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d={ICON_PATHS[icon]} />
        </svg>
      </span>
      <p className="empty-title">{title}</p>
      <p className="empty-sub">{subtitle}</p>
    </div>
  )
}
