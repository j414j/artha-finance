use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::error::Result;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct FxRate {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub from_currency: String,
    pub to_currency: String,
    pub rate: f64,
    pub date: String,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateFxRateRequest {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: f64,
    pub date: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct LatestFxRate {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: f64,
    pub date: String,
}

#[derive(Debug, Clone, Default)]
pub struct FxRateMap {
    rates: BTreeMap<(String, String), LatestFxRate>,
}

impl FxRateMap {
    pub async fn latest_for_user(pool: &sqlx::SqlitePool, user_id: &str) -> Result<Self> {
        let rows: Vec<LatestFxRate> = sqlx::query_as(
            "SELECT f.from_currency, f.to_currency, f.rate, f.date
             FROM fx_rates f
             WHERE f.user_id = ?
               AND NOT EXISTS (
                   SELECT 1
                   FROM fx_rates newer
                   WHERE newer.user_id = f.user_id
                     AND newer.from_currency = f.from_currency
                     AND newer.to_currency = f.to_currency
                     AND (
                         newer.date > f.date
                         OR (newer.date = f.date AND newer.created_at > f.created_at)
                         OR (newer.date = f.date AND newer.created_at = f.created_at AND newer.id > f.id)
                     )
               )",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(FxRateMap {
            rates: rows
                .into_iter()
                .map(|mut rate| {
                    rate.from_currency = rate.from_currency.trim().to_uppercase();
                    rate.to_currency = rate.to_currency.trim().to_uppercase();
                    ((rate.from_currency.clone(), rate.to_currency.clone()), rate)
                })
                .collect(),
        })
    }

    pub fn rate_between(&self, from_currency: &str, to_currency: &str) -> Option<f64> {
        let from = from_currency.trim().to_uppercase();
        let to = to_currency.trim().to_uppercase();
        if from == to {
            return Some(1.0);
        }

        if let Some(rate) = self.rates.get(&(from.clone(), to.clone())) {
            return Some(rate.rate);
        }
        self.rates.get(&(to, from)).map(|rate| 1.0 / rate.rate)
    }

    pub fn convert_to_inr_paise(&self, currency: &str, amount_paise: i64) -> Option<i64> {
        self.rate_between(currency, "INR")
            .map(|rate| (amount_paise as f64 * rate).round() as i64)
    }
}

pub async fn rate_for_user_on_or_before(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    from_currency: &str,
    to_currency: &str,
    date: &str,
) -> Result<Option<f64>> {
    let from = from_currency.trim().to_uppercase();
    let to = to_currency.trim().to_uppercase();
    if from == to {
        return Ok(Some(1.0));
    }

    if let Some(rate) = fetch_rate_on_or_before(pool, user_id, &from, &to, date).await? {
        return Ok(Some(rate));
    }
    if let Some(rate) = fetch_rate_on_or_before(pool, user_id, &to, &from, date).await? {
        return Ok(Some(1.0 / rate));
    }

    Ok(None)
}

async fn fetch_rate_on_or_before(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    from_currency: &str,
    to_currency: &str,
    date: &str,
) -> Result<Option<f64>> {
    Ok(sqlx::query_scalar::<_, f64>(
        "SELECT rate
         FROM fx_rates
         WHERE user_id = ?
           AND from_currency = ?
           AND to_currency = ?
           AND date <= ?
         ORDER BY date DESC, created_at DESC, id DESC
         LIMIT 1",
    )
    .bind(user_id)
    .bind(from_currency)
    .bind(to_currency)
    .bind(date)
    .fetch_optional(pool)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    #[test]
    fn rate_map_resolves_direct_reverse_and_same_currency_rates() {
        let map = FxRateMap {
            rates: BTreeMap::from([(
                ("USD".to_string(), "INR".to_string()),
                LatestFxRate {
                    from_currency: "USD".to_string(),
                    to_currency: "INR".to_string(),
                    rate: 83.25,
                    date: "2026-05-01".to_string(),
                },
            )]),
        };

        assert_eq!(map.rate_between("usd", "inr"), Some(83.25));
        assert_eq!(map.rate_between("INR", "USD"), Some(1.0 / 83.25));
        assert_eq!(map.rate_between("USD", "USD"), Some(1.0));
        assert_eq!(map.convert_to_inr_paise("USD", 1_000), Some(83_250));
    }

    #[tokio::test]
    async fn historical_lookup_uses_latest_rate_on_or_before_date() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        sqlx::query(
            "CREATE TABLE fx_rates (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                from_currency TEXT NOT NULL,
                to_currency TEXT NOT NULL,
                rate REAL NOT NULL,
                date TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create fx_rates");

        for (id, rate, date, created_at) in [
            ("old", 82.0, "2026-04-01", "2026-04-01 10:00:00"),
            ("new", 83.0, "2026-04-30", "2026-04-30 10:00:00"),
            ("future", 84.0, "2026-05-02", "2026-05-02 10:00:00"),
        ] {
            sqlx::query(
                "INSERT INTO fx_rates
                 (id, user_id, from_currency, to_currency, rate, date, created_at)
                 VALUES (?, 'user-1', 'USD', 'INR', ?, ?, ?)",
            )
            .bind(id)
            .bind(rate)
            .bind(date)
            .bind(created_at)
            .execute(&pool)
            .await
            .expect("insert fx rate");
        }

        assert_eq!(
            rate_for_user_on_or_before(&pool, "user-1", "USD", "INR", "2026-05-01")
                .await
                .expect("lookup direct rate"),
            Some(83.0)
        );

        let reverse = rate_for_user_on_or_before(&pool, "user-1", "INR", "USD", "2026-05-01")
            .await
            .expect("lookup reverse rate")
            .expect("reverse rate");
        assert!((reverse - (1.0 / 83.0)).abs() < f64::EPSILON);

        assert_eq!(
            rate_for_user_on_or_before(&pool, "user-1", "USD", "INR", "2026-03-31")
                .await
                .expect("lookup missing rate"),
            None
        );
    }
}
