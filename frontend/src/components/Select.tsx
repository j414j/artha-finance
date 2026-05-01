import { SelectHTMLAttributes, useState, ReactNode } from 'react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  children: ReactNode
}

export default function Select({ label, children, ...props }: SelectProps) {
  const [isFocused, setIsFocused] = useState(false)

  return (
    <div>
      {label && (
        <label
          style={{
            fontFamily: 'var(--font-cond)',
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text3)',
            marginBottom: '3px',
            display: 'block',
          }}
        >
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'block' }}>
        <select
          style={{
            width: '100%',
            background: 'var(--bg3)',
            border: `1px solid ${isFocused ? 'var(--accent)' : 'var(--border2)'}`,
            color: 'var(--text)',
            padding: '5px 8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            outline: 'none',
            transition: 'border-color 0.2s',
            borderRadius: '2px',
            appearance: 'none',
            paddingRight: '24px',
            cursor: 'pointer',
          }}
          onFocus={(e) => {
            setIsFocused(true)
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            setIsFocused(false)
            props.onBlur?.(e)
          }}
          {...props}
        >
          {children}
        </select>
        <span
          style={{
            position: 'absolute',
            right: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: 'var(--text3)',
            fontSize: '12px',
          }}
        >
          ▾
        </span>
      </div>
    </div>
  )
}
