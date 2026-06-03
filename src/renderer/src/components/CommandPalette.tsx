import { useState } from 'react'

export interface Command {
  id: string
  label: string
  run: () => void
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const filtered = commands.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Run a command…"
          aria-label="Command palette"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) { filtered[0].run(); onClose() }
            if (e.key === 'Escape') onClose()
          }}
        />
        <ul className="palette-list">
          {filtered.map((c) => (
            <li key={c.id}>
              <button onClick={() => { c.run(); onClose() }}>{c.label}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
