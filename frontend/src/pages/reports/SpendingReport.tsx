import { useState, useEffect, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  Legend,
} from 'recharts'
import { getTransactions } from '../../api/transactions'
import type { Transaction } from '../../types/transaction'
import { getCategories } from '../../api/categories'
import type { CategoryNode } from '../../types/category'
import { formatMoney, formatDateDisplay } from '../../utils/format'

// ─── Period helpers ───────────────────────────────────────────────────────────

type PeriodKey =
  | 'this_month' | 'last_month'
  | 'this_quarter' | 'last_quarter'
  | 'this_fy' | 'last_fy'
  | 'last_3m' | 'last_6m' | 'custom'

const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_month: 'This Month',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_fy: 'This FY',
  last_fy: 'Last FY',
  last_3m: 'Last 3M',
  last_6m: 'Last 6M',
  custom: 'Custom',
}

function toISO(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

function getPeriodRange(key: PeriodKey, custom: { from: string; to: string }): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (key) {
    case 'this_month':
      return { from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)) }
    case 'last_month':
      return { from: toISO(new Date(y, m - 1, 1)), to: toISO(new Date(y, m, 0)) }
    case 'this_quarter': {
      const q = Math.floor(m / 3)
      return { from: toISO(new Date(y, q * 3, 1)), to: toISO(new Date(y, q * 3 + 3, 0)) }
    }
    case 'last_quarter': {
      const pq = Math.floor(m / 3) - 1
      if (pq < 0) return { from: toISO(new Date(y - 1, 9, 1)), to: toISO(new Date(y - 1, 12, 0)) }
      return { from: toISO(new Date(y, pq * 3, 1)), to: toISO(new Date(y, pq * 3 + 3, 0)) }
    }
    case 'this_fy': {
      const fyY = m >= 3 ? y : y - 1
      return { from: `${fyY}-04-01`, to: toISO(now) }
    }
    case 'last_fy': {
      const fyY = (m >= 3 ? y : y - 1) - 1
      return { from: `${fyY}-04-01`, to: `${fyY + 1}-03-31` }
    }
    case 'last_3m': {
      const from = new Date(now)
      from.setMonth(now.getMonth() - 3)
      return { from: toISO(from), to: toISO(now) }
    }
    case 'last_6m': {
      const from = new Date(now)
      from.setMonth(now.getMonth() - 6)
      return { from: toISO(from), to: toISO(now) }
    }
    case 'custom':
      return custom
  }
}

