interface ProgressBarProps {
  value: number
  variant?: 'green' | 'amber' | 'red'
}

export default function ProgressBar({ value, variant = 'green' }: ProgressBarProps) {
  const variantColors: Record<string, string> = {
    green: 'var(--green)',
    amber: 'var(--accent)',
    red: 'var(--red)',
  }

  const clampedValue = Math.min(Math.max(value, 0), 100)
  const color = variantColors[variant]

  return (
    <div
      style={{
        height: '3px',
        width: '100%',
        background: 'var(--bg4)',
        borderRadius: '1px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '3px',
          width: `${clampedValue}%`,
          background: color,
          transition: 'width 0.3s',
        }}
      />
    </div>
  )
}
