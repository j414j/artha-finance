import { useState, useEffect, useMemo, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  Legend,
  ReferenceLine,
} from 'recharts'
import {
  getHoldings,
  getHoldingsSummary,
  getPortfolioHistory,
  getDividendIncome,
  getXirrSummary,
} from '../../api/investments'
import type {
  Holding,
  HoldingsSummary,
  PortfolioHistoryPoint,
  DividendMonthData,
  XirrSummary,
} from '../../types/investment'
import { formatMoney } from '../../utils/format'
import {
  allocationValue,
  allocationSegmentsFor,
  TYPE_COLORS,
  TYPE_LABELS,
} from '../../utils/allocation'
import AllocationDonut from '../../components/AllocationDonut'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtPct(v: number | null, showSign = true): string {
  if (v === null) return '--'
  const sign = showSign && v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function pnlColor(v: number | null): string {
  if (v === null) return 'var(--text3)'
  return v >= 0 ? 'var(--green)' : 'var(--red)'
}

function fmtChartDate(dateStr: string): string {
  const [y, m] = dateStr.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const idx = parseInt(m, 10) - 1
  return `${months[idx] ?? m} '${y.slice(2)}`
}

function fmtMonth(monthStr: string): string {
  const [y, m] = monthStr.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const idx = parseInt(m, 10) - 1
  return `${months[idx] ?? m} '${y.slice(2)}`
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / 86_400_000)
}

type PeriodKey = '3m' | '6m' | '1y' | 'all'

function filterByPeriod(history: PortfolioHistoryPoint[], period: PeriodKey): PortfolioHistoryPoint[] {
  if (period === 'all' || history.length === 0) return history
  const now = new Date()
  if (period === '3m') now.setMonth(now.getMonth() - 3)
  else if (period === '6m') now.setMonth(now.getMonth() - 6)
  else now.setFullYear(now.getFullYear() - 1)
  const cutoff = now.toISOString().slice(0, 10)
  return history.filter((p) => p.date >= cutoff)
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function MoneyTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={tooltipStyle}>
      <div style={{ color: 'var(--text3)', marginBottom: 6, fontSize: 9 }}>{label}</div>
      {payload.map((p) => (
        <div
          key={p.name}
          style={{ display: 'flex', gap: 12, justifyContent: 'space-between', color: p.color }}
        >
          <span>{p.name}</span>
          <span>{formatMoney(p.value, 'INR', true)}</span>
        </div>
      ))}
    </div>
  )
}

function PctTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: { name: string; value: number } }>
}) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0].payload
  return (
    <div style={tooltipStyle}>
      <div style={{ color: 'var(--text)', marginBottom: 4 }}>{name}</div>
      <div style={{ color: pnlColor(value) }}>{fmtPct(value)}</div>
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontFamily: 'var(--font-cond)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text3)',
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span>{title}</span>
      {right}
    </div>
  )
}

