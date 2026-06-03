import { Chip } from './Chip'
import { cn } from '@/lib/utils'

// Toggle chips shown in the Team PRs panel header — one per configured label.
// A chip is "active" (aria-pressed) by default; clicking it mutes that label,
// hiding its PRs from the list. Lets you focus the panel on a subset of labels.
export function LabelFilterChips({
  labels,
  muted,
  onToggle
}: {
  labels: string[]
  muted: string[]
  onToggle: (label: string) => void
}) {
  if (labels.length === 0) return null
  const mutedSet = new Set(muted)
  return (
    <span className="flex flex-wrap items-center gap-1">
      {labels.map((label) => {
        const active = !mutedSet.has(label)
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            title={active ? `Hide ${label} PRs` : `Show ${label} PRs`}
            onClick={() => onToggle(label)}
            className={cn(
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-md'
            )}
          >
            <Chip
              tone={active ? 'info' : 'neutral'}
              className={cn('cursor-pointer', !active && 'line-through opacity-70')}
            >
              {label}
            </Chip>
          </button>
        )
      })}
    </span>
  )
}
