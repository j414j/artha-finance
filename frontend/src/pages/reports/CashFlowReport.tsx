import { useState, useEffect, useCallback, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
} from 'recharts'
import { getTransactions } from '../../api/transactions'
import type { Transaction } from '../../types/transaction'
import { formatMoney } from '../../utils/format'

// ─── Period helpers ───────────────────────────────────────────────────────────

type PeriodKey =
  | 'this_week' | 'this_month' | 'last_month'
  | 'this_quarter' | 'last_quarter'
  | 'this_fy' | 'last_fy'
  | 'last_30' | 'custom'

const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_week: 'This Week',
  this_month: 'This Month',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_fy: 'This FY',
  last_fy: 'Last FY',
  last_30: 'Last 30 Days',
  custom: 'Custom Range',
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getPeriodRange(key: PeriodKey, custom: { from: string; to: string }): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (key) {
    case 'this_week': {
      const monday = new Date(now)
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { from: toISO(monday), to: toISO(sunday) }
    }
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
    case 'last_30': {
      const from = new Date(now)
      from.setDate(now.getDate() - 29)
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

// ─── Data aggregation ─────────────────────────────────────────────────────────

interface SourceRow { label: string; amount: number }

interface FlowData {
  incomeSources: SourceRow[]
  expenseCategories: SourceRow[]
  totalIncome: number
  totalExpenses: number
  investments: number
  loans: number
  netSavings: number
}

interface MonthlyPoint {
  label: string
  income: number
  expenses: number
  netSavings: number
  deficit: boolean
}

interface CumulativePoint {
  label: string
  cumIncome: number
  cumExpenses: number
  cumSavings: number
}

function aggregateFlowData(txns: Transaction[]): FlowData {
  const incomeMap = new Map<string, number>()
  const expenseMap = new Map<string, number>()
  let investments = 0
  let loans = 0
  for (const t of txns) {
    if (t.type === 'income') {
      const k = t.category_name ?? t.description
      incomeMap.set(k, (incomeMap.get(k) ?? 0) + t.amount_paise)
    } else if (t.type === 'dividend') {
      incomeMap.set('Dividends', (incomeMap.get('Dividends') ?? 0) + t.amount_paise)
    } else if (t.type === 'expense') {
      const k = t.category_name ?? 'Uncategorized'
      expenseMap.set(k, (expenseMap.get(k) ?? 0) + t.amount_paise)
    } else if (t.type === 'investment_buy') {
      investments += t.amount_paise
    } else if (t.type === 'loan_repayment') {
      loans += t.amount_paise
    }
  }
  const sortedIncome = [...incomeMap.entries()].sort((a, b) => b[1] - a[1])
  const sortedExpense = [...expenseMap.entries()].sort((a, b) => b[1] - a[1])
  const incomeSources: SourceRow[] = sortedIncome.length <= 5
    ? sortedIncome.map(([label, amount]) => ({ label, amount }))
    : [
        ...sortedIncome.slice(0, 5).map(([label, amount]) => ({ label, amount })),
        { label: 'Other Income', amount: sortedIncome.slice(5).reduce((s, [, v]) => s + v, 0) },
      ]
  const expenseCategories: SourceRow[] = sortedExpense.length <= 8
    ? sortedExpense.map(([label, amount]) => ({ label, amount }))
    : [
        ...sortedExpense.slice(0, 8).map(([label, amount]) => ({ label, amount })),
        { label: 'Other Expenses', amount: sortedExpense.slice(8).reduce((s, [, v]) => s + v, 0) },
      ]
  const totalIncome = incomeSources.reduce((s, r) => s + r.amount, 0)
  const totalExpenses = expenseCategories.reduce((s, r) => s + r.amount, 0)
  const netSavings = Math.max(0, totalIncome - totalExpenses - investments - loans)
  return { incomeSources, expenseCategories, totalIncome, totalExpenses, investments, loans, netSavings }
}

function aggregateMonthly(txns: Transaction[]): { monthly: MonthlyPoint[]; cumulative: CumulativePoint[] } {
  const map = new Map<string, { income: number; expenses: number; investments: number; loans: number }>()
  for (const t of txns) {
    const key = t.date.slice(0, 7) // YYYY-MM
    const e = map.get(key) ?? { income: 0, expenses: 0, investments: 0, loans: 0 }
    if (t.type === 'income' || t.type === 'dividend') e.income += t.amount_paise
    else if (t.type === 'expense') e.expenses += t.amount_paise
    else if (t.type === 'investment_buy') e.investments += t.amount_paise
    else if (t.type === 'loan_repayment') e.loans += t.amount_paise
    map.set(key, e)
  }
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  const monthly: MonthlyPoint[] = sorted.map(([key, v]) => {
    const [, mm] = key.split('-')
    const label = MONTHS[parseInt(mm) - 1]
    const netSavings = Math.max(0, v.income - v.expenses - v.investments - v.loans)
    return { label, income: v.income, expenses: v.expenses, netSavings, deficit: v.expenses > v.income }
  })
  let cumIncome = 0
  let cumExpenses = 0
  const cumulative: CumulativePoint[] = monthly.map(m => {
    cumIncome += m.income
    cumExpenses += m.expenses
    return { label: m.label, cumIncome, cumExpenses, cumSavings: Math.max(0, cumIncome - cumExpenses) }
  })
  return { monthly, cumulative }
}

// ─── Sankey geometry ──────────────────────────────────────────────────────────

const CHART_TOP = 20
const CHART_BOTTOM = 460
const NODE_GAP = 8
const NODE_WIDTH = 14
const COL_LEFT = 0
const COL_MID = 493
const COL_RIGHT = 886
const CTRL_LM = 246
const CTRL_LR = 510

interface NodeGeom {
  label: string; amount: number
  x: number; y: number; h: number
  color: string; textColor: string; gradient: string
}
interface FlowGeom {
  d: string; gradient: string
  srcLabel: string; tgtLabel: string; amount: number; opacity: number
}
interface SankeyGeom {
  incomeNodes: NodeGeom[]; expenseNodes: NodeGeom[]
  destNodes: NodeGeom[]; flows: FlowGeom[]
}

function computeSankey(data: FlowData): SankeyGeom | null {
  const { incomeSources, expenseCategories, totalIncome, totalExpenses, investments, loans, netSavings } = data
  if (totalIncome === 0) return null
  const chartH = CHART_BOTTOM - CHART_TOP
  const incomeGaps = Math.max(0, incomeSources.length - 1) * NODE_GAP
  const pxPerPaise = (chartH - incomeGaps) / totalIncome
  let yCursor = CHART_TOP
  const incomeNodes: NodeGeom[] = incomeSources.map(src => {
    const h = Math.max(4, src.amount * pxPerPaise)
    const node: NodeGeom = { label: src.label, amount: src.amount, x: COL_LEFT, y: yCursor, h, color: 'var(--green)', textColor: 'var(--green)', gradient: 'node-income' }
    yCursor += h + NODE_GAP
    return node
  })
  const expenseGaps = Math.max(0, expenseCategories.length - 1) * NODE_GAP
  const expenseH = totalExpenses * pxPerPaise
  let expYCursor = CHART_TOP
  const expenseNodes: NodeGeom[] = expenseCategories.map(cat => {
    const h = Math.max(4, cat.amount * pxPerPaise)
    const node: NodeGeom = { label: cat.label, amount: cat.amount, x: COL_MID, y: expYCursor, h, color: 'var(--red)', textColor: 'var(--red)', gradient: 'node-expense' }
    expYCursor += h + NODE_GAP
    return node
  })
  const expTotalH = expenseH + expenseGaps
  const expOffset = Math.max(0, (chartH - expTotalH) / 2)
  expenseNodes.forEach(n => { n.y += expOffset })
  const dests: { label: string; amount: number; gradient: string; textColor: string }[] = []
  if (investments > 0) dests.push({ label: 'Investments', amount: investments, gradient: 'node-invest', textColor: 'var(--purple)' })
  if (loans > 0) dests.push({ label: 'Loan Repay', amount: loans, gradient: 'node-loan', textColor: 'var(--blue)' })
  if (netSavings > 0) dests.push({ label: 'Net Savings', amount: netSavings, gradient: 'node-save', textColor: 'var(--accent)' })
  const destGaps = Math.max(0, dests.length - 1) * NODE_GAP
  let dYCursor = CHART_TOP
  const destNodes: NodeGeom[] = dests.map(d => {
    const h = Math.max(4, d.amount * pxPerPaise)
    const node: NodeGeom = { label: d.label, amount: d.amount, x: COL_RIGHT, y: dYCursor, h, color: d.textColor, textColor: d.textColor, gradient: d.gradient }
    dYCursor += h + NODE_GAP
    return node
  })
  const destTotalH = dests.reduce((s, d) => s + Math.max(4, d.amount * pxPerPaise), 0) + destGaps
  const destOffset = Math.max(0, (chartH - destTotalH) / 2)
  destNodes.forEach(n => { n.y += destOffset })
  const flows: FlowGeom[] = []
  const srcCursors = incomeNodes.map(n => n.y)
  const expCursors = expenseNodes.map(n => n.y)
  const destCursors = destNodes.map(n => n.y)
  function fp(srcX: number, srcY: number, srcH: number, tgtX: number, tgtY: number, tgtH: number, ctrlX: number): string {
    return (
      `M ${srcX + NODE_WIDTH},${srcY} C ${ctrlX},${srcY} ${ctrlX},${tgtY} ${tgtX},${tgtY} ` +
      `L ${tgtX},${tgtY + tgtH} C ${ctrlX},${tgtY + tgtH} ${ctrlX},${srcY + srcH} ${srcX + NODE_WIDTH},${srcY + srcH} Z`
    )
  }
  for (let si = 0; si < incomeNodes.length; si++) {
    const src = incomeNodes[si]
    const srcRatio = src.amount / totalIncome
    for (let ei = 0; ei < expenseNodes.length; ei++) {
      const exp = expenseNodes[ei]
      const flowAmount = src.amount * (exp.amount / totalIncome)
      const flowH = Math.max(0.5, flowAmount * pxPerPaise)
      flows.push({ d: fp(src.x, srcCursors[si], flowH, exp.x, expCursors[ei], flowH, CTRL_LM), gradient: 'grad-expense', srcLabel: src.label, tgtLabel: exp.label, amount: Math.round(flowAmount), opacity: 0.65 })
      srcCursors[si] += flowH
      expCursors[ei] += flowH
    }
    for (let di = 0; di < destNodes.length; di++) {
      const dest = destNodes[di]
      const flowAmount = srcRatio * dests[di].amount
      const flowH = Math.max(0.5, flowAmount * pxPerPaise)
      const gradient = dests[di].gradient === 'node-invest' ? 'grad-invest' : dests[di].gradient === 'node-loan' ? 'grad-loan' : 'grad-savings'
      flows.push({ d: fp(src.x, srcCursors[si], flowH, dest.x, destCursors[di], flowH, CTRL_LR), gradient, srcLabel: src.label, tgtLabel: dest.label, amount: Math.round(flowAmount), opacity: 0.55 })
      srcCursors[si] += flowH
      destCursors[di] += flowH
    }
  }
  return { incomeNodes, expenseNodes, destNodes, flows }
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

// ─── Recharts custom tooltip ──────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>
      <div style={{ color: 'var(--text3)', marginBottom: 4, fontSize: 10, fontFamily: 'var(--font-cond)' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>{p.name}: {formatMoney(p.value)}</div>
      ))}
    </div>
  )
}

