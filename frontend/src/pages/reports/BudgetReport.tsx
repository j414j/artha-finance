import { useState, useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useIsMobile } from '../../hooks/useIsMobile'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { getBudgetHistory } from '../../api/budget'
import type { BudgetHistory, BudgetHistoryRow, BudgetHistoryValue } from '../../types/budget'
import { formatMoney } from '../../utils/format'

// ─── Period helpers ───────────────────────────────────────────────────────────

function currentPeriod(): { year: number; month: number } {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  })
}

function prevMonth(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

function nextMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

// ─── Heat map helpers ─────────────────────────────────────────────────────────

function heatColor(pct: number | null, allocated: number): { bg: string; text: string; label: string } {
  if (pct === null || allocated === 0) return { bg: 'transparent', text: 'var(--text3)', label: '—' }
  if (pct === 0) return { bg: 'transparent', text: 'var(--text3)', label: '0%' }
  if (pct >= 100) return { bg: 'rgba(240,64,96,0.18)', text: '#f04060', label: `${Math.round(pct)}%` }
  if (pct >= 80) return { bg: 'rgba(240,165,0,0.18)', text: '#f0a500', label: `${Math.round(pct)}%` }
  if (pct >= 60) return { bg: 'rgba(58,127,255,0.15)', text: '#3a7fff', label: `${Math.round(pct)}%` }
  return { bg: 'rgba(0,200,150,0.13)', text: '#00c896', label: `${Math.round(pct)}%` }
}

// ─── Derived computations ─────────────────────────────────────────────────────

interface HeatMapRow {
  categoryId: string
  categoryName: string
  values: Map<string, BudgetHistoryValue>
  avgUsedPct: number
}

interface SummaryStats {
  avgBudget: number
  avgSpend: number
  avgSavingsRate: number | null
  monthsTracked: number
  mostOverBudgetCat: string | null
}

function buildHeatMap(rows: BudgetHistoryRow[]): HeatMapRow[] {
  return rows.map(row => {
    const valueMap = new Map<string, BudgetHistoryValue>()
    let totalPct = 0
    let countPct = 0
    for (const v of row.values) {
      valueMap.set(monthKey(v.year, v.month), v)
      if (v.used_pct !== null && v.allocated_paise > 0) {
        totalPct += v.used_pct
        countPct++
      }
    }
    return {
      categoryId: row.category_id,
      categoryName: row.category.name,
      values: valueMap,
      avgUsedPct: countPct > 0 ? totalPct / countPct : 0,
    }
  })
}

function computeStats(history: BudgetHistory): SummaryStats {
  const monthKeys = history.months.map(m => monthKey(m.year, m.month))
  let totalBudget = 0, totalSpend = 0, budgetMonths = 0

  for (const key of monthKeys) {
    let monthBudget = 0, monthSpend = 0
    for (const row of history.rows) {
      const v = row.values.find(v => monthKey(v.year, v.month) === key)
      if (v) {
        monthBudget += v.allocated_paise
        monthSpend += v.spent_paise
      }
    }
    if (monthBudget > 0 || monthSpend > 0) {
      totalBudget += monthBudget
      totalSpend += monthSpend
      budgetMonths++
    }
  }

  const validRates = history.savings_rate_trend.filter(s => s.savings_rate_pct !== null)
  const avgSavingsRate = validRates.length > 0
    ? validRates.reduce((s, r) => s + (r.savings_rate_pct ?? 0), 0) / validRates.length
    : null

  // Most over-budget category (highest avg used_pct across months)
  let mostOverBudgetCat: string | null = null
  let highestAvg = 0
  for (const row of history.rows) {
    let sum = 0, cnt = 0
    for (const v of row.values) {
      if (v.used_pct !== null && v.allocated_paise > 0) { sum += v.used_pct; cnt++ }
    }
    if (cnt > 0 && sum / cnt > highestAvg) {
      highestAvg = sum / cnt
      mostOverBudgetCat = row.category.name
    }
  }

  return {
    avgBudget: budgetMonths > 0 ? totalBudget / budgetMonths : 0,
    avgSpend: budgetMonths > 0 ? totalSpend / budgetMonths : 0,
    avgSavingsRate,
    monthsTracked: history.months.length,
    mostOverBudgetCat,
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
const iconBtn: CSSProperties = {
  background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)',
  padding: '2px 8px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)',
}
const AXIS_TICK = { fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' } as const
const GRID_PROPS = { stroke: '#1e2535', strokeDasharray: '3 3' }

const TRAILING_OPTIONS = [3, 6, 12, 24] as const
type TrailingMonths = (typeof TRAILING_OPTIONS)[number]

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function SavingsTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
      <div style={{ color: 'var(--text3)', marginBottom: 4, fontSize: 10, fontFamily: 'var(--font-cond)' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name === 'Savings Rate'
            ? `${p.name}: ${typeof p.value === 'number' ? p.value.toFixed(1) : '—'}%`
            : `${p.name}: ${formatMoney(p.value, 'INR', true)}`}
        </div>
      ))}
    </div>
  )
}

