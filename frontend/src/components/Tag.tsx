import { ReactNode } from 'react'

interface TagProps {
  variant?: 'income' | 'expense' | 'transfer' | 'invest' | 'dividend' | 'default'
  children: ReactNode
}

export default function Tag({ variant = 'default', children }: TagProps) {
  const variantStyles: Record<string, React.CSSProperties> = {
    default: {
      background: 'var(--bg4)',
      color: 'var(--text2)',
    },
    income: {
      background: 'rgba(0, 200, 150, 0.12)',
      color: 'var(--green)',
    },
    expense: {
      background: 'rgba(240, 64, 96, 0.12)',
      color: 'var(--red)',
    },
    transfer: {
      background: 'rgba(58, 127, 255, 0.12)',
      color: 'var(--blue)',
    },
    invest: {
      background: 'rgba(144, 96, 240, 0.12)',
      color: 'var(--purple)',
    },
    dividend: {
      background: 'rgba(0, 184, 212, 0.12)',
      color: 'var(--cyan)',
    },
  }

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 5px',
        fontFamily: 'var(--font-mono)',
        fontSize: '9px',
        letterSpacing: '0.04em',
        borderRadius: '1px',
        ...variantStyles[variant],
      }}
    >
      {children}
    </span>
  )
}
