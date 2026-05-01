import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/dashboard" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          width: 360,
          background: 'var(--bg2)',
          border: '1px solid var(--border2)',
        }}
      >
        {/* Logo header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              background: 'var(--accent)',
              color: '#000',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ₹
          </div>
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: 14,
                color: 'var(--text)',
                letterSpacing: '-0.5px',
              }}
            >
              ARTHA
            </div>
            <div
              style={{
                fontFamily: 'var(--font-cond)',
                fontSize: 9,
                color: 'var(--text3)',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              Personal Finance
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 20px 24px' }}>
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--font-cond)',
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text3)',
                marginBottom: 4,
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{
                width: '100%',
                background: 'var(--bg3)',
                border: '1px solid var(--border2)',
                color: 'var(--text)',
                padding: '6px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                outline: 'none',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--font-cond)',
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text3)',
                marginBottom: 4,
              }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                width: '100%',
                background: 'var(--bg3)',
                border: '1px solid var(--border2)',
                color: 'var(--text)',
                padding: '6px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                outline: 'none',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
            />
          </div>

          {error && (
            <div
              style={{
                marginBottom: 12,
                padding: '7px 10px',
                background: 'rgba(240,64,96,0.08)',
                border: '1px solid rgba(240,64,96,0.25)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--red)',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '8px 0',
              background: submitting ? 'var(--bg4)' : 'var(--accent)',
              color: submitting ? 'var(--text3)' : '#000',
              border: 'none',
              fontFamily: 'var(--font-cond)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: submitting ? 'default' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
