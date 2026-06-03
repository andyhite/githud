import { useEffect, useState } from 'react'
import { api } from '../api'

export function Digest({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.getDigest().then((d) => setText(d.markdown)).catch((e) => setError(String(e?.message ?? e)))
  }, [])
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Catch me up</h2>
        {error ? <p className="empty">{error}</p> : text === null ? <p className="empty">Thinking…</p> : <pre className="digest-body">{text}</pre>}
        <div className="settings-actions"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
