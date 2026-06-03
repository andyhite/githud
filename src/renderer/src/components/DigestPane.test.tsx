import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DigestPane } from './DigestPane'
import type { DigestResult } from '@shared/types'

describe('DigestPane', () => {
  it('renders the delta sentence when present', () => {
    const d: DigestResult = { markdown: 'alice approved o/web #88; CI went green on o/api #12', generatedAt: 'x', mode: 'delta', eventCount: 2 }
    render(<DigestPane digest={d} />)
    expect(screen.getByText(/alice approved o\/web #88/)).toBeInTheDocument()
  })

  it('shows a caught-up state when there is no digest', () => {
    render(<DigestPane digest={null} />)
    expect(screen.getByText(/caught up/i)).toBeInTheDocument()
  })

  it('shows a caught-up state when the digest text is empty', () => {
    render(<DigestPane digest={{ markdown: '', generatedAt: 'x', mode: 'delta' }} />)
    expect(screen.getByText(/caught up/i)).toBeInTheDocument()
  })
})
