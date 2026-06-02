import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityFeed } from './ActivityFeed'
import type { ActivityItem } from '@shared/types'

function item(over: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 't1', reason: 'mention', subjectType: 'PullRequest', repo: 'o/web', number: 88,
    title: 'Fix nav focus trap', url: 'https://gh/88', unread: true, updatedAt: '2026-06-02T00:00:00Z',
    latestComment: { author: { login: 'asmith', avatarUrl: '' }, body: 'Please also handle the browser-chrome case.', createdAt: '2026-06-02T00:00:00Z' },
    ...over
  }
}

beforeEach(() => { window.api = { openExternal: vi.fn() } as any })

describe('ActivityFeed', () => {
  it('shows who acted, what happened, and the subject — not the comment body', () => {
    render(<ActivityFeed items={[item()]} />)
    expect(screen.getByText('asmith')).toBeInTheDocument()
    expect(screen.getByText(/mentioned you/i)).toBeInTheDocument()
    expect(screen.getByText('Fix nav focus trap')).toBeInTheDocument()
    expect(screen.getByText(/o\/web #88/)).toBeInTheDocument()
    expect(screen.queryByText(/please also handle the browser-chrome case/i)).not.toBeInTheDocument()
  })

  it('opens the thread on click', async () => {
    render(<ActivityFeed items={[item()]} />)
    await userEvent.click(screen.getByText(/fix nav focus trap/i))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://gh/88')
  })

  it('shows the resolved subject state instead of "changed state"', () => {
    render(<ActivityFeed items={[item({ id: 't3', reason: 'state_change', latestComment: undefined, subjectState: 'merged', title: 'Add token gate' })]} />)
    expect(screen.getByText('merged')).toBeInTheDocument()
    expect(screen.queryByText(/changed state/i)).not.toBeInTheDocument()
  })

  it('renders an empty state', () => {
    render(<ActivityFeed items={[]} />)
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument()
  })

  it('renders subject-only items without a comment body', () => {
    render(<ActivityFeed items={[item({ id: 't2', reason: 'ci_activity', latestComment: undefined, title: 'CI failed on main' })]} />)
    expect(screen.getByText(/ci failed on main/i)).toBeInTheDocument()
    expect(screen.getByText(/ci.activity/i)).toBeInTheDocument()
  })
})
