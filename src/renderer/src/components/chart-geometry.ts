export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const round = (n: number): number => Math.round(n * 10) / 10

// SVG polyline `points` string for a sparkline. `pad` insets the curve
// vertically so the stroke isn't clipped at the extremes.
export function linePoints(values: number[], width: number, height: number, pad = 2): string {
  if (values.length === 0) return ''
  if (values.length === 1) {
    const y = round(height / 2)
    return `0,${y} ${width},${y}`
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) {
    const y = round(height / 2)
    return values.map((_, i) => `${round((i * width) / (values.length - 1))},${y}`).join(' ')
  }
  const span = max - min
  const stepX = width / (values.length - 1)
  const usable = height - 2 * pad
  return values
    .map((v, i) => `${round(i * stepX)},${round(pad + usable * (1 - (v - min) / span))}`)
    .join(' ')
}

export function barRects(values: number[], width: number, height: number, gap = 2): Rect[] {
  if (values.length === 0) return []
  const max = Math.max(...values, 0) || 1
  const barW = (width - gap * (values.length - 1)) / values.length
  return values.map((v, i) => {
    const h = height * (v / max)
    return { x: round(i * (barW + gap)), y: round(height - h), width: round(barW), height: round(h) }
  })
}
