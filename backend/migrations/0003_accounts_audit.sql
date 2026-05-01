CREATE TABLE accounts (
    id                    TEXT PRIMARY KEY NOT NULL,
    user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    type                  TEXT NOT NULL CHECK (
        type IN (
            'savings',
            'current',
            'credit_card',
            'demat',
            'mutual_fund',
            'real_estate',
            'loan',
            'other_asset',
            'other_liability'
        )
    ),
    currency              TEXT NOT NULL CHECK (length(currency) = 3),
    opening_balance_paise INTEGER NOT NULL CHECK (opening_balance_paise >= 0),
    opening_date          TEXT NOT NULL,
    balance_paise         INTEGER NOT NULL CHECK (balance_paise >= 0),
    inr_value_paise       INTEGER NOT NULL CHECK (inr_value_paise >= 0),
    color_hex             TEXT NOT NULL CHECK (
        length(color_hex) = 7
        AND substr(color_hex, 1, 1) = '#'
    ),
    is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    archived_at           TEXT,
    last_updated          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    notes                 TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);

CREATE INDEX idx_accounts_user_active ON accounts(user_id, is_active);
CREATE INDEX idx_accounts_user_type ON accounts(user_id, type);

CREATE TABLE audit_log (
    id          TEXT PRIMARY KEY NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    diff_json   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);

CREATE INDEX idx_audit_log_user_created_at ON audit_log(user_id, created_at);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
