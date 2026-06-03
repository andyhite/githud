import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeedsReviewTable } from './NeedsReviewTable'
import { MyPullRequestsTable } from './MyPullRequestsTable'
import type { PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p1', number: 88, title: 'Fix nav focus trap', url: 'https://gh/88', repo: 'o/web',
    branch: 'fix/nav-focus-trap',
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

describe('hide / unhide', () => {
  it('calls onHide with the PR when the hide button is clicked', async () => {
    const onHide = vi.fn()
    render(<NeedsReviewTable items={[pr({ id: 'p1' })]} hiddenIds={[]} onHide={onHide} onUnhide={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^hide$/i }))
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('omits hidden rows from the table and counts them in the toggle', () => {
    const visible = pr({ id: 'p1', title: 'Visible PR' })
    const hidden = pr({ id: 'p2', title: 'Hidden PR' })
    render(<NeedsReviewTable items={[visible, hidden]} hiddenIds={['p2']} onHide={vi.fn()} onUnhide={vi.fn()} />)
    expect(screen.getByText('Visible PR')).toBeInTheDocument()
    expect(screen.queryByText('Hidden PR')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show hidden \(1\)/i })).toBeInTheDocument()
  })

  it('reveals hidden rows and unhides via the toggle', async () => {
    const visible = pr({ id: 'p1', title: 'Visible PR' })
    const hidden = pr({ id: 'p2', title: 'Hidden PR' })
    const onUnhide = vi.fn()
    render(<NeedsReviewTable items={[visible, hidden]} hiddenIds={['p2']} onHide={vi.fn()} onUnhide={onUnhide} />)
    await userEvent.click(screen.getByRole('button', { name: /show hidden \(1\)/i }))
    expect(screen.getByText('Hidden PR')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^unhide$/i }))
    expect(onUnhide).toHaveBeenCalledWith('p2')
  })

  it('works for MyPullRequestsTable too', async () => {
    const onHide = vi.fn()
    render(<MyPullRequestsTable items={[pr({ id: 'm1' })]} hiddenIds={[]} onHide={onHide} onUnhide={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^hide$/i }))
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }))
  })
})
