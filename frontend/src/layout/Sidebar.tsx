import { useLocation, useNavigate } from 'react-router-dom'

interface NavItem {
  icon: string
  route: string
  title: string
}

const navItems: NavItem[] = [
  { icon: '⊞', route: '/dashboard', title: 'Dashboard' },
  { icon: '◫', route: '/accounts', title: 'Accounts' },
  { icon: '≡', route: '/transactions', title: 'Transactions' },
  { icon: '◑', route: '/budget', title: 'Budget' },
  { icon: '△', route: '/investments', title: 'Investments' },
  { icon: '⇄', route: '/fx-rates', title: 'FX Rates' },
  { icon: '◎', route: '/goals', title: 'Goals' },
  { icon: '▦', route: '/reports', title: 'Reports' },
]

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  const isActive = (route: string) => location.pathname.startsWith(route)

  return (
    <div
      style={{
        width: '52px',
        background: 'var(--bg2)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: '4px',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: '36px',
          height: '36px',
          background: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontSize: '14px',
          color: '#000',
          marginBottom: '12px',
          borderRadius: '2px',
        }}
      >
        ₹
      </div>

      {navItems.map((item) => (
        <button
          key={item.route}
          onClick={() => navigate(item.route)}
          title={item.title}
          style={{
            width: '40px',
            height: '40px',
            background: isActive(item.route) ? 'var(--bg4)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
            color: isActive(item.route) ? 'var(--accent)' : 'var(--text3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            if (!isActive(item.route)) {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg4)'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text2)'
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive(item.route)) {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text3)'
            }
          }}
        >
          {item.icon}
          {isActive(item.route) && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: '8px',
                bottom: '8px',
                width: '2px',
                background: 'var(--accent)',
              }}
            />
          )}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      <button
        onClick={() => navigate('/settings')}
        title="Settings"
        style={{
          width: '40px',
          height: '40px',
          background: isActive('/settings') ? 'var(--bg4)' : 'transparent',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '16px',
          color: isActive('/settings') ? 'var(--accent)' : 'var(--text3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isActive('/settings')) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg4)'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text2)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive('/settings')) {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text3)'
          }
        }}
      >
        ⚙
        {isActive('/settings') && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: '8px',
              bottom: '8px',
              width: '2px',
              background: 'var(--accent)',
            }}
          />
        )}
      </button>
    </div>
  )
}
