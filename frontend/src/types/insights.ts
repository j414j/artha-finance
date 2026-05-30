export type InsightSeverity = "warning" | "info";

export type InsightType =
  | "spend_spike"
  | "budget_burn_risk"
  | "unbudgeted_high_spend"
  | "large_transaction"
  | string; // extensible for future types

export interface Insight {
  insight_type: InsightType;
  severity: InsightSeverity;
  title: string;
  body: string;
  category_id: string | null;
  amount_paise: number | null;
}

export interface InsightsResponse {
  insights: Insight[];
}