// ─── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  valueColor = 'var(--text)',
}: {
  label: string
  value: string
  sub?: string
  valueColor?: string
}) {
  return (
    <div style={metricCardStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: valueColor, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ─── Period tabs ──────────────────────────────────────────────────────────────

function PeriodTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          style={{
            padding: '2px 8px',
            fontFamily: 'var(--font-cond)',
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            border: '1px solid var(--border)',
            background: value === o.key ? 'var(--accent)' : 'none',
            color: value === o.key ? '#000' : 'var(--text3)',
            cursor: 'pointer',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InvestmentsReport() {
  const isMobile = useIsMobile()
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [summary, setSummary] = useState<HoldingsSummary | null>(null)
  const [history, setHistory] = useState<PortfolioHistoryPoint[]>([])
  const [dividendIncome, setDividendIncome] = useState<DividendMonthData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // XIRR is loaded lazily when the user switches to the XIRR tab
  const [xirrData, setXirrData] = useState<XirrSummary | null>(null)
  const [xirrLoading, setXirrLoading] = useState(false)

  // UI state
  const [historyPeriod, setHistoryPeriod] = useState<PeriodKey>('all')
  const [perfTab, setPerfTab] = useState<'pnl' | 'xirr'>('pnl')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [holdingsRes, summaryRes, historyRes, dividendRes] = await Promise.all([
          getHoldings(),
          getHoldingsSummary(),
          getPortfolioHistory(),
          getDividendIncome(),
        ])
        setHoldings(holdingsRes.holdings)
        setSummary(summaryRes.summary)
        setHistory(historyRes.history)
        setDividendIncome(dividendRes.income)
      } catch {
        setError('Failed to load investment report')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const loadXirr = useCallback(async () => {
    if (xirrData || xirrLoading) return
    setXirrLoading(true)
    try {
      const res = await getXirrSummary()
      setXirrData(res)
    } catch {
      // silently fail; user can re-click tab
    } finally {
      setXirrLoading(false)
    }
  }, [xirrData, xirrLoading])

  const handlePerfTab = (tab: 'pnl' | 'xirr') => {
    setPerfTab(tab)
    if (tab === 'xirr') void loadXirr()
  }

  // ── Derived data ──

  const filteredHistory = useMemo(
    () => filterByPeriod(history, historyPeriod),
    [history, historyPeriod],
  )

  const historyChartData = useMemo(
    () =>
      filteredHistory.map((p) => ({
        date: fmtChartDate(p.date),
        'Current Value': p.value_paise,
        'Invested': p.invested_paise,
      })),
    [filteredHistory],
  )

  const pnlHistoryChartData = useMemo(
    () =>
      filteredHistory.map((p) => ({
        date: fmtChartDate(p.date),
        unrealised: p.unrealised_pnl_paise,
        realised: p.cumulative_realised_pnl_paise,
        total: p.unrealised_pnl_paise + p.cumulative_realised_pnl_paise,
      })),
    [filteredHistory],
  )

  // Allocation donuts
  const typeSegments = useMemo(() => {
    const groups = new Map<string, number>()
    for (const h of holdings) {
      const key = h.instrument_type
      groups.set(key, (groups.get(key) ?? 0) + allocationValue(h))
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, value]) => ({
        label: TYPE_LABELS[type] ?? type,
        value,
        color: TYPE_COLORS[type] ?? 'var(--text3)',
      }))
  }, [holdings])

  const sectorSegments = useMemo(
    () => allocationSegmentsFor(holdings, (h) => h.instrument_sector),
    [holdings],
  )

  const geoSegments = useMemo(
    () => allocationSegmentsFor(holdings, (h) => h.instrument_geography),
    [holdings],
  )

  // Concentration data
  const concentrationData = useMemo(() => {
    const total = holdings.reduce((sum, h) => sum + allocationValue(h), 0)
    if (total === 0) return []
    return holdings
      .map((h) => ({
        name: h.instrument_name,
        pct: (allocationValue(h) / total) * 100,
      }))
      .filter((d) => d.pct > 0)
      .sort((a, b) => b.pct - a.pct)
  }, [holdings])

  // Performance data (P&L tab)
  const pnlData = useMemo(
    () =>
      holdings
        .filter((h) => h.unrealised_pnl_pct !== null)
        .map((h) => ({
          name: h.instrument_name,
          value: h.unrealised_pnl_pct ?? 0,
        }))
        .sort((a, b) => b.value - a.value),
    [holdings],
  )

  // XIRR data (loaded lazily)
  const xirrChartData = useMemo(() => {
    if (!xirrData) return []
    return xirrData.holdings
      .filter((h) => h.xirr_pct !== null)
      .map((h) => {
        const holding = holdings.find(
          (hld) => hld.instrument_id === h.instrument_id && hld.account_id === h.account_id,
        )
        return { name: holding?.instrument_name ?? h.instrument_id, value: h.xirr_pct ?? 0 }
      })
      .sort((a, b) => b.value - a.value)
  }, [xirrData, holdings])

  // Dividend chart data
  const dividendChartData = useMemo(
    () => dividendIncome.map((d) => ({ month: fmtMonth(d.month), amount: d.amount_paise })),
    [dividendIncome],
  )

  const dividendYTD = useMemo(() => {
    const currentYear = new Date().getFullYear().toString()
    return dividendIncome
      .filter((d) => d.month.startsWith(currentYear))
      .reduce((s, d) => s + d.amount_paise, 0)
  }, [dividendIncome])

  const dividendTotal = useMemo(
    () => dividendIncome.reduce((s, d) => s + d.amount_paise, 0),
    [dividendIncome],
  )

  // Data quality
  const qualityData = useMemo(
    () =>
      [...holdings]
        .map((h) => ({
          ...h,
          daysSince: daysSince(h.latest_price_date),
        }))
        .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity)),
    [holdings],
  )

  // ── Render ──

  if (loading) {
    return (
      <div style={loadingStyle}>Loading investment report…</div>
    )
  }

  if (error) {
    return <div style={errorStyle}>{error}</div>
  }

  if (holdings.length === 0) {
    return (
      <div style={loadingStyle}>No holdings found. Add investment buy transactions to see your report.</div>
    )
  }

  const pnl = summary?.total_unrealised_pnl_paise ?? null
  const pct = summary?.total_unrealised_pnl_pct ?? null

  return (
    <div style={{ padding: 20, minHeight: '100vh', background: 'var(--bg1)' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={pageTitleStyle}>Investments Report</div>
      </div>

      {/* ── Section 1: Summary strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        <MetricCard
          label="Total Value"
          value={summary?.total_current_value_paise != null ? formatMoney(summary.total_current_value_paise) : '--'}
        />
        <MetricCard
          label="Invested"
          value={summary ? formatMoney(summary.total_invested_paise) : '--'}
        />
        <MetricCard
          label="Unrealised P&L"
          value={pnl !== null ? formatMoney(pnl) : '--'}
          sub={pct !== null ? fmtPct(pct) : undefined}
          valueColor={pnlColor(pnl)}
        />
        <MetricCard
          label="Realised P&L"
          value={summary ? formatMoney(summary.total_realised_pnl_paise) : '--'}
          valueColor={pnlColor(summary?.total_realised_pnl_paise ?? null)}
        />
        <MetricCard
          label="Portfolio XIRR"
          value={xirrData ? fmtPct(xirrData.portfolio_xirr_pct) : '—'}
          valueColor={xirrData?.portfolio_xirr_pct != null ? pnlColor(xirrData.portfolio_xirr_pct) : 'var(--text3)'}
        />
        <MetricCard
          label="Holdings"
          value={summary ? String(summary.holdings_count) : '--'}
        />
      </div>

      {/* ── Section 2: Portfolio Growth ── */}
      <div style={sectionStyle}>
        <SectionHeader
          title="Portfolio Growth"
          right={
            <PeriodTabs
              options={[
                { key: '3m', label: '3M' },
                { key: '6m', label: '6M' },
                { key: '1y', label: '1Y' },
                { key: 'all', label: 'All' },
              ]}
              value={historyPeriod}
              onChange={setHistoryPeriod}
            />
          }
        />
        {historyChartData.length === 0 ? (
          <div style={emptyChartStyle}>No price snapshots yet — add prices to see portfolio growth</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={historyChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="gradValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--blue)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--blue)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradInvested" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(v) => formatMoney(v, 'INR', true)}
              />
              <Tooltip content={<MoneyTooltip />} />
              <Legend
                wrapperStyle={{
                  fontFamily: 'var(--font-cond)',
                  fontSize: 9,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              />
              <Area
                type="monotone"
                dataKey="Invested"
                stroke="var(--accent)"
                strokeWidth={1.5}
                fill="url(#gradInvested)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="Current Value"
                stroke="var(--blue)"
                strokeWidth={1.5}
                fill="url(#gradValue)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Section 3: P&L History ── */}
      <div style={sectionStyle}>
        <SectionHeader
          title="P&L History"
          right={
            <PeriodTabs
              options={[
                { key: '3m', label: '3M' },
                { key: '6m', label: '6M' },
                { key: '1y', label: '1Y' },
                { key: 'all', label: 'All' },
              ]}
              value={historyPeriod}
              onChange={setHistoryPeriod}
            />
          }
        />
        {pnlHistoryChartData.length === 0 ? (
          <div style={emptyChartStyle}>No price snapshots yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pnlHistoryChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(v) => formatMoney(v, 'INR', true)}
              />
              <ReferenceLine y={0} stroke="var(--border2)" strokeDasharray="4 2" />
              <Tooltip content={<MoneyTooltip />} />
              <Legend
                wrapperStyle={{
                  fontFamily: 'var(--font-cond)',
                  fontSize: 9,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              />
              <Line
                type="monotone"
                dataKey="unrealised"
                name="Unrealised P&L"
                stroke="var(--blue)"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="realised"
                name="Realised P&L"
                stroke="var(--accent)"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="total"
                name="Total P&L"
                stroke="var(--green)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                strokeDasharray="5 2"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Section 4: Allocation Analysis ── */}
      <div style={sectionStyle}>
        <SectionHeader title="Allocation Analysis" />

        {/* Row 1: Three donuts */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: 0,
            borderBottom: '1px solid var(--border)',
            marginBottom: 16,
            paddingBottom: 16,
          }}
        >
          <AllocationDonut
            title="Asset Type"
            segments={typeSegments}
            style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0, paddingRight: isMobile ? 0 : 16, borderRight: isMobile ? 'none' : '1px solid var(--border)' }}
          />
          <AllocationDonut
            title="Sector"
            segments={sectorSegments}
            style={{
              borderBottom: 'none',
              marginBottom: 0,
              paddingBottom: 0,
              borderLeft: isMobile ? 'none' : '1px solid var(--border)',
              borderRight: isMobile ? 'none' : '1px solid var(--border)',
              paddingLeft: isMobile ? 0 : 16,
              paddingRight: isMobile ? 0 : 16,
            }}
          />
          <AllocationDonut
            title="Geography"
            segments={geoSegments}
            style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0, paddingLeft: isMobile ? 0 : 16, borderLeft: isMobile ? 'none' : '1px solid var(--border)' }}
          />
        </div>

        {/* Row 2: Concentration chart — full width */}
        <div>
          <div style={subLabelStyle}>Portfolio Concentration</div>
          {concentrationData.length > 0 && concentrationData[0].pct > 20 && (
            <div style={warningStyle}>
              ⚠ {concentrationData[0].name} is {concentrationData[0].pct.toFixed(1)}% of portfolio
            </div>
          )}
          <ResponsiveContainer width="100%" height={Math.max(80, concentrationData.length * 22)}>
            <BarChart
              data={concentrationData}
              layout="vertical"
              margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, Math.ceil(concentrationData[0]?.pct ?? 100)]}
                tick={{ fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fill: 'var(--text2)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const { name, pct } = (payload[0].payload as { name: string; pct: number })
                  return (
                    <div style={tooltipStyle}>
                      <div style={{ color: 'var(--text)' }}>{name}</div>
                      <div style={{ color: 'var(--accent)' }}>{pct.toFixed(1)}%</div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="pct" radius={[0, 2, 2, 0]} maxBarSize={14}>
                {concentrationData.map((d) => (
                  <Cell
                    key={d.name}
                    fill={d.pct > 20 ? 'var(--accent)' : 'var(--blue)'}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Section 5: Performance Ranking ── */}
      <div style={sectionStyle}>
        <SectionHeader
          title="Performance Ranking"
          right={
            <PeriodTabs
              options={[
                { key: 'pnl', label: 'P&L %' },
                { key: 'xirr', label: 'XIRR' },
              ]}
              value={perfTab}
              onChange={handlePerfTab}
            />
          }
        />
        {perfTab === 'pnl' && (
          pnlData.length === 0 ? (
            <div style={emptyChartStyle}>No holdings with price data</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(100, pnlData.length * 26 + 20)}>
              <BarChart data={pnlData} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  tick={{ fill: 'var(--text2)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<PctTooltip />} />
                <Bar dataKey="value" radius={[0, 2, 2, 0]} maxBarSize={16}>
                  {pnlData.map((d) => (
                    <Cell key={d.name} fill={d.value >= 0 ? 'var(--green)' : 'var(--red)'} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )
        )}
        {perfTab === 'xirr' && (
          xirrLoading ? (
            <div style={emptyChartStyle}>Computing XIRR…</div>
          ) : xirrChartData.length === 0 ? (
            <div style={emptyChartStyle}>
              {xirrData ? 'No holdings with sufficient price data for XIRR' : 'Loading…'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(100, xirrChartData.length * 26 + 20)}>
              <BarChart data={xirrChartData} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  tick={{ fill: 'var(--text2)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<PctTooltip />} />
                <Bar dataKey="value" radius={[0, 2, 2, 0]} maxBarSize={16}>
                  {xirrChartData.map((d) => (
                    <Cell key={d.name} fill={d.value >= 0 ? 'var(--green)' : 'var(--red)'} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )
        )}
      </div>

      {/* ── Section 6: Dividend Income ── */}
      <div style={sectionStyle}>
        <SectionHeader
          title="Dividend Income"
          right={
            dividendTotal > 0 ? (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)' }}>
                YTD {formatMoney(dividendYTD, 'INR', true)} · All-time {formatMoney(dividendTotal, 'INR', true)}
              </span>
            ) : undefined
          }
        />
        {dividendChartData.length === 0 ? (
          <div style={emptyChartStyle}>No dividend transactions recorded</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dividendChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--text3)', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
                width={60}
                tickFormatter={(v) => formatMoney(v, 'INR', true)}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div style={tooltipStyle}>
                      <div style={{ color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
                      <div style={{ color: 'var(--green)' }}>{formatMoney(payload[0].value as number)}</div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="amount" fill="var(--green)" fillOpacity={0.75} radius={[2, 2, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Section 7: Data Quality ── */}
      <div style={sectionStyle}>
        <SectionHeader title="Price Data Quality" />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)' }}>
                <QTh>Instrument</QTh>
                <QTh>Type</QTh>
                <QTh>Account</QTh>
                <QTh align="right">Last Price Date</QTh>
                <QTh align="right">Days Since</QTh>
                <QTh align="center">Status</QTh>
              </tr>
            </thead>
            <tbody>
              {qualityData.map((h) => {
                const d = h.daysSince
                const status = d === null ? 'no_price' : d <= 7 ? 'fresh' : d <= 30 ? 'ageing' : 'stale'
                const statusColor =
                  status === 'fresh' ? 'var(--green)' :
                  status === 'ageing' ? 'var(--accent)' :
                  'var(--red)'
                const statusLabel =
                  status === 'fresh' ? 'Fresh' :
                  status === 'ageing' ? 'Ageing' :
                  status === 'stale' ? 'Stale' :
                  'No Price'
                return (
                  <tr
                    key={`${h.instrument_id}-${h.account_id}`}
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <QTd>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{h.instrument_name}</span>
                      {h.instrument_ticker && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', marginLeft: 6 }}>
                          {h.instrument_ticker}
                        </span>
                      )}
                    </QTd>
                    <QTd>
                      <span
                        style={{
                          fontFamily: 'var(--font-cond)',
                          fontSize: 9,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--text3)',
                        }}
                      >
                        {h.instrument_type}
                      </span>
                    </QTd>
                    <QTd>
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text2)' }}>
                        {h.account_name}
                      </span>
                    </QTd>
                    <QTd align="right">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text2)' }}>
                        {h.latest_price_date ?? '--'}
                      </span>
                    </QTd>
                    <QTd align="right">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: statusColor }}>
                        {d !== null ? d : '--'}
                      </span>
                    </QTd>
                    <QTd align="center">
                      <span
                        style={{
                          fontFamily: 'var(--font-cond)',
                          fontSize: 9,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: statusColor,
                        }}
                      >
                        {statusLabel}
                      </span>
                    </QTd>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function QTh({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      style={{
        fontFamily: 'var(--font-cond)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text3)',
        padding: '5px 8px',
        textAlign: align,
        borderBottom: '1px solid var(--border)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  )
}

function QTd({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <td style={{ padding: '6px 8px', textAlign: align, verticalAlign: 'middle' }}>{children}</td>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const pageTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text)',
}

const metricCardStyle: CSSProperties = {
  flex: '1 1 0',
  minWidth: 120,
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  padding: '12px 16px',
}

const metricLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--text3)',
  marginBottom: 6,
}

const sectionStyle: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  padding: '14px 16px',
  marginBottom: 12,
}

const tooltipStyle: CSSProperties = {
  background: 'var(--bg3)',
  border: '1px solid var(--border2)',
  padding: '8px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
}

const subLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  marginBottom: 8,
}

const warningStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 9,
  color: 'var(--accent)',
  letterSpacing: '0.06em',
  marginBottom: 8,
}

const emptyChartStyle: CSSProperties = {
  height: 80,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text3)',
  fontFamily: 'var(--font-cond)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
}

const loadingStyle: CSSProperties = {
  padding: 32,
  fontFamily: 'var(--font-cond)',
  color: 'var(--text3)',
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
}

const errorStyle: CSSProperties = {
  padding: 32,
  fontFamily: 'var(--font-mono)',
  color: 'var(--red)',
  fontSize: 11,
}
