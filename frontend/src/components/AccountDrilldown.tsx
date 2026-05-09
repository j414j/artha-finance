import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { getAccountBalanceHistory } from "../api/accounts";
import { getGoals } from "../api/goals";
import { getHoldings } from "../api/investments";
import { getTransactions } from "../api/transactions";
import type { Account, BalanceHistoryPoint } from "../types/account";
import type { Goal } from "../types/goal";
import type { Holding } from "../types/investment";
import type { Transaction } from "../types/transaction";
import { formatDateDisplay, formatMoney } from "../utils/format";

const PERIODS = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "180D", days: 180 },
  { label: "1Y", days: 365 },
];

const INVESTMENT_TYPES = new Set(["demat", "mutual_fund"]);

export default function AccountDrilldown({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState(30);
  const [history, setHistory] = useState<BalanceHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [recentTxs, setRecentTxs] = useState<Transaction[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  const isInvestment = INVESTMENT_TYPES.has(account.type);

  // Load history when period changes
  useEffect(() => {
    setHistoryLoading(true);
    getAccountBalanceHistory(account.id, period)
      .then((res) => setHistory(res.balance_history))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [account.id, period]);

  // Load supplemental data once
  useEffect(() => {
    setDataLoading(true);
    const promises: Promise<void>[] = [
      getGoals()
        .then((res) => {
          const accountGoals = res.active_goals.filter(
            (g) => g.source_account_id === account.id,
          );
          setGoals(accountGoals);
        })
        .catch(() => setGoals([])),
      getTransactions({
        account_id: account.id,
        limit: 5,
        date_from: "2000-01-01",
      })
        .then((res) => setRecentTxs(res.transactions))
        .catch(() => setRecentTxs([])),
    ];

    if (isInvestment) {
      promises.push(
        getHoldings(account.id)
          .then((res) => setHoldings(res.holdings))
          .catch(() => setHoldings([])),
      );
    }

    Promise.all(promises).finally(() => setDataLoading(false));
  }, [account.id, isInvestment]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const holdingsValue = isInvestment
    ? holdings.reduce(
        (sum, h) => sum + (h.current_value_paise ?? h.invested_value_paise),
        0,
      )
    : 0;

  // For investment accounts, cash = total balance (cash+holdings) minus holdings value.
  // Must wait for holdings to load to avoid showing the wrong number.
  const cashBalance = isInvestment
    ? dataLoading
      ? null
      : account.balance_paise - holdingsValue
    : account.balance_paise;

  const totalBlockedPaise = goals.reduce(
    (sum, g) => sum + g.current_blocked_paise,
    0,
  );

  // For investment accounts, use total_paise (cash+holdings) so that buy/sell
  // transactions don't spuriously show as a negative "change".
  const hasMultiSeries = isInvestment && history.length > 0 && history[0].total_paise !== undefined;

  const chartValues = history.map((p) =>
    hasMultiSeries ? (p.total_paise ?? p.balance_paise) : p.balance_paise,
  );
  const minBalance = chartValues.length ? Math.min(...chartValues) : 0;
  const maxBalance = chartValues.length ? Math.max(...chartValues) : 0;

  const balanceChange =
    history.length >= 2
      ? hasMultiSeries
        ? (history[history.length - 1].total_paise ?? 0) - (history[0].total_paise ?? 0)
        : history[history.length - 1].balance_paise - history[0].balance_paise
      : 0;

  const chartColor =
    account.side === "liability" ? "var(--red)" : account.color_hex;

  const formatChartDate = (d: string) => {
    const parts = d.split("-");
    return `${parts[2]}/${parts[1]}`;
  };

  const formatChartMoney = (v: number) =>
    formatMoney(v, account.currency, true);

  return (
    <>
      {/* Backdrop */}
      <div style={backdropStyle} onClick={onClose} />

      {/* Panel */}
      <div ref={panelRef} style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                background: account.color_hex,
                flexShrink: 0,
              }}
            />
            <span style={headerTitleStyle}>{account.name}</span>
            <span style={typeBadgeStyle}>{account.type.replace("_", " ")}</span>
          </div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {/* Balance Section */}
          <div style={sectionStyle}>
            <div style={metaLabelStyle}>Current Balance</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 28,
                  color:
                    account.side === "liability"
                      ? "var(--red)"
                      : "var(--text)",
                  lineHeight: 1.1,
                }}
              >
                {formatMoney(account.balance_paise, account.currency)}
              </span>
              {account.currency !== "INR" && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    color: "var(--text3)",
                  }}
                >
                  {formatMoney(account.inr_value_paise)}
                </span>
              )}
            </div>
            {balanceChange !== 0 && !historyLoading && (
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: balanceChange > 0 ? "var(--green)" : "var(--red)",
                  marginTop: 3,
                }}
              >
                {balanceChange > 0 ? "+" : ""}
                {formatMoney(balanceChange, account.currency, true)} in {period}d
              </div>
            )}
          </div>

          {/* Balance History Chart */}
          <div style={{ borderBottom: "1px solid var(--border)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 14px 4px",
              }}
            >
              <span style={metaLabelStyle}>Balance History</span>
              <div style={{ display: "flex", gap: 2 }}>
                {PERIODS.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    onClick={() => setPeriod(p.days)}
                    style={{
                      ...periodButtonStyle,
                      color:
                        period === p.days ? "var(--text)" : "var(--text3)",
                      borderColor:
                        period === p.days
                          ? "var(--border2)"
                          : "transparent",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {historyLoading ? (
              <div style={chartSkeletonStyle} />
            ) : history.length === 0 ? (
              <div style={{ ...chartSkeletonStyle, color: "var(--text3)", fontSize: 10, fontFamily: "var(--font-cond)", letterSpacing: "0.08em", display: "flex", alignItems: "center", justifyContent: "center" }}>
                NO DATA
              </div>
            ) : (
              <div style={{ padding: "0 0 4px" }}>
                <ResponsiveContainer width="100%" height={hasMultiSeries ? 140 : 120}>
                  <AreaChart
                    data={history}
                    margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id={`grad-total-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chartColor} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id={`grad-holdings-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--green)" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="var(--green)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id={`grad-cash-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--text3)" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="var(--text3)" stopOpacity={0} />
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
                      domain={[
                        Math.floor(minBalance * 0.99),
                        Math.ceil(maxBalance * 1.01),
                      ]}
                      tickFormatter={formatChartMoney}
                      tick={{ fontSize: 8, fill: "var(--text3)", fontFamily: "var(--font-mono)" }}
                      tickLine={false}
                      axisLine={false}
                      width={60}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0].payload as BalanceHistoryPoint;
                        return (
                          <div style={tooltipStyle}>
                            <div style={{ color: "var(--text3)", fontSize: 9, fontFamily: "var(--font-cond)", letterSpacing: "0.08em", marginBottom: 3 }}>
                              {formatDateDisplay(point.date)}
                            </div>
                            {hasMultiSeries ? (
                              <>
                                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)", display: "flex", justifyContent: "space-between", gap: 10 }}>
                                  <span style={{ color: "var(--text3)", fontSize: 9 }}>TOTAL</span>
                                  {formatMoney(point.total_paise ?? 0, account.currency)}
                                </div>
                                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--green)", display: "flex", justifyContent: "space-between", gap: 10 }}>
                                  <span style={{ color: "var(--text3)", fontSize: 9 }}>HOLDINGS</span>
                                  {formatMoney(point.holdings_paise ?? 0, account.currency)}
                                </div>
                                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text2)", display: "flex", justifyContent: "space-between", gap: 10 }}>
                                  <span style={{ color: "var(--text3)", fontSize: 9 }}>CASH</span>
                                  {formatMoney(point.cash_paise ?? 0, account.currency)}
                                </div>
                              </>
                            ) : (
                              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)" }}>
                                {formatMoney(point.balance_paise, account.currency)}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    {hasMultiSeries ? (
                      <>
                        <Area
                          type="monotone"
                          dataKey="cash_paise"
                          stroke="var(--text3)"
                          strokeWidth={1}
                          strokeDasharray="3 3"
                          fill={`url(#grad-cash-${account.id})`}
                          dot={false}
                          activeDot={{ r: 2, fill: "var(--text3)" }}
                          name="Cash"
                        />
                        <Area
                          type="monotone"
                          dataKey="holdings_paise"
                          stroke="var(--green)"
                          strokeWidth={1}
                          fill={`url(#grad-holdings-${account.id})`}
                          dot={false}
                          activeDot={{ r: 2, fill: "var(--green)" }}
                          name="Holdings"
                        />
                        <Area
                          type="monotone"
                          dataKey="total_paise"
                          stroke={chartColor}
                          strokeWidth={1.5}
                          fill={`url(#grad-total-${account.id})`}
                          dot={false}
                          activeDot={{ r: 3, fill: chartColor }}
                          name="Total"
                        />
                      </>
                    ) : (
                      <Area
                        type="monotone"
                        dataKey="balance_paise"
                        stroke={chartColor}
                        strokeWidth={1.5}
                        fill={`url(#grad-total-${account.id})`}
                        dot={false}
                        activeDot={{ r: 3, fill: chartColor }}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
                {hasMultiSeries && (
                  <div style={{ display: "flex", gap: 12, padding: "2px 14px 4px", justifyContent: "flex-end" }}>
                    {[
                      { label: "Total", color: chartColor, dash: false },
                      { label: "Holdings", color: "var(--green)", dash: false },
                      { label: "Cash", color: "var(--text3)", dash: true },
                    ].map(({ label, color, dash }) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <svg width={16} height={8}>
                          <line
                            x1={0} y1={4} x2={16} y2={4}
                            stroke={color}
                            strokeWidth={dash ? 1 : 1.5}
                            strokeDasharray={dash ? "3 2" : undefined}
                          />
                        </svg>
                        <span style={{ fontFamily: "var(--font-cond)", fontSize: 8, color: "var(--text3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Investment: Cash + Holdings breakdown */}
          {isInvestment && (
            <div style={sectionStyle}>
              <div style={metaLabelStyle}>Investment Breakdown</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                <div style={kvRowStyle}>
                  <span style={kvLabelStyle}>Brokerage Cash</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
                    {cashBalance !== null ? formatMoney(cashBalance, account.currency) : "—"}
                  </span>
                </div>
                <div style={kvRowStyle}>
                  <span style={kvLabelStyle}>Holdings Value</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--green)" }}>
                    {dataLoading ? "—" : formatMoney(holdingsValue, account.currency)}
                  </span>
                </div>
              </div>

              {dataLoading ? (
                <div style={{ color: "var(--text3)", fontSize: 10, marginTop: 10 }}>Loading holdings…</div>
              ) : holdings.length === 0 ? (
                <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 8, fontFamily: "var(--font-cond)" }}>
                  No holdings in this account
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <div style={miniTableHeaderStyle}>
                    <span>Instrument</span>
                    <span>Qty</span>
                    <span style={{ textAlign: "right" }}>Value</span>
                    <span style={{ textAlign: "right" }}>P&amp;L</span>
                  </div>
                  {holdings.map((h) => {
                    const pnl = h.unrealised_pnl_paise ?? 0;
                    return (
                      <div key={h.instrument_id} style={miniTableRowStyle}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: "var(--font-cond)", fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {h.instrument_name}
                          </div>
                          {h.instrument_ticker && (
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)" }}>
                              {h.instrument_ticker}
                            </div>
                          )}
                        </div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text2)" }}>
                          {h.quantity_held.toLocaleString()}
                        </div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)", textAlign: "right" }}>
                          {formatMoney(h.current_value_paise ?? h.invested_value_paise, h.instrument_currency, true)}
                        </div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: pnl >= 0 ? "var(--green)" : "var(--red)", textAlign: "right" }}>
                          {pnl !== 0 ? `${pnl > 0 ? "+" : ""}${formatMoney(pnl, h.instrument_currency, true)}` : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Blocked Funds */}
          {goals.length > 0 && (
            <div style={sectionStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={metaLabelStyle}>Blocked Funds</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--amber, #c8a000)" }}>
                  {formatMoney(totalBlockedPaise)}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {goals.map((g) => (
                  <div key={g.id} style={kvRowStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          background: g.color_hex,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 12, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {g.name}
                      </span>
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--amber, #c8a000)", flexShrink: 0 }}>
                      {formatMoney(g.current_blocked_paise, "INR", true)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Transactions */}
          <div style={sectionStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={metaLabelStyle}>Recent Transactions</span>
              <button
                type="button"
                onClick={() => navigate(`/transactions?account_id=${account.id}`)}
                style={viewAllButtonStyle}
              >
                View All →
              </button>
            </div>

            {dataLoading ? (
              <div style={{ color: "var(--text3)", fontSize: 10 }}>Loading…</div>
            ) : recentTxs.length === 0 ? (
              <div style={{ color: "var(--text3)", fontSize: 11, fontFamily: "var(--font-cond)" }}>
                No transactions found
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {recentTxs.map((tx) => {
                  const isDebit =
                    tx.account_id === account.id &&
                    !["income", "dividend", "investment_sell"].includes(tx.type);
                  const isCreditCardExpense =
                    account.type === "credit_card" && tx.type === "expense";
                  const amtColor = isDebit && !isCreditCardExpense
                    ? "var(--red)"
                    : "var(--green)";
                  return (
                    <div key={tx.id} style={txRowStyle}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tx.description}
                        </div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", marginTop: 1 }}>
                          {formatDateDisplay(tx.date)} · {tx.type.replace(/_/g, " ")}
                        </div>
                      </div>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          color: amtColor,
                          flexShrink: 0,
                        }}
                      >
                        {isDebit && !isCreditCardExpense ? "-" : "+"}
                        {formatMoney(tx.amount_paise, account.currency, true)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Account Notes */}
          {account.notes && (
            <div style={{ ...sectionStyle, borderBottom: "none" }}>
              <div style={metaLabelStyle}>Notes</div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4, lineHeight: 1.5 }}>
                {account.notes}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

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
  width: 460,
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

const kvRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const kvLabelStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 11,
  color: "var(--text3)",
  letterSpacing: "0.04em",
};

const miniTableHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 50px 70px 70px",
  gap: 6,
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

const miniTableRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 50px 70px 70px",
  gap: 6,
  padding: "5px 0",
  borderBottom: "1px solid var(--border)",
  alignItems: "center",
};

const txRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "6px 0",
  borderBottom: "1px solid var(--border)",
};

const viewAllButtonStyle: CSSProperties = {
  border: "none",
  background: "none",
  fontFamily: "var(--font-cond)",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--accent)",
  cursor: "pointer",
  padding: 0,
};
