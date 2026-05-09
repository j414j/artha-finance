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
import { sankey as d3Sankey, sankeyLinkHorizontal, sankeyLeft } from 'd3-sankey'
import type { SankeyNode, SankeyLink } from 'd3-sankey'
import { getTransactions } from '../../api/transactions'
import type { Transaction } from '../../types/transaction'
import { getCategories } from '../../api/categories'
import type { CategoryNode } from '../../types/category'
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
interface ExpenseGroup { label: string; amount: number; children: SourceRow[] }

interface FlowData {
  incomeSources: SourceRow[]
  expenseCategories: SourceRow[]   // flat list for right panel
  expenseGroups: ExpenseGroup[]    // hierarchical for Sankey
  totalIncome: number
  totalExpenses: number
  investments: number
  loans: number
  netSavings: number
  existingFunds: number
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

type CatInfo = { name: string; parent_id: string | null }

function buildCatMap(nodes: CategoryNode[]): Map<string, CatInfo> {
  const map = new Map<string, CatInfo>()
  function traverse(nodes: CategoryNode[]) {
    for (const node of nodes) {
      map.set(node.id, { name: node.name, parent_id: node.parent_id })
      traverse(node.children)
    }
  }
  traverse(nodes)
  return map
}

function getRootAndChild(catId: string | null, fallback: string, catMap: Map<string, CatInfo>): { root: string; child: string | null } {
  if (!catId || !catMap.has(catId)) return { root: fallback, child: null }
  const ancestors: string[] = []
  let id: string | null = catId
  while (id && catMap.has(id)) {
    const info: CatInfo = catMap.get(id)!
    ancestors.unshift(info.name)
    id = info.parent_id
  }
  return { root: ancestors[0] ?? fallback, child: ancestors.length > 1 ? ancestors[1] : null }
}

function aggregateFlowData(txns: Transaction[], catMap: Map<string, CatInfo>): FlowData {
  const incomeMap = new Map<string, number>()
  const expTopMap = new Map<string, { amount: number; children: Map<string, number> }>()
  let investments = 0
  let loans = 0

  for (const t of txns) {
    if (t.type === 'income') {
      const k = t.category_name ?? t.description
      incomeMap.set(k, (incomeMap.get(k) ?? 0) + t.inr_amount_paise)
    } else if (t.type === 'dividend') {
      incomeMap.set('Dividends', (incomeMap.get('Dividends') ?? 0) + t.inr_amount_paise)
    } else if (t.type === 'expense') {
      const { root, child } = getRootAndChild(t.category_id, t.category_name ?? 'Uncategorized', catMap)
      const existing = expTopMap.get(root) ?? { amount: 0, children: new Map() }
      existing.amount += t.inr_amount_paise
      if (child && child !== root) {
        existing.children.set(child, (existing.children.get(child) ?? 0) + t.inr_amount_paise)
      }
      expTopMap.set(root, existing)
    } else if (t.type === 'investment_buy') {
      investments += t.inr_amount_paise
    } else if (t.type === 'loan_repayment') {
      loans += t.inr_amount_paise
    }
  }

  const sortedIncome = [...incomeMap.entries()].sort((a, b) => b[1] - a[1])
  const incomeSources: SourceRow[] = sortedIncome.length <= 5
    ? sortedIncome.map(([label, amount]) => ({ label, amount }))
    : [
        ...sortedIncome.slice(0, 5).map(([label, amount]) => ({ label, amount })),
        { label: 'Other Income', amount: sortedIncome.slice(5).reduce((s, [, v]) => s + v, 0) },
      ]

  const sortedExpTop = [...expTopMap.entries()].sort((a, b) => b[1].amount - a[1].amount)
  const topGroups = sortedExpTop.length <= 8 ? sortedExpTop : [...sortedExpTop.slice(0, 8), ['Other Expenses', {
    amount: sortedExpTop.slice(8).reduce((s, [, v]) => s + v.amount, 0),
    children: new Map<string, number>(),
  }] as [string, { amount: number; children: Map<string, number> }]]

  const expenseGroups: ExpenseGroup[] = topGroups.map(([label, data]) => ({
    label: label as string,
    amount: (data as { amount: number; children: Map<string, number> }).amount,
    children: [...(data as { amount: number; children: Map<string, number> }).children.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([l, a]) => ({ label: l, amount: a })),
  }))

  const expenseCategories: SourceRow[] = expenseGroups.map(({ label, amount }) => ({ label, amount }))
  const totalIncome = incomeSources.reduce((s, r) => s + r.amount, 0)
  const totalExpenses = expenseGroups.reduce((s, r) => s + r.amount, 0)
  const existingFunds = Math.max(0, totalExpenses + investments + loans - totalIncome)
  const netSavings = Math.max(0, totalIncome - totalExpenses - investments - loans)

  return { incomeSources, expenseCategories, expenseGroups, totalIncome, totalExpenses, investments, loans, netSavings, existingFunds }
}

function aggregateMonthly(txns: Transaction[]): { monthly: MonthlyPoint[]; cumulative: CumulativePoint[] } {
  const map = new Map<string, { income: number; expenses: number; investments: number; loans: number }>()
  for (const t of txns) {
    const key = t.date.slice(0, 7) // YYYY-MM
    const e = map.get(key) ?? { income: 0, expenses: 0, investments: 0, loans: 0 }
    if (t.type === 'income' || t.type === 'dividend') e.income += t.inr_amount_paise
    else if (t.type === 'expense') e.expenses += t.inr_amount_paise
    else if (t.type === 'investment_buy') e.investments += t.inr_amount_paise
    else if (t.type === 'loan_repayment') e.loans += t.inr_amount_paise
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

// ─── Sankey via d3-sankey ─────────────────────────────────────────────────────

const CHART_TOP = 20
const CHART_BOTTOM = 460
const SANKEY_WIDTH = 840  // logical width of the layout extent
const NODE_WIDTH = 14
const NODE_PADDING = 14   // minimum gap between nodes in the same column

// Per-node extra data
interface NodeExtra {
  id: string
  label: string
  nodeColor: string
  textColor: string
  amount: number  // original paise value for display
}
// Per-link extra data
interface LinkExtra {
  srcColor: string
  tgtColor: string
}

type MyNode = SankeyNode<NodeExtra, LinkExtra>
type MyLink = SankeyLink<NodeExtra, LinkExtra>

function buildSankeyGraph(data: FlowData): { nodes: NodeExtra[]; links: Array<{ source: string; target: string; value: number } & LinkExtra> } {
  const { incomeSources, expenseGroups, totalExpenses, investments, loans, netSavings, existingFunds } = data
  const nodes: NodeExtra[] = []
  const links: Array<{ source: string; target: string; value: number } & LinkExtra> = []

  const add = (id: string, label: string, nodeColor: string, textColor: string, amount: number) =>
    nodes.push({ id, label, nodeColor, textColor, amount })

  const link = (source: string, target: string, value: number, srcColor: string, tgtColor: string) =>
    links.push({ source, target, value, srcColor, tgtColor })

  // Income sources → Income aggregate
  incomeSources.forEach(src => {
    add(`src:${src.label}`, src.label, '#009e78', '#00c896', src.amount)
    link(`src:${src.label}`, 'Income', src.amount, '#00c896', '#00c896')
  })

  if (existingFunds > 0) {
    add('Existing Funds', 'Existing Funds', '#2060dd', '#3a7fff', existingFunds)
    link('Existing Funds', 'Income', existingFunds, '#3a7fff', '#3a7fff')
  }

  add('Income', 'Income', '#009e78', '#00c896', data.totalIncome + existingFunds)

  // Income → allocation nodes
  if (totalExpenses > 0) {
    add('Expenses', 'Expenses', '#c02040', '#f04060', totalExpenses)
    link('Income', 'Expenses', totalExpenses, '#00c896', '#f04060')
  }
  if (investments > 0) {
    add('Investments', 'Investments', '#6040c0', '#9060f0', investments)
    link('Income', 'Investments', investments, '#00c896', '#9060f0')
  }
  if (loans > 0) {
    add('Loan Repay', 'Loan Repay', '#2060dd', '#3a7fff', loans)
    link('Income', 'Loan Repay', loans, '#00c896', '#3a7fff')
  }
  if (netSavings > 0) {
    add('Net Savings', 'Net Savings', '#c07800', '#f0a500', netSavings)
    link('Income', 'Net Savings', netSavings, '#00c896', '#f0a500')
  }

  // Expenses → expense categories
  expenseGroups.forEach(cat => {
    const catId = `cat:${cat.label}`
    add(catId, cat.label, '#c02040', '#f04060', cat.amount)
    link('Expenses', catId, cat.amount, '#f04060', '#f04060')

    // Category → subcategories
    cat.children.forEach(sub => {
      const subId = `sub:${cat.label}:${sub.label}`
      add(subId, sub.label, '#a01828', '#e05060', sub.amount)
      link(catId, subId, sub.amount, '#f04060', '#e05060')
    })
  })

  return { nodes, links }
}

function runSankeyLayout(data: FlowData): { nodes: MyNode[]; links: MyLink[] } | null {
  const totalFlow = data.totalIncome + data.existingFunds
  if (totalFlow === 0) return null

  const { nodes: inputNodes, links: inputLinks } = buildSankeyGraph(data)

  const layout = d3Sankey<NodeExtra, LinkExtra>()
    .nodeId(d => d.id)
    .nodeAlign(sankeyLeft)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    .extent([[0, CHART_TOP], [SANKEY_WIDTH, CHART_BOTTOM]])

  return layout({
    nodes: inputNodes.map(n => ({ ...n })),
    links: inputLinks.map(l => ({ ...l })),
  }) as { nodes: MyNode[]; links: MyLink[] }
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
  const [catMap, setCatMap] = useState<Map<string, CatInfo>>(new Map())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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

  const flowData = aggregateFlowData(transactions, catMap)
  const sankeyGraph = runSankeyLayout(flowData)
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
  function showLinkTip(e: React.MouseEvent, link: MyLink) {
    if (!containerRef.current) return
    const src = link.source as MyNode
    const tgt = link.target as MyNode
    const rect = containerRef.current.getBoundingClientRect()
    setTooltip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8, lines: [`${src.label} → ${tgt.label}`, formatMoney(link.value)] })
  }
  function showNodeTip(e: React.MouseEvent, node: MyNode) {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setTooltip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8, lines: [node.label, formatMoney(node.amount)] })
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
            {!loading && !error && (() => {
              const linkPath = sankeyLinkHorizontal()
              // Derive column x positions from node depths for divider lines
              const colXs = sankeyGraph
                ? [...new Set(sankeyGraph.nodes.map(n => n.x0 ?? 0))].sort((a, b) => a - b)
                : []
              // ViewBox: left label space (-130) + layout width + right label space (~180)
              const vbW = 130 + SANKEY_WIDTH + NODE_WIDTH + 200
              return (
                <svg width="100%" height="510" viewBox={`-130 0 ${vbW} 510`} style={{ display: 'block', overflow: 'visible' }}>
                  <defs>
                    {/* Per-link gradients injected inline below */}
                  </defs>
                  {/* Column divider lines */}
                  {colXs.slice(1).map((x, i) => {
                    const mid = ((colXs[i] ?? 0) + NODE_WIDTH + x) / 2
                    return <line key={i} x1={mid} y1={0} x2={mid} y2={460} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 4"/>
                  })}
                  {!sankeyGraph && (
                    <text x={SANKEY_WIDTH / 2} y={240} textAnchor="middle" fontSize={13} fill="var(--text3)" fontFamily="IBM Plex Sans Condensed">No transactions in this period</text>
                  )}
                  {sankeyGraph && (<>
                    {/* Links (rendered behind nodes) */}
                    {sankeyGraph.links.map((link, i) => {
                      const src = link.source as MyNode
                      const tgt = link.target as MyNode
                      const gradId = `sk-link-${i}`
                      return (
                        <g key={i}>
                          <defs>
                            <linearGradient id={gradId} x1={src.x1} y1={0} x2={tgt.x0} y2={0} gradientUnits="userSpaceOnUse">
                              <stop offset="0%" stopColor={link.srcColor} stopOpacity={0.55}/>
                              <stop offset="100%" stopColor={link.tgtColor} stopOpacity={0.45}/>
                            </linearGradient>
                          </defs>
                          <path
                            d={linkPath(link as Parameters<typeof linkPath>[0]) ?? ''}
                            fill="none"
                            stroke={`url(#${gradId})`}
                            strokeWidth={Math.max(1, link.width ?? 0)}
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={e => showLinkTip(e, link)}
                            onMouseLeave={() => setTooltip(null)}
                          />
                        </g>
                      )
                    })}
                    {/* Nodes */}
                    {sankeyGraph.nodes.map((n, i) => {
                      const x0 = n.x0 ?? 0
                      const y0 = n.y0 ?? 0
                      const x1 = n.x1 ?? 0
                      const y1 = n.y1 ?? 0
                      const h = y1 - y0
                      const mid = y0 + h / 2
                      const isLeft = (n.depth ?? 0) === 0
                      const showLabel = h >= 16  // only show inline label if node is tall enough
                      return (
                        <g key={i} style={{ cursor: 'pointer' }} onMouseEnter={e => showNodeTip(e, n)} onMouseLeave={() => setTooltip(null)}>
                          <rect x={x0} y={y0} width={x1 - x0} height={h} rx={2} fill={n.nodeColor}/>
                          {showLabel && (isLeft ? (<>
                            <text x={x0 - 6} y={mid - 5} textAnchor="end" fontSize={11} fill="var(--text)" fontFamily="IBM Plex Sans Condensed" fontWeight={600}>{n.label}</text>
                            <text x={x0 - 6} y={mid + 8} textAnchor="end" fontSize={9} fill={n.textColor} fontFamily="IBM Plex Mono">{formatMoney(n.amount)}</text>
                          </>) : (<>
                            <text x={x1 + 6} y={mid - 5} fontSize={11} fill="var(--text)" fontFamily="IBM Plex Sans Condensed" fontWeight={600}>{n.label}</text>
                            <text x={x1 + 6} y={mid + 8} fontSize={9} fill={n.textColor} fontFamily="IBM Plex Mono">{formatMoney(n.amount)}</text>
                          </>))}
                        </g>
                      )
                    })}
                    {/* Column header labels at bottom */}
                    {colXs.map((x, i) => {
                      const labels = ['INCOME SOURCES', 'INCOME', 'ALLOCATION', 'CATEGORIES', 'SUBCATEGORIES']
                      return <text key={i} x={x} y={490} fontSize={9} fill="var(--text3)" fontFamily="IBM Plex Sans Condensed" fontWeight={600} letterSpacing={1}>{labels[i] ?? ''}</text>
                    })}
                  </>)}
                </svg>
              )
            })()}
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
