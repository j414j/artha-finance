use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct GoalView {
    pub id: String,
    pub name: String,
    pub color_hex: String,
    pub target_amount_paise: i64,
    pub source_account_id: String,
    pub source_account_name: String,
    pub target_date: Option<String>,
    pub current_blocked_paise: i64,
    pub completed_amount_paise: Option<i64>,
    pub display_amount_paise: i64,
    pub remaining_paise: i64,
    pub progress_pct: f64,
    pub projected_completion_date: Option<String>,
    pub required_monthly_paise: Option<i64>,
    pub status: String,
    pub status_label: String,
    pub status_tone: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoalEventView {
    pub id: String,
    pub event_type: String,
    pub amount_paise: i64,
    pub date: String,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoalAccountAvailabilityView {
    pub account_id: String,
    pub account_name: String,
    pub total_balance_paise: i64,
    pub blocked_paise: i64,
    pub available_balance_paise: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateGoalRequest {
    pub name: String,
    pub target_amount_paise: i64,
    pub source_account_id: String,
    pub target_date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateGoalRequest {
    pub name: Option<String>,
    pub target_amount_paise: Option<i64>,
    pub source_account_id: Option<String>,
    pub target_date: Option<Option<String>>,
    pub notes: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct GoalFundsRequest {
    pub amount_paise: i64,
    pub date: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct CompleteGoalRequest {
    pub date: Option<String>,
    pub notes: Option<String>,
}
