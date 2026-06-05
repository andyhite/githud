import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrTable, type PrColumn } from './pr-table'
import { ShowHiddenToggle } from './show-hidden-toggle'
import type { PullRequest } from '@shared/types'

// Column configs mirroring how App.tsx wires each panel, so the assertions below
// exercise the same rendering the old NeedsReviewTable / MyPullRequestsTable did.
const REVIEW_COLS: PrColumn[] = ['diff', 'status', 'age']
const REVIEW_COLS_AI: PrColumn[] = ['diff', 'status', 'triage', 'age']
const MINE_COLS: PrColumn[] = ['diff', 'status', 'reviewers', 'age']

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'p1', number: 88, title: 'Fix nav focus trap', url: 'https://gh/88', repo: 'o/web',
    branch: 'fix/nav-focus-trap', baseBranch: 'main',
    author: { login: 'asmith', avatarUrl: '' }, reviewers: [{ login: 'me', avatarUrl: '' }],
    reviewState: 'changes_requested', approvals: 0, mergeable: 'mergeable',
    checks: { state: 'failure', passed: 11, failed: 1, total: 12 },
    additions: 40, deletions: 8, changedFiles: 3, unresolvedThreads: 0, labels: [],
    updatedAt: '2026-06-01T00:00:00Z', isStale: true, isDraft: false, isQueued: false, ...over
  }
}

beforeEach(() => { window.api = { openExternal: vi.fn(), copyToClipboard: vi.fn() } as any })