function rangeLabel(from: string, to: string): string {
  if (!from || !to) return ''
  const fmt = (s: string) =>
    new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  const f = fmt(from)
  const t = fmt(to)
  return f === t ? f : `${f} – ${t}`
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

interface CategoryRow {
  id: string | null
  name: string
  total: number
  count: number
  pct: number
}

interface MonthlyPoint {
  label: string
  total: number
  [cat: string]: number | string
}

type CatInfo = { name: string; parent_id: string | null }

function buildCatMap(nodes: CategoryNode[]): Map<string, CatInfo> {
  const map = new Map<string, CatInfo>()
  function traverse(nodes: CategoryNode[]) {
    for (const n of nodes) {
      map.set(n.id, { name: n.name, parent_id: n.parent_id })
      traverse(n.children)
    }
  }
  traverse(nodes)
  return map
}

function getRootName(catId: string | null, fallback: string, catMap: Map<string, CatInfo>): string {
  if (!catId || !catMap.has(catId)) return fallback
  let id: string | null = catId
  let rootName = fallback
  while (id && catMap.has(id)) {
    const info: CatInfo = catMap.get(id)!
    rootName = info.name
    id = info.parent_id
  }
  return rootName
}

const CAT_COLORS = [
  '#f04060', '#3a7fff', '#00c896', '#f0a500', '#9060f0',
  '#00b4d8', '#e07040', '#60c060', '#c060a0', '#80b0e0',
]

interface AggResult {
  categories: CategoryRow[]
  monthly: MonthlyPoint[]
  topExpenses: Transaction[]
  totalSpend: number
  monthCount: number
}

function aggregate(txns: Transaction[], catMap: Map<string, CatInfo>): AggResult {
  const expenses = txns.filter(t => t.type === 'expense')
  const totalSpend = expenses.reduce((s, t) => s + t.inr_amount_paise, 0)

  // Category rollup
  const catTotals = new Map<string, { id: string | null; total: number; count: number }>()
  for (const t of expenses) {
    const name = getRootName(t.category_id, t.category_name ?? 'Uncategorized', catMap)
    const existing = catTotals.get(name) ?? { id: t.category_id, total: 0, count: 0 }
    existing.total += t.inr_amount_paise
    existing.count += 1
    catTotals.set(name, existing)
  }
  const sortedCats = [...catTotals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
  const categories: CategoryRow[] = sortedCats.map(([name, v]) => ({
    id: v.id,
    name,
    total: v.total,
    count: v.count,
    pct: totalSpend > 0 ? (v.total / totalSpend) * 100 : 0,
  }))

  // Monthly breakdown (top 5 categories)
  const top5 = sortedCats.slice(0, 5).map(([name]) => name)
  const monthMap = new Map<string, { total: number; byCat: Map<string, number> }>()
  for (const t of expenses) {
    const key = t.date.slice(0, 7)
    const entry = monthMap.get(key) ?? { total: 0, byCat: new Map() }
    entry.total += t.inr_amount_paise
    const cat = getRootName(t.category_id, t.category_name ?? 'Uncategorized', catMap)
    entry.byCat.set(cat, (entry.byCat.get(cat) ?? 0) + t.inr_amount_paise)
    monthMap.set(key, entry)
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthly: MonthlyPoint[] = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => {
      const [, mm] = key.split('-')
      const pt: MonthlyPoint = { label: MONTHS[parseInt(mm) - 1] ?? key, total: v.total }
      for (const cat of top5) pt[cat] = v.byCat.get(cat) ?? 0
      return pt
    })

  // Top individual expenses
  const topExpenses = [...expenses]
    .sort((a, b) => b.inr_amount_paise - a.inr_amount_paise)
    .slice(0, 15)

  const monthCount = monthMap.size

  return { categories, monthly, topExpenses, totalSpend, monthCount }
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function SpendingReport() {
  const [period, setPeriod] = useState<PeriodKey>('this_fy')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [catMap, setCatMap] = useState<Map<string, CatInfo>>(new Map())

  const range = getPeriodRange(period, { from: customFrom, to: customTo })

  useEffect(() => {
    getCategories().then(({ categories }) => setCatMap(buildCatMap(categories))).catch(() => {})
  }, [])

  const fetchAll = useCallback(async (from: string, to: string) => {
    if (!from || !to) return
    setLoading(true)
    setError(null)
    const all: Transaction[] = []
    let cursor: string | null = null
    try {
      do {
        const res = await getTransactions({ date_from: from, date_to: to, limit: 500, ...(cursor ? { cursor } : {}) })
        all.push(...res.transactions)
        cursor = res.next_cursor
      } while (cursor)
      setTransactions(all)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (period === 'custom') {
      if (customFrom && customTo) fetchAll(customFrom, customTo)
    } else {
      const r = getPeriodRange(period, { from: customFrom, to: customTo })
      fetchAll(r.from, r.to)
    }
  }, [period, customFrom, customTo, fetchAll])

  const { categories, monthly, topExpenses, totalSpend, monthCount } = aggregate(transactions, catMap)
  const top5Names = categories.slice(0, 5).map(c => c.name)
  const avgMonthly = monthCount > 0 ? totalSpend / monthCount : 0
  const topCat = categories[0]
  const multiMonth = monthly.length >= 2

  // Bar chart data: top 10 categories for horizontal bar
  const barData = categories.slice(0, 12).map(c => ({ name: c.name, value: c.total }))

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%' }}>

      {/* Breadcrumb */}
      <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em' }}>
        <Link to="/reports" style={{ color: 'var(--text3)', textDecoration: 'none' }}>REPORTS</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ color: 'var(--text2)' }}>SPENDING</span>
      </div>

      {/* Controls bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text2)' }}>Period:</span>
        <div style={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map(k => (
            <button key={k} style={period === k ? btnActive : btnBase} onClick={() => setPeriod(k)}>
              {PERIOD_LABELS[k]}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px', cursor: 'pointer' }} />
            <span style={{ color: 'var(--text3)', fontSize: 10 }}>–</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px', cursor: 'pointer' }} />
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>{rangeLabel(range.from, range.to)}</span>
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
        {[
          { label: 'Total Spend', value: formatMoney(totalSpend), color: 'var(--red)', sub: rangeLabel(range.from, range.to) || '—' },
          { label: 'Avg / Month', value: avgMonthly > 0 ? formatMoney(avgMonthly) : '—', color: 'var(--text)', sub: `${monthCount} month${monthCount !== 1 ? 's' : ''}` },
          { label: 'Transactions', value: String(topExpenses.length > 0 || transactions.filter(t => t.type === 'expense').length > 0 ? transactions.filter(t => t.type === 'expense').length : 0), color: 'var(--text)', sub: 'expense entries' },
          { label: 'Top Category', value: topCat ? topCat.name : '—', color: 'var(--accent)', sub: topCat ? formatMoney(topCat.total, 'INR', true) + ` · ${topCat.pct.toFixed(1)}%` : '' },
        ].map(({ label, value, color, sub }) => (
          <div key={label} style={{ background: 'var(--bg3)', padding: '8px 14px' }}>
            <div style={mlStyle}>{label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: label === 'Top Category' ? 13 : 17, color, marginTop: 2, wordBreak: 'break-word' }}>{value}</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{sub}</div>
          </div>
        ))}
      </div>

      {loading && (
        <div style={{ padding: '12px 16px', fontFamily: 'var(--font-cond)', color: 'var(--text3)', fontSize: 10, letterSpacing: '0.08em' }}>Loading…</div>
      )}
      {error && !loading && (
        <div style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', color: 'var(--red)', fontSize: 11 }}>{error}</div>
      )}

      {/* Category breakdown — bar + table */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ background: 'var(--bg2)' }}>
          <div style={sHd}>
            Spending by Category
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>{rangeLabel(range.from, range.to)}</span>
          </div>
          <div style={{ padding: '12px 12px 8px' }}>
            {barData.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, padding: '30px 0', textAlign: 'center', letterSpacing: '0.08em' }}>
                NO EXPENSE TRANSACTIONS IN THIS PERIOD
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(120, barData.length * 26 + 20)}>
                <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 60, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID_PROPS} horizontal={false} />
                  <XAxis type="number" tickFormatter={v => formatMoney(v, 'INR', true)} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fill: 'var(--text2)', fontSize: 10, fontFamily: 'IBM Plex Sans Condensed' }} tickLine={false} axisLine={false} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const { name, value } = payload[0].payload as { name: string; value: number }
                    const pct = totalSpend > 0 ? (value / totalSpend) * 100 : 0
                    return (
                      <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        <div style={{ color: 'var(--text)' }}>{name}</div>
                        <div style={{ color: '#f04060' }}>{formatMoney(value)}</div>
                        <div style={{ color: 'var(--text3)', fontSize: 9 }}>{pct.toFixed(1)}% of total</div>
                      </div>
                    )
                  }} />
                  <Bar dataKey="value" radius={[0, 2, 2, 0]} maxBarSize={18}>
                    {barData.map((_, i) => (
                      <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Side table */}
        <div style={{ background: 'var(--bg2)', borderLeft: '1px solid var(--border)' }}>
          <div style={sHd}>Category Table</div>
          <div style={{ padding: '8px 0' }}>
            {categories.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-mono)', padding: '8px 12px' }}>—</div>
            ) : (
              categories.map((cat, i) => (
                <div key={cat.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 12px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <div style={{ width: 6, height: 6, background: CAT_COLORS[i % CAT_COLORS.length], flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#f04060' }}>{formatMoney(cat.total, 'INR', true)}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)' }}>{cat.pct.toFixed(1)}%</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Monthly spending trend */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={sHd}>Monthly Spending Trend — Top Categories</div>
        <div style={{ background: 'var(--bg2)', padding: '16px 12px 8px' }}>
          {!multiMonth ? (
            <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, padding: '20px 0', textAlign: 'center', letterSpacing: '0.08em' }}>
              SELECT A MULTI-MONTH PERIOD TO SEE TRENDS
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly} barCategoryGap="30%" barGap={1} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => formatMoney(v, 'INR', true)} tick={AXIS_TICK} axisLine={false} tickLine={false} width={54} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconSize={8} wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', paddingTop: 4 }} />
                {top5Names.map((name, i) => (
                  <Bar key={name} dataKey={name} stackId="a" fill={CAT_COLORS[i % CAT_COLORS.length]} fillOpacity={0.85} radius={i === top5Names.length - 1 ? [1, 1, 0, 0] : undefined} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top expense transactions */}
      <div>
        <div style={sHd}>
          Top Transactions by Amount
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>largest expenses</span>
        </div>
        <div style={{ background: 'var(--bg2)' }}>
          {topExpenses.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, textAlign: 'center', letterSpacing: '0.08em' }}>
              NO EXPENSE TRANSACTIONS IN THIS PERIOD
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)' }}>
                  {['Date', 'Description', 'Account', 'Category', 'Amount'].map((h, i) => (
                    <th key={h} style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', padding: '5px 10px', textAlign: i === 4 ? 'right' : 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topExpenses.map((tx, i) => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg3)' }}>
                    <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{formatDateDisplay(tx.date)}</td>
                    <td style={{ padding: '5px 10px', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description}</td>
                    <td style={{ padding: '5px 10px', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{tx.account_name}</td>
                    <td style={{ padding: '5px 10px', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{tx.category_name ?? '—'}</td>
                    <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#f04060', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(tx.inr_amount_paise, 'INR', true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  )
}
