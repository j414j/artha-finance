export interface BudgetCategory {
  id: string;
  parent_id: string | null;
  name: string;
  color_hex: string;
  icon_emoji: string | null;
}

export interface BudgetBaseAllocation {
  category_id: string;
  category: BudgetCategory;
  amount_paise: number;
}

export interface BudgetMonthAllocation extends BudgetBaseAllocation {
  is_manual_override: boolean;
}

export interface BudgetSummary {
  total_budget_paise: number;
  spent_paise: number;
  remaining_paise: number;
  used_pct: number;
  expected_pct: number;
  days_elapsed: number;
  days_in_month: number;
}

export interface BudgetSavings {
  income_paise: number;
  expense_paise: number;
  net_paise: number;
  savings_rate_pct: number | null;
}

export interface BudgetItem {
  category_id: string;
  category: BudgetCategory;
  allocated_paise: number;
  spent_paise: number;
  remaining_paise: number;
  used_pct: number;
  expected_pct: number;
  status: BudgetStatus;
  is_manual_override: boolean;
}

export type BudgetStatus =
  | "over_budget"
  | "near_limit"
  | "ahead_of_pace"
  | "well_within"
  | "on_track";

export interface UnbudgetedSpend {
  category_id: string | null;
  category_name: string;
  color_hex: string;
  icon_emoji: string | null;
  spent_paise: number;
}

export interface BudgetMonth {
  year: number;
  month: number;
  month_label: string;
  summary: BudgetSummary;
  savings: BudgetSavings;
  allocations: BudgetMonthAllocation[];
  items: BudgetItem[];
  unbudgeted: UnbudgetedSpend[];
}

export interface BudgetHistoryMonth {
  year: number;
  month: number;
  label: string;
}

export interface BudgetHistoryValue {
  year: number;
  month: number;
  allocated_paise: number;
  spent_paise: number;
  used_pct: number | null;
}

export interface BudgetHistoryRow {
  category_id: string;
  category: BudgetCategory;
  values: BudgetHistoryValue[];
}

export interface SavingsRatePoint {
  year: number;
  month: number;
  label: string;
  income_paise: number;
  expense_paise: number;
  savings_rate_pct: number | null;
}

export interface BudgetHistory {
  months: BudgetHistoryMonth[];
  rows: BudgetHistoryRow[];
  savings_rate_trend: SavingsRatePoint[];
}

export interface BudgetAllocationPayload {
  category_id: string;
  amount_paise: number;
}
