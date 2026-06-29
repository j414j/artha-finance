import { useState, useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useIsMobile } from '../../hooks/useIsMobile'
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
import { getGoals } from '../../api/goals'
import type { Goal, GoalAccountAvailability } from '../../types/goal'
import { formatMoney, formatDateDisplay } from '../../utils/format'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const target = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000)
}

function statusColor(tone: Goal['status_tone']): string {
  if (tone === 'green') return '#00c896'
  if (tone === 'amber') return '#f0a500'
  if (tone === 'red') return '#f04060'
  return 'var(--text3)'
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
const AXIS_TICK = { fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' } as const
const GRID_PROPS = { stroke: '#1e2535', strokeDasharray: '3 3' }

// ─── Goal Progress Card ───────────────────────────────────────────────────────

function GoalCard({ goal, isMobile }: { goal: Goal; isMobile: boolean }) {
  const days = daysUntil(goal.target_date)
  const projDays = daysUntil(goal.projected_completion_date)
  const fillColor = statusColor(goal.status_tone)
  const pct = Math.min(100, goal.progress_pct)

  const stats: Array<{ label: string; value: string; color?: string }> = [
    { label: 'Target', value: formatMoney(goal.target_amount_paise, 'INR', true) },
    { label: 'Blocked', value: formatMoney(goal.current_blocked_paise, 'INR', true), color: '#00c896' },
    { label: 'Remaining', value: formatMoney(goal.remaining_paise, 'INR', true), color: goal.remaining_paise > 0 ? 'var(--text2)' : '#00c896' },
    {
      label: 'Monthly Needed',
      value: goal.required_monthly_paise ? formatMoney(goal.required_monthly_paise, 'INR', true) : '—',
      color: 'var(--text2)',
    },
    {
      label: 'Target Date',
      value: goal.target_date ? formatDateDisplay(goal.target_date) : '—',
      color: days !== null && days < 0 ? '#f04060' : 'var(--text2)',
    },
    {
      label: 'Projected',
      value: goal.projected_completion_date ? formatDateDisplay(goal.projected_completion_date) : '—',
      color: projDays !== null && goal.target_date && projDays > (daysUntil(goal.target_date) ?? projDays) ? '#f0a500' : '#00c896',
    },
  ]

  return (
    <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, background: goal.color_hex, flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.04em' }}>{goal.name}</span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: fillColor, border: `1px solid ${fillColor}`, padding: '1px 5px', opacity: 0.9 }}>
            {goal.status_label}
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>
          {goal.source_account_name}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: fillColor, fontWeight: 600 }}>{pct.toFixed(1)}%</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
            {formatMoney(goal.current_blocked_paise, 'INR', true)} of {formatMoney(goal.target_amount_paise, 'INR', true)}
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 1 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: fillColor, borderRadius: 1, transition: 'width 0.3s ease' }} />
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(6,1fr)', gap: 8 }}>
        {stats.map(s => (
          <div key={s.label}>
            <div style={mlStyle}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: s.color ?? 'var(--text)', marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function GoalsReport() {
  const isMobile = useIsMobile()
  const [activeGoals, setActiveGoals] = useState<Goal[]>([])
  const [completedGoals, setCompletedGoals] = useState<Goal[]>([])
  const [accountAvailability, setAccountAvailability] = useState<GoalAccountAvailability[]>([])
  const [totalBlocked, setTotalBlocked] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getGoals()
      .then(res => {
        setActiveGoals(res.active_goals)
        setCompletedGoals(res.completed_goals)
        setAccountAvailability(res.account_availability)
        setTotalBlocked(res.total_blocked_paise)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  // Summary stats
  const totalTarget = useMemo(() => activeGoals.reduce((s, g) => s + g.target_amount_paise, 0), [activeGoals])
  const totalRequired = useMemo(
    () => activeGoals.reduce((s, g) => s + (g.required_monthly_paise ?? 0), 0),
    [activeGoals],
  )
  const onTrackCount = useMemo(
    () => activeGoals.filter(g => g.status_tone === 'green').length,
    [activeGoals],
  )

  // Progress chart data: blocked vs remaining per active goal
  const progressChartData = useMemo(
    () =>
      activeGoals.map(g => ({
        name: g.name.length > 16 ? g.name.slice(0, 14) + '…' : g.name,
        fullName: g.name,
        Funded: g.current_blocked_paise,
        Remaining: g.remaining_paise,
        color: g.color_hex,
        tone: g.status_tone,
      })),
    [activeGoals],
  )

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100%' }}>

      {/* Breadcrumb */}
      <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em' }}>
        <Link to="/reports" style={{ color: 'var(--text3)', textDecoration: 'none' }}>REPORTS</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ color: 'var(--text2)' }}>GOALS</span>
      </div>

      {loading && (
        <div style={{ padding: '12px 16px', fontFamily: 'var(--font-cond)', color: 'var(--text3)', fontSize: 10, letterSpacing: '0.08em' }}>Loading…</div>
      )}
      {error && !loading && (
        <div style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', color: 'var(--red)', fontSize: 11 }}>{error}</div>
      )}

      {!loading && !error && (
        <>
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
            {[
              { label: 'Active Goals', value: String(activeGoals.length), color: 'var(--text)', sub: `${onTrackCount} on track · ${activeGoals.length - onTrackCount} behind` },
              { label: 'Total Target', value: formatMoney(totalTarget, 'INR', true), color: 'var(--text)', sub: 'across all active goals' },
              { label: 'Total Blocked', value: formatMoney(totalBlocked, 'INR', true), color: '#00c896', sub: totalTarget > 0 ? `${((totalBlocked / totalTarget) * 100).toFixed(1)}% of total target` : '—' },
              { label: 'Monthly Required', value: totalRequired > 0 ? formatMoney(totalRequired, 'INR', true) : '—', color: 'var(--amber)', sub: `${completedGoals.length} goal${completedGoals.length !== 1 ? 's' : ''} completed` },
            ].map(({ label, value, color, sub }) => (
              <div key={label} style={{ background: 'var(--bg3)', padding: '8px 14px' }}>
                <div style={mlStyle}>{label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color, marginTop: 2 }}>{value}</div>
                <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* Active Goals */}
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            <div style={sHd}>
              Active Goals
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>detailed progress</span>
            </div>
            {activeGoals.length === 0 ? (
              <div style={{ padding: '24px 16px', color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, textAlign: 'center', letterSpacing: '0.08em', background: 'var(--bg2)' }}>
                NO ACTIVE GOALS — CREATE A GOAL FROM THE GOALS PAGE
              </div>
            ) : (
              activeGoals.map(goal => (
                <GoalCard key={goal.id} goal={goal} isMobile={isMobile} />
              ))
            )}
          </div>

          {/* Progress chart */}
          {progressChartData.length > 0 && (
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={sHd}>
                Goal Funding Overview
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>funded vs remaining</span>
              </div>
              <div style={{ background: 'var(--bg2)', padding: '16px 12px 8px' }}>
                <ResponsiveContainer width="100%" height={Math.max(160, progressChartData.length * 44 + 40)}>
                  <BarChart
                    data={progressChartData}
                    layout="vertical"
                    margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
                    barCategoryGap="30%"
                  >
                    <CartesianGrid {...GRID_PROPS} horizontal={false} />
                    <XAxis type="number" tickFormatter={v => formatMoney(v, 'INR', true)} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'var(--text2)', fontSize: 10, fontFamily: 'IBM Plex Sans Condensed' }} tickLine={false} axisLine={false} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as typeof progressChartData[0]
                      const total = d.Funded + d.Remaining
                      return (
                        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>{d.fullName}</div>
                          <div style={{ color: '#00c896' }}>Funded: {formatMoney(d.Funded, 'INR', true)}</div>
                          <div style={{ color: 'var(--text2)' }}>Remaining: {formatMoney(d.Remaining, 'INR', true)}</div>
                          <div style={{ color: 'var(--text3)', fontSize: 9, marginTop: 3 }}>
                            {total > 0 ? `${((d.Funded / total) * 100).toFixed(1)}% funded` : '—'}
                          </div>
                        </div>
                      )
                    }} />
                    <Legend iconSize={8} wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', paddingTop: 4 }} />
                    <Bar dataKey="Funded" stackId="a" radius={[0, 0, 0, 0]} maxBarSize={22}>
                      {progressChartData.map((d, i) => (
                        <Cell key={i} fill={d.color} fillOpacity={0.85} />
                      ))}
                    </Bar>
                    <Bar dataKey="Remaining" stackId="a" fill="var(--bg3)" stroke="var(--border2)" strokeWidth={1} radius={[0, 2, 2, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Completed Goals */}
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            <div style={sHd}>
              Completed Goals
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>{completedGoals.length} total</span>
            </div>
            {completedGoals.length === 0 ? (
              <div style={{ padding: '20px 16px', color: 'var(--text3)', fontFamily: 'var(--font-cond)', fontSize: 10, textAlign: 'center', letterSpacing: '0.08em', background: 'var(--bg2)' }}>
                NO COMPLETED GOALS YET
              </div>
            ) : (
              <div style={{ background: 'var(--bg2)', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)' }}>
                      {['Goal', 'Target', 'Achieved', 'Achieved %', 'Completed', 'Source Account'].map((h, i) => (
                        <th key={h} style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', padding: '5px 10px', textAlign: i >= 1 && i <= 4 ? 'right' : 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {completedGoals.map((g, i) => {
                      const achievedPct = g.target_amount_paise > 0
                        ? ((g.completed_amount_paise ?? 0) / g.target_amount_paise) * 100
                        : 100
                      return (
                        <tr key={g.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg3)' }}>
                          <td style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div style={{ width: 6, height: 6, background: g.color_hex, flexShrink: 0 }} />
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text)' }}>{g.name}</span>
                          </td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(g.target_amount_paise, 'INR', true)}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#00c896', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(g.completed_amount_paise ?? 0, 'INR', true)}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: achievedPct >= 100 ? '#00c896' : '#f0a500', textAlign: 'right' }}>{achievedPct.toFixed(1)}%</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', textAlign: 'right', whiteSpace: 'nowrap' }}>{g.completed_at ? formatDateDisplay(g.completed_at.slice(0, 10)) : '—'}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{g.source_account_name}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Account Availability */}
          {accountAvailability.length > 0 && (
            <div>
              <div style={sHd}>
                Account Funding Capacity
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: 0, textTransform: 'none' }}>balance vs blocked vs available</span>
              </div>
              <div style={{ background: 'var(--bg2)', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)' }}>
                      {['Account', 'Total Balance', 'Blocked', 'Available', 'Block %'].map((h, i) => (
                        <th key={h} style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', padding: '5px 10px', textAlign: i === 0 ? 'left' : 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {accountAvailability.map((a, i) => {
                      const blockPct = a.total_balance_paise > 0 ? (a.blocked_paise / a.total_balance_paise) * 100 : 0
                      return (
                        <tr key={a.account_id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg3)' }}>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text)' }}>{a.account_name}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text2)', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(a.total_balance_paise, 'INR', true)}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#f0a500', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(a.blocked_paise, 'INR', true)}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#00c896', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(a.available_balance_paise, 'INR', true)}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, color: blockPct > 80 ? '#f04060' : blockPct > 50 ? '#f0a500' : 'var(--text3)', textAlign: 'right' }}>
                            {blockPct.toFixed(1)}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
