use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct BudgetCategoryView {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub color_hex: String,
    pub icon_emoji: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetBaseAllocationView {
    pub category_id: String,
    pub category: BudgetCategoryView,
    pub amount_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetMonthAllocationView {
    pub category_id: String,
    pub category: BudgetCategoryView,
    pub amount_paise: i64,
    pub is_manual_override: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetSummaryView {
    pub total_budget_paise: i64,
    pub spent_paise: i64,
    pub remaining_paise: i64,
    pub used_pct: f64,
    pub expected_pct: f64,
    pub days_elapsed: u32,
    pub days_in_month: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetSavingsView {
    pub income_paise: i64,
    pub expense_paise: i64,
    pub net_paise: i64,
    pub savings_rate_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetItemView {
    pub category_id: String,
    pub category: BudgetCategoryView,
    pub allocated_paise: i64,
    pub spent_paise: i64,
    pub remaining_paise: i64,
    pub used_pct: f64,
    pub expected_pct: f64,
    pub status: String,
    pub is_manual_override: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct UnbudgetedSpendView {
    pub category_id: Option<String>,
    pub category_name: String,
    pub color_hex: String,
    pub icon_emoji: Option<String>,
    pub spent_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetMonthView {
    pub year: i32,
    pub month: u32,
    pub month_label: String,
    pub summary: BudgetSummaryView,
    pub savings: BudgetSavingsView,
    pub allocations: Vec<BudgetMonthAllocationView>,
    pub items: Vec<BudgetItemView>,
    pub unbudgeted: Vec<UnbudgetedSpendView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetHistoryMonthView {
    pub year: i32,
    pub month: u32,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetHistoryValueView {
    pub year: i32,
    pub month: u32,
    pub allocated_paise: i64,
    pub spent_paise: i64,
    pub used_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetHistoryRowView {
    pub category_id: String,
    pub category: BudgetCategoryView,
    pub values: Vec<BudgetHistoryValueView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SavingsRatePointView {
    pub year: i32,
    pub month: u32,
    pub label: String,
    pub income_paise: i64,
    pub expense_paise: i64,
    pub savings_rate_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetHistoryView {
    pub months: Vec<BudgetHistoryMonthView>,
    pub rows: Vec<BudgetHistoryRowView>,
    pub savings_rate_trend: Vec<SavingsRatePointView>,
}

#[derive(Debug, Deserialize)]
pub struct BudgetAllocationInput {
    pub category_id: String,
    pub amount_paise: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBudgetBaseRequest {
    pub allocations: Vec<BudgetAllocationInput>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMonthlyBudgetRequest {
    pub year: i32,
    pub month: u32,
    pub allocations: Vec<BudgetAllocationInput>,
}
