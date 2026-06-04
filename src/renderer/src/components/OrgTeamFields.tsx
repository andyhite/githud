import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { TeamOption, ListResult } from '@shared/types'
import { api } from '../api'
import { ChipInput } from './ChipInput'
import { Chip } from './Chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

const fieldHelp = 'text-xs leading-relaxed text-muted-foreground'

// Lazily-loaded list of T plus the failure reason (for the "couldn't list" hint).
type Loaded<T> = { status: 'loading' } | { status: 'ready'; items: T } | { status: 'error'; reason: string }

function useLoaded<T>(load: () => Promise<ListResult<T>>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    load().then((r) => {
      if (!alive) return
      setState(r.ok ? { status: 'ready', items: r.items } : { status: 'error', reason: r.reason })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

// Worded hint when listing fails. Only 'scope' is actionable enough to surface;
// the inputs stay usable as free-text either way, so other reasons stay quiet.
function scopeHint(state: Loaded<unknown>, kind: string): string | null {
  if (state.status === 'error' && state.reason === 'scope') {
    return `Couldn’t list your ${kind} — the GitHub token needs the read:org scope. You can still type them in manually.`
  }
  return null
}

// The Other-PRs "Organizations" + "Team" fields, enhanced with auto-populated
// pickers from the authed user's GitHub orgs/teams. Both stay free-text first:
// the pickers only ADD to what you can already type, and everything degrades to
// plain entry if the token lacks read:org or GitHub can't be reached.
export function OrgTeamFields({
  orgs,
  team,
  onOrgsChange,
  onTeamChange
}: {
  orgs: string[]
  team: string
  onOrgsChange: (orgs: string[]) => void
  onTeamChange: (team: string) => void
}) {
  const orgState = useLoaded<string[]>(() => api.listOrgs())
  const teamState = useLoaded<TeamOption[]>(() => api.listTeams())

  // Suggest only orgs not already chosen.
  const orgSuggestions = orgState.status === 'ready' ? orgState.items.filter((o) => !orgs.includes(o)) : []
  const teams = teamState.status === 'ready' ? teamState.items : []
  const orgHint = scopeHint(orgState, 'organizations')
  const teamHint = scopeHint(teamState, 'teams')

  return (
    <>
      <div className="grid gap-2">
        <ChipInput
          id="other-orgs"
          label="Organizations"
          values={orgs}
          onChange={onOrgsChange}
          placeholder="your-org"
        />
        {orgSuggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">Your orgs:</span>
            {orgSuggestions.map((o) => (
              <button
                key={o}
                type="button"
                aria-label={`Add ${o}`}
                title={`Add ${o}`}
                onClick={() => onOrgsChange([...orgs, o])}
                className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <Chip tone="neutral" className="cursor-pointer">
                  + {o}
                </Chip>
              </button>
            ))}
          </div>
        )}
        <p className={fieldHelp}>Scope the search to these orgs. Your own repos are always included.</p>
        {orgHint && <p className={fieldHelp}>{orgHint}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="other-team">Team</Label>
        <div className="flex items-center gap-2">
          <Input
            id="other-team"
            className="flex-1"
            value={team}
            onChange={(e) => onTeamChange(e.target.value)}
            placeholder="org/team"
          />
          {teams.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="shrink-0 gap-1">
                  Pick team
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                {team && (
                  <DropdownMenuItem onSelect={() => onTeamChange('')} className="text-muted-foreground">
                    Clear selection
                  </DropdownMenuItem>
                )}
                {teams.map((t) => (
                  <DropdownMenuItem key={t.slug} onSelect={() => onTeamChange(t.slug)}>
                    <span className="truncate">
                      {t.name} <span className="text-muted-foreground">· {t.org}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <p className={fieldHelp}>
          Surface a team’s review queue (PRs where this team’s review was requested). The team’s org is added to the scope
          automatically. Leave blank for none.
        </p>
        {teamHint && <p className={fieldHelp}>{teamHint}</p>}
      </div>
    </>
  )
}
