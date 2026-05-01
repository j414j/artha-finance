import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { ApiError } from '../api/client';
import { createInstrument, createPriceSnapshot } from '../api/instruments';
import { getHoldings, getHoldingsSummary } from '../api/investments';
import Button from '../components/Button';
import Input from '../components/Input';
import Select from '../components/Select';
import type { InstrumentType } from '../types/instrument';
import type { Holding, HoldingsSummary } from '../types/investment';
import {
  formatDateDisplay,
  formatMoney,
  parseMoneyInput,
} from '../utils/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INSTRUMENT_TYPES: Array<{ value: InstrumentType; label: string }> = [
  { value: 'equity', label: 'Equity' },
  { value: 'mf', label: 'Mutual Fund' },
  { value: 'etf', label: 'ETF' },
  { value: 'bond', label: 'Bond' },
  { value: 'gold', label: 'Gold' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'other', label: 'Other' },
];

const TYPE_LABELS: Record<string, string> = {
  equity: 'Equity',
  mf: 'Mutual Fund',
  etf: 'ETF',
  bond: 'Bond',
  gold: 'Gold',
  crypto: 'Crypto',
  other: 'Other',
};

const TYPE_COLORS: Record<string, string> = {
  equity: 'var(--blue)',
  mf: 'var(--purple)',
  etf: '#00B8D4',
  bond: 'var(--accent)',
  gold: '#FFD700',
  crypto: 'var(--green)',
  other: 'var(--text3)',
};

const ALLOCATION_PALETTE = [
  'var(--blue)',
  'var(--green)',
  'var(--purple)',
  'var(--accent)',
  '#00B8D4',
  '#FFD700',
  'var(--red)',
  'var(--text3)',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(pct: number | null): string {
  if (pct === null) return '--';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function pnlColor(value: number | null): string {
  if (value === null) return 'var(--text3)';
  return value >= 0 ? 'var(--green)' : 'var(--red)';
}

function allocationValue(holding: Holding): number {
  return holding.current_value_inr_paise ?? holding.invested_value_inr_paise ?? 0;
}

function isInrCurrency(currency: string): boolean {
  return currency.trim().toUpperCase() === 'INR';
}

function allocationLabel(value: string | null | undefined): string {
  const label = value?.trim();
  return label ? label : 'Unknown';
}

function allocationSegmentsFor(
  holdings: Holding[],
  getLabel: (holding: Holding) => string | null | undefined,
): DonutSegment[] {
  const totals = new Map<string, number>();
  for (const holding of holdings) {
    const label = allocationLabel(getLabel(holding));
    totals.set(label, (totals.get(label) ?? 0) + allocationValue(holding));
  }

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, value], index) => ({
      label,
      value,
      color: ALLOCATION_PALETTE[index % ALLOCATION_PALETTE.length],
    }));
}

function todayInputDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// SVG Donut
// ---------------------------------------------------------------------------

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

