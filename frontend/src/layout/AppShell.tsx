import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import BottomNav, { BOTTOM_NAV_HEIGHT } from './BottomNav'
import { useIsMobile } from '../hooks/useIsMobile'

export default function AppShell() {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
        <Topbar />
        <main
          style={{
            flex: 1,
            overflow: 'auto',
            background: 'var(--bg)',
            paddingBottom: BOTTOM_NAV_HEIGHT,
          }}
        >
          <Outlet />
        </main>
        <BottomNav />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Topbar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
