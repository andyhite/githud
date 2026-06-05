// A friendly blank slate shown when a panel has nothing to show. The
// needs-review variant is the celebratory "inbox zero" (success accent); the
// others share its look with calmer wording.
import { CheckCircle2, Inbox, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'review' | 'mine' | 'activity' | 'team'

const VARIANTS: Record<Variant, { celebrate: boolean; icon: LucideIcon; title: string; subtitle: string }> = {
  review: {
    celebrate: true,
    icon: CheckCircle2,
    title: 'Inbox zero',
    subtitle: 'Nothing is waiting on your review. Go enjoy the calm. 🎉'
  },
  mine: {
    celebrate: false,
    icon: Inbox,
    title: 'Nothing in flight',
    subtitle: "None of your pull requests are open. Time to ship something."
  },
  activity: {
    celebrate: false,
    icon: Inbox,
    title: 'All quiet',
    subtitle: 'New reviews, comments, and CI updates will land here.'
  },
  team: {
    celebrate: false,
    icon: Inbox,
    title: 'No team PRs',
    subtitle: 'No open PRs match the labels in this panel right now.'
  }
}

export function EmptyState({ variant }: { variant: Variant }) {
  const { celebrate, icon: Icon, title, subtitle } = VARIANTS[variant]
  // flex-1 centers it vertically inside the Panel body (a flex column). The tall-*
  // steps scale the blank slate WITH THE PANEL'S HEIGHT (container-height queries —
  // see tailwind.css), starting from a compact base so it never overflows a short
  // panel; min-h-0 + overflow-hidden guarantee it clips (centered) rather than
  // forcing a scrollbar if a panel is shorter than even the compact base.
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 overflow-hidden px-4 py-3 text-center tall-sm:gap-2 tall-md:py-6">
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-full h-9 w-9 tall-sm:h-12 tall-sm:w-12 tall-lg:h-16 tall-lg:w-16',
          celebrate ? 'bg-sev-success/10 text-sev-success' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="h-4 w-4 tall-sm:h-6 tall-sm:w-6 tall-lg:h-8 tall-lg:w-8" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-card-foreground tall-lg:text-base">{title}</p>
      {/* Fixed width + text-balance so the sentence wraps at the same point
          regardless of panel size and the two lines come out roughly equal. */}
      <p className="max-w-[30ch] text-balance text-xs text-muted-foreground">{subtitle}</p>
    </div>
  )
}
