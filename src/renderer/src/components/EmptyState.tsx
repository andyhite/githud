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
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center gap-2 px-5 py-6">
      <span
        className={cn(
          'grid place-items-center rounded-full h-12 w-12',
          celebrate ? 'bg-sev-success/10 text-sev-success' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-card-foreground">{title}</p>
      <p className="text-xs text-muted-foreground max-w-[32ch]">{subtitle}</p>
    </div>
  )
}