describe('PrTable (needs-review config)', () => {
  it('renders an empty state with no rows', () => {
    render(<PrTable items={[]} columns={REVIEW_COLS} emptyVariant="review" />)
    expect(screen.getByText(/inbox zero/i)).toBeInTheDocument()
  })

  it('shows the empty state when every item is hidden and hidden rows are collapsed', () => {
    render(<PrTable items={[pr({ id: 'p1' })]} columns={REVIEW_COLS} emptyVariant="review" hiddenIds={['p1']} showHidden={false} />)
    expect(screen.getByText(/inbox zero/i)).toBeInTheDocument()
  })

  it('shows the hidden rows (not the empty state) when hidden rows are expanded', () => {
    render(<PrTable items={[pr({ id: 'p1' })]} columns={REVIEW_COLS} emptyVariant="review" hiddenIds={['p1']} showHidden={true} />)
    expect(screen.queryByText(/inbox zero/i)).not.toBeInTheDocument()
    expect(screen.getByText('Fix nav focus trap')).toBeInTheDocument()
  })

  it('renders a row with author + checks in the meta line and opens the PR on click', async () => {
    render(<PrTable items={[pr()]} columns={REVIEW_COLS} emptyVariant="review" showAuthor />)
    expect(screen.getByText('Fix nav focus trap')).toBeInTheDocument()
    expect(screen.getByText(/o\/web #88/)).toBeInTheDocument()
    expect(screen.getByText('asmith')).toBeInTheDocument() // author now in the PR meta line
    expect(screen.getByText(/1 failing/i)).toBeInTheDocument() // checks now in the PR meta line
    await userEvent.click(screen.getByText('Fix nav focus trap'))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://gh/88')
  })

  it('shows the AI triage chip in its own column only when AI is enabled', () => {
    const verdict = { prId: 'p1', label: 'quick_approve', rationale: 'small', focusHint: 'n/a' } as any
    const { rerender } = render(<PrTable items={[pr({ id: 'p1' })]} columns={REVIEW_COLS} emptyVariant="review" />)
    expect(screen.queryByText(/quick approve/i)).not.toBeInTheDocument() // no triage column without aiOn
    rerender(<PrTable items={[pr({ id: 'p1' })]} columns={REVIEW_COLS_AI} emptyVariant="review" aiOn verdicts={{ p1: verdict }} />)
    expect(screen.getByText(/quick approve/i)).toBeInTheDocument()
  })

  it('shows the diff stat, stacked base, and unresolved-thread count', () => {
    render(<PrTable items={[pr({ additions: 40, deletions: 8, changedFiles: 3, baseBranch: 'feature/parent', unresolvedThreads: 3 })]} columns={REVIEW_COLS} emptyVariant="review" />)
    expect(screen.getByText('+40')).toBeInTheDocument()
    expect(screen.getByText(/[−-]8/)).toBeInTheDocument()
    expect(screen.getByText(/→ feature\/parent/)).toBeInTheDocument()
    expect(screen.getByText(/3 unresolved/)).toBeInTheDocument()
  })

  it('hides the base marker for PRs targeting the default branch', () => {
    render(<PrTable items={[pr({ baseBranch: 'main' })]} columns={REVIEW_COLS} emptyVariant="review" />)
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })

  it('shows a status tag in its own column', () => {
    render(<PrTable items={[pr({ reviewState: 'changes_requested' })]} columns={REVIEW_COLS} emptyVariant="review" />)
    expect(screen.getByText(/changes requested/i)).toBeInTheDocument()
  })

  it('copies the PR link from the actions menu', async () => {
    render(<PrTable items={[pr({ url: 'https://gh/88', branch: 'feat/x' })]} columns={REVIEW_COLS} emptyVariant="review" />)
    await userEvent.click(screen.getByRole('button', { name: /row actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /copy pr link/i }))
    expect(window.api.copyToClipboard).toHaveBeenCalledWith('https://gh/88')
  })
})

describe('PrTable (my-open-PRs config)', () => {
  it('shows failing checks (in the meta line) and changes-requested status', () => {
    render(<PrTable items={[pr()]} columns={MINE_COLS} emptyVariant="mine" />)
    expect(screen.getByText(/1 failing/i)).toBeInTheDocument()
    expect(screen.getByText(/changes requested/i)).toBeInTheDocument()
  })

  it('lists who the PR is waiting on as reviewer chips', () => {
    render(<PrTable items={[pr({ reviewers: [{ login: 'me', avatarUrl: '' }, { login: 'bob', avatarUrl: '' }] })]} columns={MINE_COLS} emptyVariant="mine" />)
    expect(screen.getByText('@me')).toBeInTheDocument()
    expect(screen.getByText('@bob')).toBeInTheDocument()
  })

  it('shows a dash when there are no reviewers', () => {
    render(<PrTable items={[pr({ reviewers: [] })]} columns={MINE_COLS} emptyVariant="mine" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('surfaces approval even when a higher-priority status (failing CI) would mask it', () => {
    render(
      <PrTable
        items={[pr({ reviewState: 'approved', approvals: 2, checks: { state: 'failure', passed: 1, failed: 1, total: 2 } })]}
        columns={MINE_COLS}
        emptyVariant="mine"
      />
    )
    expect(screen.getByText(/CI failing/i)).toBeInTheDocument() // primary status still shown
    expect(screen.getByText(/✓ 2/)).toBeInTheDocument() // approval no longer masked
  })

  it('shows "queued to merge" instead of the approval count when the PR is in the merge queue', () => {
    render(
      <PrTable
        items={[pr({ reviewState: 'approved', approvals: 3, isQueued: true })]}
        columns={MINE_COLS}
        emptyVariant="mine"
      />
    )
    expect(screen.getByText(/queued to merge/i)).toBeInTheDocument()
    expect(screen.queryByText(/✓ 3/)).not.toBeInTheDocument()
    expect(screen.queryByText(/3 approval/i)).not.toBeInTheDocument()
  })

  it('does not duplicate approval when the status chip already shows the approval count', () => {
    // approved + CI still pending + mergeable → statusTag falls through to "N approvals"
    render(
      <PrTable
        items={[pr({ reviewState: 'approved', approvals: 1, mergeable: 'mergeable', checks: { state: 'pending', passed: 0, failed: 0, total: 1 } })]}
        columns={MINE_COLS}
        emptyVariant="mine"
      />
    )
    expect(screen.getByText(/1 approval/i)).toBeInTheDocument()
    expect(screen.queryByText(/✓ 1/)).not.toBeInTheDocument()
  })

  it('renders an empty state with no rows', () => {
    render(<PrTable items={[]} columns={MINE_COLS} emptyVariant="mine" />)
    expect(screen.getByText(/nothing in flight/i)).toBeInTheDocument()
  })

  it('shows the empty state when every item is hidden and hidden rows are collapsed', () => {
    render(<PrTable items={[pr({ id: 'p1' })]} columns={MINE_COLS} emptyVariant="mine" hiddenIds={['p1']} showHidden={false} />)
    expect(screen.getByText(/nothing in flight/i)).toBeInTheDocument()
  })
})

describe('PrTable (team config)', () => {
  it('shows the author when showAuthor is set', () => {
    render(<PrTable items={[pr({ author: { login: 'teammate', avatarUrl: '' } })]} columns={MINE_COLS} emptyVariant="team" showAuthor />)
    expect(screen.getByText('teammate')).toBeInTheDocument()
  })

  it('renders the team empty-state copy when there are no rows', () => {
    render(<PrTable items={[]} columns={MINE_COLS} emptyVariant="team" />)
    expect(screen.getByText(/no team prs/i)).toBeInTheDocument()
  })
})

describe('PrTable (card layout on narrow viewports)', () => {
  // Force the narrow viewport so useNarrowViewport() flips to the card layout.
  // It reads window.matchMedia; jsdom doesn't implement it, so we stub a matching
  // query here and remove it afterwards (other suites run with it absent → table).
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) as unknown as typeof window.matchMedia
  })
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia
  })

  it('renders cards (no table) with the PR title, status, and diff when narrow', () => {
    const { container } = render(<PrTable items={[pr()]} columns={REVIEW_COLS} emptyVariant="review" showAuthor />)
    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByText('Fix nav focus trap')).toBeInTheDocument()
    expect(screen.getByText(/changes requested/i)).toBeInTheDocument()
    expect(screen.getByText('+40')).toBeInTheDocument()
  })

  it('shows the "Waiting on" reviewer line for columns that include reviewers', () => {
    render(
      <PrTable
        items={[pr({ reviewers: [{ login: 'bob', avatarUrl: '' }] })]}
        columns={MINE_COLS}
        emptyVariant="mine"
      />
    )
    expect(screen.getByText(/waiting on/i)).toBeInTheDocument()
    expect(screen.getByText('@bob')).toBeInTheDocument()
  })

  it('still exposes row actions (hide) in card layout', async () => {
    const onHide = vi.fn()
    render(<PrTable items={[pr({ id: 'p1' })]} columns={REVIEW_COLS} emptyVariant="review" hiddenIds={[]} onHide={onHide} onUnhide={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /row actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^hide$/i }))
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })
})

