import { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
  size?: 'sm' | 'md'
  children: ReactNode
}

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const baseStyles: React.CSSProperties = {
    fontFamily: 'var(--font-cond)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontWeight: 600,
    border: 'none',
    borderRadius: '2px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'all 0.2s',
  }

  const sizeStyles: React.CSSProperties =
    size === 'sm'
      ? {
          padding: '3px 8px',
          fontSize: '10px',
        }
      : {
          padding: '5px 12px',
          fontSize: '11px',
        }

  const variantStyles: React.CSSProperties =
    variant === 'primary'
      ? {
          background: 'var(--accent)',
          color: '#000',
        }
      : {
          background: 'none',
          border: '1px solid var(--border2)',
          color: 'var(--text2)',
        }

  return (
    <button
      style={{
        ...baseStyles,
        ...sizeStyles,
        ...variantStyles,
        ...style,
      }}
      {...props}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
