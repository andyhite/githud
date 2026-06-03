import { barRects } from './chart-geometry'

export function MiniBars({
  values,
  width = 96,
  height = 24,
  color = 'var(--green)'
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (values.length === 0) return null
  return (
    <svg className="spark" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {barRects(values, width, height, 3).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={color} rx={1} />
      ))}
    </svg>
  )
}
