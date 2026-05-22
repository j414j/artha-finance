import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  getBaseBudget,
  getBudget,
  getBudgetHistory,
  updateBaseBudget,
  updateMonthlyBudget,
} from "../api/budget";
import { ApiError } from "../api/client";
import Button from "../components/Button";
import ProgressBar from "../components/ProgressBar";
import type {
  BudgetAllocationPayload,
  BudgetBaseAllocation,
  BudgetCategory,
  BudgetHistory,
  BudgetItem,
  BudgetMonth,
  BudgetMonthAllocation,
  BudgetStatus,
  SavingsRatePoint,
  UnbudgetedSpend,
} from "../types/budget";
import { formatMoney, paiseToInput, parseMoneyInput } from "../utils/format";

interface Period {
  year: number;
  month: number;
}

interface BudgetFormRow {
  category_id: string;
  category: BudgetCategory;
  amount: string;
  is_manual_override?: boolean;
  dirty?: boolean;
}

type ModalMode = "base" | "monthly";

export default function BudgetPage() {
  const isMobile = useIsMobile();
  const [period, setPeriod] = useState<Period>(() => currentPeriod());
  const [budget, setBudget] = useState<BudgetMonth | null>(null);
  const [baseAllocations, setBaseAllocations] = useState<BudgetBaseAllocation[]>([]);
  const [history, setHistory] = useState<BudgetHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [formRows, setFormRows] = useState<BudgetFormRow[]>([]);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadBudget = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [budgetResponse, baseResponse, historyResponse] = await Promise.all([
        getBudget(period.year, period.month),
        getBaseBudget(),
        getBudgetHistory(period.year, period.month, 6),
      ]);
      setBudget(budgetResponse.budget);
      setBaseAllocations(baseResponse.allocations);
      setHistory(historyResponse.history);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load budget");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void loadBudget();
  }, [loadBudget]);

  const openBaseModal = () => {
    setFormRows(rowsFromBase(baseAllocations));
    setFormError("");
    setModalMode("base");
  };

  const openMonthlyModal = () => {
    const rows =
      budget && budget.allocations.length > 0
        ? rowsFromMonthly(budget.allocations)
        : rowsFromBase(baseAllocations);
    setFormRows(rows);
    setFormError("");
    setModalMode("monthly");
  };

  const closeModal = () => {
    if (saving) return;
    setModalMode(null);
    setFormError("");
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!modalMode) return;
    setSaving(true);
    setFormError("");

    try {
      const payload = buildAllocationPayload(formRows, modalMode);
      if (modalMode === "base") {
        await updateBaseBudget(payload);
      } else {
        await updateMonthlyBudget(period.year, period.month, payload);
      }
      setModalMode(null);
      await loadBudget();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to save budget");
    } finally {
      setSaving(false);
    }
  };

  const moveMonth = (delta: number) => setPeriod((current) => addMonths(current, delta));

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)" }}>
      <MonthBar
        budget={budget}
        period={period}
        loading={loading}
        onPrev={() => moveMonth(-1)}
        onNext={() => moveMonth(1)}
        onBase={openBaseModal}
        onMonthly={openMonthlyModal}
        isMobile={isMobile}
      />

      {error && (
        <div style={noticeStyle("error")}>
          {error}
          <button onClick={() => void loadBudget()} style={noticeButtonStyle}>
            Retry
          </button>
        </div>
      )}

      <div style={isMobile ? mobileLayoutStyle : budgetLayoutStyle}>
        <main style={{ background: "var(--bg2)", minWidth: 0 }}>
          {budget && <SummaryStrip budget={budget} isMobile={isMobile} />}

          {loading ? (
            <EmptyPanel label="Loading budget" />
          ) : budget && budget.items.length > 0 ? (
            <BudgetCards items={budget.items} />
          ) : (
            <EmptyPanel label="No budget allocations" action={openBaseModal} />
          )}

          {!isMobile && <HistoryTable history={history} loading={loading} />}

          {isMobile && <BudgetSidebar budget={budget} history={history} loading={loading} isMobile />}
        </main>

        {!isMobile && <BudgetSidebar budget={budget} history={history} loading={loading} />}
      </div>

      {modalMode && (
        <BudgetEditorModal
          mode={modalMode}
          period={period}
          rows={formRows}
          error={formError}
          saving={saving}
          onRowsChange={setFormRows}
          onClose={closeModal}
          onSubmit={handleSave}
        />
      )}
    </div>
  );
}

