import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from './Settings'
import { DEFAULT_SETTINGS } from '@shared/types'

beforeEach(() => {
  window.api = {
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockImplementation((s) => Promise.resolve(s))
  } as any
})

describe('Settings', () => {
  it('loads current settings and saves edits', async () => {
    render(<Settings onClose={() => {}} />)
    const hideBots = await screen.findByLabelText(/hide bot/i)
    expect(hideBots).toBeChecked() // default true
    await userEvent.click(hideBots)

    const authors = screen.getByLabelText(/excluded authors/i)
    await userEvent.clear(authors)
    await userEvent.type(authors, 'noisybot, anotherbot')

    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(window.api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ hideBots: false, excludedAuthors: ['noisybot', 'anotherbot'] })
    )
  })

  it('saves launch-at-login', async () => {
    render(<Settings onClose={() => {}} />)
    await userEvent.click(await screen.findByLabelText(/launch at login/i))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(window.api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ launchAtLogin: true }))
  })

  it('toggles a notify-kind and enables quiet hours', async () => {
    render(<Settings onClose={() => {}} />)
    const approvals = await screen.findByLabelText(/approvals/i)
    await userEvent.click(approvals) // 'approved' is off by default in DEFAULT_SETTINGS.notifyKinds; click adds it
    await userEvent.click(screen.getByLabelText(/quiet hours/i))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(window.api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyKinds: expect.arrayContaining(['approved']),
        quietHours: { start: '18:00', end: '09:00' }
      })
    )
  })
})
