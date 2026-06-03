import { useState } from 'react'

// Sliding switch for binary settings. Rendered as a labeled checkbox with
// role="switch" so it stays accessible (getByRole('switch', { name }) /
// getByLabelText both resolve via the wrapping label text).
export function Toggle({
  label,
  checked,
  onChange,
  disabled
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  )
}

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
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="chip-input">
        {values.map((v) => (
          <span key={v} className="chip">
            <span className="chip-text">{v}</span>
            <button type="button" aria-label={`Remove ${v}`} onClick={() => remove(v)}>
              ×
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
        />
      </div>
    </div>
  )
}

// Range slider with a live value readout in the label.
export function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  format
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="slider-value">{format ? format(value) : value}</span>
      </label>
      <input
        id={id}
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

// Preset buttons for a numeric value. A stored value that isn't one of the
// presets (hand-edited config) renders as a trailing custom readout rather than
// being silently snapped to a preset.
export function Segmented({
  label,
  value,
  options,
  onChange,
  formatCustom
}: {
  label: string
  value: number
  options: { label: string; value: number }[]
  onChange: (v: number) => void
  formatCustom?: (v: number) => string
}) {
  const isPreset = options.some((o) => o.value === value)
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            type="button"
            key={o.value}
            className={o.value === value ? 'seg active' : 'seg'}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
        {!isPreset && (
          <span className="seg-custom">{formatCustom ? formatCustom(value) : value}</span>
        )}
      </div>
    </div>
  )
}