const AXIS_TICK = { fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' } as const
const GRID_PROPS = { stroke: '#1e2535', strokeDasharray: '3 3' }

// ─── Tooltip state ────────────────────────────────────────────────────────────

interface TooltipState { x: number; y: number; lines: string[] }

// ─── Main component ───────────────────────────────────────────────────────────

export default function CashFlowReport() {
  const [period, setPeriod] = useState<PeriodKey>('this_fy')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const range = getPeriodRange(period, { from: customFrom, to: customTo })

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

  const flowData = aggregateFlowData(transactions)
  const sankey = computeSankey(flowData)
  const { monthly, cumulative } = aggregateMonthly(transactions)
  const { totalIncome, totalExpenses, investments, loans, netSavings } = flowData
  const expRatio = totalIncome > 0 ? totalExpenses / totalIncome : 0
  const savingsRate = totalIncome > 0 ? netSavings / totalIncome : 0
  const investRate = totalIncome > 0 ? investments / totalIncome : 0

  function pct(n: number) {
    return totalIncome > 0 ? `${((n / totalIncome) * 100).toFixed(1)}%` : '—'
  }

  function getInsight(): string {
    if (totalIncome === 0) return 'No income recorded in this period.'
    if (expRatio > 0.5) return `Expenses are above the 50% threshold (${(expRatio * 100).toFixed(1)}%). Review discretionary spending.`
    if (savingsRate < 0.2) return `Savings rate is ${(savingsRate * 100).toFixed(1)}% — consider increasing to at least 20%.`
    if (investRate > 0.3) return `Strong investing rate of ${(investRate * 100).toFixed(1)}%. Expenses well below threshold.`
    return `Expenses are below the 50% threshold. Investing rate of ${(investRate * 100).toFixed(1)}% is healthy.`
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (containerRef.current && tooltip) {
      const rect = containerRef.current.getBoundingClientRect()
      setTooltip(prev => prev ? { ...prev, x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8 } : null)
    }
  }
  function showFlowTip(e: React.MouseEvent, flow: FlowGeom) {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setTooltip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8, lines: [`${flow.srcLabel} → ${flow.tgtLabel}`, formatMoney(flow.amount)] })
  }
  function showNodeTip(e: React.MouseEvent, label: string, amount: number) {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setTooltip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8, lines: [label, formatMoney(amount)] })
  }

  const deficitMonths = monthly.filter(m => m.deficit).map(m => m.label)
  const multiMonth = monthly.length >= 2

  return (
    <div ref={containerRef} style={{ background: 'var(--bg)', minHeight: '100%', position: 'relative' }} onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>

      {/* Breadcrumb */}
      <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em' }}>
        <Link to="/reports" style={{ color: 'var(--text3)', textDecoration: 'none' }}>REPORTS</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ color: 'var(--text2)' }}>CASH FLOW</span>
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
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px', cursor: 'pointer' }} />
            <span style={{ color: 'var(--text3)', fontSize: 10 }}>–</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px', cursor: 'pointer' }} />
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>{rangeLabel(range.from, range.to)}</span>
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
        {[
          { label: 'Total Income', value: totalIncome, color: 'var(--green)', sub: rangeLabel(range.from, range.to) || '—', subColor: 'var(--text3)' },
          { label: 'Total Expenses', value: totalExpenses, color: 'var(--red)', sub: pct(totalExpenses) + ' of income', subColor: 'var(--text3)' },
          { label: 'Investments', value: investments, color: 'var(--purple)', sub: pct(investments) + ' of income', subColor: 'var(--text3)' },
          { label: 'Loan Repayments', value: loans, color: 'var(--blue)', sub: pct(loans) + ' of income', subColor: 'var(--text3)' },
          { label: 'Net Saved (Cash)', value: netSavings, color: 'var(--accent)', sub: 'Savings rate ' + pct(netSavings), subColor: 'var(--green)' },
        ].map(({ label, value, color, sub, subColor }) => (
          <div key={label} style={{ background: 'var(--bg3)', padding: '8px 14px' }}>
            <div style={mlStyle}>{label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color, marginTop: 2 }}>{formatMoney(value)}</div>
            <div style={{ fontSize: 9, color: subColor, fontFamily: 'var(--font-mono)' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Section 1: Sankey + Right panel ── */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={{ ...sHd, border: 'none', borderBottom: '1px solid var(--border)' }}>
          Money Flow — Sankey Diagram
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>{rangeLabel(range.from, range.to)}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 1, background: 'var(--border)' }}>
          {/* Sankey canvas */}
          <div style={{ background: 'var(--bg2)', padding: '16px 16px 12px', position: 'relative' }}>
            {loading && <div style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '40px 0' }}>Loading…</div>}
            {error && !loading && <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '20px 0' }}>{error}</div>}
            {!loading && !error && (
              <svg width="100%" height="510" viewBox="-120 0 1080 510" style={{ display: 'block', overflow: 'visible' }}>
                <defs>
                  <linearGradient id="cf-grad-expense" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#00c896" stopOpacity={0.6}/><stop offset="100%" stopColor="#f04060" stopOpacity={0.4}/></linearGradient>
                  <linearGradient id="cf-grad-invest" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#00c896" stopOpacity={0.5}/><stop offset="100%" stopColor="#9060f0" stopOpacity={0.6}/></linearGradient>
                  <linearGradient id="cf-grad-loan" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#00c896" stopOpacity={0.5}/><stop offset="100%" stopColor="#3a7fff" stopOpacity={0.6}/></linearGradient>
                  <linearGradient id="cf-grad-savings" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#00c896" stopOpacity={0.5}/><stop offset="100%" stopColor="#f0a500" stopOpacity={0.7}/></linearGradient>
                  <linearGradient id="cf-node-income" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00c896"/><stop offset="100%" stopColor="#009e78"/></linearGradient>
                  <linearGradient id="cf-node-expense" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f04060"/><stop offset="100%" stopColor="#c02040"/></linearGradient>
                  <linearGradient id="cf-node-invest" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9060f0"/><stop offset="100%" stopColor="#6040c0"/></linearGradient>
                  <linearGradient id="cf-node-loan" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3a7fff"/><stop offset="100%" stopColor="#2060dd"/></linearGradient>
                  <linearGradient id="cf-node-save" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f0a500"/><stop offset="100%" stopColor="#c07800"/></linearGradient>
                </defs>
                <line x1={200} y1={0} x2={200} y2={460} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 4"/>
                <line x1={690} y1={0} x2={690} y2={460} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 4"/>
                <text x={COL_LEFT} y={490} fontSize={9} fill="var(--text3)" fontFamily="IBM Plex Sans Condensed" fontWeight={600} letterSpacing={1}>INCOME SOURCES</text>
                <text x={COL_MID - 30} y={490} fontSize={9} fill="var(--text3)" fontFamily="IBM Plex Sans Condensed" fontWeight={600} letterSpacing={1}>EXPENSE CATEGORIES</text>
                <text x={COL_RIGHT - 10} y={490} fontSize={9} fill="var(--text3)" fontFamily="IBM Plex Sans Condensed" fontWeight={600} letterSpacing={1}>DESTINATIONS</text>
                {!sankey && totalIncome === 0 && (
                  <text x={440} y={240} textAnchor="middle" fontSize={13} fill="var(--text3)" fontFamily="IBM Plex Sans Condensed">No transactions in this period</text>
                )}
                {sankey && (<>
                  {sankey.flows.map((flow, i) => (
                    <path key={i} d={flow.d} fill={`url(#cf-${flow.gradient})`} opacity={flow.opacity} style={{ cursor: 'pointer' }}
                      onMouseEnter={e => showFlowTip(e, flow)} onMouseLeave={() => setTooltip(null)}/>
                  ))}
                  {sankey.incomeNodes.map((n, i) => (
                    <g key={`inc-${i}`}>
                      <rect x={n.x} y={n.y} width={NODE_WIDTH} height={n.h} rx={2} fill={`url(#cf-${n.gradient})`} style={{ cursor: 'pointer' }} onMouseEnter={e => showNodeTip(e, n.label, n.amount)} onMouseLeave={() => setTooltip(null)}/>
                      <text x={n.x - 6} y={n.y + n.h / 2 - 5} textAnchor="end" fontSize={11} fill="var(--text)" fontFamily="IBM Plex Sans Condensed" fontWeight={600}>{n.label}</text>
                      <text x={n.x - 6} y={n.y + n.h / 2 + 8} textAnchor="end" fontSize={9} fill={n.textColor} fontFamily="IBM Plex Mono">{formatMoney(n.amount)}</text>
                    </g>
                  ))}
                  {sankey.expenseNodes.map((n, i) => (
                    <g key={`exp-${i}`}>
                      <rect x={n.x} y={n.y} width={NODE_WIDTH} height={n.h} rx={2} fill={`url(#cf-${n.gradient})`} style={{ cursor: 'pointer' }} onMouseEnter={e => showNodeTip(e, n.label, n.amount)} onMouseLeave={() => setTooltip(null)}/>
                      <text x={n.x + NODE_WIDTH + 8} y={n.y + n.h / 2 - 5} fontSize={11} fill="var(--text)" fontFamily="IBM Plex Sans Condensed" fontWeight={600}>{n.label}</text>
                      <text x={n.x + NODE_WIDTH + 8} y={n.y + n.h / 2 + 8} fontSize={9} fill={n.textColor} fontFamily="IBM Plex Mono">{formatMoney(n.amount)}</text>
                    </g>
                  ))}
                  {sankey.destNodes.map((n, i) => (
                    <g key={`dest-${i}`}>
                      <rect x={n.x} y={n.y} width={NODE_WIDTH} height={n.h} rx={2} fill={`url(#cf-${n.gradient})`} style={{ cursor: 'pointer' }} onMouseEnter={e => showNodeTip(e, n.label, n.amount)} onMouseLeave={() => setTooltip(null)}/>
                      <text x={n.x + NODE_WIDTH + 8} y={n.y + n.h / 2 - 5} fontSize={11} fill="var(--text)" fontFamily="IBM Plex Sans Condensed" fontWeight={600}>{n.label}</text>
                      <text x={n.x + NODE_WIDTH + 8} y={n.y + n.h / 2 + 8} fontSize={9} fill={n.textColor} fontFamily="IBM Plex Mono">{formatMoney(n.amount)}</text>
                    </g>
                  ))}
                </>)}
              </svg>
            )}
          </div>

          {/* Right panel */}
          <div style={{ background: 'var(--bg2)', borderLeft: '1px solid var(--border)' }}>
            <div style={sHd}>Income Breakdown</div>
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {flowData.incomeSources.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>—</div>}
              {flowData.incomeSources.map((src, i) => {
                const barW = totalIncome > 0 ? (src.amount / totalIncome) * 100 : 0
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, background: 'var(--green)', opacity: 1 - i * 0.1 }}/>
                        <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-cond)', fontSize: 11 }}>{src.label}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>{formatMoney(src.amount)}</div>
                        <div style={{ fontSize: 9, color: 'var(--text3)' }}>{(barW).toFixed(1)}%</div>
                      </div>
                    </div>
                    <div style={{ height: 3, background: 'var(--bg4)', marginTop: 3 }}>
                      <div style={{ height: 3, background: 'var(--green)', width: `${barW}%`, opacity: 0.85 }}/>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ ...sHd, marginTop: 4 }}>Expense Breakdown</div>
            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {flowData.expenseCategories.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>—</div>}
              {flowData.expenseCategories.map((cat, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '3px 0', borderBottom: i < flowData.expenseCategories.length - 1 ? '1px solid var(--border)' : undefined }}>
                  <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-cond)' }}>{cat.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>{formatMoney(cat.amount)}</span>
                </div>
              ))}
            </div>
            <div style={{ ...sHd, marginTop: 4 }}>Allocation Summary</div>
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { label: 'Expenses', amount: totalExpenses, color: 'var(--red)' },
                { label: 'Investments', amount: investments, color: 'var(--purple)' },
                { label: 'Net Savings', amount: netSavings, color: 'var(--accent)' },
                { label: 'Loan Repay', amount: loans, color: 'var(--blue)' },
              ].map(({ label, amount, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, background: color }}/>
                    <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-cond)' }}>{label}</span>
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', color }}>{pct(amount)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', height: 8, marginTop: 4, gap: 1 }}>
                {[{ amount: totalExpenses, color: 'var(--red)' }, { amount: investments, color: 'var(--purple)' }, { amount: netSavings, color: 'var(--accent)' }, { amount: loans, color: 'var(--blue)' }].map(({ amount, color }, i) => {
                  const w = totalIncome > 0 ? (amount / totalIncome) * 100 : 0
                  return w > 0 ? <div key={i} style={{ background: color, width: `${w}%`, height: 8 }}/> : null
                })}
              </div>
            </div>
            <div style={{ margin: 12, padding: 8, background: 'var(--bg3)', borderLeft: '2px solid var(--accent)' }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-cond)', color: 'var(--text2)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--accent)' }}>▲</span>{' '}{getInsight()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Monthly Cash Flow Bar Chart ── */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={sHd}>Monthly Cash Flow — Income, Expenses &amp; Net Savings</div>
        <div style={{ background: 'var(--bg2)', padding: '16px 12px 8px' }}>
          {!multiMonth ? (
            <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, padding: '20px 0', textAlign: 'center', letterSpacing: '0.08em' }}>
              SELECT A MULTI-MONTH PERIOD TO SEE TRENDS
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly} barCategoryGap="30%" barGap={2} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} vertical={false}/>
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v => formatMoney(v, 'INR', true)} tick={AXIS_TICK} axisLine={false} tickLine={false} width={54}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Legend iconSize={8} wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', paddingTop: 4 }}/>
                <Bar dataKey="income" name="Income" fill="#00c896" opacity={0.85} radius={[1,1,0,0]}/>
                <Bar dataKey="expenses" name="Expenses" fill="#f04060" opacity={0.85} radius={[1,1,0,0]}/>
                <Bar dataKey="netSavings" name="Net Savings" fill="#f0a500" opacity={0.85} radius={[1,1,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Section 3: Cumulative + Trend (2-column) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)' }}>

        {/* Cumulative Cash Flow */}
        <div style={{ background: 'var(--bg2)' }}>
          <div style={sHd}>Cumulative Cash Flow — Income vs Expenses</div>
          <div style={{ padding: '16px 12px 8px' }}>
            {!multiMonth ? (
              <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, padding: '20px 0', textAlign: 'center', letterSpacing: '0.08em' }}>SELECT A MULTI-MONTH PERIOD</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={cumulative} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cf-cum-income" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00c896" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#00c896" stopOpacity={0.03}/>
                    </linearGradient>
                    <linearGradient id="cf-cum-expense" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f04060" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#f04060" stopOpacity={0.03}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_PROPS} vertical={false}/>
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v => formatMoney(v, 'INR', true)} tick={AXIS_TICK} axisLine={false} tickLine={false} width={54}/>
                  <Tooltip content={<ChartTooltip/>}/>
                  <Legend iconSize={8} wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', paddingTop: 4 }}/>
                  <Area type="monotone" dataKey="cumIncome" name="Cum. Income" stroke="#00c896" strokeWidth={2} fill="url(#cf-cum-income)" dot={false}/>
                  <Area type="monotone" dataKey="cumExpenses" name="Cum. Expenses" stroke="#f04060" strokeWidth={2} fill="url(#cf-cum-expense)" dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Income vs Expense Trend */}
        <div style={{ background: 'var(--bg2)' }}>
          <div style={sHd}>
            Income vs Expense Trend
            {deficitMonths.length > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--red)', letterSpacing: 0, textTransform: 'none' }}>
                {deficitMonths.length} deficit month{deficitMonths.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div style={{ padding: '16px 12px 8px' }}>
            {!multiMonth ? (
              <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, padding: '20px 0', textAlign: 'center', letterSpacing: '0.08em' }}>SELECT A MULTI-MONTH PERIOD</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={monthly} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <CartesianGrid {...GRID_PROPS} vertical={false}/>
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v => formatMoney(v, 'INR', true)} tick={AXIS_TICK} axisLine={false} tickLine={false} width={54}/>
                  <Tooltip content={<ChartTooltip/>}/>
                  <Legend iconSize={8} wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', paddingTop: 4 }}/>
                  {deficitMonths.map(m => (
                    <ReferenceArea key={m} x1={m} x2={m} fill="#f04060" fillOpacity={0.08}/>
                  ))}
                  <Line type="monotone" dataKey="income" name="Income" stroke="#00c896" strokeWidth={2} dot={{ fill: '#00c896', r: 3 }} activeDot={{ r: 4 }}/>
                  <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#f04060" strokeWidth={2} dot={{ fill: '#f04060', r: 3 }} activeDot={{ r: 4 }}/>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Floating tooltip (Sankey) */}
      {tooltip && (
        <div style={{ position: 'absolute', left: tooltip.x, top: tooltip.y, background: 'var(--bg3)', border: '1px solid var(--border2)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', pointerEvents: 'none', zIndex: 100, whiteSpace: 'nowrap' }}>
          {tooltip.lines.map((line, i) => (
            <div key={i} style={{ color: i === 0 ? 'var(--text)' : 'var(--green)' }}>{line}</div>
          ))}
        </div>
      )}
    </div>
  )
}
