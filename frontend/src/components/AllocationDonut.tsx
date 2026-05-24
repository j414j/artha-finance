import { formatMoney } from '../utils/format'
import type { DonutSegment } from '../utils/allocation'
import BlurredValue from './BlurredValue'

function DonutSvg({ segments }: { segments: DonutSegment[] }) {
  const visible = segments.filter((s) => s.value > 0)
  const total = visible.reduce((sum, s) => sum + s.value, 0)
  const radius = 56
  const circumference = 2 * Math.PI * radius

  if (total === 0) {
    return (
      <svg width={160} height={160} viewBox="0 0 160 160" aria-hidden="true">
        <circle cx={80} cy={80} r={radius} fill="none" stroke="var(--border)" strokeWidth={24} />
      </svg>
    )
  }

  if (visible.length === 1) {
    return (
      <svg width={160} height={160} viewBox="0 0 160 160" aria-hidden="true">
        <circle cx={80} cy={80} r={radius} fill="none" stroke={visible[0].color} strokeWidth={24} />
      </svg>
    )
  }

  let consumed = 0
  return (
    <svg width={160} height={160} viewBox="0 0 160 160" aria-hidden="true">
      <circle cx={80} cy={80} r={radius} fill="none" stroke="var(--border)" strokeWidth={24} />
      {visible.map((seg) => {
        const length = (seg.value / total) * circumference
        const offset = -consumed
        consumed += length
        return (
          <circle
            key={seg.label}
            cx={80}
            cy={80}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={24}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={offset}
            transform="rotate(-90 80 80)"
          />
        )
      })}
    </svg>
  )
}

function DonutLegend({ segments }: { segments: DonutSegment[] }) {
  const visible = segments.filter((s) => s.value > 0)
  const total = visible.reduce((s, seg) => s + seg.value, 0)
  if (visible.length === 0 || total === 0) {
    return (
      <div
        style={{
          color: 'var(--text3)',
          fontSize: 10,
          fontFamily: 'var(--font-cond)',
          textAlign: 'center',
          marginTop: 8,
        }}
      >
        No data
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {visible.map((seg) => {
        const pct = ((seg.value / total) * 100).toFixed(1)
        return (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                background: seg.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                fontFamily: 'var(--font-cond)',
                fontSize: 10,
                color: 'var(--text2)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {seg.label}
            </span>
            <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
              {formatMoney(seg.value, 'INR', true)}
            </BlurredValue>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text3)',
                minWidth: 38,
                textAlign: 'right',
              }}
            >
              {pct}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

export interface AllocationDonutProps {
  title: string
  segments: DonutSegment[]
  style?: React.CSSProperties
}

export default function AllocationDonut({ title, segments, style }: AllocationDonutProps) {
  return (
    <section
      style={{
        paddingBottom: 16,
        marginBottom: 16,
        borderBottom: '1px solid var(--border)',
        ...style,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-cond)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text3)',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
        <DonutSvg segments={segments} />
      </div>
      <DonutLegend segments={segments} />
    </section>
  )
}
