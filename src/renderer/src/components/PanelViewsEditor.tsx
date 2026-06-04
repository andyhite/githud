import { PanelView } from '@shared/types'
import { ChipInput } from './ChipInput'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// Editor for one panel's named views (the header tag switcher). Each view has a
// name plus per-dimension filters (labels/authors/repos); within a dimension the
// values OR, across dimensions they AND.
export function PanelViewsEditor({
  views,
  onChange
}: {
  views: PanelView[]
  onChange: (views: PanelView[]) => void
}) {
  const updateFilter = (id: string, fp: Partial<PanelView['filter']>) =>
    onChange(views.map((v) => (v.id === id ? { ...v, filter: { ...v.filter, ...fp } } : v)))
  const rename = (id: string, name: string) =>
    onChange(views.map((v) => (v.id === id ? { ...v, name } : v)))
  const add = () => onChange([...views, { id: crypto.randomUUID(), name: 'New view', filter: {} }])
  const remove = (id: string) => onChange(views.filter((v) => v.id !== id))

  return (
    <div className="grid gap-3">
      {views.map((v) => (
        <div key={v.id} className="grid gap-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label="View name"
              className="h-8"
              value={v.name}
              onChange={(e) => rename(v.id, e.target.value)}
              placeholder="View name"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              onClick={() => remove(v.id)}
            >
              Remove
            </Button>
          </div>
          <ChipInput
            id={`${v.id}-labels`}
            label="Labels"
            values={v.filter.labels ?? []}
            onChange={(x) => updateFilter(v.id, { labels: x })}
            placeholder="frontend"
          />
          <ChipInput
            id={`${v.id}-authors`}
            label="Authors"
            values={v.filter.authors ?? []}
            onChange={(x) => updateFilter(v.id, { authors: x })}
            placeholder="octocat"
          />
          <ChipInput
            id={`${v.id}-repos`}
            label="Repos"
            values={v.filter.repos ?? []}
            onChange={(x) => updateFilter(v.id, { repos: x })}
            placeholder="owner/name"
          />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={add}>
        Add view
      </Button>
    </div>
  )
}
