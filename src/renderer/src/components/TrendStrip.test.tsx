import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrendStrip } from './TrendStrip'
import { DailyMetric, FeedEvent } from '@shared/types'

const history: DailyMetric[] = [
  { date: '2026-05-27', reviewQueue: 10, openWipSize: 100, merges: 2 },
  { date: '2026-06-03', reviewQueue: 12, openWipSize: 1400, merges: 1 }
]
const events: FeedEvent[] = []

describe('TrendStrip', () => {
  it('renders the four card labels and current values', () => {
    render(<TrendStrip history={history} events={events} />)
    expect(screen.getByText(/review queue/i)).toBeInTheDocument()
    expect(screen.getByText(/merges \/ wk/i)).toBeInTheDocument()
    expect(screen.getByText(/open wip/i)).toBeInTheDocument()
    expect(screen.getByText(/activity \/ day/i)).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument() // queue current
    expect(screen.getByText('1.4k')).toBeInTheDocument() // wip current, formatted
  })

  it('shows a collecting-data state per card when history is empty', () => {
    render(<TrendStrip history={[]} events={[]} />)
    expect(screen.getAllByText(/collecting/i).length).toBeGreaterThan(0)
  })
})
