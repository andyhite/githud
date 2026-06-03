import { describe, it, expect } from 'vitest'
import { linePoints, barRects } from './chart-geometry'

describe('linePoints', () => {
  it('returns an empty string for no values', () => {
    expect(linePoints([], 100, 10)).toBe('')
  })
  it('draws an ascending series from bottom-left to top-right', () => {
    // pad 0: min 0, max 2, span 2, stepX 50; y = h*(1 - (v-min)/span)
    expect(linePoints([0, 1, 2], 100, 10, 0)).toBe('0,10 50,5 100,0')
  })
  it('draws a flat series down the middle', () => {
    expect(linePoints([5, 5, 5], 100, 10, 0)).toBe('0,5 50,5 100,5')
  })
  it('centers a single value', () => {
    expect(linePoints([7], 100, 10)).toBe('0,5 100,5')
  })
})

describe('barRects', () => {
  it('returns an empty array for no values', () => {
    expect(barRects([], 100, 10)).toEqual([])
  })
  it('scales bar heights to the max value', () => {
    expect(barRects([2, 4], 20, 10, 0)).toEqual([
      { x: 0, y: 5, width: 10, height: 5 },
      { x: 10, y: 0, width: 10, height: 10 }
    ])
  })
})
