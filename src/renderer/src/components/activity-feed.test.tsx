import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityFeed } from './activity-feed'
import type { FeedEvent } from '@shared/types'

function ev(over: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id: 'e1', kind: 'approved', repo: 'o/web', number: 88, title: 'Fix nav focus trap',
    url: 'https://gh/88', createdAt: '2026-06-02T00:00:00Z', unread: true,
    actor: { login: 'alice', avatarUrl: '' }, ...over
  }
}

beforeEach(() => { window.api = { openExternal: vi.fn(), markRead: vi.fn().mockResolvedValue([]) } as any })

describe('ActivityFeed', () => {
  it('shows the actor, action phrasing, and subject', () => {
    render(<ActivityFeed events={[ev()]} onRead={vi.fn()} />)
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText(/approved/i)).toBeInTheDocument()
    expect(screen.getByText('Fix nav focus trap')).toBeInTheDocument()
    expect(screen.getByText(/o\/web #88/)).toBeInTheDocument()
  })

  it('phrases a mention and a CI failure', () => {
    render(<ActivityFeed events={[ev({ id: 'm', kind: 'mention' }), ev({ id: 'c', kind: 'ci_failed', actor: undefined })]} onRead={vi.fn()} />)
    expect(screen.getByText(/mentioned you/i)).toBeInTheDocument()
    expect(screen.getByText(/checks failed/i)).toBeInTheDocument()
  })

  it('opens the event and marks it read on click', async () => {
    const onRead = vi.fn()
    render(<ActivityFeed events={[ev()]} onRead={onRead} />)
    await userEvent.click(screen.getByText('Fix nav focus trap'))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://gh/88')
    expect(onRead).toHaveBeenCalledWith('e1')
  })

  it('renders an empty state', () => {
    render(<ActivityFeed events={[]} onRead={vi.fn()} />)
    expect(screen.getByText(/all quiet/i)).toBeInTheDocument()
  })
})
