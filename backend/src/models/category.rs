use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};

use crate::error::Result;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Category {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub category_type: String,
    pub color_hex: String,
    pub icon_emoji: Option<String>,
    pub is_default: bool,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoryNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub category_type: String,
    pub color_hex: String,
    pub icon_emoji: Option<String>,
    pub is_default: bool,
    pub children: Vec<CategoryNode>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCategoryRequest {
    pub parent_id: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub category_type: String,
    pub color_hex: String,
    pub icon_emoji: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCategoryRequest {
    pub parent_id: Option<Option<String>>,
    pub name: Option<String>,
    pub color_hex: Option<String>,
    pub icon_emoji: Option<Option<String>>,
}

#[derive(Debug, Clone, Copy)]
pub struct DefaultCategory {
    pub key: &'static str,
    pub parent_key: Option<&'static str>,
    pub name: &'static str,
    pub category_type: &'static str,
    pub color_hex: &'static str,
    pub icon_emoji: &'static str,
}

pub const DEFAULT_CATEGORIES: &[DefaultCategory] = &[
    DefaultCategory {
        key: "income",
        parent_key: None,
        name: "Income",
        category_type: "income",
        color_hex: "#00C896",
        icon_emoji: "IN",
    },
    DefaultCategory {
        key: "income:salary",
        parent_key: Some("income"),
        name: "Salary",
        category_type: "income",
        color_hex: "#00C896",
        icon_emoji: "SA",
    },
    DefaultCategory {
        key: "income:freelance",
        parent_key: Some("income"),
        name: "Freelance",
        category_type: "income",
        color_hex: "#00B8D4",
        icon_emoji: "FR",
    },
    DefaultCategory {
        key: "income:interest",
        parent_key: Some("income"),
        name: "Interest",
        category_type: "income",
        color_hex: "#3A7FFF",
        icon_emoji: "IR",
    },
    DefaultCategory {
        key: "food",
        parent_key: None,
        name: "Food",
        category_type: "expense",
        color_hex: "#F0A500",
        icon_emoji: "FO",
    },
    DefaultCategory {
        key: "food:groceries",
        parent_key: Some("food"),
        name: "Groceries",
        category_type: "expense",
        color_hex: "#F0A500",
        icon_emoji: "GR",
    },
    DefaultCategory {
        key: "food:dining",
        parent_key: Some("food"),
        name: "Dining Out",
        category_type: "expense",
        color_hex: "#E8860A",
        icon_emoji: "DO",
    },
    DefaultCategory {
        key: "transport",
        parent_key: None,
        name: "Transport",
        category_type: "expense",
        color_hex: "#3A7FFF",
        icon_emoji: "TR",
    },
    DefaultCategory {
        key: "transport:fuel",
        parent_key: Some("transport"),
        name: "Fuel",
        category_type: "expense",
        color_hex: "#3A7FFF",
        icon_emoji: "FU",
    },
    DefaultCategory {
        key: "transport:cab",
        parent_key: Some("transport"),
        name: "Cab & Transit",
        category_type: "expense",
        color_hex: "#2060DD",
        icon_emoji: "CB",
    },
    DefaultCategory {
        key: "bills",
        parent_key: None,
        name: "Bills & Utilities",
        category_type: "expense",
        color_hex: "#9060F0",
        icon_emoji: "BU",
    },
    DefaultCategory {
        key: "bills:electricity",
        parent_key: Some("bills"),
        name: "Electricity",
        category_type: "expense",
        color_hex: "#9060F0",
        icon_emoji: "EL",
    },
    DefaultCategory {
        key: "bills:internet",
        parent_key: Some("bills"),
        name: "Internet",
        category_type: "expense",
        color_hex: "#00B8D4",
        icon_emoji: "NT",
    },
    DefaultCategory {
        key: "health",
        parent_key: None,
        name: "Health",
        category_type: "expense",
        color_hex: "#F04060",
        icon_emoji: "HE",
    },
    DefaultCategory {
        key: "shopping",
        parent_key: None,
        name: "Shopping",
        category_type: "expense",
        color_hex: "#C02040",
        icon_emoji: "SH",
    },
];

pub async fn seed_default_categories(pool: &SqlitePool, user_id: &str) -> Result<()> {
    let mut tx = pool.begin().await?;
    seed_default_categories_in_tx(&mut tx, user_id).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn seed_default_categories_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
) -> Result<()> {
    for category in DEFAULT_CATEGORIES {
        let id = default_category_id(user_id, category.key);
        let parent_id = category
            .parent_key
            .map(|parent_key| default_category_id(user_id, parent_key));

        sqlx::query(
            "INSERT OR IGNORE INTO categories (
                id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
        )
        .bind(&id)
        .bind(user_id)
        .bind(parent_id)
        .bind(category.name)
        .bind(category.category_type)
        .bind(category.color_hex)
        .bind(category.icon_emoji)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

pub fn default_category_id(user_id: &str, key: &str) -> String {
    format!("{user_id}:cat:{key}")
}

pub fn is_valid_category_type(category_type: &str) -> bool {
    matches!(category_type, "income" | "expense")
}

pub fn build_category_tree(categories: Vec<Category>) -> Vec<CategoryNode> {
    let mut roots = Vec::new();

    for category in categories
        .iter()
        .filter(|category| category.parent_id.is_none())
    {
        roots.push(build_node(category, &categories));
    }

    roots.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    roots
}

fn build_node(category: &Category, categories: &[Category]) -> CategoryNode {
    let mut children: Vec<CategoryNode> = categories
        .iter()
        .filter(|candidate| candidate.parent_id.as_deref() == Some(category.id.as_str()))
        .map(|child| build_node(child, categories))
        .collect();

    children.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    CategoryNode {
        id: category.id.clone(),
        parent_id: category.parent_id.clone(),
        name: category.name.clone(),
        category_type: category.category_type.clone(),
        color_hex: category.color_hex.clone(),
        icon_emoji: category.icon_emoji.clone(),
        is_default: category.is_default,
        children,
    }
}
