import { useState } from 'react'

export function TokenSetup({ onSaved }: { onSaved: (login: string) => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await window.api.saveToken(token.trim())
    setBusy(false)
    if (res.ok && res.login) onSaved(res.login)
    else setError(res.error ?? 'Failed to save token')
  }

  return (
    <div className="token-setup">
      <h1>Connect githud to GitHub</h1>
      <p>
        Create a Personal Access Token with <code>repo</code>, <code>read:org</code>, and{' '}
        <code>notifications</code> scopes (or a fine-grained token with read access to PRs, checks,
        and notifications), then paste it below.
      </p>
      <p>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            window.api.openExternal('https://github.com/settings/tokens')
          }}
        >
          Open GitHub token settings →
        </a>
      </p>
      <label htmlFor="token">Personal access token</label>
      <input
        id="token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="ghp_…"
        autoFocus
      />
      <button onClick={submit} disabled={!token.trim() || busy}>
        {busy ? 'Validating…' : 'Save token'}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
