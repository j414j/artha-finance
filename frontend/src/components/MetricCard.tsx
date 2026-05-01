import { CSSProperties } from 'react'

interface MetricCardProps {
  label: string
  value: string
  change?: string
  changeType?: 'up' | 'down' | 'neutral'
  style?: CSSProperties
}

export default function MetricCard({
  label,
  value,
  change,
  changeType = 'neutral',
  style,
}: MetricCardProps) {
  const changeSymbols: Record<string, string> = {
    up: '▲',
    down: '▼',
    neutral: '—',
  }

  const changeColors: Record<string, string> = {
    up: 'var(--green)',
    down: 'var(--red)',
    neutral: 'var(--text2)',
  }

  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'var(--bg2)',
        borderRadius: '2px',
        ...style,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-cond)',
          fontSize: '9px',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--text3)',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '22px',
          color: 'var(--text)',
          margin: '4px 0 2px 0',
          letterSpacing: '-0.5px',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {change && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: changeColors[changeType],
          }}
        >
          {changeSymbols[changeType]} {change}
        </div>
      )}
    </div>
  )
}
