import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TokenSetup } from './token-setup'

describe('TokenSetup', () => {
  beforeEach(() => {
    window.api = {
      saveToken: vi.fn().mockResolvedValue({ ok: true, login: 'me' })
    } as any
  })

  it('disables submit until a token is entered', () => {
    render(<TokenSetup onSaved={() => {}} />)
    expect(screen.getByRole('button', { name: /save token/i })).toBeDisabled()
  })

  it('saves the token and calls onSaved on success', async () => {
    const onSaved = vi.fn()
    render(<TokenSetup onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'ghp_x')
    await userEvent.click(screen.getByRole('button', { name: /save token/i }))
    expect(window.api.saveToken).toHaveBeenCalledWith('ghp_x')
    expect(onSaved).toHaveBeenCalledWith('me')
  })

  it('shows an error when the token is rejected', async () => {
    window.api.saveToken = vi.fn().mockResolvedValue({ ok: false, error: 'Token rejected' })
    render(<TokenSetup onSaved={() => {}} />)
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'bad')
    await userEvent.click(screen.getByRole('button', { name: /save token/i }))
    expect(await screen.findByText(/token rejected/i)).toBeInTheDocument()
  })
})
