import { linePoints } from './chart-geometry'

export function Sparkline({
  values,
  width = 96,
  height = 24,
  color = 'var(--blue)'
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (values.length === 0) return null
  return (
    <svg className="spark" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={linePoints(values, width, height, 2)} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  )
}
