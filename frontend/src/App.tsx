export default function App() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '32px',
            fontWeight: 700,
            color: 'var(--accent)',
            letterSpacing: '-1px',
          }}
        >
          ₹ ARTHA
        </div>
        <div
          style={{
            fontFamily: 'var(--font-cond)',
            fontSize: '11px',
            color: 'var(--text3)',
            marginTop: '8px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}
        >
          Personal Finance
        </div>
      </div>
    </div>
  )
}
