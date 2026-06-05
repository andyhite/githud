import { Line, LineChart, Bar, BarChart, ResponsiveContainer } from 'recharts'

export function TrendChart({
  values,
  viz,
  color
}: {
  values: number[]
  viz: 'line' | 'bars'
  color: string
}) {
  const data = values.map((v, i) => ({ i, v }))
  return (
    <ResponsiveContainer width="100%" height={28}>
      {viz === 'line' ? (
        <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      ) : (
        <BarChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <Bar dataKey="v" fill={color} radius={1} isAnimationActive={false} />
        </BarChart>
      )}
    </ResponsiveContainer>
  )
}