function MonthBar({
  budget,
  period,
  loading,
  onPrev,
  onNext,
  onBase,
  onMonthly,
  isMobile,
}: {
  budget: BudgetMonth | null;
  period: Period;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onBase: () => void;
  onMonthly: () => void;
  isMobile: boolean;
}) {
  const label = budget?.month_label ?? `${monthName(period.month)} ${period.year}`;
  const elapsed = budget?.summary.days_elapsed ?? 0;
  const days = budget?.summary.days_in_month ?? daysInMonth(period);
  const expected = budget?.summary.expected_pct ?? 0;

  if (isMobile) {
    return (
      <div style={mobileMonthBarStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Button variant="ghost" size="sm" onClick={onPrev} title="Previous month">
            ◀
          </Button>
          <span style={mobileMonthTitleStyle}>{label.toUpperCase()}</span>
          <Button variant="ghost" size="sm" onClick={onNext} title="Next month">
            ▶
          </Button>
        </div>
        <span style={mobileElapsedStyle}>
          {elapsed}/{days} ({formatPct(expected)})
        </span>
        <div style={{ display: "flex", gap: 4, width: "100%", marginTop: 6 }}>
          <Button size="sm" variant="ghost" onClick={onMonthly} disabled={loading} style={{ flex: 1 }}>
            Override
          </Button>
          <Button size="sm" onClick={onBase} disabled={loading} style={{ flex: 1 }}>
            Edit
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={monthBarStyle}>
      <Button variant="ghost" size="sm" onClick={onPrev} title="Previous month">
        ◀
      </Button>
      <span style={monthTitleStyle}>{label.toUpperCase()}</span>
      <Button variant="ghost" size="sm" onClick={onNext} title="Next month">
        ▶
      </Button>
      <span style={elapsedStyle}>
        {elapsed} days elapsed / {days} ({formatPct(expected)})
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        <Button variant="ghost" onClick={onMonthly} disabled={loading}>
          Monthly Override
        </Button>
        <Button onClick={onBase} disabled={loading}>
          Edit Base Budget
        </Button>
      </div>
    </div>
  );
}

function SummaryStrip({ budget, isMobile }: { budget: BudgetMonth; isMobile?: boolean }) {
  const metrics = [
    {
      label: "Total Budget",
      value: formatMoney(budget.summary.total_budget_paise),
      color: "var(--text)",
      sub: null,
    },
    {
      label: "Spent",
      value: formatMoney(budget.summary.spent_paise),
      color: "var(--red)",
      sub: null,
    },
    {
      label: "Remaining",
      value: formatMoney(budget.summary.remaining_paise),
      color: budget.summary.remaining_paise < 0 ? "var(--red)" : "var(--green)",
      sub: null,
    },
    {
      label: "% Used",
      value: formatPct(budget.summary.used_pct),
      color: "var(--accent)",
      sub: `expected: ${formatPct(budget.summary.expected_pct)}`,
    },
  ];

  return (
    <div style={isMobile ? mobileSummaryGridStyle : summaryGridStyle}>
      {metrics.map((metric) => (
        <div key={metric.label} style={summaryCellStyle}>
          <MetricLabel>{metric.label}</MetricLabel>
          <div style={{ ...metricValueStyle, color: metric.color }}>{metric.value}</div>
          {metric.sub && <div style={metricSubStyle}>{metric.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function BudgetCards({ items }: { items: BudgetItem[] }) {
  return (
    <div style={cardsGridStyle}>
      {items.map((item) => {
        const color = statusColor(item.status);
        const variant = progressVariant(item.status);
        return (
          <div
            key={item.category_id}
            style={{
              ...budgetCardStyle,
              border:
                item.status === "over_budget"
                  ? "1px solid rgba(240,64,96,.25)"
                  : "1px solid transparent",
            }}
          >
            <div style={cardHeaderStyle}>
              <span style={categoryNameStyle}>
                <CategoryMark category={item.category} /> {item.category.name}
              </span>
              <span style={{ ...monoTinyStyle, color }}>{formatPct(item.used_pct)}</span>
            </div>
            <div style={{ marginBottom: 6 }}>
              <ProgressBar value={item.used_pct} variant={variant} />
            </div>
            <div style={amountLineStyle}>
              <span
                style={{
                  color: item.status === "over_budget" ? "var(--red)" : "var(--text2)",
                }}
              >
                {formatMoney(item.spent_paise)}
              </span>
              <span style={{ color: "var(--text3)" }}>
                / {formatMoney(item.allocated_paise)}
              </span>
            </div>
            <div style={{ ...statusLineStyle, color }}>
              {statusLabel(item)}
              {item.is_manual_override && <span style={overrideTagStyle}>OVR</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HistoryTable({
  history,
  loading,
}: {
  history: BudgetHistory | null;
  loading: boolean;
}) {
  return (
    <section>
      <SectionHeader>Budget History — Last 6 Months</SectionHeader>
      {loading ? (
        <EmptyPanel label="Loading history" compact />
      ) : !history || history.rows.length === 0 ? (
        <EmptyPanel label="No budget history" compact />
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>Category</Th>
              {history.months.map((month, index) => (
                <Th key={`${month.year}-${month.month}`} align="right">
                  <span
                    style={{
                      color:
                        index === history.months.length - 1
                          ? "var(--accent)"
                          : "var(--text3)",
                    }}
                  >
                    {month.label}
                  </span>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.rows.map((row) => (
              <tr key={row.category_id}>
                <Td>
                  <CategoryMark category={row.category} /> {row.category.name}
                </Td>
                {history.months.map((month) => {
                  const value = row.values.find(
                    (candidate) =>
                      candidate.year === month.year && candidate.month === month.month,
                  );
                  return (
                    <Td
                      key={`${row.category_id}-${month.year}-${month.month}`}
                      align="right"
                      mono
                      color={historyColor(value?.used_pct ?? null)}
                    >
                      {value?.used_pct == null ? "—" : formatPct(value.used_pct)}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BudgetSidebar({
  budget,
  history,
  loading,
  isMobile,
}: {
  budget: BudgetMonth | null;
  history: BudgetHistory | null;
  loading: boolean;
  isMobile?: boolean;
}) {
  const trend = history?.savings_rate_trend ?? [];
  const average = averageRate(trend);
  const best = bestRate(trend);

  if (isMobile) {
    return (
      <section style={{ background: "var(--bg2)", paddingBottom: 16 }}>
        <SectionHeader>Savings Rate Trend</SectionHeader>
        <div style={{ padding: 12 }}>
          {loading ? <EmptyPanel label="Loading trend" compact /> : <SavingsChart trend={trend} />}
          <div style={sidebarMetricListStyle}>
            <SidebarMetric
              label="This Month"
              value={formatNullablePct(budget?.savings.savings_rate_pct ?? null)}
              color="var(--green)"
            />
            <SidebarMetric
              label="6M Average"
              value={formatNullablePct(average)}
              color="var(--text2)"
            />
            <SidebarMetric
              label="Best Month"
              value={best ? `${formatPct(best.savings_rate_pct ?? 0)} (${best.label})` : "—"}
              color="var(--green)"
            />
          </div>
        </div>
        <SectionHeader>Unbudgeted Spend</SectionHeader>
        <UnbudgetedTable rows={budget?.unbudgeted ?? []} loading={loading} />
        <div style={{ marginTop: 16 }}>
          <SectionHeader>Budget History — Last 6 Months</SectionHeader>
        </div>
        {loading ? (
          <EmptyPanel label="Loading history" compact />
        ) : !history || history.rows.length === 0 ? (
          <EmptyPanel label="No budget history" compact />
        ) : (
          <div style={{ padding: "10px 16px" }}>
            {history.rows.map((row) => (
              <div key={row.category_id} style={mobileHistoryRowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={mobileHistoryCategoryStyle}>
                    <CategoryMark category={row.category} /> {row.category.name}
                  </div>
                  <div style={mobileHistoryValuesStyle}>
                    {history.months.map((month, idx) => {
                      const value = row.values.find(
                        (v) => v.year === month.year && v.month === month.month,
                      );
                      return (
                        <span key={`${month.year}-${month.month}`} style={mobileHistoryValueStyle}>
                          {month.label}: {value?.used_pct == null ? "—" : formatPct(value.used_pct)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <aside style={sidebarStyle}>
      <SectionHeader>Savings Rate Trend</SectionHeader>
      <div style={{ padding: 12 }}>
        {loading ? <EmptyPanel label="Loading trend" compact /> : <SavingsChart trend={trend} />}
        <div style={sidebarMetricListStyle}>
          <SidebarMetric
            label="This Month"
            value={formatNullablePct(budget?.savings.savings_rate_pct ?? null)}
            color="var(--green)"
          />
          <SidebarMetric
            label="6M Average"
            value={formatNullablePct(average)}
            color="var(--text2)"
          />
          <SidebarMetric
            label="Best Month"
            value={best ? `${formatPct(best.savings_rate_pct ?? 0)} (${best.label})` : "—"}
            color="var(--green)"
          />
        </div>
      </div>
      <SectionHeader>Unbudgeted Spend</SectionHeader>
      <UnbudgetedTable rows={budget?.unbudgeted ?? []} loading={loading} />
    </aside>
  );
}

function SavingsChart({ trend }: { trend: SavingsRatePoint[] }) {
  const width = 240;
  const height = 120;
  const top = 12;
  const bottom = 18;
  const left = 22;
  const right = 8;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const points = trend.map((point, index) => {
    const x =
      trend.length <= 1 ? left + plotWidth / 2 : left + (plotWidth * index) / (trend.length - 1);
    const rate = Math.max(0, Math.min(80, point.savings_rate_pct ?? 0));
    const y = top + plotHeight - (rate / 80) * plotHeight;
    return { x, y, point };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area =
    points.length > 1
      ? `${polyline} ${points[points.length - 1].x},${height - bottom} ${points[0].x},${
          height - bottom
        }`
      : "";

  return (
    <svg width="100%" height="120" viewBox={`0 0 ${width} ${height}`} role="img">
      {[20, 40, 60].map((tick) => {
        const y = top + plotHeight - (tick / 80) * plotHeight;
        return (
          <g key={tick}>
            <line x1={left} y1={y} x2={width - right} y2={y} stroke="var(--border)" />
            <text x="2" y={y - 2} fontSize="7" fill="var(--text3)">
              {tick}%
            </text>
          </g>
        );
      })}
      {area && <polygon points={area} fill="var(--green)" opacity="0.12" />}
      {polyline && (
        <polyline points={polyline} fill="none" stroke="var(--green)" strokeWidth="2" />
      )}
      {points.map(({ x, point }, index) => (
        <text
          key={`${point.year}-${point.month}`}
          x={x - 7}
          y={height - 3}
          fontSize="7"
          fill={index === points.length - 1 ? "var(--accent)" : "var(--text3)"}
        >
          {point.label}
        </text>
      ))}
    </svg>
  );
}

function UnbudgetedTable({
  rows,
  loading,
}: {
  rows: UnbudgetedSpend[];
  loading: boolean;
}) {
  if (loading) return <EmptyPanel label="Loading spend" compact />;
  if (rows.length === 0) return <EmptyPanel label="No unbudgeted spend" compact />;

  return (
    <div style={{ padding: "10px 12px" }}>
      <table style={tableStyle}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category_id ?? row.category_name}>
              <Td color="var(--text2)">
                <span style={{ color: row.color_hex }}>■</span> {row.category_name}
              </Td>
              <Td align="right" mono color="var(--red)">
                {formatMoney(row.spent_paise)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetEditorModal({
  mode,
  period,
  rows,
  error,
  saving,
  onRowsChange,
  onClose,
  onSubmit,
}: {
  mode: ModalMode;
  period: Period;
  rows: BudgetFormRow[];
  error: string;
  saving: boolean;
  onRowsChange: (rows: BudgetFormRow[]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const isMobile = useIsMobile();
  const title =
    mode === "base"
      ? "Edit Base Budget"
      : `Monthly Override — ${monthName(period.month)} ${period.year}`;

  const updateRow = (categoryId: string, amount: string) => {
    onRowsChange(
      rows.map((row) =>
        row.category_id === categoryId ? { ...row, amount, dirty: true } : row,
      ),
    );
  };

  return (
    <div style={modalBackdropStyle} onMouseDown={onClose}>
      <form
        style={isMobile ? mobileModalStyle : modalStyle}
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <div>{title}</div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ×
          </button>
        </div>
        <div style={{ padding: 14, overflowY: "auto", maxHeight: isMobile ? "85vh" : "auto" }}>
          {error && <div style={noticeStyle("error")}>{error}</div>}
          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {rows.map((row) => (
                <div key={row.category_id} style={mobileFormRowStyle}>
                  <div>
                    <div style={mobileFormLabelStyle}>
                      <CategoryMark category={row.category} /> {row.category.name}
                    </div>
                    {mode === "monthly" && (
                      <div style={mobileFormModeStyle}>
                        {row.dirty || row.is_manual_override ? "Override" : "Snapshot"}
                      </div>
                    )}
                  </div>
                  <input
                    value={row.amount}
                    onChange={(event) => updateRow(row.category_id, event.target.value)}
                    inputMode="decimal"
                    style={mobileAmountInputStyle}
                  />
                </div>
              ))}
            </div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th align="right">Monthly Limit</Th>
                  {mode === "monthly" && <Th align="right">Mode</Th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.category_id}>
                    <Td>
                      <CategoryMark category={row.category} /> {row.category.name}
                    </Td>
                    <Td align="right">
                      <input
                        value={row.amount}
                        onChange={(event) => updateRow(row.category_id, event.target.value)}
                        inputMode="decimal"
                        style={amountInputStyle}
                      />
                    </Td>
                    {mode === "monthly" && (
                      <Td align="right" color="var(--text3)">
                        {row.dirty || row.is_manual_override ? "Override" : "Snapshot"}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={modalFooterStyle}>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Budget"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function CategoryMark({ category }: { category: BudgetCategory }) {
  return (
    <span
      style={{
        color: category.color_hex,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        display: "inline-block",
        minWidth: 14,
      }}
    >
      {category.icon_emoji ?? "■"}
    </span>
  );
}

function SidebarMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div style={sidebarMetricStyle}>
      <span style={{ color: "var(--text3)" }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}

function EmptyPanel({
  label,
  action,
  compact = false,
}: {
  label: string;
  action?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        padding: compact ? "14px 12px" : "28px 14px",
        color: "var(--text3)",
        fontFamily: "var(--font-cond)",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {label}
      {action && (
        <Button onClick={action} size="sm" style={{ marginLeft: 10 }}>
          Edit Base
        </Button>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return <div style={sectionHeaderStyle}>{children}</div>;
}

function MetricLabel({ children }: { children: ReactNode }) {
  return <div style={metricLabelStyle}>{children}</div>;
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "6px 10px",
        borderBottom: "1px solid var(--border)",
        color: "var(--text3)",
        fontFamily: "var(--font-cond)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
  color = "var(--text2)",
}: {
  children: ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  color?: string;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "6px 10px",
        borderBottom: "1px solid var(--border)",
        color,
        fontFamily: mono ? "var(--font-mono)" : "var(--font)",
        fontSize: mono ? 10 : 11,
      }}
    >
      {children}
    </td>
  );
}

function rowsFromBase(allocations: BudgetBaseAllocation[]): BudgetFormRow[] {
  return allocations.map((allocation) => ({
    category_id: allocation.category_id,
    category: allocation.category,
    amount: allocation.amount_paise === 0 ? "" : paiseToInput(allocation.amount_paise),
  }));
}

function rowsFromMonthly(allocations: BudgetMonthAllocation[]): BudgetFormRow[] {
  return allocations.map((allocation) => ({
    category_id: allocation.category_id,
    category: allocation.category,
    amount: allocation.amount_paise === 0 ? "" : paiseToInput(allocation.amount_paise),
    is_manual_override: allocation.is_manual_override,
  }));
}

function buildAllocationPayload(
  rows: BudgetFormRow[],
  mode: ModalMode,
): BudgetAllocationPayload[] {
  return rows
    .filter((row) => mode === "base" || row.dirty)
    .map((row) => ({
      category_id: row.category_id,
      amount_paise: row.amount.trim() ? parseMoneyInput(row.amount) : 0,
    }));
}

function statusLabel(item: BudgetItem): string {
  if (item.status === "over_budget") return `Over by ${formatMoney(Math.abs(item.remaining_paise))}`;
  if (item.status === "near_limit") return "Near limit";
  if (item.status === "ahead_of_pace") return "Ahead of pace";
  if (item.status === "well_within") return "Well within";
  return "On track";
}

function statusColor(status: BudgetStatus): string {
  if (status === "over_budget") return "var(--red)";
  if (status === "near_limit" || status === "ahead_of_pace") return "var(--accent)";
  return "var(--green)";
}

function progressVariant(status: BudgetStatus): "green" | "amber" | "red" {
  if (status === "over_budget") return "red";
  if (status === "near_limit" || status === "ahead_of_pace") return "amber";
  return "green";
}

function historyColor(value: number | null): string {
  if (value == null) return "var(--text3)";
  if (value > 100) return "var(--red)";
  if (value >= 90) return "var(--accent)";
  return "var(--green)";
}

function averageRate(trend: SavingsRatePoint[]): number | null {
  const values = trend
    .map((point) => point.savings_rate_pct)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bestRate(trend: SavingsRatePoint[]): SavingsRatePoint | null {
  return trend.reduce<SavingsRatePoint | null>((best, point) => {
    if (point.savings_rate_pct === null) return best;
    if (!best || point.savings_rate_pct > (best.savings_rate_pct ?? -Infinity)) {
      return point;
    }
    return best;
  }, null);
}

function formatNullablePct(value: number | null): string {
  return value === null ? "—" : formatPct(value);
}

function formatPct(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function currentPeriod(): Period {
  const today = new Date();
  return { year: today.getFullYear(), month: today.getMonth() + 1 };
}

function addMonths(period: Period, delta: number): Period {
  const date = new Date(period.year, period.month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function daysInMonth(period: Period): number {
  return new Date(period.year, period.month, 0).getDate();
}

function monthName(month: number): string {
  return [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][month - 1];
}

function noticeStyle(kind: "error"): CSSProperties {
  return {
    margin: 0,
    padding: "8px 12px",
    background: kind === "error" ? "rgba(240,64,96,0.08)" : "var(--bg3)",
    borderBottom: "1px solid var(--border)",
    color: kind === "error" ? "var(--red)" : "var(--text2)",
    fontSize: 11,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  };
}

const budgetLayoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 300px",
  gap: 1,
  minHeight: "calc(100vh - 90px)",
  background: "var(--border)",
};

const monthBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 14px",
  background: "var(--bg2)",
  borderBottom: "1px solid var(--border)",
};

const monthTitleStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.06em",
  color: "var(--text)",
};

const elapsedStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--text3)",
  marginLeft: 4,
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 1,
  background: "var(--border)",
  borderBottom: "1px solid var(--border)",
};

const summaryCellStyle: CSSProperties = {
  background: "var(--bg3)",
  padding: "8px 12px",
};

const metricLabelStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text3)",
};

const metricValueStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 16,
  marginTop: 2,
  lineHeight: 1.15,
};

const metricSubStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  color: "var(--text3)",
};

const cardsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
  gap: 1,
  background: "var(--border)",
};

const budgetCardStyle: CSSProperties = {
  background: "var(--bg2)",
  padding: "10px 12px",
  minHeight: 86,
};

const cardHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 6,
};

const categoryNameStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const monoTinyStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  flexShrink: 0,
};

const amountLineStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontFamily: "var(--font-mono)",
  fontSize: 10,
};

const statusLineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  marginTop: 3,
};

const overrideTagStyle: CSSProperties = {
  color: "var(--accent)",
  border: "1px solid rgba(240,165,0,0.28)",
  padding: "0 3px",
  fontSize: 8,
};

const sectionHeaderStyle: CSSProperties = {
  background: "var(--bg3)",
  borderTop: "1px solid var(--border)",
  borderBottom: "1px solid var(--border)",
  padding: "6px 10px",
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.09em",
  color: "var(--text2)",
};

const sidebarStyle: CSSProperties = {
  background: "var(--bg2)",
  borderLeft: "1px solid var(--border)",
  minWidth: 0,
};

const sidebarMetricListStyle: CSSProperties = {
  marginTop: 6,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const sidebarMetricStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontFamily: "var(--font-mono)",
  fontSize: 10,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const noticeButtonStyle: CSSProperties = {
  border: "1px solid var(--border2)",
  background: "none",
  color: "var(--text2)",
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  textTransform: "uppercase",
  cursor: "pointer",
  padding: "3px 8px",
};

const modalBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.58)",
  zIndex: 2000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalStyle: CSSProperties = {
  width: 680,
  maxWidth: "100%",
  maxHeight: "92vh",
  overflowY: "auto",
  background: "var(--bg2)",
  border: "1px solid var(--border2)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
};

const modalHeaderStyle: CSSProperties = {
  height: 38,
  borderBottom: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 14px",
  fontFamily: "var(--font-cond)",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "var(--text2)",
};

const closeButtonStyle: CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--text3)",
  cursor: "pointer",
  fontSize: 20,
  lineHeight: 1,
};

const amountInputStyle: CSSProperties = {
  width: 110,
  background: "var(--bg3)",
  border: "1px solid var(--border2)",
  color: "var(--text)",
  padding: "4px 7px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  outline: "none",
  textAlign: "right",
  borderRadius: 2,
};

const modalFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 12,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};

const mobileLayoutStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: "calc(100vh - 90px)",
  background: "var(--border)",
};

const mobileMonthBarStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "8px 14px",
  background: "var(--bg2)",
  borderBottom: "1px solid var(--border)",
};

const mobileMonthTitleStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.06em",
  color: "var(--text)",
};

const mobileElapsedStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  color: "var(--text3)",
};

const mobileSummaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 1,
  background: "var(--border)",
  borderBottom: "1px solid var(--border)",
};

const mobileModalStyle: CSSProperties = {
  width: "100vw",
  maxHeight: "95vh",
  background: "var(--bg2)",
  border: "1px solid var(--border2)",
  borderRadius: 0,
};

const mobileFormRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  gap: 8,
  paddingBottom: 8,
  borderBottom: "1px solid var(--border)",
};

const mobileFormLabelStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text)",
  marginBottom: 4,
};

const mobileFormModeStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  color: "var(--text3)",
};

const mobileAmountInputStyle: CSSProperties = {
  width: 100,
  background: "var(--bg3)",
  border: "1px solid var(--border2)",
  color: "var(--text)",
  padding: "4px 7px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  outline: "none",
  textAlign: "right",
  borderRadius: 2,
};

const mobileHistoryRowStyle: CSSProperties = {
  padding: "10px 0",
  borderBottom: "1px solid var(--border)",
};

const mobileHistoryCategoryStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text)",
  marginBottom: 4,
};

const mobileHistoryValuesStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const mobileHistoryValueStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  color: "var(--text2)",
};
