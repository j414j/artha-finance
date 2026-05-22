import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import {
  createFxRate,
  deleteFxRate,
  getFxRates,
  getLatestFxRates,
} from "../api/fx_rates";
import { ApiError } from "../api/client";
import Button from "../components/Button";
import Input from "../components/Input";
import type { FxRate, LatestFxRate } from "../types/fx_rate";
import { formatDateDisplay } from "../utils/format";
import { useIsMobile } from "../hooks/useIsMobile";

interface FxFormState {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  date: string;
  notes: string;
}

function blankForm(): FxFormState {
  return {
    fromCurrency: "USD",
    toCurrency: "INR",
    rate: "",
    date: todayInputDate(),
    notes: "",
  };
}

export default function FxRatesPage() {
  const isMobile = useIsMobile();
  const [rates, setRates] = useState<FxRate[]>([]);
  const [latest, setLatest] = useState<LatestFxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FxFormState>(blankForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadRates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [historyRes, latestRes] = await Promise.all([
        getFxRates(),
        getLatestFxRates(),
      ]);
      setRates(historyRes.fx_rates);
      setLatest(latestRes.latest);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load FX rates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  const pairs = useMemo(() => {
    const map = new Map<string, LatestFxRate>();
    for (const rate of latest) {
      map.set(`${rate.from_currency}/${rate.to_currency}`, rate);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [latest]);

  const update = <K extends keyof FxFormState>(key: K, value: FxFormState[K]) =>
    setForm({ ...form, [key]: value });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      await createFxRate({
        from_currency: normalizeCurrency(form.fromCurrency, "From currency"),
        to_currency: normalizeCurrency(form.toCurrency, "To currency"),
        rate: parseRateInput(form.rate),
        date: form.date,
        notes: form.notes.trim() || null,
      });
      setForm({ ...form, rate: "", notes: "", date: todayInputDate() });
      await loadRates();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to save FX rate");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rate: FxRate) => {
    const confirmed = window.confirm(
      `Delete ${rate.from_currency}/${rate.to_currency} ${rate.rate} for ${formatDateDisplay(rate.date)}?`,
    );
    if (!confirmed) return;

    setDeletingId(rate.id);
    setError("");
    try {
      await deleteFxRate(rate.id);
      await loadRates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to delete FX rate");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)" }}>
      <div
        style={{
          display: isMobile ? "flex" : "grid",
          flexDirection: isMobile ? "column" : undefined,
          gridTemplateColumns: isMobile ? undefined : "minmax(0, 1fr) 300px",
          gap: 1,
          minHeight: "100%",
          background: "var(--border)",
        }}
      >
        <main style={{ background: "var(--bg2)", minWidth: 0 }}>
          <SummaryStrip latest={latest} historyCount={rates.length} isMobile={isMobile} />

          <form
            onSubmit={handleSubmit}
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr" : "110px 110px 1fr 140px 1.2fr 130px",
              gap: isMobile ? 8 : 8,
              padding: 10,
              borderBottom: "1px solid var(--border)",
              alignItems: isMobile ? "start" : "end",
            }}
          >
            <Input
              label="From"
              value={form.fromCurrency}
              onChange={(event) =>
                update("fromCurrency", event.target.value.toUpperCase())
              }
              maxLength={10}
              required
            />
            <Input
              label="To"
              value={form.toCurrency}
              onChange={(event) =>
                update("toCurrency", event.target.value.toUpperCase())
              }
              maxLength={10}
              required
            />
            <Input
              label="Rate"
              value={form.rate}
              inputMode="decimal"
              onChange={(event) => update("rate", event.target.value)}
              required
            />
            <Input
              label="Date"
              type="date"
              value={form.date}
              onChange={(event) => update("date", event.target.value)}
              required
            />
            <div style={{ gridColumn: isMobile ? "1 / -1" : undefined }}>
              <Input
                label="Notes"
                value={form.notes}
                onChange={(event) => update("notes", event.target.value)}
              />
            </div>
            <div style={{ gridColumn: isMobile ? "1 / -1" : undefined }}>
              <Button type="submit" disabled={saving} style={{ width: "100%" }}>
                {saving ? "Saving" : "Record Rate"}
              </Button>
            </div>
          </form>

          {formError && <Notice kind="error">{formError}</Notice>}
          {error && (
            <Notice kind="error">
              {error}
              <button
                type="button"
                onClick={() => void loadRates()}
                style={noticeButtonStyle}
              >
                Retry
              </button>
            </Notice>
          )}

          {loading ? (
            <EmptyPanel label="Loading FX rates" />
          ) : rates.length === 0 ? (
            <EmptyPanel label="No FX rates recorded" />
          ) : (
            <FxRateTable
              rates={rates}
              deletingId={deletingId}
              onDelete={handleDelete}
              isMobile={isMobile}
            />
          )}
        </main>

        <aside
          style={{
            background: "var(--bg2)",
            borderLeft: isMobile ? "none" : "1px solid var(--border)",
            borderTop: isMobile ? "1px solid var(--border)" : "none",
            minWidth: 0,
          }}
        >
          <SectionHeader>Latest Pairs</SectionHeader>
          <div style={{ padding: 12 }}>
            {pairs.length === 0 ? (
              <div style={mutedTextStyle}>No active pairs</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pairs.map(([pair, rate]) => (
                  <button
                    key={pair}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        fromCurrency: rate.from_currency,
                        toCurrency: rate.to_currency,
                        rate: formatRateInput(rate.rate),
                      })
                    }
                    style={isMobile ? mobilePairButtonStyle : pairButtonStyle}
                  >
                    <span style={{ color: "var(--text2)" }}>{pair}</span>
                    <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>
                      {formatRateInput(rate.rate)}
                    </span>
                    <span style={{ color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                      {formatDateDisplay(rate.date)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryStrip({
  latest,
  historyCount,
  isMobile,
}: {
  latest: LatestFxRate[];
  historyCount: number;
  isMobile: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, minmax(0, 1fr))",
        gap: 1,
        background: "var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Metric label="Pairs" value={String(latest.length)} />
      <Metric label="History Rows" value={String(historyCount)} />
      <Metric label="Base Currency" value="INR" color="var(--accent)" />
    </div>
  );
}

function Metric({
  label,
  value,
  color = "var(--text)",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ background: "var(--bg3)", padding: "10px 14px" }}>
      <MetricLabel>{label}</MetricLabel>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 21,
          color,
          marginTop: 6,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function FxRateTable({
  rates,
  deletingId,
  onDelete,
  isMobile,
}: {
  rates: FxRate[];
  deletingId: string | null;
  onDelete: (rate: FxRate) => void;
  isMobile: boolean;
}) {
  if (isMobile) {
    return (
      <div style={{ padding: "12px" }}>
        {rates.map((rate) => (
          <div
            key={rate.id}
            style={{
              borderBottom: "1px solid var(--border)",
              paddingBottom: 12,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--text)",
                  fontWeight: 600,
                }}
              >
                {rate.from_currency}/{rate.to_currency}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--text)",
                }}
              >
                {formatRateInput(rate.rate)}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 11,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span style={{ color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                  {formatDateDisplay(rate.date)}
                </span>
                <span
                  style={{
                    color: rate.notes ? "var(--text2)" : "var(--text3)",
                  }}
                >
                  {rate.notes || "-"}
                </span>
              </div>
              <button
                type="button"
                disabled={deletingId === rate.id}
                onClick={() => onDelete(rate)}
                style={deleteButtonStyle}
              >
                {deletingId === rate.id ? "..." : "Del"}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <Th>Pair</Th>
            <Th align="right">Rate</Th>
            <Th>Date</Th>
            <Th>Notes</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {rates.map((rate) => (
            <tr key={rate.id}>
              <Td mono>
                {rate.from_currency}/{rate.to_currency}
              </Td>
              <Td align="right" mono>
                {formatRateInput(rate.rate)}
              </Td>
              <Td mono color="var(--text3)" size={10}>
                {formatDateDisplay(rate.date)}
              </Td>
              <Td color={rate.notes ? "var(--text2)" : "var(--text3)"}>
                {rate.notes || "-"}
              </Td>
              <Td align="right">
                <button
                  type="button"
                  disabled={deletingId === rate.id}
                  onClick={() => onDelete(rate)}
                  style={deleteButtonStyle}
                >
                  {deletingId === rate.id ? "..." : "Del"}
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notice({
  kind,
  children,
}: {
  kind: "error" | "neutral";
  children: ReactNode;
}) {
  return <div style={noticeStyle(kind)}>{children}</div>;
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div
      style={{
        minHeight: 280,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text3)",
        fontFamily: "var(--font-cond)",
        fontSize: 11,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      style={{
        fontFamily: "var(--font-cond)",
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--text3)",
        padding: "5px 10px",
        textAlign: align,
        borderBottom: "1px solid var(--border)",
        whiteSpace: "nowrap",
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
  color = "var(--text)",
  size = 12,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  mono?: boolean;
  color?: string;
  size?: number;
}) {
  return (
    <td
      style={{
        padding: "5px 10px",
        borderBottom: "1px solid var(--border)",
        fontSize: mono ? size : 12,
        whiteSpace: "nowrap",
        textAlign: align,
        fontFamily: mono ? "var(--font-mono)" : "var(--font)",
        color,
      }}
    >
      {children}
    </td>
  );
}

function MetricLabel({ children }: { children: string }) {
  return <div style={metricLabelStyle}>{children}</div>;
}

function SectionHeader({ children }: { children: string }) {
  return <div style={sectionHeaderStyle}>{children}</div>;
}

function normalizeCurrency(value: string, label: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(currency)) {
    throw new Error(`${label} must be a 2-10 character code`);
  }
  return currency;
}

function parseRateInput(value: string): number {
  const rate = Number(value.trim().replace(/,/g, ""));
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Rate must be a positive number");
  }
  return rate;
}

function formatRateInput(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "");
}

function todayInputDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function noticeStyle(kind: "error" | "neutral"): CSSProperties {
  return {
    margin: 12,
    padding: "8px 10px",
    border: `1px solid ${kind === "error" ? "rgba(240,64,96,0.25)" : "var(--border2)"}`,
    background: kind === "error" ? "rgba(240,64,96,0.08)" : "var(--bg3)",
    color: kind === "error" ? "var(--red)" : "var(--text2)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  };
}

const metricLabelStyle: CSSProperties = {
  fontSize: 9,
  fontFamily: "var(--font-cond)",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text3)",
};

const sectionHeaderStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text3)",
  padding: "12px 12px 4px",
};

const mutedTextStyle: CSSProperties = {
  color: "var(--text3)",
  fontSize: 11,
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

const deleteButtonStyle: CSSProperties = {
  height: 22,
  minWidth: 34,
  border: "1px solid rgba(240,64,96,0.35)",
  background: "none",
  color: "var(--red)",
  cursor: "pointer",
  fontFamily: "var(--font-cond)",
  fontSize: 9,
  textTransform: "uppercase",
};

const pairButtonStyle: CSSProperties = {
  width: "100%",
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "2px 8px",
  padding: "7px 8px",
  border: "1px solid var(--border)",
  background: "var(--bg3)",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "var(--font-cond)",
  fontSize: 11,
};

const mobilePairButtonStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  padding: "10px 10px",
  border: "1px solid var(--border)",
  background: "var(--bg3)",
  cursor: "pointer",
  fontFamily: "var(--font-cond)",
  fontSize: 12,
};
