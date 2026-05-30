import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { getAccounts, getAccountBalanceHistory } from '../api/accounts'
import { getBudget, getBudgetHistory } from '../api/budget'
import { getInsights } from '../api/insights'
import { getTransactions } from '../api/transactions'
import type { Account, AccountsResponse, BalanceHistoryPoint } from '../types/account'
import type { BudgetHistory, BudgetItem, BudgetMonth } from '../types/budget'
import type { Insight } from '../types/insights'
import type { Transaction } from '../types/transaction'
import { formatMoney } from '../utils/format'
import { useIsMobile } from '../hooks/useIsMobile'
import BlurredValue from '../components/BlurredValue'
import InsightsPanel from '../components/InsightsPanel'

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const GROUP_COLORS: Record<string, string> = {
  cash_bank: 'var(--green)',
  investments: 'var(--blue)',
  real_estate: 'var(--accent)',
  other_assets: 'var(--purple)',
}

const metricLabel: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
}

const sectionHd: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  borderBottom: '1px solid var(--border)',
  padding: '6px 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 28,
  flexShrink: 0,
}

const th: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  padding: '5px 10px',
  textAlign: 'left',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
  background: 'var(--bg2)',
}

function currentPeriod() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function shortDate(dateStr: string): string {
  const d = dateStr.split(' ')[0]
  const parts = d.split('-')
  if (parts.length === 3) {
    const [, m, day] = parts
    return `${parseInt(day)} ${SHORT_MONTHS[parseInt(m) - 1]}`
  }
  return dateStr
}

function txAmountColor(type: Transaction['type']): string {
  switch (type) {
    case 'income': return 'var(--green)'
    case 'expense': return 'var(--red)'
    case 'transfer': case 'credit_card_payment': case 'loan_repayment': return 'var(--blue)'
    case 'investment_buy': case 'investment_sell': return 'var(--purple)'
    case 'dividend': return 'var(--cyan)'
    default: return 'var(--text2)'
  }
}

function txAmountPrefix(type: Transaction['type']): string {
  switch (type) {
    case 'income': case 'dividend': case 'investment_sell': return '+'
    case 'expense': case 'investment_buy': case 'loan_repayment': return '−'
    default: return ''
  }
}

function txSubLabel(tx: Transaction): { text: string; color: string } {
  switch (tx.type) {
    case 'income':
      return { text: `${tx.category_name ?? 'Income'} · ${tx.account_name}`, color: 'var(--text3)' }
    case 'expense':
      return { text: `${tx.category_name ?? 'Expense'} · ${tx.account_name}`, color: 'var(--text3)' }
    case 'transfer':
      return { text: `Transfer · ${tx.transfer_account_name ?? tx.account_name}`, color: 'var(--blue)' }
    case 'investment_buy':
      return { text: 'Investment Buy', color: 'var(--purple)' }
    case 'investment_sell':
      return { text: 'Investment Sell', color: 'var(--purple)' }
    case 'dividend':
      return { text: 'Dividend', color: 'var(--cyan)' }
    case 'loan_repayment':
      return { text: `Loan Repayment · ${tx.account_name}`, color: 'var(--blue)' }
    case 'credit_card_payment':
      return { text: `CC Payment · ${tx.account_name}`, color: 'var(--blue)' }
    default:
      return { text: tx.type, color: 'var(--text3)' }
  }
}

function budgetStatusColor(status: BudgetItem['status']): string {
  if (status === 'over_budget') return 'var(--red)'
  if (status === 'near_limit') return '#f0a500'
  return 'var(--green)'
}

