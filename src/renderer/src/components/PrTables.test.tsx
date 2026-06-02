import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeedsReviewTable } from './NeedsReviewTable'
import { MyPullRequestsTable } from './MyPullRequestsTable'
import type { PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p1', number: 88, title: 'Fix nav focus trap', url: 'https://gh/88', repo: 'o/web',
    author: { login: 'asmith', avatarUrl: '' }, reviewers: [{ login: 'me', avatarUrl: '' }],
    reviewState: 'changes_requested', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'failure', passed: 11, failed: 1, total: 12 },
    updatedAt: '2026-06-01T00:00:00Z', isStale: true, isDraft: false, ...over
  }
}

beforeEach(() => { window.api = { openExternal: vi.fn() } as any })

describe('NeedsReviewTable', () => {
  it('renders an empty state with no rows', () => {
    render(<NeedsReviewTable items={[]} />)
    expect(screen.getByText(/nothing needs your review/i)).toBeInTheDocument()
  })

  it('renders a row and opens the PR on click', async () => {
    render(<NeedsReviewTable items={[pr()]} />)
    expect(screen.getByText('Fix nav focus trap')).toBeInTheDocument()
    expect(screen.getByText(/o\/web #88/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Fix nav focus trap'))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://gh/88')
  })

  it('lists requested reviewers as chips', () => {
    render(<NeedsReviewTable items={[pr({ reviewers: [{ login: 'me', avatarUrl: '' }, { login: 'bob', avatarUrl: '' }] })]} />)
    expect(screen.getByText('@me')).toBeInTheDocument()
    expect(screen.getByText('@bob')).toBeInTheDocument()
  })

  it('shows a dash when there are no reviewers', () => {
    render(<NeedsReviewTable items={[pr({ reviewers: [] })]} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('MyPullRequestsTable', () => {
  it('shows failing checks and changes-requested status', () => {
    render(<MyPullRequestsTable items={[pr()]} />)
    expect(screen.getByText(/1 failing/i)).toBeInTheDocument()
    expect(screen.getByText(/changes requested/i)).toBeInTheDocument()
    expect(screen.getByText('@me')).toBeInTheDocument()
  })

  it('renders an empty state with no rows', () => {
    render(<MyPullRequestsTable items={[]} />)
    expect(screen.getByText(/no open pull requests/i)).toBeInTheDocument()
  })
})
