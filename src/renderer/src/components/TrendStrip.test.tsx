import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrendStrip } from './TrendStrip'
import { DailyMetric, FeedEvent } from '@shared/types'

const history: DailyMetric[] = [
  { date: '2026-05-27', reviewQueue: 10, openWipSize: 100, merges: 2 },
  { date: '2026-06-03', reviewQueue: 12, openWipSize: 1400, merges: 1 }
]
const events: FeedEvent[] = []

describe('TrendStrip', () => {
  it('renders the four card labels and current values when expanded', () => {
    render(<TrendStrip history={history} events={events} collapsed={false} onToggleCollapsed={() => {}} />)
    expect(screen.getByText(/review queue/i)).toBeInTheDocument()
    expect(screen.getByText(/merges \/ wk/i)).toBeInTheDocument()
    expect(screen.getByText(/open wip/i)).toBeInTheDocument()
    expect(screen.getByText(/activity \/ day/i)).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument() // queue current
    expect(screen.getByText('1.4k')).toBeInTheDocument() // wip current, formatted
  })

  it('shows a collecting-data state per card when history is empty', () => {
    render(<TrendStrip history={[]} events={[]} collapsed={false} onToggleCollapsed={() => {}} />)
    expect(screen.getAllByText(/collecting/i).length).toBeGreaterThan(0)
  })

  it('hides the cards when collapsed', () => {
    render(<TrendStrip history={history} events={events} collapsed={true} onToggleCollapsed={() => {}} />)
    expect(screen.queryByText(/review queue/i)).not.toBeInTheDocument()
  })

  it('calls onToggleCollapsed when the toggle is clicked', () => {
    const onToggle = vi.fn()
    render(<TrendStrip history={history} events={events} collapsed={false} onToggleCollapsed={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: /trends/i }))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