// ─── Heat map tooltip ─────────────────────────────────────────────────────────

function HeatTooltip({ row, month, value }: { row: HeatMapRow; month: string; value: BudgetHistoryValue | undefined }) {
  if (!value) return null
  const pct = value.used_pct
  const { text } = heatColor(pct, value.allocated_paise)
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, zIndex: 100 }}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text3)', marginBottom: 3 }}>
        {row.categoryName} · {month}
      </div>
      <div style={{ color: text }}>{pct !== null ? `${pct.toFixed(1)}% used` : '—'}</div>
      <div style={{ color: 'var(--text2)', marginTop: 2 }}>
        {formatMoney(value.spent_paise, 'INR', true)} / {formatMoney(value.allocated_paise, 'INR', true)}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BudgetReport() {
  const isMobile = useIsMobile()
  const { year: curY, month: curM } = currentPeriod()
  const [endYear, setEndYear] = useState(curY)
  const [endMonth, setEndMonth] = useState(curM)
  const [trailing, setTrailing] = useState<TrailingMonths>(6)
  const [history, setHistory] = useState<BudgetHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ row: HeatMapRow; month: string; value: BudgetHistoryValue | undefined; x: number; y: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getBudgetHistory(endYear, endMonth, trailing)
      .then(res => setHistory(res.history))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [endYear, endMonth, trailing])

  const stats = useMemo(() => history ? computeStats(history) : null, [history])
  const heatRows = useMemo(() => history ? buildHeatMap(history.rows) : [], [history])

  const savingsChartData = useMemo(() => {
    if (!history) return []
    return history.savings_rate_trend.map(s => ({
      label: s.label,
      Income: s.income_paise,
      Expense: s.expense_paise,
      'Savings Rate': s.savings_rate_pct,
    }))
  }, [history])

  const isAtOrAfterCurrent = endYear > curY || (endYear === curY && endMonth >= curM)

  const goNext = () => {
    if (isAtOrAfterCurrent) return
    const n = nextMonth(endYear, endMonth)
    setEndYear(n.year)
    setEndMonth(n.month)
  }
  const goPrev = () => {
    const p = prevMonth(endYear, endMonth)
    setEndYear(p.year)
    setEndMonth(p.month)
  }

  const months = history?.months ?? []

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%' }} onClick={() => setTooltip(null)}>

      {/* Breadcrumb */}
      <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em' }}>
        <Link to="/reports" style={{ color: 'var(--text3)', textDecoration: 'none' }}>REPORTS</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ color: 'var(--text2)' }}>BUDGET</span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text2)' }}>End Month:</span>
          <button style={iconBtn} onClick={goPrev}>◀</button>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text)', minWidth: 84, textAlign: 'center' }}>{monthLabel(endYear, endMonth)}</span>
          <button style={{ ...iconBtn, opacity: isAtOrAfterCurrent ? 0.3 : 1 }} onClick={goNext} disabled={isAtOrAfterCurrent}>▶</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text2)' }}>Trailing:</span>
          <div style={{ display: 'flex', gap: 1 }}>
            {TRAILING_OPTIONS.map(n => (
              <button key={n} style={trailing === n ? btnActive : btnBase} onClick={() => setTrailing(n)}>
                {n}M
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading / error */}
      {loading && (
        <div style={{ padding: '12px 16px', fontFamily: 'var(--font-cond)', color: 'var(--text3)', fontSize: 10, letterSpacing: '0.08em' }}>Loading…</div>
      )}
      {error && !loading && (
        <div style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', color: 'var(--red)', fontSize: 11 }}>{error}</div>
      )}

      {stats && !loading && (
        <>
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
            {[
              { label: 'Avg Monthly Budget', value: formatMoney(stats.avgBudget, 'INR', true), color: 'var(--text)', sub: 'across tracked months' },
              { label: 'Avg Monthly Spend', value: formatMoney(stats.avgSpend, 'INR', true), color: stats.avgSpend > stats.avgBudget ? 'var(--red)' : 'var(--text)', sub: `${stats.avgBudget > 0 ? ((stats.avgSpend / stats.avgBudget) * 100).toFixed(1) : '—'}% of budget` },
              { label: 'Avg Savings Rate', value: stats.avgSavingsRate !== null ? `${stats.avgSavingsRate.toFixed(1)}%` : '—', color: (stats.avgSavingsRate ?? 0) >= 20 ? 'var(--green)' : 'var(--amber)', sub: 'income saved' },
              { label: 'Months Tracked', value: String(stats.monthsTracked), color: 'var(--text)', sub: stats.mostOverBudgetCat ? `Tightest: ${stats.mostOverBudgetCat}` : 'no budget data' },
            ].map(({ label, value, color, sub }) => (
              <div key={label} style={{ background: 'var(--bg3)', padding: '8px 14px' }}>
                <div style={mlStyle}>{label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color, marginTop: 2 }}>{value}</div>
                <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* Heat Map */}
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            <div style={sHd}>
              Category Budget Heat Map
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {[
                  { bg: 'rgba(0,200,150,0.18)', text: '#00c896', label: '< 60%' },
                  { bg: 'rgba(58,127,255,0.18)', text: '#3a7fff', label: '60–80%' },
                  { bg: 'rgba(240,165,0,0.18)', text: '#f0a500', label: '80–100%' },
                  { bg: 'rgba(240,64,96,0.18)', text: '#f04060', label: '> 100%' },
                ].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 8, height: 8, background: l.bg, border: `1px solid ${l.text}` }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {heatRows.length === 0 ? (
              <div style={{ padding: '24px 16px', color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, textAlign: 'center', letterSpacing: '0.08em', background: 'var(--bg2)' }}>
                NO BUDGET DATA FOR THIS PERIOD — SET UP A BUDGET FIRST
              </div>
            ) : (
              <div style={{ overflowX: 'auto', background: 'var(--bg2)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: Math.max(400, 140 + months.length * 72) }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)' }}>
                      <th style={{ ...thStyle, textAlign: 'left', width: 140, position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2 }}>Category</th>
                      {months.map(m => (
                        <th key={monthKey(m.year, m.month)} style={{ ...thStyle, width: 72 }}>{m.label}</th>
                      ))}
                      <th style={{ ...thStyle, width: 60 }}>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heatRows.map((row, ri) => (
                      <tr key={row.categoryId} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 10px', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: ri % 2 === 0 ? 'var(--bg2)' : 'var(--bg3)', zIndex: 1 }}>
                          {row.categoryName}
                        </td>
                        {months.map(m => {
                          const key = monthKey(m.year, m.month)
                          const val = row.values.get(key)
                          const pct = val?.used_pct ?? null
                          const alloc = val?.allocated_paise ?? 0
                          const { bg, text, label } = heatColor(pct, alloc)
                          return (
                            <td
                              key={key}
                              style={{ padding: '3px 6px', textAlign: 'center', background: ri % 2 === 0 ? `color-mix(in srgb, var(--bg2) 60%, ${bg})` : `color-mix(in srgb, var(--bg3) 60%, ${bg})`, cursor: val ? 'pointer' : 'default', position: 'relative' }}
                              onMouseEnter={e => {
                                if (val) setTooltip({ row, month: `${m.label} ${m.year}`, value: val, x: (e.target as HTMLElement).getBoundingClientRect().left, y: (e.target as HTMLElement).getBoundingClientRect().bottom })
                              }}
                              onMouseLeave={() => setTooltip(null)}
                            >
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: text }}>{label}</span>
                            </td>
                          )
                        })}
                        <td style={{ padding: '3px 6px', textAlign: 'center', background: ri % 2 === 0 ? 'var(--bg2)' : 'var(--bg3)' }}>
                          {(() => {
                            const { bg, text, label } = heatColor(row.avgUsedPct || null, row.avgUsedPct > 0 ? 1 : 0)
                            return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: text }}>{row.avgUsedPct > 0 ? label : '—'}</span>
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Savings Rate Trend */}
          {savingsChartData.length > 0 && (
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={sHd}>
                Savings Rate Trend
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>income vs expenses + savings rate</span>
              </div>
              <div style={{ background: 'var(--bg2)', padding: '16px 12px 8px' }}>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={savingsChartData} margin={{ top: 4, right: 50, left: 4, bottom: 0 }}>
                    <CartesianGrid {...GRID_PROPS} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="money" tickFormatter={v => formatMoney(v, 'INR', true)} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
                    <YAxis yAxisId="pct" orientation="right" tickFormatter={v => `${v}%`} tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={[0, 100]} />
                    <Tooltip content={<SavingsTooltip />} />
                    <Legend iconSize={8} wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', paddingTop: 4 }} />
                    <Bar yAxisId="money" dataKey="Income" fill="#00c896" fillOpacity={0.7} radius={[2, 2, 0, 0]} maxBarSize={28} />
                    <Bar yAxisId="money" dataKey="Expense" fill="#f04060" fillOpacity={0.7} radius={[2, 2, 0, 0]} maxBarSize={28} />
                    <Line yAxisId="pct" dataKey="Savings Rate" stroke="#3a7fff" strokeWidth={2} dot={{ r: 3, fill: '#3a7fff' }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Monthly spend vs budget per category */}
          {heatRows.length > 0 && months.length > 1 && (
            <div>
              <div style={sHd}>
                Monthly Spend vs Budget — All Categories
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>totals across all budgeted categories</span>
              </div>
              <div style={{ background: 'var(--bg2)', padding: '16px 12px 8px' }}>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart
                    data={months.map(m => {
                      const key = monthKey(m.year, m.month)
                      let budget = 0, spent = 0
                      for (const row of heatRows) {
                        const v = row.values.get(key)
                        if (v) { budget += v.allocated_paise; spent += v.spent_paise }
                      }
                      return { label: m.label, Budget: budget, Spent: spent }
                    })}
                    margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
                  >
                    <CartesianGrid {...GRID_PROPS} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v => formatMoney(v, 'INR', true)} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      return (
                        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-cond)', marginBottom: 3 }}>{label}</div>
                          {payload.map((p, i) => (
                            <div key={i} style={{ color: p.color }}>{p.name}: {formatMoney(p.value as number, 'INR', true)}</div>
                          ))}
                          {payload.length === 2 && (
                            <div style={{ color: 'var(--text3)', fontSize: 9, marginTop: 3 }}>
                              {(() => {
                                const budget = payload.find(p => p.name === 'Budget')?.value as number ?? 0
                                const spent = payload.find(p => p.name === 'Spent')?.value as number ?? 0
                                if (!budget) return null
                                const pct = (spent / budget) * 100
                                return `${pct.toFixed(1)}% used`
                              })()}
                            </div>
                          )}
                        </div>
                      )
                    }} />
                    <Legend iconSize={8} wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', paddingTop: 4 }} />
                    <Bar dataKey="Budget" fill="#3a7fff" fillOpacity={0.4} radius={[2, 2, 0, 0]} maxBarSize={32} />
                    <Bar dataKey="Spent" fill="#f04060" fillOpacity={0.75} radius={[2, 2, 0, 0]} maxBarSize={32} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      {/* Floating tooltip */}
      {tooltip && (
        <div style={{ position: 'fixed', top: tooltip.y + 6, left: tooltip.x, zIndex: 999, pointerEvents: 'none' }}>
          <HeatTooltip row={tooltip.row} month={tooltip.month} value={tooltip.value} />
        </div>
      )}
    </div>
  )
}

const thStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 600,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)',
  padding: '5px 6px', textAlign: 'center',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}
