import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Area,
  AreaChart,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getHoldingDrilldown } from "../api/investments";
import type { BuyLot, HoldingDrilldown, Holding, ValueHistoryPoint, PriceHistoryPoint } from "../types/investment";
import { formatDateDisplay, formatMoney } from "../utils/format";

const PERIODS = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "180D", days: 180 },
  { label: "1Y", days: 365 },
  { label: "All", days: 0 },
];

const TYPE_COLORS: Record<string, string> = {
  equity: "var(--blue)",
  mf: "var(--purple)",
  etf: "#00B8D4",
  bond: "var(--accent)",
  gold: "#FFD700",
  crypto: "var(--green)",
  other: "var(--text3)",
};

function pnlColor(v: number | null): string {
  if (v === null) return "var(--text3)";
  return v >= 0 ? "var(--green)" : "var(--red)";
}

function fmtPct(v: number | null, decimals = 2): string {
  if (v === null) return "--";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}%`;
}

function filterByPeriod(history: ValueHistoryPoint[], days: number): ValueHistoryPoint[] {
  if (days === 0 || history.length === 0) return history;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return history.filter((p) => p.date >= cutoffStr);
}

function filterByPeriodPrice(history: PriceHistoryPoint[], days: number): PriceHistoryPoint[] {
  if (days === 0 || history.length === 0) return history;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return history.filter((p) => p.date >= cutoffStr);
}

export default function HoldingDrilldown({
  holding,
  onClose,
}: {
  holding: Holding;
  onClose: () => void;
}) {
  const [drilldown, setDrilldown] = useState<HoldingDrilldown | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(180);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    getHoldingDrilldown(holding.instrument_id, holding.account_id)
      .then((d) => setDrilldown(d))
      .catch(() => setDrilldown(null))
      .finally(() => setLoading(false));
  }, [holding.instrument_id, holding.account_id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const chartColor = TYPE_COLORS[holding.instrument_type] ?? "var(--accent)";
  const currency = holding.instrument_currency;

  const allHistory = drilldown?.value_history ?? [];
  const filteredHistory = filterByPeriod(allHistory, period);

  const allPriceHistory = drilldown?.price_history ?? [];
  const filteredPriceHistory = filterByPeriodPrice(allPriceHistory, period);

  const chartValues = filteredHistory.map((p) => p.value_paise);
  const minVal = chartValues.length ? Math.min(...chartValues) : 0;
  const maxVal = chartValues.length ? Math.max(...chartValues) : 0;

  const balanceChange =
    filteredHistory.length >= 2
      ? filteredHistory[filteredHistory.length - 1].value_paise - filteredHistory[0].value_paise
      : 0;

  const formatChartDate = (d: string) => {
    const parts = d.split("-");
    return `${parts[2]}/${parts[1]}`;
  };

  const currentValue = holding.current_value_paise ?? holding.invested_value_paise;
  const pnl = holding.unrealised_pnl_paise ?? null;
  const pnlPct = holding.unrealised_pnl_pct ?? null;

  return (
    <>
      <div style={backdropStyle} onClick={onClose} />
      <div ref={panelRef} style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                background: chartColor,
                flexShrink: 0,
              }}
            />
            <span style={headerTitleStyle}>{holding.instrument_name}</span>
            {holding.instrument_ticker && (
              <span style={tickerBadgeStyle}>{holding.instrument_ticker}</span>
            )}
            <span style={typeBadgeStyle}>{holding.instrument_type.toUpperCase()}</span>
          </div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {/* Total value */}
          <div style={sectionStyle}>
            <div style={metaLabelStyle}>Current Value</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 28, color: "var(--text)", lineHeight: 1.1 }}>
                {formatMoney(currentValue, currency)}
              </span>
              {currency !== "INR" && holding.current_value_inr_paise != null && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text3)" }}>
                  {formatMoney(holding.current_value_inr_paise)}
                </span>
              )}
            </div>
            {pnl !== null && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: pnlColor(pnl), marginTop: 3 }}>
                {pnl >= 0 ? "+" : ""}{formatMoney(pnl, currency, true)} ({fmtPct(pnlPct)}) unrealised
              </div>
            )}
          </div>

          {/* Key metrics */}
          <div style={sectionStyle}>
            <div style={metaLabelStyle}>Position</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
              <KvRow label="Quantity">
                {holding.quantity_held.toFixed(4).replace(/\.?0+$/, "")}
              </KvRow>
              <KvRow label="Avg Cost">
                {formatMoney(holding.avg_cost_per_unit_paise, currency)}
              </KvRow>
              <KvRow label="Curr Price">
                {holding.latest_price_paise != null
                  ? formatMoney(holding.latest_price_paise, currency)
                  : "--"}
              </KvRow>
              <KvRow label="Invested">
                {formatMoney(holding.invested_value_paise, currency)}
              </KvRow>
              <KvRow label="Unrealised P&L" valueColor={pnlColor(pnl)}>
                {pnl != null
                  ? `${pnl >= 0 ? "+" : ""}${formatMoney(pnl, currency, true)} (${fmtPct(pnlPct)})`
                  : "--"}
              </KvRow>
              {!loading && drilldown?.xirr_pct != null && (
                <KvRow label="XIRR" valueColor={pnlColor(drilldown.xirr_pct)}>
                  {fmtPct(drilldown.xirr_pct)} p.a.
                </KvRow>
              )}
              {holding.instrument_sector && (
                <KvRow label="Sector">{holding.instrument_sector}</KvRow>
              )}
              {holding.instrument_geography && (
                <KvRow label="Geography">{holding.instrument_geography}</KvRow>
              )}
              <KvRow label="Account">{holding.account_name}</KvRow>
              {holding.latest_price_date && (
                <KvRow label="Price Date">{formatDateDisplay(holding.latest_price_date)}</KvRow>
              )}
            </div>
          </div>

          {/* Value history chart */}
          <div style={{ borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px 4px" }}>
              <span style={metaLabelStyle}>Value History</span>
              <div style={{ display: "flex", gap: 2 }}>
                {PERIODS.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    onClick={() => setPeriod(p.days)}
                    style={{
                      ...periodButtonStyle,
                      color: period === p.days ? "var(--text)" : "var(--text3)",
                      borderColor: period === p.days ? "var(--border2)" : "transparent",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div style={chartSkeletonStyle} />
            ) : filteredHistory.length === 0 ? (
              <div style={{ ...chartSkeletonStyle, color: "var(--text3)", fontSize: 10, fontFamily: "var(--font-cond)", letterSpacing: "0.08em", display: "flex", alignItems: "center", justifyContent: "center" }}>
                NO PRICE DATA
              </div>
            ) : (
              <div style={{ padding: "0 0 4px" }}>
                {balanceChange !== 0 && (
                  <div style={{ padding: "0 14px 4px", fontFamily: "var(--font-mono)", fontSize: 10, color: balanceChange > 0 ? "var(--green)" : "var(--red)" }}>
                    {balanceChange > 0 ? "+" : ""}{formatMoney(balanceChange, currency, true)} in period
                  </div>
                )}
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={filteredHistory} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`grad-holding-${holding.instrument_id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chartColor} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatChartDate}
                      tick={{ fontSize: 8, fill: "var(--text3)", fontFamily: "var(--font-mono)" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[Math.floor(minVal * 0.99), Math.ceil(maxVal * 1.01)]}
                      tickFormatter={(v) => formatMoney(v, currency, true)}
                      tick={{ fontSize: 8, fill: "var(--text3)", fontFamily: "var(--font-mono)" }}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0].payload as ValueHistoryPoint;
                        return (
                          <div style={tooltipStyle}>
                            <div style={{ color: "var(--text3)", fontSize: 9, fontFamily: "var(--font-cond)", letterSpacing: "0.08em", marginBottom: 3 }}>
                              {formatDateDisplay(point.date)}
                            </div>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)" }}>
                              {formatMoney(point.value_paise, currency)}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value_paise"
                      stroke={chartColor}
                      strokeWidth={1.5}
                      fill={`url(#grad-holding-${holding.instrument_id})`}
                      dot={false}
                      activeDot={{ r: 3, fill: chartColor }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Price history chart */}
          {filteredPriceHistory.length > 0 && (() => {
            const avgCost = holding.avg_cost_per_unit_paise;
            const prices = filteredPriceHistory.map((p) => p.price_paise);
            const rawMin = Math.min(...prices);
            const rawMax = Math.max(...prices);
            const domainMin = Math.floor(Math.min(rawMin, avgCost) * 0.98);
            const domainMax = Math.ceil(Math.max(rawMax, avgCost) * 1.02);
            const minP = domainMin;
            const maxP = domainMax;

            // SVG gradients use objectBoundingBox by default, so the offset must be relative
            // to the bounding box of the element it's applied to, NOT the full chart height.
            //
            // Stroke bounding box: [rawMin, rawMax] (the price data range)
            // Fill bounding box:   [domainMin, rawMax] (data top → chart baseline)
            //
            // offset = fraction from TOP (y=0 in gradient = high price = chart top)
            const strokeGradOffset = rawMax > rawMin
              ? Math.max(0, Math.min(1, (rawMax - avgCost) / (rawMax - rawMin)))
              : 0.5;
            const fillGradOffset = rawMax > domainMin
              ? Math.max(0, Math.min(1, (rawMax - avgCost) / (rawMax - domainMin)))
              : 0.5;
            const gradId = `priceGrad-${holding.instrument_id}`;
            const currency = holding.instrument_currency;
            return (
              <div style={{ borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px 4px" }}>
                  <span style={metaLabelStyle}>Price History</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)" }}>
                    avg entry {formatMoney(avgCost, currency)}
                  </span>
                </div>
                <div style={{ padding: "0 0 4px" }}>
                  <ResponsiveContainer width="100%" height={130}>
                    <ComposedChart data={filteredPriceHistory} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`${gradId}-fill`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset={0} stopColor="var(--green)" stopOpacity={0.18} />
                          <stop offset={fillGradOffset} stopColor="var(--green)" stopOpacity={0.18} />
                          <stop offset={fillGradOffset} stopColor="var(--red)" stopOpacity={0.18} />
                          <stop offset={1} stopColor="var(--red)" stopOpacity={0.18} />
                        </linearGradient>
                        <linearGradient id={`${gradId}-stroke`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset={0} stopColor="var(--green)" stopOpacity={1} />
                          <stop offset={strokeGradOffset} stopColor="var(--green)" stopOpacity={1} />
                          <stop offset={strokeGradOffset} stopColor="var(--red)" stopOpacity={1} />
                          <stop offset={1} stopColor="var(--red)" stopOpacity={1} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatChartDate}
                        tick={{ fontSize: 8, fill: "var(--text3)", fontFamily: "var(--font-mono)" }}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        domain={[Math.floor(minP), Math.ceil(maxP)]}
                        tickFormatter={(v) => formatMoney(v, currency, true)}
                        tick={{ fontSize: 8, fill: "var(--text3)", fontFamily: "var(--font-mono)" }}
                        tickLine={false}
                        axisLine={false}
                        width={64}
                      />
                      <ReferenceLine
                        y={avgCost}
                        stroke="var(--accent)"
                        strokeDasharray="4 3"
                        strokeWidth={1.5}
                        label={{
                          value: "Avg",
                          position: "insideTopRight",
                          fill: "var(--accent)",
                          fontSize: 8,
                          fontFamily: "var(--font-cond)",
                        }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const point = payload[0].payload as PriceHistoryPoint;
                          const price = point.price_paise;
                          const above = price >= avgCost;
                          return (
                            <div style={tooltipStyle}>
                              <div style={{ color: "var(--text3)", fontSize: 9, fontFamily: "var(--font-cond)", letterSpacing: "0.08em", marginBottom: 3 }}>
                                {formatDateDisplay(point.date)}
                              </div>
                              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: above ? "var(--green)" : "var(--red)" }}>
                                {formatMoney(price, currency)}
                              </div>
                              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: above ? "var(--green)" : "var(--red)", marginTop: 2 }}>
                                {above ? "+" : ""}{formatMoney(price - avgCost, currency, true)} vs avg
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="price_paise"
                        stroke={`url(#${gradId}-stroke)`}
                        strokeWidth={1.5}
                        fill={`url(#${gradId}-fill)`}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* Buy lots */}
          <div style={sectionStyle}>
            <div style={metaLabelStyle}>Buy Lots</div>
            {loading ? (
              <div style={{ color: "var(--text3)", fontSize: 10, marginTop: 6 }}>Loading…</div>
            ) : !drilldown || drilldown.buy_lots.length === 0 ? (
              <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 6, fontFamily: "var(--font-cond)" }}>No buy transactions</div>
            ) : (
              <div style={{ marginTop: 8, overflowX: "auto" }}>
                <div style={lotHeaderStyle}>
                  <span>Date</span>
                  <span style={{ textAlign: "right" }}>Qty</span>
                  <span style={{ textAlign: "right" }}>Invested</span>
                  <span style={{ textAlign: "right" }}>Current</span>
                  <span style={{ textAlign: "right" }}>P&amp;L</span>
                  <span style={{ textAlign: "right" }}>Days</span>
                  <span style={{ textAlign: "right" }}>Return</span>
                  <span style={{ textAlign: "right" }}>Ann.</span>
                </div>
                {drilldown.buy_lots.map((lot) => (
                  <BuyLotRow key={lot.transaction_id} lot={lot} currency={currency} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function BuyLotRow({ lot, currency }: { lot: BuyLot; currency: string }) {
  const pnl = lot.pnl_paise;
  const color = pnlColor(pnl);

  return (
    <div style={lotRowStyle}>
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text)" }}>
          {formatDateDisplay(lot.date)}
        </div>
        {lot.fees_paise > 0 && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text3)" }}>
            +{formatMoney(lot.fees_paise, currency, true)} fee
          </div>
        )}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text2)", textAlign: "right" }}>
        {lot.quantity.toFixed(4).replace(/\.?0+$/, "")}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text2)", textAlign: "right" }}>
        {formatMoney(lot.invested_paise, currency, true)}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text)", textAlign: "right" }}>
        {lot.current_value_paise != null ? formatMoney(lot.current_value_paise, currency, true) : "--"}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color, textAlign: "right" }}>
        {pnl != null ? `${pnl >= 0 ? "+" : ""}${formatMoney(pnl, currency, true)}` : "--"}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)", textAlign: "right" }}>
        {lot.days_held}d
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color, textAlign: "right" }}>
        {lot.pnl_pct != null ? `${lot.pnl_pct >= 0 ? "+" : ""}${lot.pnl_pct.toFixed(1)}%` : "--"}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color, textAlign: "right" }}>
        {lot.annualised_return_pct != null
          ? `${lot.annualised_return_pct >= 0 ? "+" : ""}${lot.annualised_return_pct.toFixed(1)}%`
          : "--"}
      </div>
    </div>
  );
}

