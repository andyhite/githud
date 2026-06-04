import { PanelView } from '@shared/types'
import { Chip } from './Chip'
import { cn } from '@/lib/utils'

// The panel-header view switcher: an "All" tag plus one tag per configured
// named view. Single-select — clicking a tag makes it the active filter (or
// "All" to clear). Active tag is tinted (info); the rest are neutral. Renders
// nothing when no views are configured (the panel then shows everything).
export function PanelViewTabs({
  views,
  activeId,
  onSelect
}: {
  views: PanelView[]
  activeId: string | null
  onSelect: (id: string | null) => void
}) {
  if (views.length === 0) return null
  const tags: { id: string | null; name: string }[] = [{ id: null, name: 'All' }, ...views]
  return (
    <span className="flex flex-wrap items-center gap-1">
      {tags.map((t) => {
        const active = t.id === activeId
        return (
          <button
            key={t.id ?? '__all__'}
            type="button"
            aria-pressed={active}
            title={`Show ${t.name}`}
            onClick={() => onSelect(t.id)}
            className={cn(
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-md'
            )}
          >
            <Chip tone={active ? 'info' : 'neutral'} className={cn('cursor-pointer', !active && 'opacity-70')}>
              {t.name}
            </Chip>
          </button>
        )
      })}
    </span>
  )
}
