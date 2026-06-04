import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { Settings } from './Settings'
import { ThemeProvider } from './theme-provider'
import { DEFAULT_SETTINGS } from '@shared/types'

// Settings reads useTheme() for the Appearance section, so renders need the provider.
const render = (ui: ReactElement) => rtlRender(<ThemeProvider>{ui}</ThemeProvider>)

beforeEach(() => {
  window.api = {
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockImplementation((s) => Promise.resolve(s)),
    getAiStatus: vi.fn().mockResolvedValue({ hasKey: false }),
    saveAiKey: vi.fn().mockResolvedValue({ ok: true }),
    getAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, login: 'me' }),
    saveToken: vi.fn().mockResolvedValue({ ok: true, login: 'me' }),
    getReviewInstructions: vi.fn().mockResolvedValue(''),
    saveReviewInstructions: vi.fn().mockResolvedValue(undefined),
    resetReviewInstructions: vi.fn().mockResolvedValue('')
  } as any
})

const openSection = (name: RegExp) =>
  screen.findByRole('tab', { name }).then((tab) => userEvent.click(tab))
const save = () => userEvent.click(screen.getByRole('button', { name: /save/i }))

describe('Settings', () => {
  it('opens on the General section and switches sections via the nav', async () => {
    render(<Settings onClose={() => {}} />)
    // General section is active first: its slider is present, Connections fields are not.
    expect(await screen.findByLabelText(/api budget/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/github token/i)).not.toBeInTheDocument()

    await openSection(/connections/i)
    expect(await screen.findByLabelText(/github token/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/api budget/i)).not.toBeInTheDocument()
  })

  it('adds and saves excluded-author chips', async () => {
    render(<Settings onClose={() => {}} />)
    await openSection(/filters/i)
    const authors = screen.getByLabelText(/excluded authors/i)
    await userEvent.type(authors, 'noisybot{Enter}anotherbot{Enter}')
    await save()
    expect(window.api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ excludedAuthors: ['noisybot', 'anotherbot'] })
    )
  })

  it('shows existing Other-PRs label chips and adds a new one', async () => {
    window.api.getSettings = vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, teamLabels: ['frontend'] })
    render(<Settings onClose={() => {}} />)
    await openSection(/filters/i)
    expect(screen.getByText('frontend')).toBeInTheDocument() // seeded teamLabels chip
    await userEvent.type(screen.getByLabelText(/^labels$/i), 'backend{Enter}')
    await save()
    expect(window.api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ teamLabels: ['frontend', 'backend'] })
    )
  })

  it('removes an Other-PRs label chip', async () => {
    window.api.getSettings = vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, teamLabels: ['frontend'] })
    render(<Settings onClose={() => {}} />)
    await openSection(/filters/i)
    await userEvent.click(screen.getByRole('button', { name: /remove frontend/i }))
    await save()
    expect(window.api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ teamLabels: [] }))
  })

  it('updates the GitHub token via saveToken when one is entered', async () => {
    render(<Settings onClose={() => {}} />)
    await openSection(/connections/i)
    expect(await screen.findByText(/connected as @me/i)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/github token/i), 'ghp_new')
    await save()
    expect(window.api.saveToken).toHaveBeenCalledWith('ghp_new')
  })

  it('keeps the panel open and shows an error when GitHub rejects the token', async () => {
    window.api.saveToken = vi.fn().mockResolvedValue({ ok: false, error: 'Token rejected by GitHub.' })
    const onClose = vi.fn()
    render(<Settings onClose={onClose} />)
    await openSection(/connections/i)
    await userEvent.type(screen.getByLabelText(/github token/i), 'bad')
    await save()
    expect(await screen.findByText(/token rejected/i)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(window.api.saveSettings).not.toHaveBeenCalled() // bailed before saving the rest
  })

  it('saves an edited refresh interval via the preset control', async () => {
    render(<Settings onClose={() => {}} />)
    const group = await screen.findByRole('group', { name: /refresh interval/i })
    await userEvent.click(within(group).getByRole('radio', { name: '2m' }))
    await save()
    expect(window.api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ refreshIntervalSeconds: 120 }))
  })

  it('saves an edited API budget via the slider', async () => {
    render(<Settings onClose={() => {}} />)
    const budget = await screen.findByLabelText(/api budget/i)
    // Radix Slider is a focusable thumb, not a native range input; it responds
    // to arrow keys (step 5). Default budget is 80; six ArrowDowns lands on 50.
    for (let i = 0; i < 6; i++) fireEvent.keyDown(budget, { key: 'ArrowDown' })
    await save()
    expect(window.api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ apiBudgetPercent: 50 }))
  })

  it('saves launch-at-login via its toggle', async () => {
    render(<Settings onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('switch', { name: /launch at login/i }))
    await save()
    expect(window.api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ launchAtLogin: true }))
  })

  it('toggles a notify-kind and enables quiet hours', async () => {
    render(<Settings onClose={() => {}} />)
    await openSection(/notifications/i)
    await userEvent.click(screen.getByLabelText(/approvals/i)) // 'approved' off by default; click adds it
    await userEvent.click(screen.getByRole('switch', { name: /quiet hours/i }))
    await save()
    expect(window.api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyKinds: expect.arrayContaining(['approved']),
        quietHours: { start: '22:00', end: '08:00' }
      })
    )
  })
})
