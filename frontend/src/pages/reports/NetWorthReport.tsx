import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useIsMobile } from '../../hooks/useIsMobile'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { getAccounts, getAccountBalanceHistory } from '../../api/accounts'
import type { Account, AccountGroup, AccountsResponse, BalanceHistoryPoint } from '../../types/account'
import { formatMoney } from '../../utils/format'

// ─── Period ───────────────────────────────────────────────────────────────────

type PeriodKey = '3m' | '6m' | '1y'

const PERIOD_DAYS: Record<PeriodKey, number> = { '3m': 90, '6m': 180, '1y': 365 }
const PERIOD_LABELS: Record<PeriodKey, string> = { '3m': '3M', '6m': '6M', '1y': '1Y' }

// ─── Data building ────────────────────────────────────────────────────────────

interface DailyPoint {
  date: string
  label: string
  assets: number
  liabilities: number
  net_worth: number
}

function buildHistory(
  accounts: Account[],
  histories: Map<string, BalanceHistoryPoint[]>,
  days: number,
): DailyPoint[] {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const dateSet = new Set<string>()
  for (const [, pts] of histories) {
    for (const pt of pts) {
      if (pt.date >= cutoffStr) dateSet.add(pt.date)
    }
  }
  const sortedDates = [...dateSet].sort()
  if (sortedDates.length === 0) return []

  // Scale factor: convert account-currency balance_paise → INR using current ratio
  const inrScale = new Map<string, number>()
  for (const acc of accounts) {
    const pts = histories.get(acc.id) ?? []
    const latest = pts.length > 0 ? pts[pts.length - 1] : null
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

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const result: DailyPoint[] = []

  for (const date of sortedDates) {
    let assets = 0
    let liabilities = 0
    for (const acc of accounts) {
      const m = accMaps.get(acc.id)!
      if (m.has(date)) lastKnown.set(acc.id, m.get(date)!)
      const rawVal = lastKnown.get(acc.id) ?? 0
      const scale = inrScale.get(acc.id) ?? 1
      const inrVal = Math.round(rawVal * scale)
      if (acc.side === 'asset') assets += inrVal
      else liabilities += inrVal
    }
    const [, mm, dd] = date.split('-')
    const label = dd === '01' ? (MONTHS[parseInt(mm) - 1] ?? '') : ''
    result.push({ date, label, assets, liabilities, net_worth: assets - liabilities })
  }
  return result
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const sHd: CSSProperties = {
  fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 600,
  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)',
  borderBottom: '1px solid var(--border)', padding: '6px 12px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 28,
}
const mlStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 500,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)',
}
const btnBase: CSSProperties = {
  background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)',
  padding: '3px 8px', fontSize: 10, fontFamily: 'var(--font-cond)', fontWeight: 600,
  letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
}
const btnActive: CSSProperties = {
  ...btnBase, background: 'var(--accent)', color: '#000', border: '1px solid var(--accent)',
}
const AXIS_TICK = { fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' } as const
const GRID_PROPS = { stroke: '#1e2535', strokeDasharray: '3 3' }

// ─── Tooltip ──────────────────────────────────────────────────────────────────

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

// ─── Balance sheet group ──────────────────────────────────────────────────────

function BalanceGroup({ group }: { group: AccountGroup }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)' }}>{group.label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text2)' }}>{formatMoney(group.total_inr_value_paise, 'INR', true)}</span>
      </div>
      {group.accounts.map(acc => (
        <div key={acc.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 8px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: 1, background: acc.color_hex, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text2)' }}>{acc.name}</span>
            {acc.currency !== 'INR' && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)' }}>{acc.currency}</span>
            )}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>
            {formatMoney(acc.inr_value_paise, 'INR', true)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NetWorthReport() {
  const isMobile = useIsMobile()
  const [period, setPeriod] = useState<PeriodKey>('1y')
  const [accountsData, setAccountsData] = useState<AccountsResponse | null>(null)
  const [histories, setHistories] = useState<Map<string, BalanceHistoryPoint[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await getAccounts()
        setAccountsData(data)
        const allAccounts = [
          ...data.asset_groups.flatMap(g => g.accounts),
          ...data.liability_groups.flatMap(g => g.accounts),
        ]
        const entries = await Promise.all(
          allAccounts.map(acc =>
            getAccountBalanceHistory(acc.id, 365).then(r => [acc.id, r.balance_history] as const)
          )
        )
        setHistories(new Map(entries))
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  if (loading) {
    return <div style={{ padding: 32, fontFamily: 'var(--font-cond)', color: 'var(--text3)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Loading…</div>
  }
  if (error) {
    return <div style={{ padding: 32, fontFamily: 'var(--font-mono)', color: 'var(--red)', fontSize: 11 }}>{error}</div>
  }

  const summary = accountsData?.summary
  const assetGroups = accountsData?.asset_groups ?? []
  const liabilityGroups = accountsData?.liability_groups ?? []
  const totalAssets = summary?.total_assets_paise ?? 0
  const totalLiabilities = summary?.total_liabilities_paise ?? 0
  const netWorth = summary?.net_worth_paise ?? 0

  const allAccounts: Account[] = [
    ...assetGroups.flatMap(g => g.accounts),
    ...liabilityGroups.flatMap(g => g.accounts),
  ]

  const history = buildHistory(allAccounts, histories, PERIOD_DAYS[period])
  const chartData = history.map(pt => ({
    date: pt.label || pt.date.slice(5),
    'Total Assets': pt.assets,
    'Net Worth': pt.net_worth,
    'Total Liabilities': pt.liabilities,
  }))

  // MoM change: first vs last point in history
  const firstPt = history[0]
  const lastPt = history[history.length - 1]
  const nwChange = firstPt && lastPt ? lastPt.net_worth - firstPt.net_worth : null
  const nwChangePct = firstPt && firstPt.net_worth !== 0 && nwChange !== null
    ? (nwChange / Math.abs(firstPt.net_worth)) * 100
    : null

  // Allocation breakdown
  const totalAssetsForPct = totalAssets || 1
  const allocationRows = assetGroups
    .filter(g => g.total_inr_value_paise > 0)
    .sort((a, b) => b.total_inr_value_paise - a.total_inr_value_paise)

  const GROUP_COLORS: Record<string, string> = {
    cash_bank: 'var(--green)',
    investments: 'var(--blue)',
    real_estate: 'var(--accent)',
    other_assets: 'var(--purple)',
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%' }}>

      {/* Breadcrumb */}
      <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em' }}>
        <Link to="/reports" style={{ color: 'var(--text3)', textDecoration: 'none' }}>REPORTS</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ color: 'var(--text2)' }}>NET WORTH</span>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
        {[
          { label: 'Net Worth', value: netWorth, color: netWorth >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'Total Assets', value: totalAssets, color: 'var(--blue)' },
          { label: 'Total Liabilities', value: totalLiabilities, color: 'var(--red)' },
          {
            label: `Change (${PERIOD_LABELS[period]})`,
            value: nwChange ?? 0,
            color: nwChange == null ? 'var(--text3)' : nwChange >= 0 ? 'var(--green)' : 'var(--red)',
          },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'var(--bg3)', padding: '8px 14px' }}>
            <div style={mlStyle}>{label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color, marginTop: 2 }}>
              {value !== 0 || label.startsWith('Change') ? (
                <>
                  {value > 0 && label.startsWith('Change') ? '+' : ''}
                  {formatMoney(value)}
                </>
              ) : '—'}
            </div>
            {label.startsWith('Change') && nwChangePct !== null && (
              <div style={{ fontSize: 9, color, fontFamily: 'var(--font-mono)' }}>
                {nwChangePct >= 0 ? '+' : ''}{nwChangePct.toFixed(1)}%
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Net Worth Over Time */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={sHd}>
          Net Worth Over Time
          <div style={{ display: 'flex', gap: 1 }}>
            {(Object.keys(PERIOD_DAYS) as PeriodKey[]).map(k => (
              <button key={k} style={period === k ? btnActive : btnBase} onClick={() => setPeriod(k)}>
                {PERIOD_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <div style={{ background: 'var(--bg2)', padding: '16px 12px 8px' }}>
          {chartData.length < 2 ? (
            <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, padding: '40px 0', textAlign: 'center', letterSpacing: '0.08em' }}>
              NOT ENOUGH HISTORY — ADD MORE TRANSACTIONS TO SEE TRENDS
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="nw-assets" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3a7fff" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3a7fff" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="nw-nw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00c896" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00c896" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="nw-liab" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f04060" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f04060" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={v => formatMoney(v, 'INR', true)} tick={AXIS_TICK} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconSize={8} wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', paddingTop: 4 }} />
                <Area type="monotone" dataKey="Total Assets" stroke="#3a7fff" strokeWidth={1.5} fill="url(#nw-assets)" dot={false} />
                <Area type="monotone" dataKey="Total Liabilities" stroke="#f04060" strokeWidth={1.5} fill="url(#nw-liab)" dot={false} />
                <Area type="monotone" dataKey="Net Worth" stroke="#00c896" strokeWidth={2} fill="url(#nw-nw)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Balance Sheet + Allocation — two-column */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>

        {/* Assets */}
        <div style={{ background: 'var(--bg2)' }}>
          <div style={sHd}>
            Assets
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--blue)', letterSpacing: 0, textTransform: 'none' }}>{formatMoney(totalAssets, 'INR', true)}</span>
          </div>
          <div style={{ padding: '12px 12px 8px' }}>
            {assetGroups.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10 }}>No asset accounts</div>
            ) : (
              assetGroups.map(g => <BalanceGroup key={g.key} group={g} />)
            )}
          </div>
        </div>

        {/* Liabilities + Allocation */}
        <div style={{ background: 'var(--bg2)', borderLeft: isMobile ? 'none' : '1px solid var(--border)', borderTop: isMobile ? '1px solid var(--border)' : 'none' }}>
          <div style={sHd}>
            Liabilities
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red)', letterSpacing: 0, textTransform: 'none' }}>{formatMoney(totalLiabilities, 'INR', true)}</span>
          </div>
          <div style={{ padding: '12px 12px 8px' }}>
            {liabilityGroups.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10 }}>No liability accounts</div>
            ) : (
              liabilityGroups.map(g => <BalanceGroup key={g.key} group={g} />)
            )}
          </div>

          {/* Asset allocation breakdown */}
          <div style={{ ...sHd, marginTop: 8 }}>Asset Allocation</div>
          <div style={{ padding: '10px 12px' }}>
            {/* Stacked bar */}
            <div style={{ display: 'flex', height: 10, gap: 1, marginBottom: 10 }}>
              {allocationRows.map(g => {
                const w = (g.total_inr_value_paise / totalAssetsForPct) * 100
                return (
                  <div key={g.key} style={{ background: GROUP_COLORS[g.key] ?? 'var(--text3)', width: `${w}%`, height: 10, opacity: 0.85 }} />
                )
              })}
            </div>
            {allocationRows.map(g => {
              const pct = (g.total_inr_value_paise / totalAssetsForPct) * 100
              return (
                <div key={g.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 7, height: 7, background: GROUP_COLORS[g.key] ?? 'var(--text3)' }} />
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text2)' }}>{g.label}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>{formatMoney(g.total_inr_value_paise, 'INR', true)}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', marginLeft: 8 }}>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              )
            })}
            {allocationRows.length === 0 && (
              <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10 }}>No assets</div>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
