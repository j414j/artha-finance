import { InputHTMLAttributes, useState } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export default function Input({ label, ...props }: InputProps) {
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
      <input
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
      />
    </div>
  )
}
