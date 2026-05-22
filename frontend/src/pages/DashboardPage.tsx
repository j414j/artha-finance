import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { getAccounts } from '../api/accounts'
import { getBudget, getBudgetHistory } from '../api/budget'
import { getTransactions } from '../api/transactions'
import type { AccountsResponse } from '../types/account'
import type { BudgetHistory, BudgetItem, BudgetMonth, SavingsRatePoint } from '../types/budget'
import type { Transaction } from '../types/transaction'
import { formatMoney } from '../utils/format'
import { useIsMobile } from '../hooks/useIsMobile'

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

// Compute estimated historical net worth by walking backwards from current using budget history
function computeNetWorthHistory(currentNW: number, trend: SavingsRatePoint[]): number[] {
  if (trend.length === 0) return [currentNW]
  const points: number[] = []
  let nw = currentNW
  const reversed = [...trend].reverse() // newest → oldest
  for (const month of reversed) {
    points.unshift(nw)
    nw = nw - (month.income_paise - month.expense_paise)
  }
  return points
}

function svgPolyline(values: number[], svgW: number, top: number, bottom: number): string {
  const n = values.length
  if (n === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values
    .map((v, i) => {
      const x = n === 1 ? svgW / 2 : (i / (n - 1)) * svgW
      const y = bottom - ((v - min) / range) * (bottom - top)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export default function DashboardPage() {
  const isMobile = useIsMobile()
  const [accountsData, setAccountsData] = useState<AccountsResponse | null>(null)
  const [budget, setBudget] = useState<BudgetMonth | null>(null)
  const [recentTxs, setRecentTxs] = useState<Transaction[]>([])
  const [history, setHistory] = useState<BudgetHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const { year, month } = currentPeriod()
    setLoading(true)
    Promise.all([
      getAccounts(),
      getBudget(year, month),
      getTransactions({ limit: 10 }),
      getBudgetHistory(year, month, 13),
    ])
      .then(([accs, bud, txs, hist]) => {
        setAccountsData(accs)
        setBudget(bud.budget)
        setRecentTxs(txs.transactions)
        setHistory(hist.history)
      })
      .catch(e => setError(e?.message ?? 'Failed to load dashboard'))
      .finally(() => setLoading(false))
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
  const nwHistory = computeNetWorthHistory(netWorth, trend)
  const prevMonthNW = nwHistory.length >= 2 ? nwHistory[nwHistory.length - 2] : null
  const nwChange = prevMonthNW !== null ? netWorth - prevMonthNW : null
  const nwChangePct = prevMonthNW != null && prevMonthNW !== 0 ? ((netWorth - prevMonthNW) / prevMonthNW) * 100 : null

  const sparkPts = svgPolyline(nwHistory, 240, 2, 30)
  const sparkArea = sparkPts ? sparkPts + ' 240,36 0,36' : ''

  const assetsHistory = nwHistory.map(nw => nw + totalLiabilities)
  const liabValues = nwHistory.map(() => totalLiabilities)
  const allChartValues = [...nwHistory, ...assetsHistory, ...liabValues]
  const chartMin = Math.min(...allChartValues)
  const chartMax = Math.max(...allChartValues)
  const chartRange = chartMax - chartMin || 1
  const chartN = nwHistory.length

  function chartY(v: number): number {
    return 115 - ((v - chartMin) / chartRange) * 100
  }
  function chartX(i: number): number {
    return chartN <= 1 ? 230 : (i / (chartN - 1)) * 460
  }

  const nwChartPts = nwHistory.map((v, i) => `${chartX(i).toFixed(1)},${chartY(v).toFixed(1)}`).join(' ')
  const nwChartArea = nwChartPts ? nwChartPts + ` ${chartX(chartN - 1).toFixed(1)},130 0,130` : ''
  const assetsChartPts = assetsHistory.map((v, i) => `${chartX(i).toFixed(1)},${chartY(v).toFixed(1)}`).join(' ')
  const liabChartPts = liabValues.map((v, i) => `${chartX(i).toFixed(1)},${chartY(v).toFixed(1)}`).join(' ')
  const chartLabels = trend.map((t, i) => ({ label: t.label.split(' ')[0], i }))

  const cfMonths = trend.slice(-6)
  const maxCF = Math.max(...cfMonths.map(m => Math.max(m.income_paise, m.expense_paise)), 1)
  const barMaxH = 95
  const cfGroupW = 460 / Math.max(cfMonths.length, 1)

  // ── Shared sub-components (used by both layouts) ─────────────────────────

  const NWChart = (
    <svg width="100%" height="148" viewBox="0 0 460 148" preserveAspectRatio="none">
      <defs>
        <linearGradient id="nw-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0a500" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <line x1="0" y1="25" x2="460" y2="25" stroke="var(--border)" strokeWidth="1" />
      <line x1="0" y1="65" x2="460" y2="65" stroke="var(--border)" strokeWidth="1" />
      <line x1="0" y1="105" x2="460" y2="105" stroke="var(--border)" strokeWidth="1" />
      {nwChartArea && <polygon points={nwChartArea} fill="url(#nw-area-grad)" opacity="0.2" />}
      {assetsChartPts && (
        <polyline points={assetsChartPts} fill="none" stroke="var(--blue)" strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
      )}
      {nwChartPts && (
        <polyline points={nwChartPts} fill="none" stroke="var(--accent)" strokeWidth="2" />
      )}
      {liabChartPts && (
        <polyline points={liabChartPts} fill="none" stroke="var(--red)" strokeWidth="1" opacity="0.5" />
      )}
      {chartLabels.map(({ label, i }) => {
        if (i % 2 !== 0 && i !== chartLabels.length - 1) return null
        const x = chartX(i)
        const isLast = i === chartLabels.length - 1
        return (
          <text key={i} x={x} y="146" fontSize="8" fill={isLast ? '#f0a500' : '#4a5878'} textAnchor={isLast ? 'end' : 'start'}>
            {label}
          </text>
        )
      })}
      <text x="4" y="14" fontSize="8" fill="var(--blue)">── Assets</text>
      <text x="70" y="14" fontSize="8" fill="var(--accent)">── Net Worth</text>
      <text x="165" y="14" fontSize="8" fill="var(--red)">── Liabilities</text>
    </svg>
  )

  const CFChart = (
    <svg width="100%" height="155" viewBox="0 0 460 155" preserveAspectRatio="none">
      {cfMonths.map((m, i) => {
        const isLast = i === cfMonths.length - 1
        const groupX = i * cfGroupW
        const barW = Math.min(22, (cfGroupW - 8) / 2)
        const incH = Math.max(2, (m.income_paise / maxCF) * barMaxH)
        const expH = Math.max(2, (m.expense_paise / maxCF) * barMaxH)
        const incX = groupX + (cfGroupW / 2 - barW - 1)
        const expX = incX + barW + 2
        const labelX = groupX + cfGroupW / 2
        return (
          <g key={i}>
            <rect x={incX} y={120 - incH} width={barW} height={incH} fill="var(--green)" opacity={isLast ? 1 : 0.7} />
            <rect x={expX} y={120 - expH} width={barW} height={expH} fill="var(--red)" opacity={isLast ? 1 : 0.7} />
            <text x={labelX} y="133" fontSize="8" fill={isLast ? '#f0a500' : '#4a5878'} textAnchor="middle">
              {m.label.split(' ')[0]}
            </text>
          </g>
        )
      })}
      {cfMonths.length === 0 && <text x="230" y="70" fontSize="10" fill="#4a5878" textAnchor="middle">No data</text>}
      <rect x="0" y="142" width="8" height="5" fill="var(--green)" opacity="0.7" />
      <text x="12" y="148" fontSize="8" fill="#7a8fb5">Income</text>
      <rect x="56" y="142" width="8" height="5" fill="var(--red)" opacity="0.7" />
      <text x="68" y="148" fontSize="8" fill="#7a8fb5">Expenses</text>
    </svg>
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
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 34,
              fontWeight: 400,
              color: 'var(--text)',
              letterSpacing: -1,
              margin: '6px 0 4px',
              lineHeight: 1,
            }}
          >
            {formatMoney(netWorth)}
          </div>
          {nwChange !== null && nwChangePct !== null && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: nwChange >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {nwChange >= 0 ? '▲' : '▼'} {formatMoney(Math.abs(nwChange))}&nbsp;
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
                const pts = svgPolyline(nwHistory, 320, 2, 36)
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
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: 'var(--text)', letterSpacing: -0.5, margin: '4px 0 8px', lineHeight: 1.1 }}>
              {formatMoney(totalAssets)}
            </div>
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
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: 'var(--red)', letterSpacing: -0.5, margin: '4px 0 8px', lineHeight: 1.1 }}>
              {formatMoney(totalLiabilities)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {liabilityGroups.map(g => (
                <div key={g.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-cond)' }}>{g.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>{formatMoney(g.total_inr_value_paise, 'INR', true)}</span>
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
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color: 'var(--green)', margin: '3px 0' }}>
                {formatMoney(budget?.savings.income_paise ?? 0, 'INR', true)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>EXPENSES</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color: 'var(--red)', margin: '3px 0' }}>
                {formatMoney(budget?.savings.expense_paise ?? 0, 'INR', true)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>SAVED</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color: 'var(--accent)', margin: '3px 0' }}>
                {formatMoney(budget?.savings.net_paise ?? 0, 'INR', true)}
              </div>
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
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 28,
              fontWeight: 400,
              color: 'var(--text)',
              letterSpacing: -0.5,
              margin: '4px 0 2px',
              lineHeight: 1.1,
            }}
          >
            {formatMoney(netWorth)}
          </div>
          {nwChange !== null && nwChangePct !== null && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: nwChange >= 0 ? 'var(--green)' : 'var(--red)',
              }}
            >
              {nwChange >= 0 ? '▲' : '▼'} {formatMoney(Math.abs(nwChange))}&nbsp;
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
              {sparkArea && (
                <polygon points={sparkArea} fill="url(#spark-grad)" opacity="0.15" />
              )}
              {sparkPts && (
                <polyline points={sparkPts} fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity="0.9" />
              )}
            </svg>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>
              12M NET WORTH TREND
            </div>
          </div>
        </div>

        {/* Total Assets */}
        <div style={{ background: 'var(--bg2)', padding: '10px 14px' }}>
          <div style={metricLabel}>Total Assets</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 400, color: 'var(--text)', letterSpacing: -0.5, margin: '4px 0 2px', lineHeight: 1.1 }}>
            {formatMoney(totalAssets)}
          </div>
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
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 400, color: 'var(--red)', letterSpacing: -0.5, margin: '4px 0 2px', lineHeight: 1.1 }}>
            {formatMoney(totalLiabilities)}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-cond)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>By Type</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {liabilityGroups.map(g => (
                <div key={g.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={{ color: 'var(--text2)' }}>{g.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>{formatMoney(g.total_inr_value_paise)}</span>
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
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--green)', margin: '2px 0' }}>
                {formatMoney(budget?.savings.income_paise ?? 0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>EXPENSES</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--red)', margin: '2px 0' }}>
                {formatMoney(budget?.savings.expense_paise ?? 0)}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>NET SAVINGS</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--accent)', margin: '2px 0' }}>
              {formatMoney(budget?.savings.net_paise ?? 0)}
            </div>
            {budget?.savings.savings_rate_pct != null && (
              <div style={{ fontSize: 9, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                SAVINGS RATE: {budget.savings.savings_rate_pct.toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </div>

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
