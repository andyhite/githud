import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { api } from '../api'

export function TokenSetup({ onSaved }: { onSaved: (login: string) => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await api.saveToken(token.trim())
    setBusy(false)
    if (res.ok && res.login) onSaved(res.login)
    else setError(res.error ?? 'Failed to save token')
  }

  return (
    <Card className="mx-auto mt-16 max-w-xl">
      <CardHeader>
        <CardTitle>Connect githud to GitHub</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Create a Personal Access Token with <code>repo</code>, <code>read:org</code>, and{' '}
          <code>notifications</code> scopes (or a fine-grained token with read access to PRs, checks,
          and notifications), then paste it below.
        </p>
        <p>
          <button
            type="button"
            className="text-sev-info hover:underline"
            onClick={() => api.openExternal('https://github.com/settings/tokens')}
          >
            Open GitHub token settings →
          </button>
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="token">Personal access token</Label>
          <Input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_…"
            autoFocus
          />
        </div>
        <Button onClick={submit} disabled={!token.trim() || busy} className="self-start">
          {busy ? 'Validating…' : 'Save token'}
        </Button>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