function KvRow({
  label,
  children,
  valueColor = "var(--text)",
}: {
  label: string;
  children: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontFamily: "var(--font-cond)", fontSize: 11, color: "var(--text3)", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: valueColor }}>
        {children}
      </span>
    </div>
  );
}

// Styles

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(0,0,0,0.35)",
};

const panelStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: 560,
  maxWidth: "100vw",
  background: "var(--bg2)",
  borderLeft: "1px solid var(--border2)",
  boxShadow: "-12px 0 40px rgba(0,0,0,0.4)",
  zIndex: 1001,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  height: 44,
  borderBottom: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 14px",
  flexShrink: 0,
  background: "var(--bg3)",
};

const headerTitleStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.06em",
  color: "var(--text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 220,
};

const tickerBadgeStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  color: "var(--text3)",
  border: "1px solid var(--border2)",
  padding: "1px 5px",
};

const typeBadgeStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text3)",
  border: "1px solid var(--border2)",
  padding: "1px 5px",
  whiteSpace: "nowrap",
};

const closeButtonStyle: CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--text3)",
  cursor: "pointer",
  fontSize: 20,
  lineHeight: 1,
  padding: 0,
};

const sectionStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
};

const metaLabelStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text3)",
  marginBottom: 4,
};

const periodButtonStyle: CSSProperties = {
  border: "1px solid transparent",
  background: "none",
  fontFamily: "var(--font-cond)",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
  padding: "2px 5px",
};

const chartSkeletonStyle: CSSProperties = {
  height: 120,
  margin: "0 0 4px",
};

const tooltipStyle: CSSProperties = {
  background: "var(--bg3)",
  border: "1px solid var(--border2)",
  padding: "5px 8px",
};

const lotHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "70px 50px 70px 70px 70px 36px 52px 52px",
  gap: 4,
  padding: "3px 0",
  fontFamily: "var(--font-cond)",
  fontSize: 8,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text3)",
  borderBottom: "1px solid var(--border)",
  marginBottom: 2,
};

const lotRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "70px 50px 70px 70px 70px 36px 52px 52px",
  gap: 4,
  padding: "5px 0",
  borderBottom: "1px solid var(--border)",
  alignItems: "center",
};
