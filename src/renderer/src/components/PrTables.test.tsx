import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeedsReviewTable, ShowHiddenToggle } from './NeedsReviewTable'
import { MyPullRequestsTable } from './MyPullRequestsTable'
import type { PullRequest } from '@shared/types'

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p1', number: 88, title: 'Fix nav focus trap', url: 'https://gh/88', repo: 'o/web',
    branch: 'fix/nav-focus-trap', baseBranch: 'main',
    author: { login: 'asmith', avatarUrl: '' }, reviewers: [{ login: 'me', avatarUrl: '' }],
    reviewState: 'changes_requested', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'failure', passed: 11, failed: 1, total: 12 },
    additions: 40, deletions: 8, changedFiles: 3, unresolvedThreads: 0,
    updatedAt: '2026-06-01T00:00:00Z', isStale: true, isDraft: false, ...over
  }
}

beforeEach(() => { window.api = { openExternal: vi.fn(), copyToClipboard: vi.fn() } as any })

describe('NeedsReviewTable', () => {
  it('renders an empty state with no rows', () => {
    render(<NeedsReviewTable items={[]} />)
    expect(screen.getByText(/nothing needs your review/i)).toBeInTheDocument()
  })

  it('renders a row with author + checks in the meta line and opens the PR on click', async () => {
    render(<NeedsReviewTable items={[pr()]} />)
    expect(screen.getByText('Fix nav focus trap')).toBeInTheDocument()
    expect(screen.getByText(/o\/web #88/)).toBeInTheDocument()
    expect(screen.getByText('asmith')).toBeInTheDocument() // author now in the PR meta line
    expect(screen.getByText(/1 failing/i)).toBeInTheDocument() // checks now in the PR meta line
    await userEvent.click(screen.getByText('Fix nav focus trap'))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://gh/88')
  })

  it('shows the AI triage chip in its own column only when AI is enabled', () => {
    const verdict = { prId: 'p1', label: 'quick_approve', rationale: 'small', focusHint: 'n/a' } as any
    const { rerender } = render(<NeedsReviewTable items={[pr({ id: 'p1' })]} />)
    expect(screen.queryByText(/quick approve/i)).not.toBeInTheDocument() // no triage column without aiOn
    rerender(<NeedsReviewTable items={[pr({ id: 'p1' })]} aiOn verdicts={{ p1: verdict }} />)
    expect(screen.getByText(/quick approve/i)).toBeInTheDocument()
  })

  it('shows the diff stat, stacked base, and unresolved-thread count', () => {
    render(<NeedsReviewTable items={[pr({ additions: 40, deletions: 8, changedFiles: 3, baseBranch: 'feature/parent', unresolvedThreads: 3 })]} />)
    expect(screen.getByText('+40')).toBeInTheDocument()
    expect(screen.getByText(/[−-]8/)).toBeInTheDocument()
    expect(screen.getByText(/→ feature\/parent/)).toBeInTheDocument()
    expect(screen.getByText(/3 unresolved/)).toBeInTheDocument()
  })

  it('hides the base marker for PRs targeting the default branch', () => {
    render(<NeedsReviewTable items={[pr({ baseBranch: 'main' })]} />)
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })

  it('shows a status tag in its own column', () => {
    render(<NeedsReviewTable items={[pr({ reviewState: 'changes_requested' })]} />)
    expect(screen.getByText(/changes requested/i)).toBeInTheDocument()
  })

  it('copies the PR link from the actions menu', async () => {
    render(<NeedsReviewTable items={[pr({ url: 'https://gh/88', branch: 'feat/x' })]} />)
    await userEvent.click(screen.getByRole('button', { name: /row actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /copy pr link/i }))
    expect(window.api.copyToClipboard).toHaveBeenCalledWith('https://gh/88')
  })
})

describe('MyPullRequestsTable', () => {
  it('shows failing checks (in the meta line) and changes-requested status', () => {
    render(<MyPullRequestsTable items={[pr()]} />)
    expect(screen.getByText(/1 failing/i)).toBeInTheDocument()
    expect(screen.getByText(/changes requested/i)).toBeInTheDocument()
  })

  it('lists who the PR is waiting on as reviewer chips', () => {
    render(<MyPullRequestsTable items={[pr({ reviewers: [{ login: 'me', avatarUrl: '' }, { login: 'bob', avatarUrl: '' }] })]} />)
    expect(screen.getByText('@me')).toBeInTheDocument()
    expect(screen.getByText('@bob')).toBeInTheDocument()
  })

  it('shows a dash when there are no reviewers', () => {
    render(<MyPullRequestsTable items={[pr({ reviewers: [] })]} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders an empty state with no rows', () => {
    render(<MyPullRequestsTable items={[]} />)
    expect(screen.getByText(/no open pull requests/i)).toBeInTheDocument()
  })
})

describe('hide / unhide', () => {
  it('calls onHide with the PR when Hide is selected from the actions menu', async () => {
    const onHide = vi.fn()
    render(<NeedsReviewTable items={[pr({ id: 'p1' })]} hiddenIds={[]} onHide={onHide} onUnhide={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /row actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^hide$/i }))
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('omits hidden rows by default and shows them when showHidden is set', () => {
    const visible = pr({ id: 'p1', title: 'Visible PR' })
    const hidden = pr({ id: 'p2', title: 'Hidden PR' })
    const { rerender } = render(<NeedsReviewTable items={[visible, hidden]} hiddenIds={['p2']} onHide={vi.fn()} onUnhide={vi.fn()} />)
    expect(screen.getByText('Visible PR')).toBeInTheDocument()
    expect(screen.queryByText('Hidden PR')).not.toBeInTheDocument()
    rerender(<NeedsReviewTable items={[visible, hidden]} hiddenIds={['p2']} showHidden onHide={vi.fn()} onUnhide={vi.fn()} />)
    expect(screen.getByText('Hidden PR')).toBeInTheDocument()
  })

  it('unhides a revealed row via the actions menu', async () => {
    const visible = pr({ id: 'p1', title: 'Visible PR' })
    const hidden = pr({ id: 'p2', title: 'Hidden PR' })
    const onUnhide = vi.fn()
    render(<NeedsReviewTable items={[visible, hidden]} hiddenIds={['p2']} showHidden onHide={vi.fn()} onUnhide={onUnhide} />)
    const hiddenRow = screen.getByText('Hidden PR').closest('tr')!
    await userEvent.click(within(hiddenRow).getByRole('button', { name: /row actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^unhide$/i }))
    expect(onUnhide).toHaveBeenCalledWith('p2')
  })

  it('works for MyPullRequestsTable too', async () => {
    const onHide = vi.fn()
    render(<MyPullRequestsTable items={[pr({ id: 'm1' })]} hiddenIds={[]} onHide={onHide} onUnhide={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /row actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^hide$/i }))
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }))
  })
})

describe('ShowHiddenToggle', () => {
  it('renders nothing when there are no hidden rows', () => {
    const { container } = render(<ShowHiddenToggle count={0} open={false} onToggle={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the count and toggles', async () => {
    const onToggle = vi.fn()
    const { rerender } = render(<ShowHiddenToggle count={3} open={false} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('button', { name: /show hidden \(3\)/i }))
    expect(onToggle).toHaveBeenCalled()
    rerender(<ShowHiddenToggle count={3} open onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: /hide hidden/i })).toBeInTheDocument()
  })
})
