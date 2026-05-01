CREATE TABLE budget_base (
    id           TEXT PRIMARY KEY NOT NULL,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    UNIQUE(user_id, category_id)
);

CREATE INDEX idx_budget_base_user ON budget_base(user_id);

CREATE TABLE budget_months (
    id         TEXT PRIMARY KEY NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year       INTEGER NOT NULL CHECK (year >= 1900 AND year <= 9999),
    month      INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    UNIQUE(user_id, year, month)
);

CREATE INDEX idx_budget_months_user_period ON budget_months(user_id, year, month);

CREATE TABLE budget_month_allocations (
    id                 TEXT PRIMARY KEY NOT NULL,
    user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    budget_month_id    TEXT NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
    category_id        TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    amount_paise       INTEGER NOT NULL CHECK (amount_paise >= 0),
    is_manual_override INTEGER NOT NULL DEFAULT 0 CHECK (is_manual_override IN (0, 1)),
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    UNIQUE(user_id, budget_month_id, category_id)
);

CREATE INDEX idx_budget_month_allocations_month ON budget_month_allocations(user_id, budget_month_id);
CREATE INDEX idx_budget_month_allocations_category ON budget_month_allocations(user_id, category_id);
