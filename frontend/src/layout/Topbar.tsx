import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useBlur } from '../contexts/BlurContext'
import { useIsMobile } from '../hooks/useIsMobile'

const TAB_ROUTES = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Accounts', path: '/accounts' },
  { label: 'Transactions', path: '/transactions' },
  { label: 'Budget', path: '/budget' },
  { label: 'Investments', path: '/investments' },
  { label: 'FX', path: '/fx-rates' },
  { label: 'Goals', path: '/goals' },
  { label: 'Reports', path: '/reports' },
]

export default function Topbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const isMobile = useIsMobile()
  const { isBlurred, toggleBlur } = useBlur()
  const [dateTime, setDateTime] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })

  const avatarRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const update = () => {
      const now = new Date()
      const dd = String(now.getDate()).padStart(2, '0')
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const hh = String(now.getHours()).padStart(2, '0')
      const min = String(now.getMinutes()).padStart(2, '0')
      setDateTime(`${dd}/${mm}/${now.getFullYear()} ${hh}:${min}`)
    }
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        avatarRef.current &&
        !avatarRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleAvatarClick = () => {
    if (avatarRef.current) {
      const r = avatarRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setMenuOpen(o => !o)
  }

  const handleLogout = async () => {
    setMenuOpen(false)
    await logout()
    navigate('/login')
  }

  return (
    <>
      <div
        style={{
          height: 40,
          background: 'var(--bg2)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 16,
          flexShrink: 0,
        }}
      >
        {/* Brand */}
        <span
          style={{
            fontFamily: 'var(--font-cond)',
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--text2)',
            whiteSpace: 'nowrap',
          }}
        >
          ARTHA <span style={{ color: 'var(--accent)' }}>FINANCE</span>
        </span>

        {/* Tab nav — desktop only */}
        {!isMobile && (
          <div style={{ display: 'flex' }}>
            {TAB_ROUTES.map(({ label, path }) => {
              const active = location.pathname.startsWith(path)
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  style={{
                    padding: '6px 12px',
                    fontFamily: 'var(--font-cond)',
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    background: 'none',
                    border: 'none',
                    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    color: active ? 'var(--accent)' : 'var(--text3)',
                    cursor: 'pointer',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text2)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text3)' }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}

        {/* Right controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {!isMobile && (
            <>
              <button
                onClick={toggleBlur}
                style={{
                  border: `1px solid ${isBlurred ? 'var(--accent)' : 'var(--border2)'}`,
                  background: isBlurred ? 'rgba(240,165,0,0.08)' : 'none',
                  color: isBlurred ? 'var(--accent)' : 'var(--text3)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  cursor: 'pointer',
                  padding: '3px 8px',
                  letterSpacing: '0.05em',
                }}
                onMouseEnter={e => {
                  if (!isBlurred) {
                    e.currentTarget.style.color = 'var(--accent)'
                    e.currentTarget.style.borderColor = 'var(--accent)'
                  }
                }}
                onMouseLeave={e => {
                  if (!isBlurred) {
                    e.currentTarget.style.color = 'var(--text3)'
                    e.currentTarget.style.borderColor = 'var(--border2)'
                  }
                }}
              >
                {isBlurred ? 'BLUR ◉' : 'BLUR ○'}
              </button>

              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text3)',
                  whiteSpace: 'nowrap',
                }}
              >
                {dateTime}
              </span>
            </>
          )}

          {/* Avatar — click to open user menu (desktop only; mobile uses BottomNav sheet) */}
          {!isMobile && (
            <button
              ref={avatarRef}
              onClick={handleAvatarClick}
              title={user?.display_name}
              style={{
                width: 24,
                height: 24,
                background: menuOpen ? 'var(--blue)' : 'var(--blue2)',
                borderRadius: 2,
                border: menuOpen ? '1px solid var(--blue)' : '1px solid transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--text)',
                cursor: 'pointer',
                padding: 0,
                transition: 'background 0.15s',
              }}
            >
              {user?.avatar_initials ?? '??'}
            </button>
          )}
        </div>
      </div>

      {/* User dropdown — fixed so it escapes overflow:hidden on AppShell */}
      {menuOpen && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPos.top,
            right: menuPos.right,
            zIndex: 1000,
            background: 'var(--bg2)',
            border: '1px solid var(--border2)',
            minWidth: 200,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {/* User info */}
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: 2,
              }}
            >
              {user?.display_name}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text3)',
                letterSpacing: '0.02em',
              }}
            >
              {user?.email}
            </div>
          </div>

          {/* Logout */}
          <div style={{ padding: '6px' }}>
            <button
              onClick={handleLogout}
              style={{
                width: '100%',
                padding: '7px 10px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                fontFamily: 'var(--font-cond)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--red)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: 2,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,64,96,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ fontSize: 13 }}>→</span> Sign Out
            </button>
          </div>
        </div>
      )}
    </>
  )
}
