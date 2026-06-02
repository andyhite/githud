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
  it('renders the full comment body and a reason badge', () => {
    render(<ActivityFeed items={[item()]} />)
    expect(screen.getByText(/please also handle the browser-chrome case/i)).toBeInTheDocument()
    expect(screen.getByText(/mention/i)).toBeInTheDocument()
    expect(screen.getByText(/o\/web #88/)).toBeInTheDocument()
  })

  it('opens the thread on click', async () => {
    render(<ActivityFeed items={[item()]} />)
    await userEvent.click(screen.getByText(/fix nav focus trap/i))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://gh/88')
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
