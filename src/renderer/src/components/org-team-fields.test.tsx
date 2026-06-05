import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrgTeamFields } from './org-team-fields'

const teams = [
  { slug: 'acme/frontend', name: 'Frontend', org: 'acme' },
  { slug: 'acme/platform', name: 'Platform', org: 'acme' }
]

beforeEach(() => {
  window.api = {
    listOrgs: vi.fn().mockResolvedValue({ ok: true, items: ['acme', 'globex'] }),
    listTeams: vi.fn().mockResolvedValue({ ok: true, items: teams })
  } as any
})

describe('OrgTeamFields', () => {
  it('suggests fetched orgs not already selected, and adds one on click', async () => {
    const onOrgsChange = vi.fn()
    render(<OrgTeamFields orgs={['acme']} team="" onOrgsChange={onOrgsChange} onTeamChange={vi.fn()} />)
    // 'acme' is already selected → only 'globex' is suggested.
    const add = await screen.findByRole('button', { name: /add globex/i })
    expect(screen.queryByRole('button', { name: /add acme/i })).not.toBeInTheDocument()
    await userEvent.click(add)
    expect(onOrgsChange).toHaveBeenCalledWith(['acme', 'globex'])
  })

  it('picks a team from the dropdown and writes the org/team slug', async () => {
    const onTeamChange = vi.fn()
    render(<OrgTeamFields orgs={[]} team="" onOrgsChange={vi.fn()} onTeamChange={onTeamChange} />)
    await userEvent.click(await screen.findByRole('button', { name: /pick team/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /platform/i }))
    expect(onTeamChange).toHaveBeenCalledWith('acme/platform')
  })

  it('falls back to free-text with a scope hint when listing is forbidden', async () => {
    window.api.listOrgs = vi.fn().mockResolvedValue({ ok: false, reason: 'scope' })
    window.api.listTeams = vi.fn().mockResolvedValue({ ok: false, reason: 'scope' })
    render(<OrgTeamFields orgs={[]} team="" onOrgsChange={vi.fn()} onTeamChange={vi.fn()} />)
    // The free-text inputs remain usable...
    expect(screen.getByLabelText(/organizations/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^team$/i)).toBeInTheDocument()
    // ...no picker, and a read:org hint appears.
    await waitFor(() => expect(screen.queryByRole('button', { name: /pick team/i })).not.toBeInTheDocument())
    expect(screen.getAllByText(/read:org/i).length).toBeGreaterThan(0)
  })
})
