import type { CSSProperties } from "react";
import type { Insight } from "../types/insights";

interface InsightsPanelProps {
  insights: Insight[];
  loading?: boolean;
}

const INSIGHT_LABELS: Record<string, string> = {
  spend_spike: "Spend Spike",
  budget_burn_risk: "Burn Risk",
  unbudgeted_high_spend: "Unbudgeted",
  large_transaction: "Large Tx",
};

function severityIcon(severity: Insight["severity"]): string {
  return severity === "warning" ? "▲" : "●";
}

function severityColor(severity: Insight["severity"]): string {
  return severity === "warning" ? "var(--accent)" : "var(--cyan)";
}

function insightTypeBg(severity: Insight["severity"]): string {
  return severity === "warning"
    ? "rgba(240,165,0,0.06)"
    : "rgba(0,184,212,0.05)";
}

function insightTypeBorder(severity: Insight["severity"]): string {
  return severity === "warning"
    ? "rgba(240,165,0,0.2)"
    : "rgba(0,184,212,0.15)";
}

const panelWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 0,
};

const headerStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text3)",
  borderBottom: "1px solid var(--border)",
  padding: "6px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: 28,
  flexShrink: 0,
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 0,
};

const emptyStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 11,
  color: "var(--text3)",
  padding: "10px 12px",
  textAlign: "center",
};

function InsightRow({ insight }: { insight: Insight }) {
  const color = severityColor(insight.severity);
  const bg = insightTypeBg(insight.severity);
  const border = insightTypeBorder(insight.severity);
  const tag = INSIGHT_LABELS[insight.insight_type] ?? insight.insight_type;

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    background: bg,
    borderLeft: `2px solid ${border}`,
  };

  const iconStyle: CSSProperties = {
    color,
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    flexShrink: 0,
    marginTop: 2,
  };

  const contentStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
  };

  const titleRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    flexWrap: "wrap",
  };

  const titleStyle: CSSProperties = {
    fontFamily: "var(--font-cond)",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text)",
    lineHeight: 1.3,
  };

  const tagStyle: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 8,
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color,
    background: insightTypeBg(insight.severity),
    border: `1px solid ${border}`,
    borderRadius: 2,
    padding: "1px 4px",
    flexShrink: 0,
  };

  const bodyStyle: CSSProperties = {
    fontFamily: "var(--font-cond)",
    fontSize: 11,
    color: "var(--text2)",
    marginTop: 2,
    lineHeight: 1.4,
  };

  return (
    <div style={rowStyle}>
      <span style={iconStyle}>{severityIcon(insight.severity)}</span>
      <div style={contentStyle}>
        <div style={titleRowStyle}>
          <span style={titleStyle}>{insight.title}</span>
          <span style={tagStyle}>{tag}</span>
        </div>
        <div style={bodyStyle}>{insight.body}</div>
      </div>
    </div>
  );
}

export default function InsightsPanel({ insights, loading }: InsightsPanelProps) {
  return (
    <div style={panelWrapStyle}>
      <div style={headerStyle}>
        <span>Spending Insights</span>
        {!loading && insights.length > 0 && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text3)",
            }}
          >
            {insights.filter((i) => i.severity === "warning").length > 0 && (
              <span style={{ color: "var(--accent)" }}>
                ▲{insights.filter((i) => i.severity === "warning").length}
              </span>
            )}{" "}
            {insights.filter((i) => i.severity === "info").length > 0 && (
              <span style={{ color: "var(--cyan)" }}>
                ●{insights.filter((i) => i.severity === "info").length}
              </span>
            )}
          </span>
        )}
      </div>
      {loading ? (
        <div style={emptyStyle}>Loading insights…</div>
      ) : insights.length === 0 ? (
        <div style={emptyStyle}>No insights for this period</div>
      ) : (
        <div style={listStyle}>
          {insights.map((insight, i) => (
            <InsightRow key={`${insight.insight_type}-${i}`} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}