describe('hide / unhide', () => {
  it('calls onHide with the PR when Hide is selected from the actions menu', async () => {
    const onHide = vi.fn()
    render(<PrTable items={[pr({ id: 'p1' })]} columns={REVIEW_COLS} emptyVariant="review" hiddenIds={[]} onHide={onHide} onUnhide={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /row actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^hide$/i }))
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('omits hidden rows by default and shows them when showHidden is set', () => {
    const visible = pr({ id: 'p1', title: 'Visible PR' })
    const hidden = pr({ id: 'p2', title: 'Hidden PR' })
    const { rerender } = render(<PrTable items={[visible, hidden]} columns={REVIEW_COLS} emptyVariant="review" hiddenIds={['p2']} onHide={vi.fn()} onUnhide={vi.fn()} />)
    expect(screen.getByText('Visible PR')).toBeInTheDocument()
    expect(screen.queryByText('Hidden PR')).not.toBeInTheDocument()
    rerender(<PrTable items={[visible, hidden]} columns={REVIEW_COLS} emptyVariant="review" hiddenIds={['p2']} showHidden onHide={vi.fn()} onUnhide={vi.fn()} />)
    expect(screen.getByText('Hidden PR')).toBeInTheDocument()
  })

  it('unhides a revealed row via the actions menu', async () => {
    const visible = pr({ id: 'p1', title: 'Visible PR' })
    const hidden = pr({ id: 'p2', title: 'Hidden PR' })
    const onUnhide = vi.fn()
    render(<PrTable items={[visible, hidden]} columns={REVIEW_COLS} emptyVariant="review" hiddenIds={['p2']} showHidden onHide={vi.fn()} onUnhide={onUnhide} />)
    const hiddenRow = screen.getByText('Hidden PR').closest('tr')!
    await userEvent.click(within(hiddenRow).getByRole('button', { name: /row actions/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^unhide$/i }))
    expect(onUnhide).toHaveBeenCalledWith('p2')
  })

  it('works for the my-open-PRs config too', async () => {
    const onHide = vi.fn()
    render(<PrTable items={[pr({ id: 'm1' })]} columns={MINE_COLS} emptyVariant="mine" hiddenIds={[]} onHide={onHide} onUnhide={vi.fn()} />)
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
