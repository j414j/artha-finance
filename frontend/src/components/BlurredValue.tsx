import type { CSSProperties, ReactNode } from 'react'
import { useBlur } from '../contexts/BlurContext'

interface Props {
  children: ReactNode
  style?: CSSProperties
  as?: 'span' | 'div'
}

export default function BlurredValue({ children, style, as: Tag = 'span' }: Props) {
  const { isBlurred } = useBlur()
  return (
    <Tag
      style={{
        ...style,
        transition: 'filter 0.2s',
        ...(isBlurred ? { filter: 'blur(6px)', userSelect: 'none' } : {}),
      }}
    >
      {children}
    </Tag>
  )
}
