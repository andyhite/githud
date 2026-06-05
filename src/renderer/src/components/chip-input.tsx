import { useState } from 'react'
import { XIcon } from 'lucide-react'
import { Label } from '@/components/ui/label'

// Array editor: add on Enter/comma/blur, remove via the ✕ button or Backspace
// on an empty draft. Holds the underlying string[] directly (no comma-string
// parsing at the call site). Duplicates are ignored.
export function ChipInput({
  id,
  label,
  values,
  onChange,
  placeholder
}: {
  id: string
  label: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const v = raw.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setDraft('')
  }
  const remove = (v: string) => onChange(values.filter((x) => x !== v))

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => remove(v)}
              className="text-muted-foreground/70 hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={draft}
          placeholder={values.length ? '' : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && values.length) {
              remove(values[values.length - 1])
            }
          }}
          onBlur={() => add(draft)}
          className="flex-1 min-w-[8ch] border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}