function svgPolyline(values: number[], w: number, top: number, bottom: number): string {
  const n = values.length
  if (n === 0) return ''
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1
  return values.map((v, i) => {
    const x = n === 1 ? w / 2 : (i / (n - 1)) * w
    const y = bottom - ((v - min) / range) * (bottom - top)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

const AXIS_TICK = { fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' } as const
const GRID_PROPS = { stroke: '#1e2535', strokeDasharray: '3 3' }

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>
      <div style={{ color: 'var(--text3)', marginBottom: 4, fontSize: 10, fontFamily: 'var(--font-cond)' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>{p.name}: {formatMoney(p.value, 'INR', true)}</div>
      ))}
    </div>
  )
}

// Build daily net worth series from real account balance histories.
function buildNWHistory(
  accounts: Account[],
  histories: Map<string, BalanceHistoryPoint[]>,
): Array<{ date: string; label: string; 'Net Worth': number; Assets: number; Liabilities: number }> {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dateSet = new Set<string>()
  for (const [, pts] of histories) {
    for (const pt of pts) dateSet.add(pt.date)
  }
  const sortedDates = [...dateSet].sort()
  if (sortedDates.length === 0) return []

  // Scale factor: current inr_value / current raw balance (handles FX & investment accounts)
  const inrScale = new Map<string, number>()
  for (const acc of accounts) {
    const pts = histories.get(acc.id) ?? []
    const latest = pts[pts.length - 1]
    const latestRaw = latest ? (latest.total_paise ?? latest.balance_paise) : acc.balance_paise
    inrScale.set(acc.id, latestRaw !== 0 ? acc.inr_value_paise / latestRaw : 1)
  }

  const accMaps = new Map<string, Map<string, number>>()
  for (const acc of accounts) {
    const m = new Map<string, number>()
    for (const pt of histories.get(acc.id) ?? []) {
      m.set(pt.date, pt.total_paise ?? pt.balance_paise)
    }
    accMaps.set(acc.id, m)
  }

  const lastKnown = new Map<string, number>()
  for (const acc of accounts) {
    const scale = inrScale.get(acc.id) ?? 1
    lastKnown.set(acc.id, scale !== 0 ? Math.round(acc.inr_value_paise / scale) : acc.balance_paise)
  }

  return sortedDates.map(date => {
    let assets = 0, liabilities = 0
    for (const acc of accounts) {
      const m = accMaps.get(acc.id)!
      if (m.has(date)) lastKnown.set(acc.id, m.get(date)!)
      const inrVal = Math.round((lastKnown.get(acc.id) ?? 0) * (inrScale.get(acc.id) ?? 1))
      if (acc.side === 'asset') assets += inrVal
      else liabilities += inrVal
    }
    const [, mm, dd] = date.split('-')
    const label = dd === '01' ? (MONTHS[parseInt(mm) - 1] ?? '') : ''
    return { date, label, 'Net Worth': assets - liabilities, Assets: assets, Liabilities: liabilities }
  })
}

export default function DashboardPage() {
  const isMobile = useIsMobile()
  const [accountsData, setAccountsData] = useState<AccountsResponse | null>(null)
  const [budget, setBudget] = useState<BudgetMonth | null>(null)
  const [recentTxs, setRecentTxs] = useState<Transaction[]>([])
  const [history, setHistory] = useState<BudgetHistory | null>(null)
  const [insights, setInsights] = useState<Insight[]>([])
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [histories, setHistories] = useState<Map<string, BalanceHistoryPoint[]>>(new Map())

  useEffect(() => {
    const { year, month } = currentPeriod()
    setLoading(true)
    setInsightsLoading(true)
    Promise.all([
      getAccounts(),
      getBudget(year, month),
      getTransactions({ limit: 10 }),
      getBudgetHistory(year, month, 13),
    ])
      .then(async ([accs, bud, txs, hist]) => {
        setAccountsData(accs)
        setBudget(bud.budget)
        setRecentTxs(txs.transactions)
        setHistory(hist.history)
        const allAccounts: Account[] = [
          ...accs.asset_groups.flatMap(g => g.accounts),
          ...accs.liability_groups.flatMap(g => g.accounts),
        ]
        const entries = await Promise.all(
          allAccounts.map(acc =>
            getAccountBalanceHistory(acc.id, 180).then(r => [acc.id, r.balance_history] as const)
          )
        )
        setHistories(new Map(entries))
      })
      .catch(e => setError(e?.message ?? 'Failed to load dashboard'))
      .finally(() => setLoading(false))

    getInsights(year, month)
      .then(r => setInsights(r.insights))
      .catch(() => setInsights([]))
      .finally(() => setInsightsLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ padding: 24, color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 11 }}>
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ padding: 24, color: 'var(--red)', fontFamily: 'var(--font-cond)', fontSize: 11 }}>
        {error}
      </div>
    )
  }

  const summary = accountsData?.summary
  const assetGroups = accountsData?.asset_groups ?? []
  const liabilityGroups = accountsData?.liability_groups ?? []
  const totalAssets = summary?.total_assets_paise ?? 0
  const totalLiabilities = summary?.total_liabilities_paise ?? 0
  const netWorth = summary?.net_worth_paise ?? 0

  const allocationSegments = assetGroups.map(g => ({
    key: g.key,
    label: g.label,
    pct: totalAssets > 0 ? (g.total_inr_value_paise / totalAssets) * 100 : 0,
    color: GROUP_COLORS[g.key] ?? 'var(--text3)',
  }))

  const trend = history?.savings_rate_trend ?? []

  const allAccounts: Account[] = [
    ...assetGroups.flatMap(g => g.accounts),
    ...liabilityGroups.flatMap(g => g.accounts),
  ]
  const nwSeries = buildNWHistory(allAccounts, histories)
  // MoM change: compare last two distinct month-start points
  const monthPoints = nwSeries.filter(p => p.label !== '')
  const prevMonthNW = monthPoints.length >= 2 ? monthPoints[monthPoints.length - 2]['Net Worth'] : null
  const nwChange = prevMonthNW !== null ? netWorth - prevMonthNW : null
  const nwChangePct = prevMonthNW != null && prevMonthNW !== 0 ? ((netWorth - prevMonthNW) / prevMonthNW) * 100 : null

  // Thin out daily points to one per week for chart performance (keep month labels)
  const nwChartData = nwSeries.filter((p, i) => p.label !== '' || i % 7 === 0 || i === nwSeries.length - 1)

  // Sparkline values for the mini hero chart
  const sparkValues = nwSeries.map(p => p['Net Worth'])

  const cfChartData = trend.slice(-6).map(m => ({
    month: m.label.split(' ')[0],
    Income: m.income_paise,
    Expenses: m.expense_paise,
  }))

  // ── Shared sub-components (used by both layouts) ─────────────────────────

  const NWChart = (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={nwChartData} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="nw-dash-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false}
          tickFormatter={v => formatMoney(v, 'INR', true)} width={52} />
        <Tooltip content={<ChartTooltip />} />
        <Area type="monotone" dataKey="Assets" stroke="var(--blue)" strokeWidth={1}
          strokeDasharray="4 2" fill="none" dot={false} />
        <Area type="monotone" dataKey="Liabilities" stroke="var(--red)" strokeWidth={1}
          fill="none" dot={false} opacity={0.6} />
        <Area type="monotone" dataKey="Net Worth" stroke="var(--accent)" strokeWidth={2}
          fill="url(#nw-dash-grad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )

  const CFChart = (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={cfChartData} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap="30%">
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false}
          tickFormatter={v => formatMoney(v, 'INR', true)} width={52} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="Income" fill="var(--green)" maxBarSize={18} radius={[1, 1, 0, 0]} />
        <Bar dataKey="Expenses" fill="var(--red)" maxBarSize={18} radius={[1, 1, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )

  // ── Mobile layout ─────────────────────────────────────────────────────────

  if (isMobile) {
    const card: CSSProperties = {
      background: 'var(--bg2)',
      borderBottom: '1px solid var(--border)',
    }
    const cardHd: CSSProperties = {
      fontFamily: 'var(--font-cond)',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--text3)',
      padding: '10px 16px 6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>

        {/* ── Net Worth Hero ── */}
        <div style={{ ...card, padding: '16px 16px 14px' }}>
          <div style={metricLabel}>Net Worth</div>
          <BlurredValue
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 34,
              fontWeight: 400,
              color: 'var(--text)',
              letterSpacing: -1,
              margin: '6px 0 4px',
              lineHeight: 1,
              display: 'block',
            }}
          >
            {formatMoney(netWorth)}
          </BlurredValue>
          {nwChange !== null && nwChangePct !== null && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: nwChange >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {nwChange >= 0 ? '▲' : '▼'} <BlurredValue>{formatMoney(Math.abs(nwChange))}</BlurredValue>&nbsp;
              {nwChangePct >= 0 ? '+' : ''}{nwChangePct.toFixed(2)}% vs last month
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <svg width="100%" height="40" viewBox="0 0 320 40" preserveAspectRatio="none" style={{ display: 'block' }}>
              <defs>
                <linearGradient id="spark-grad-m" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
              {(() => {
                const pts = svgPolyline(sparkValues, 320, 2, 36)
                const area = pts ? pts + ' 320,40 0,40' : ''
                return (
                  <>
                    {area && <polygon points={area} fill="url(#spark-grad-m)" opacity="0.15" />}
                    {pts && <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity="0.9" />}
                  </>
                )
              })()}
            </svg>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', marginTop: 3 }}>
              12M NET WORTH TREND
            </div>
          </div>
        </div>

        {/* ── Assets + Liabilities 2-col ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)' }}>
          <div style={{ background: 'var(--bg2)', padding: '12px 14px' }}>
            <div style={metricLabel}>Total Assets</div>
            <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: 'var(--text)', letterSpacing: -0.5, margin: '4px 0 8px', lineHeight: 1.1, display: 'block' }}>
              {formatMoney(totalAssets)}
            </BlurredValue>
            <div style={{ display: 'flex', gap: 2, height: 4 }}>
              {allocationSegments.map(g => (
                <div key={g.key} style={{ background: g.color, width: `${g.pct}%`, height: 4 }} />
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
              {allocationSegments.map(g => (
                <span key={g.key} style={{ fontSize: 9, color: g.color, fontFamily: 'var(--font-mono)' }}>
                  ● {g.label} {g.pct.toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
          <div style={{ background: 'var(--bg2)', padding: '12px 14px' }}>
            <div style={metricLabel}>Liabilities</div>
            <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: 'var(--red)', letterSpacing: -0.5, margin: '4px 0 8px', lineHeight: 1.1, display: 'block' }}>
              {formatMoney(totalLiabilities)}
            </BlurredValue>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {liabilityGroups.map(g => (
                <div key={g.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-cond)' }}>{g.label}</span>
                  <BlurredValue style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>{formatMoney(g.total_inr_value_paise, 'INR', true)}</BlurredValue>
                </div>
              ))}
              {liabilityGroups.length === 0 && (
                <span style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-cond)' }}>None</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Cash Flow this month ── */}
        <div style={{ ...card, padding: '12px 16px' }}>
          <div style={{ ...metricLabel, marginBottom: 10 }}>{budget?.month_label ?? 'This Month'} — Cash Flow</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>INCOME</div>
              <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color: 'var(--green)', margin: '3px 0', display: 'block' }}>
                {formatMoney(budget?.savings.income_paise ?? 0, 'INR', true)}
              </BlurredValue>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>EXPENSES</div>
              <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color: 'var(--red)', margin: '3px 0', display: 'block' }}>
                {formatMoney(budget?.savings.expense_paise ?? 0, 'INR', true)}
              </BlurredValue>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>SAVED</div>
              <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color: 'var(--accent)', margin: '3px 0', display: 'block' }}>
                {formatMoney(budget?.savings.net_paise ?? 0, 'INR', true)}
              </BlurredValue>
              {budget?.savings.savings_rate_pct != null && (
                <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                  {budget.savings.savings_rate_pct.toFixed(1)}% rate
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Net Worth Chart ── */}
        <div style={card}>
          <div style={cardHd}>
            Net Worth Over Time
            <span style={{ fontSize: 9, color: 'var(--accent)' }}>12M</span>
          </div>
          <div style={{ padding: '0 12px 8px' }}>{NWChart}</div>
        </div>

        {/* ── Budget Status ── */}
        <div style={card}>
          <div style={cardHd}>
            {budget?.month_label ?? 'This Month'} Budget
            <Link to="/budget" style={{ fontSize: 9, color: 'var(--accent)', textDecoration: 'none' }}>View All →</Link>
          </div>
          <div style={{ padding: '4px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(budget?.items ?? []).slice(0, 6).map(item => (
              <div key={item.category_id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text2)' }}>
                    {item.category.icon_emoji && `${item.category.icon_emoji} `}{item.category.name}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: budgetStatusColor(item.status) }}>
                    {formatMoney(item.spent_paise, 'INR', true)} / {formatMoney(item.allocated_paise, 'INR', true)}
                    {item.status === 'over_budget' && ' ⚠'}
                  </span>
                </div>
                <div style={{ background: 'var(--bg4)', height: 3 }}>
                  <div style={{ background: budgetStatusColor(item.status), height: 3, width: `${Math.min(100, item.used_pct)}%` }} />
                </div>
              </div>
            ))}
            {(!budget || budget.items.length === 0) && (
              <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 11 }}>No budget set for this month</div>
            )}
          </div>
        </div>

        {/* ── Insights ── */}
        {(insightsLoading || insights.length > 0) && (
          <div style={card}>
            <InsightsPanel insights={insights} loading={insightsLoading} />
          </div>
        )}

        {/* ── Recent Transactions ── */}
        <div style={card}>
          <div style={cardHd}>
            Recent Transactions
            <Link to="/transactions" style={{ fontSize: 9, color: 'var(--accent)', textDecoration: 'none' }}>All →</Link>
          </div>
          <div>
            {recentTxs.map(tx => {
              const sub = txSubLabel(tx)
              const prefix = txAmountPrefix(tx.type)
              return (
                <div
                  key={tx.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '9px 16px',
                    borderBottom: '1px solid var(--border)',
                    gap: 10,
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap', minWidth: 44 }}>
                    {shortDate(tx.date)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.description}
                    </div>
                    <div style={{ fontSize: 10, color: sub.color, marginTop: 1 }}>{sub.text}</div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: txAmountColor(tx.type), whiteSpace: 'nowrap' }}>
                    {prefix}{formatMoney(tx.inr_amount_paise, 'INR', true)}
                  </div>
                </div>
              )
            })}
            {recentTxs.length === 0 && (
              <div style={{ padding: '16px', color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 11, textAlign: 'center' }}>
                No transactions yet
              </div>
            )}
          </div>
        </div>

        {/* ── Monthly Cash Flow ── */}
        <div style={card}>
          <div style={cardHd}>Monthly Cash Flow — Last 6 Months</div>
          <div style={{ padding: '0 12px 8px' }}>{CFChart}</div>
        </div>

      </div>
    )
  }

  // ── Desktop layout ────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Top metric strip ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr 1fr 1fr',
          gap: 1,
          background: 'var(--border)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* Net Worth Hero */}
        <div style={{ background: 'var(--bg2)', padding: '14px 16px' }}>
          <div style={metricLabel}>Net Worth</div>
          <BlurredValue
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 28,
              fontWeight: 400,
              color: 'var(--text)',
              letterSpacing: -0.5,
              margin: '4px 0 2px',
              lineHeight: 1.1,
              display: 'block',
            }}
          >
            {formatMoney(netWorth)}
          </BlurredValue>
          {nwChange !== null && nwChangePct !== null && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: nwChange >= 0 ? 'var(--green)' : 'var(--red)',
              }}
            >
              {nwChange >= 0 ? '▲' : '▼'} <BlurredValue>{formatMoney(Math.abs(nwChange))}</BlurredValue>&nbsp;
              {nwChangePct >= 0 ? '+' : ''}{nwChangePct.toFixed(2)}% vs last month
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <svg width="240" height="36" style={{ display: 'block' }}>
              <defs>
                <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
              {(() => {
                const pts = svgPolyline(sparkValues, 240, 2, 30)
                const area = pts ? pts + ' 240,36 0,36' : ''
                return (
                  <>
                    {area && <polygon points={area} fill="url(#spark-grad)" opacity="0.15" />}
                    {pts && <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity="0.9" />}
                  </>
                )
              })()}
            </svg>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>
              12M NET WORTH TREND
            </div>
          </div>
        </div>

        {/* Total Assets */}
        <div style={{ background: 'var(--bg2)', padding: '10px 14px' }}>
          <div style={metricLabel}>Total Assets</div>
          <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 400, color: 'var(--text)', letterSpacing: -0.5, margin: '4px 0 2px', lineHeight: 1.1, display: 'block' }}>
            {formatMoney(totalAssets)}
          </BlurredValue>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 4 }}>ALLOCATION</div>
            <div style={{ display: 'flex', gap: 2, height: 6 }}>
              {allocationSegments.map(g => (
                <div key={g.key} style={{ background: g.color, width: `${g.pct}%`, height: 6 }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {allocationSegments.map(g => (
                <span key={g.key} style={{ fontSize: 9, color: g.color, fontFamily: 'var(--font-mono)' }}>
                  ● {g.label} {g.pct.toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Total Liabilities */}
        <div style={{ background: 'var(--bg2)', padding: '10px 14px' }}>
          <div style={metricLabel}>Total Liabilities</div>
          <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 400, color: 'var(--red)', letterSpacing: -0.5, margin: '4px 0 2px', lineHeight: 1.1, display: 'block' }}>
            {formatMoney(totalLiabilities)}
          </BlurredValue>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-cond)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>By Type</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {liabilityGroups.map(g => (
                <div key={g.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={{ color: 'var(--text2)' }}>{g.label}</span>
                  <BlurredValue style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>{formatMoney(g.total_inr_value_paise)}</BlurredValue>
                </div>
              ))}
              {liabilityGroups.length === 0 && (
                <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-cond)' }}>No liabilities</div>
              )}
            </div>
          </div>
        </div>

        {/* Cash Flow Tile */}
        <div style={{ background: 'var(--bg2)', padding: '10px 14px' }}>
          <div style={metricLabel}>{budget?.month_label ?? 'This Month'} — Cash Flow</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>INCOME</div>
              <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--green)', margin: '2px 0', display: 'block' }}>
                {formatMoney(budget?.savings.income_paise ?? 0)}
              </BlurredValue>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>EXPENSES</div>
              <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--red)', margin: '2px 0', display: 'block' }}>
                {formatMoney(budget?.savings.expense_paise ?? 0)}
              </BlurredValue>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>NET SAVINGS</div>
            <BlurredValue style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--accent)', margin: '2px 0', display: 'block' }}>
              {formatMoney(budget?.savings.net_paise ?? 0)}
            </BlurredValue>
            {budget?.savings.savings_rate_pct != null && (
              <div style={{ fontSize: 9, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                SAVINGS RATE: {budget.savings.savings_rate_pct.toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Insights ── */}
      {(insightsLoading || insights.length > 0) && (
        <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg2)', marginTop: 1 }}>
          <InsightsPanel insights={insights} loading={insightsLoading} />
        </div>
      )}

      {/* ── Body panels ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 320px',
          gridTemplateRows: '200px 220px',
          gap: 1,
          background: 'var(--border)',
          marginTop: 1,
        }}
      >
        {/* Net Worth Over Time */}
        <div style={{ background: 'var(--bg2)', overflow: 'hidden' }}>
          <div style={sectionHd}>
            Net Worth Over Time
            <span style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.05em' }}>12M</span>
          </div>
          <div style={{ padding: '6px 12px 4px' }}>{NWChart}</div>
        </div>

        {/* Budget Status */}
        <div style={{ background: 'var(--bg2)', overflow: 'hidden' }}>
          <div style={sectionHd}>
            {budget?.month_label ?? 'This Month'} Budget
            <Link to="/budget" style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.05em', textDecoration: 'none' }}>
              View All →
            </Link>
          </div>
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', height: 'calc(100% - 28px)' }}>
            {(budget?.items ?? []).slice(0, 7).map(item => (
              <div key={item.category_id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text2)' }}>
                    {item.category.icon_emoji && `${item.category.icon_emoji} `}{item.category.name}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: budgetStatusColor(item.status) }}>
                    {formatMoney(item.spent_paise, 'INR', true)} / {formatMoney(item.allocated_paise, 'INR', true)}
                    {item.status === 'over_budget' && ' ⚠'}
                  </span>
                </div>
                <div style={{ background: 'var(--bg4)', height: 3, width: '100%' }}>
                  <div style={{ background: budgetStatusColor(item.status), height: 3, width: `${Math.min(100, item.used_pct)}%` }} />
                </div>
              </div>
            ))}
            {(!budget || budget.items.length === 0) && (
              <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, paddingTop: 4 }}>
                No budget set for this month
              </div>
            )}
          </div>
        </div>

        {/* Recent Transactions — spans 2 rows */}
        <div style={{ background: 'var(--bg2)', gridRow: 'span 2', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={sectionHd}>
            Recent Transactions
            <Link to="/transactions" style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.05em', textDecoration: 'none' }}>All →</Link>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Description</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentTxs.map(tx => {
                  const sub = txSubLabel(tx)
                  const prefix = txAmountPrefix(tx.type)
                  return (
                    <tr key={tx.id}>
                      <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                        {shortDate(tx.date)}
                      </td>
                      <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <div style={{ fontSize: 11 }}>{tx.description}</div>
                        <div style={{ fontSize: 9, color: sub.color }}>{sub.text}</div>
                      </td>
                      <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: txAmountColor(tx.type), whiteSpace: 'nowrap' }}>
                        {prefix}{formatMoney(tx.inr_amount_paise)}
                      </td>
                    </tr>
                  )
                })}
                {recentTxs.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: '12px 10px', color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, textAlign: 'center' }}>
                      No transactions yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly Cash Flow Bars */}
        <div style={{ background: 'var(--bg2)', overflow: 'hidden' }}>
          <div style={sectionHd}>Monthly Cash Flow — Last 6 Months</div>
          <div style={{ padding: '8px 12px 4px' }}>{CFChart}</div>
        </div>
      </div>
    </div>
  )
}
