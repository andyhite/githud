import { describe, it, expect } from 'vitest'
import { moveSelection } from './selection'

describe('moveSelection', () => {
  it('clamps within [0, len)', () => {
    expect(moveSelection(0, 'down', 3)).toBe(1)
    expect(moveSelection(2, 'down', 3)).toBe(2)
    expect(moveSelection(0, 'up', 3)).toBe(0)
    expect(moveSelection(-1, 'down', 3)).toBe(0)
  })
  it('returns -1 for an empty list', () => {
    expect(moveSelection(0, 'down', 0)).toBe(-1)
  })
})
