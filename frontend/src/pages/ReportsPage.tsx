import { useNavigate } from 'react-router-dom'

interface ReportCard {
  route: string
  icon: string
  title: string
  bullets: string[]
  available: boolean
}

const REPORT_CARDS: ReportCard[] = [
  {
    route: '/reports/cashflow',
    icon: '⇌',
    title: 'Cash Flow',
    bullets: [
      'Sankey diagram — income → expenses → destinations',
      'Monthly income vs expenses bar chart',
      'Cumulative & trend charts',
    ],
    available: true,
  },
  {
    route: '/reports/net-worth',
    icon: '◈',
    title: 'Net Worth & Balance Sheet',
    bullets: [
      'Net worth over time with assets & liabilities',
      'Balance sheet — assets vs liabilities side-by-side',
      'Asset allocation & liability breakdown',
    ],
    available: true,
  },
  {
    route: '/reports/spending',
    icon: '◑',
    title: 'Spending Analytics',
    bullets: [
      'Category-wise spend ranked by amount',
      'Top merchants & spending heatmap',
      'Period comparison & day-of-month patterns',
    ],
    available: true,
  },
  {
    route: '/reports/budget',
    icon: '▦',
    title: 'Budget Reports',
    bullets: [
      'Budget vs actual chart per category',
      'Budget history table (last 12 months)',
      'Savings rate trend over time',
    ],
    available: false,
  },
  {
    route: '/reports/investments',
    icon: '△',
    title: 'Investment Reports',
    bullets: [
      'Portfolio growth chart & asset allocation analysis',
      'Performance ranking (P&L % and XIRR per holding)',
      'Dividend income history & price data quality',
    ],
    available: true,
  },
  {
    route: '/reports/goals',
    icon: '◎',
    title: 'Savings Goals',
    bullets: [
      'Goals progress overview',
      'Blocking history & monthly rate chart',
      'Projected completion dates',
    ],
    available: false,
  },
]

export default function ReportsPage() {
  const navigate = useNavigate()

  return (
    <div style={{ padding: '24px 28px', background: 'var(--bg)', minHeight: '100%' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontFamily: 'var(--font-cond)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text3)',
            marginBottom: 4,
          }}
        >
          Reports
        </div>
        <div
          style={{
            fontFamily: 'var(--font)',
            fontSize: 13,
            color: 'var(--text2)',
          }}
        >
          Explore detailed visualisations and analytics across all areas of your finances.
        </div>
      </div>

      {/* Cards grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 1,
          background: 'var(--border)',
        }}
      >
        {REPORT_CARDS.map((card) => (
          <div
            key={card.route}
            onClick={() => card.available && navigate(card.route)}
            style={{
              background: 'var(--bg2)',
              padding: '18px 20px',
              cursor: card.available ? 'pointer' : 'default',
              transition: 'background 0.15s',
              opacity: card.available ? 1 : 0.6,
            }}
            onMouseEnter={(e) => {
              if (card.available)
                (e.currentTarget as HTMLDivElement).style.background = 'var(--bg3)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'var(--bg2)'
            }}
          >
            {/* Icon + title row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: card.available ? 'var(--bg4)' : 'var(--bg3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  color: card.available ? 'var(--accent)' : 'var(--text3)',
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              >
                {card.icon}
              </div>
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-cond)',
                    fontSize: 13,
                    fontWeight: 600,
                    color: card.available ? 'var(--text)' : 'var(--text2)',
                    letterSpacing: '0.02em',
                  }}
                >
                  {card.title}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: card.available ? 'var(--accent)' : 'var(--text3)',
                    letterSpacing: '0.06em',
                    marginTop: 1,
                  }}
                >
                  {card.available ? 'AVAILABLE' : 'COMING SOON'}
                </div>
              </div>
            </div>

            {/* Bullet points */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {card.bullets.map((b, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: 'var(--font)',
                    fontSize: 11,
                    color: 'var(--text2)',
                    display: 'flex',
                    gap: 6,
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={{ color: 'var(--text3)', flexShrink: 0, marginTop: 1 }}>·</span>
                  {b}
                </div>
              ))}
            </div>

            {/* Explore link */}
            {card.available && (
              <div
                style={{
                  marginTop: 14,
                  fontFamily: 'var(--font-cond)',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  color: 'var(--accent)',
                  textTransform: 'uppercase',
                }}
              >
                Explore →
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
