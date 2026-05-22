import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface NavItem {
  icon: string
  route: string
  label: string
}

const PRIMARY: NavItem[] = [
  { icon: '⊞', route: '/dashboard', label: 'Dashboard' },
  { icon: '≡', route: '/transactions', label: 'Transactions' },
  { icon: '◑', route: '/budget', label: 'Budget' },
  { icon: '△', route: '/investments', label: 'Invest' },
]

const MORE_ITEMS: NavItem[] = [
  { icon: '◫', route: '/accounts', label: 'Accounts' },
  { icon: '⇄', route: '/fx-rates', label: 'FX Rates' },
  { icon: '◎', route: '/goals', label: 'Goals' },
  { icon: '▦', route: '/reports', label: 'Reports' },
]

const BOTTOM_NAV_HEIGHT = 56

export { BOTTOM_NAV_HEIGHT }

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  const isActive = (route: string) => location.pathname.startsWith(route)
  const isMoreActive = MORE_ITEMS.some(item => isActive(item.route)) || isActive('/settings')

  useEffect(() => {
    setSheetOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!sheetOpen) return
    const handler = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setSheetOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sheetOpen])

  const handleLogout = async () => {
    setSheetOpen(false)
    await logout()
    navigate('/login')
  }

  const navBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '6px 0',
    color: active ? 'var(--accent)' : 'var(--text3)',
    position: 'relative',
  })

  return (
    <>
      {/* Bottom nav bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: BOTTOM_NAV_HEIGHT,
          background: 'var(--bg2)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'stretch',
          zIndex: 100,
        }}
      >
        {PRIMARY.map(item => (
          <button
            key={item.route}
            onClick={() => navigate(item.route)}
            style={navBtnStyle(isActive(item.route))}
          >
            {isActive(item.route) && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '25%',
                  right: '25%',
                  height: 2,
                  background: 'var(--accent)',
                }}
              />
            )}
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <span
              style={{
                fontFamily: 'var(--font-cond)',
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {item.label}
            </span>
          </button>
        ))}

        {/* More button */}
        <button
          onClick={() => setSheetOpen(o => !o)}
          style={navBtnStyle(isMoreActive || sheetOpen)}
        >
          {(isMoreActive || sheetOpen) && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: '25%',
                right: '25%',
                height: 2,
                background: 'var(--accent)',
              }}
            />
          )}
          <span style={{ fontSize: 18 }}>⋯</span>
          <span
            style={{
              fontFamily: 'var(--font-cond)',
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            More
          </span>
        </button>
      </div>

      {/* More sheet backdrop */}
      {sheetOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 99,
          }}
        />
      )}

      {/* More sheet */}
      <div
        ref={sheetRef}
        style={{
          position: 'fixed',
          bottom: BOTTOM_NAV_HEIGHT,
          left: 0,
          right: 0,
          background: 'var(--bg2)',
          borderTop: '1px solid var(--border)',
          zIndex: 200,
          transform: sheetOpen ? 'translateY(0)' : `translateY(calc(100% + ${BOTTOM_NAV_HEIGHT}px))`,
          transition: 'transform 0.22s ease',
          paddingBottom: 8,
        }}
      >
        {/* Sheet header */}
        <div
          style={{
            padding: '10px 16px 8px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-cond)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text3)',
            }}
          >
            More
          </span>
          <button
            onClick={() => setSheetOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text3)',
              fontSize: 16,
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Nav items grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 0,
          }}
        >
          {MORE_ITEMS.map(item => (
            <button
              key={item.route}
              onClick={() => navigate(item.route)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 20px',
                background: isActive(item.route) ? 'var(--bg4)' : 'none',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                color: isActive(item.route) ? 'var(--accent)' : 'var(--text2)',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              <span
                style={{
                  fontFamily: 'var(--font-cond)',
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {item.label}
              </span>
            </button>
          ))}

          {/* Settings */}
          <button
            onClick={() => navigate('/settings')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 20px',
              background: isActive('/settings') ? 'var(--bg4)' : 'none',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
              color: isActive('/settings') ? 'var(--accent)' : 'var(--text2)',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 20 }}>⚙</span>
            <span
              style={{
                fontFamily: 'var(--font-cond)',
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Settings
            </span>
          </button>
        </div>

        {/* User info + logout */}
        <div
          style={{
            padding: '12px 20px 4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--font)',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text)',
              }}
            >
              {user?.display_name}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text3)',
                marginTop: 2,
              }}
            >
              {user?.email}
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: 'none',
              border: '1px solid var(--border2)',
              color: 'var(--red)',
              fontFamily: 'var(--font-cond)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: '6px 12px',
              borderRadius: 2,
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </>
  )
}
