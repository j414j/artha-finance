use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct InsightView {
    pub insight_type: String,
    pub severity: String,
    pub title: String,
    pub body: String,
    pub category_id: Option<String>,
    pub amount_paise: Option<i64>,
}