function DonutChart({ segments }: { segments: DonutSegment[] }) {
  const visibleSegments = segments.filter((segment) => segment.value > 0);
  const total = visibleSegments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return (
      <svg width={160} height={160} viewBox="0 0 160 160" aria-hidden="true">
        <circle cx={80} cy={80} r={56} fill="none" stroke="var(--border)" strokeWidth={24} />
      </svg>
    );
  }

  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;

  if (visibleSegments.length === 1) {
    return (
      <svg width={160} height={160} viewBox="0 0 160 160" aria-hidden="true">
        <circle
          cx={80}
          cy={80}
          r={radius}
          fill="none"
          stroke={visibleSegments[0].color}
          strokeWidth={24}
        />
      </svg>
    );
  }

  return (
    <svg width={160} height={160} viewBox="0 0 160 160" aria-hidden="true">
      <circle cx={80} cy={80} r={radius} fill="none" stroke="var(--border)" strokeWidth={24} />
      {visibleSegments.map((segment) => {
        const length = (segment.value / total) * circumference;
        const dashOffset = -consumed;
        consumed += length;

        return (
          <circle
            key={segment.label}
            cx={80}
            cy={80}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={24}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 80 80)"
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Form state types
// ---------------------------------------------------------------------------

interface InstrumentFormState {
  name: string;
  type: InstrumentType;
  ticker: string;
  currency: string;
  sector: string;
  geography: string;
  notes: string;
}

interface PriceFormState {
  price: string;
  date: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InvestmentsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [summary, setSummary] = useState<HoldingsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');

  // Add Instrument modal
  const [instrumentModalOpen, setInstrumentModalOpen] = useState(false);
  const [instrumentForm, setInstrumentForm] = useState<InstrumentFormState>(blankInstrumentForm());
  const [instrumentFormError, setInstrumentFormError] = useState('');
  const [instrumentSaving, setInstrumentSaving] = useState(false);

  // Update Price modal
  const [priceModalHolding, setPriceModalHolding] = useState<Holding | null>(null);
  const [priceForm, setPriceForm] = useState<PriceFormState>(blankPriceForm());
  const [priceFormError, setPriceFormError] = useState('');
  const [priceSaving, setPriceSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [holdingsRes, summaryRes] = await Promise.all([
        getHoldings(filterAccountId || undefined),
        getHoldingsSummary(filterAccountId || undefined),
      ]);
      setHoldings(holdingsRes.holdings);
      setSummary(summaryRes.summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load investments');
    } finally {
      setLoading(false);
    }
  }, [filterAccountId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Derived: unique accounts for filter
  const accounts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const h of holdings) {
      if (!seen.has(h.account_id)) seen.set(h.account_id, h.account_name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [holdings]);

  // Derived: group by instrument_type, sorted by group total invested desc
  const groupedHoldings = useMemo(() => {
    const groups = new Map<string, Holding[]>();
    for (const h of holdings) {
      const key = h.instrument_type;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(h);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      const sumA = a[1].reduce((s, h) => s + allocationValue(h), 0);
      const sumB = b[1].reduce((s, h) => s + allocationValue(h), 0);
      return sumB - sumA;
    });
  }, [holdings]);

  // Derived: donut segments
  const donutSegments = useMemo((): DonutSegment[] =>
    groupedHoldings.map(([type, hs]) => ({
      label: TYPE_LABELS[type] ?? type,
      value: hs.reduce((s, h) => s + allocationValue(h), 0),
      color: TYPE_COLORS[type] ?? 'var(--text3)',
    })),
    [groupedHoldings],
  );

  const sectorSegments = useMemo(
    () => allocationSegmentsFor(holdings, (holding) => holding.instrument_sector),
    [holdings],
  );

  const geographySegments = useMemo(
    () => allocationSegmentsFor(holdings, (holding) => holding.instrument_geography),
    [holdings],
  );

  // ---------- Instrument modal ----------

  const openInstrumentModal = () => {
    setInstrumentForm(blankInstrumentForm());
    setInstrumentFormError('');
    setInstrumentModalOpen(true);
  };

  const closeInstrumentModal = () => {
    if (instrumentSaving) return;
    setInstrumentModalOpen(false);
  };

  const handleInstrumentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setInstrumentFormError('');
    const name = instrumentForm.name.trim();
    if (!name) { setInstrumentFormError('Name is required'); return; }
    setInstrumentSaving(true);
    try {
      await createInstrument({
        name,
        type: instrumentForm.type,
        ticker: instrumentForm.ticker.trim() || null,
        currency: instrumentForm.currency.trim() || 'INR',
        sector: instrumentForm.sector.trim() || null,
        geography: instrumentForm.geography.trim() || null,
        notes: instrumentForm.notes.trim() || null,
      });
      setInstrumentModalOpen(false);
      await loadData();
    } catch (err) {
      setInstrumentFormError(err instanceof Error ? err.message : 'Failed to create instrument');
    } finally {
      setInstrumentSaving(false);
    }
  };

  // ---------- Price modal ----------

  const openPriceModal = (holding: Holding) => {
    setPriceModalHolding(holding);
    setPriceForm(blankPriceForm());
    setPriceFormError('');
  };

  const closePriceModal = () => {
    if (priceSaving) return;
    setPriceModalHolding(null);
  };

  const handlePriceSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!priceModalHolding) return;
    setPriceFormError('');
    let price_paise: number;
    try {
      price_paise = parseMoneyInput(priceForm.price);
    } catch (err) {
      setPriceFormError(err instanceof Error ? err.message : 'Invalid price');
      return;
    }
    if (price_paise <= 0) { setPriceFormError('Price must be positive'); return; }
    if (!priceForm.date) { setPriceFormError('Date is required'); return; }
    setPriceSaving(true);
    try {
      await createPriceSnapshot(priceModalHolding.instrument_id, {
        price_paise,
        date: priceForm.date,
        notes: priceForm.notes.trim() || null,
      });
      setPriceModalHolding(null);
      await loadData();
    } catch (err) {
      setPriceFormError(err instanceof Error ? err.message : 'Failed to update price');
    } finally {
      setPriceSaving(false);
    }
  };

  // ---------- Render ----------

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg1)', padding: 20 }}>
      <SummaryStrip summary={summary} />

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left column */}
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          {/* Filter bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              marginBottom: 8,
              padding: '8px 12px',
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ flex: '0 0 200px' }}>
              <Select
                label="Account"
                value={filterAccountId}
                onChange={(e) => setFilterAccountId(e.target.value)}
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <Button onClick={openInstrumentModal}>+ Add Instrument</Button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={errorBannerStyle}>
              {error}
              <button type="button" style={retryButtonStyle} onClick={() => void loadData()}>
                Retry
              </button>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <EmptyPanel label="Loading holdings…" />
          ) : holdings.length === 0 ? (
            <EmptyPanel label="No holdings — add an instrument then log investment transactions" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg2)' }}>
                    <Th>Instrument</Th>
                    <Th>Type</Th>
                    <Th>Account</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Avg Cost</Th>
                    <Th align="right">Price</Th>
                    <Th align="right">Invested</Th>
                    <Th align="right">Current</Th>
                    <Th align="right">P&amp;L ₹</Th>
                    <Th align="right">P&amp;L %</Th>
                    <Th align="right">Updated</Th>
                    <Th align="center">⋯</Th>
                  </tr>
                </thead>
                <tbody>
                  {groupedHoldings.flatMap(([type, hs]) => {
                    const groupValue = hs.reduce((s, h) => s + allocationValue(h), 0);
                    return [
                      <tr key={`grp-${type}`} style={{ background: 'var(--bg3)' }}>
                        <td
                          colSpan={11}
                          style={{
                            padding: '5px 8px',
                            fontFamily: 'var(--font-cond)',
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                          }}
                        >
                          <span style={{ color: TYPE_COLORS[type] ?? 'var(--text3)' }}>
                            {TYPE_LABELS[type] ?? type}
                          </span>
                          <span
                            style={{
                              marginLeft: 12,
                              fontWeight: 400,
                              color: 'var(--text3)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 10,
                            }}
                          >
                            {formatMoney(groupValue)}
                          </span>
                        </td>
                        <td style={{ background: 'var(--bg3)', padding: '5px 8px' }} />
                      </tr>,
                      ...hs.map((h) => (
                        <HoldingRow
                          key={`${h.instrument_id}-${h.account_id}`}
                          holding={h}
                          onUpdatePrice={openPriceModal}
                        />
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div
            style={{
              padding: '10px 12px',
              fontFamily: 'var(--font-cond)',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--text3)',
              borderTop: '1px solid var(--border)',
            }}
          >
            {!loading && `${holdings.length} holding${holdings.length !== 1 ? 's' : ''}`}
          </div>
        </div>

        {/* Right sidebar */}
        <div
          style={{
            flex: '0 0 260px',
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            padding: '14px 16px',
          }}
        >
          <AllocationChart title="Allocation by Type" segments={donutSegments} />
          <AllocationChart title="Allocation by Sector" segments={sectorSegments} />
          <AllocationChart title="Allocation by Geography" segments={geographySegments} />
        </div>
      </div>

      {/* Modals */}
      {instrumentModalOpen && (
        <InstrumentModal
          form={instrumentForm}
          saving={instrumentSaving}
          error={instrumentFormError}
          onChange={setInstrumentForm}
          onSubmit={handleInstrumentSubmit}
          onClose={closeInstrumentModal}
        />
      )}

      {priceModalHolding !== null && (
        <PriceModal
          holding={priceModalHolding}
          form={priceForm}
          saving={priceSaving}
          error={priceFormError}
          onChange={setPriceForm}
          onSubmit={handlePriceSubmit}
          onClose={closePriceModal}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function SummaryStrip({ summary }: { summary: HoldingsSummary | null }) {
  const pnl = summary?.total_unrealised_pnl_paise ?? null;
  const pct = summary?.total_unrealised_pnl_pct ?? null;

  const unrealisedLabel = pnl !== null
    ? `${formatMoney(pnl)}  ${fmtPct(pct)}`
    : '--';

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
      <MetricCard
        label="Invested"
        value={summary ? formatMoney(summary.total_invested_paise) : '--'}
      />
      <MetricCard
        label="Current Value"
        value={
          summary?.total_current_value_paise != null
            ? formatMoney(summary.total_current_value_paise)
            : '--'
        }
      />
      <MetricCard
        label="Unrealised P&L"
        value={unrealisedLabel}
        valueColor={pnl !== null ? pnlColor(pnl) : 'var(--text3)'}
      />
      <MetricCard
        label="Realised P&L"
        value={summary ? formatMoney(summary.total_realised_pnl_paise) : '--'}
        valueColor={
          summary
            ? pnlColor(summary.total_realised_pnl_paise)
            : 'var(--text3)'
        }
      />
      <MetricCard
        label="Holdings"
        value={summary ? String(summary.holdings_count) : '--'}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  valueColor = 'var(--text)',
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 140,
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        padding: '12px 16px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-cond)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--text3)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 18,
          color: valueColor,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holding row
// ---------------------------------------------------------------------------

function HoldingRow({
  holding: h,
  onUpdatePrice,
}: {
  holding: Holding;
  onUpdatePrice: (h: Holding) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <tr
      style={{
        borderBottom: '1px solid var(--border)',
        background: hovered ? 'var(--bg2)' : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Instrument */}
      <Td>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
            {h.instrument_name}
          </div>
          {h.instrument_ticker && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', marginTop: 1 }}>
              {h.instrument_ticker}
            </div>
          )}
        </div>
      </Td>

      {/* Type */}
      <Td>
        <span
          style={{
            fontFamily: 'var(--font-cond)',
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: TYPE_COLORS[h.instrument_type] ?? 'var(--text3)',
            border: `1px solid ${TYPE_COLORS[h.instrument_type] ?? 'var(--border)'}`,
            padding: '1px 5px',
          }}
        >
          {TYPE_LABELS[h.instrument_type] ?? h.instrument_type}
        </span>
      </Td>

      {/* Account */}
      <Td color="var(--text3)">{h.account_name}</Td>

      {/* Qty */}
      <Td align="right" mono>
        {h.quantity_held.toFixed(4).replace(/\.?0+$/, '')}
      </Td>

      {/* Avg cost */}
      <Td align="right" mono>
        {formatMoney(h.avg_cost_per_unit_paise, h.instrument_currency)}
      </Td>

      {/* Price */}
      <Td align="right" mono color={h.latest_price_paise != null ? 'var(--text)' : 'var(--text3)'}>
        {h.latest_price_paise != null
          ? formatMoney(h.latest_price_paise, h.instrument_currency)
          : '--'}
      </Td>

      {/* Invested */}
      <Td align="right" mono>
        <MoneyWithInr
          amount={h.invested_value_paise}
          currency={h.instrument_currency}
          inrAmount={h.invested_value_inr_paise}
        />
      </Td>

      {/* Current */}
      <Td align="right" mono>
        <MoneyWithInr
          amount={h.current_value_paise}
          currency={h.instrument_currency}
          inrAmount={h.current_value_inr_paise}
        />
      </Td>

      {/* P&L ₹ */}
      <Td align="right" mono color={pnlColor(h.unrealised_pnl_inr_paise)}>
        {h.unrealised_pnl_inr_paise != null ? formatMoney(h.unrealised_pnl_inr_paise) : '--'}
      </Td>

      {/* P&L % */}
      <Td align="right" mono color={pnlColor(h.unrealised_pnl_pct)}>
        {fmtPct(h.unrealised_pnl_pct)}
      </Td>

      {/* Updated */}
      <Td align="right">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
          {h.latest_price_date ? formatDateDisplay(h.latest_price_date) : '--'}
        </span>
      </Td>

      {/* Action */}
      <Td align="center">
        <button
          type="button"
          title="Update price"
          onClick={() => onUpdatePrice(h)}
          style={actionBtnStyle}
        >
          ₹
        </button>
      </Td>
    </tr>
  );
}

function MoneyWithInr({
  amount,
  currency,
  inrAmount,
}: {
  amount: number | null;
  currency: string;
  inrAmount: number | null;
}) {
  const showInr = !isInrCurrency(currency);

  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 2,
        lineHeight: 1.15,
      }}
    >
      <span style={{ color: amount != null ? 'var(--text)' : 'var(--text3)' }}>
        {amount != null ? formatMoney(amount, currency) : '--'}
      </span>
      {showInr && (
        <span style={{ color: 'var(--text3)', fontSize: 9 }}>
          {inrAmount != null ? `INR ${formatMoney(inrAmount)}` : 'INR --'}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Allocation legend
// ---------------------------------------------------------------------------

function AllocationChart({ title, segments }: { title: string; segments: DonutSegment[] }) {
  return (
    <section style={allocationSectionStyle}>
      <div style={sidebarLabelStyle}>{title}</div>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
        <DonutChart segments={segments} />
      </div>
      <AllocationLegend segments={segments} />
    </section>
  );
}

function AllocationLegend({ segments }: { segments: DonutSegment[] }) {
  const visibleSegments = segments.filter((segment) => segment.value > 0);
  const total = visibleSegments.reduce((s, seg) => s + seg.value, 0);
  if (visibleSegments.length === 0 || total === 0) {
    return (
      <div
        style={{
          color: 'var(--text3)',
          fontSize: 10,
          fontFamily: 'var(--font-cond)',
          textAlign: 'center',
          marginTop: 8,
        }}
      >
        No data
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {visibleSegments.map((seg) => {
        const pct = total > 0 ? ((seg.value / total) * 100).toFixed(1) : '0.0';
        return (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                background: seg.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                fontFamily: 'var(--font-cond)',
                fontSize: 10,
                color: 'var(--text2)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {seg.label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text3)',
              }}
            >
              {formatMoney(seg.value, 'INR', true)}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text3)',
                minWidth: 38,
                textAlign: 'right',
              }}
            >
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Instrument modal
// ---------------------------------------------------------------------------

function InstrumentModal({
  form,
  saving,
  error,
  onChange,
  onSubmit,
  onClose,
}: {
  form: InstrumentFormState;
  saving: boolean;
  error: string;
  onChange: (f: InstrumentFormState) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof InstrumentFormState>(key: K, value: InstrumentFormState[K]) =>
    onChange({ ...form, [key]: value });

  return (
    <div style={backdropStyle} onMouseDown={onClose}>
      <form
        style={modalBoxStyle}
        onSubmit={onSubmit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <span>Add Instrument</span>
          <button type="button" onClick={onClose} style={closeButtonStyle}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
            <Input
              label="Name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
            <Select
              label="Type"
              value={form.type}
              onChange={(e) => set('type', e.target.value as InstrumentType)}
            >
              {INSTRUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10, marginTop: 10 }}>
            <Input
              label="Ticker (optional)"
              value={form.ticker}
              onChange={(e) => set('ticker', e.target.value)}
              placeholder="RELIANCE"
            />
            <Input
              label="Currency"
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
              placeholder="INR"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <Input
              label="Sector (optional)"
              value={form.sector}
              onChange={(e) => set('sector', e.target.value)}
              placeholder="Technology"
            />
            <Input
              label="Geography (optional)"
              value={form.geography}
              onChange={(e) => set('geography', e.target.value)}
              placeholder="India"
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={fieldLabelStyle}>Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              style={textareaStyle}
            />
          </div>

          {error && <div style={formErrorStyle}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button type="button" variant="ghost" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} style={{ flex: 2 }}>
              {saving ? 'Creating…' : 'Create Instrument'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Update Price modal
// ---------------------------------------------------------------------------

function PriceModal({
  holding,
  form,
  saving,
  error,
  onChange,
  onSubmit,
  onClose,
}: {
  holding: Holding;
  form: PriceFormState;
  saving: boolean;
  error: string;
  onChange: (f: PriceFormState) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof PriceFormState>(key: K, value: PriceFormState[K]) =>
    onChange({ ...form, [key]: value });

  const currentPrice =
    holding.latest_price_paise != null
      ? formatMoney(holding.latest_price_paise, holding.instrument_currency)
      : null;

  return (
    <div style={backdropStyle} onMouseDown={onClose}>
      <form
        style={{ ...modalBoxStyle, width: 420 }}
        onSubmit={onSubmit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <span>Update Price</span>
          <button type="button" onClick={onClose} style={closeButtonStyle}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 12, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text2)' }}>
            {holding.instrument_name}
            {holding.instrument_ticker && (
              <span
                style={{
                  marginLeft: 8,
                  color: 'var(--text3)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                }}
              >
                {holding.instrument_ticker}
              </span>
            )}
          </div>

          {currentPrice && (
            <div
              style={{
                marginBottom: 12,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text3)',
              }}
            >
              Current: {currentPrice}
              {holding.latest_price_date && (
                <span style={{ marginLeft: 8 }}>
                  ({formatDateDisplay(holding.latest_price_date)})
                </span>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
            <Input
              label={`Price (${holding.instrument_currency})`}
              value={form.price}
              inputMode="decimal"
              onChange={(e) => set('price', e.target.value)}
              placeholder="1500.50"
              required
            />
            <Input
              label="Date"
              type="date"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
              required
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={fieldLabelStyle}>Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              style={textareaStyle}
            />
          </div>

          {error && <div style={formErrorStyle}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button type="button" variant="ghost" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} style={{ flex: 2 }}>
              {saving ? 'Saving…' : 'Update Price'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Primitive table cell helpers
// ---------------------------------------------------------------------------

function Th({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      style={{
        fontFamily: 'var(--font-cond)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text3)',
        padding: '6px 8px',
        textAlign: align,
        borderBottom: '1px solid var(--border)',
        whiteSpace: 'nowrap',
        background: 'var(--bg2)',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  mono = false,
  color = 'var(--text)',
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  color?: string;
}) {
  return (
    <td
      style={{
        padding: '6px 8px',
        fontSize: 11,
        whiteSpace: 'nowrap',
        textAlign: align,
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font)',
        color,
      }}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// EmptyPanel
// ---------------------------------------------------------------------------

function EmptyPanel({ label }: { label: string }) {
  return (
    <div
      style={{
        minHeight: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text3)',
        fontFamily: 'var(--font-cond)',
        fontSize: 11,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: 24,
        textAlign: 'center',
        border: '1px solid var(--border)',
        background: 'var(--bg2)',
      }}
    >
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form defaults
// ---------------------------------------------------------------------------

function blankInstrumentForm(): InstrumentFormState {
  return { name: '', type: 'equity', ticker: '', currency: 'INR', sector: '', geography: '', notes: '' };
}

function blankPriceForm(): PriceFormState {
  return { price: '', date: todayInputDate(), notes: '' };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sidebarLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
};

const allocationSectionStyle: CSSProperties = {
  paddingBottom: 16,
  marginBottom: 16,
  borderBottom: '1px solid var(--border)',
};

const actionBtnStyle: CSSProperties = {
  width: 24,
  height: 20,
  border: '1px solid var(--border)',
  background: 'none',
  color: 'var(--text3)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const errorBannerStyle: CSSProperties = {
  margin: '0 0 8px',
  padding: '8px 10px',
  border: '1px solid rgba(240,64,96,0.25)',
  background: 'rgba(240,64,96,0.08)',
  color: 'var(--red)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const retryButtonStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'none',
  color: 'var(--text2)',
  fontFamily: 'var(--font-cond)',
  fontSize: 10,
  textTransform: 'uppercase',
  cursor: 'pointer',
  padding: '3px 8px',
};

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.58)',
  zIndex: 2000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const modalBoxStyle: CSSProperties = {
  width: 640,
  maxWidth: '100%',
  maxHeight: '92vh',
  overflowY: 'auto',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
};

const modalHeaderStyle: CSSProperties = {
  height: 38,
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 14px',
  fontFamily: 'var(--font-cond)',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--text2)',
};

const closeButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--text3)',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
};

const fieldLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text3)',
  marginBottom: 3,
  display: 'block',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  resize: 'vertical',
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '6px 8px',
  fontFamily: 'var(--font)',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
};

const formErrorStyle: CSSProperties = {
  marginTop: 10,
  padding: '6px 10px',
  border: '1px solid rgba(240,64,96,0.25)',
  background: 'rgba(240,64,96,0.08)',
  color: 'var(--red)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
};
