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
    <span className="label-filters">
      {labels.map((label) => {
        const active = !mutedSet.has(label)
        return (
          <button
            key={label}
            type="button"
            className={`label-chip${active ? '' : ' muted'}`}
            aria-pressed={active}
            title={active ? `Hide ${label} PRs` : `Show ${label} PRs`}
            onClick={() => onToggle(label)}
          >
            {label}
          </button>
        )
      })}
    </span>
  )
}
