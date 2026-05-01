CREATE TABLE categories (
    id          TEXT PRIMARY KEY NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    color_hex   TEXT NOT NULL CHECK (
        length(color_hex) = 7
        AND substr(color_hex, 1, 1) = '#'
    ),
    icon_emoji  TEXT,
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);

CREATE INDEX idx_categories_user_type_active ON categories(user_id, type, is_active);
CREATE INDEX idx_categories_parent_id ON categories(parent_id);

CREATE TABLE transactions (
    id                   TEXT PRIMARY KEY NOT NULL,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id           TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    transfer_account_id  TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
    type                 TEXT NOT NULL CHECK (
        type IN (
            'income',
            'expense',
            'transfer',
            'investment_buy',
            'investment_sell',
            'dividend',
            'loan_repayment',
            'credit_card_payment',
            'valuation_update'
        )
    ),
    date                 TEXT NOT NULL,
    description          TEXT NOT NULL,
    amount_paise         INTEGER NOT NULL CHECK (amount_paise > 0),
    category_id          TEXT REFERENCES categories(id) ON DELETE RESTRICT,
    notes                TEXT,
    is_recurring         INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0, 1)),
    recurrence_frequency TEXT CHECK (
        recurrence_frequency IS NULL OR recurrence_frequency IN (
            'daily',
            'weekly',
            'fortnightly',
            'monthly',
            'quarterly',
            'annually'
        )
    ),
    deleted_at           TEXT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);

CREATE INDEX idx_transactions_user_deleted_date_id ON transactions(user_id, deleted_at, date DESC, id DESC);
CREATE INDEX idx_transactions_user_account ON transactions(user_id, account_id);
CREATE INDEX idx_transactions_user_transfer_account ON transactions(user_id, transfer_account_id);
CREATE INDEX idx_transactions_user_category ON transactions(user_id, category_id);
CREATE INDEX idx_transactions_user_type ON transactions(user_id, type);
CREATE INDEX idx_transactions_user_amount ON transactions(user_id, amount_paise);

CREATE TABLE transaction_splits (
    id             TEXT PRIMARY KEY NOT NULL,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category_id    TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    amount_paise   INTEGER NOT NULL CHECK (amount_paise > 0),
    notes          TEXT
);

CREATE INDEX idx_transaction_splits_user_transaction ON transaction_splits(user_id, transaction_id);
CREATE INDEX idx_transaction_splits_user_category ON transaction_splits(user_id, category_id);

CREATE TABLE transaction_tags (
    id             TEXT PRIMARY KEY NOT NULL,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag            TEXT NOT NULL
);

CREATE INDEX idx_transaction_tags_user_tag ON transaction_tags(user_id, tag);
CREATE UNIQUE INDEX idx_transaction_tags_unique ON transaction_tags(user_id, transaction_id, tag);

CREATE TABLE transaction_account_effects (
    id                    TEXT PRIMARY KEY NOT NULL,
    user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id        TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    account_id            TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    balance_delta_paise   INTEGER NOT NULL,
    inr_value_delta_paise INTEGER NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);

CREATE INDEX idx_transaction_effects_user_transaction ON transaction_account_effects(user_id, transaction_id);
CREATE INDEX idx_transaction_effects_user_account ON transaction_account_effects(user_id, account_id);

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:income', users.id, NULL, 'Income', 'income', '#00C896', 'IN', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:income:salary', users.id, users.id || ':cat:income', 'Salary', 'income', '#00C896', 'SA', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:income:freelance', users.id, users.id || ':cat:income', 'Freelance', 'income', '#00B8D4', 'FR', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:income:interest', users.id, users.id || ':cat:income', 'Interest', 'income', '#3A7FFF', 'IR', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:food', users.id, NULL, 'Food', 'expense', '#F0A500', 'FO', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:food:groceries', users.id, users.id || ':cat:food', 'Groceries', 'expense', '#F0A500', 'GR', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:food:dining', users.id, users.id || ':cat:food', 'Dining Out', 'expense', '#E8860A', 'DO', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:transport', users.id, NULL, 'Transport', 'expense', '#3A7FFF', 'TR', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:transport:fuel', users.id, users.id || ':cat:transport', 'Fuel', 'expense', '#3A7FFF', 'FU', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:transport:cab', users.id, users.id || ':cat:transport', 'Cab & Transit', 'expense', '#2060DD', 'CB', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:bills', users.id, NULL, 'Bills & Utilities', 'expense', '#9060F0', 'BU', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:bills:electricity', users.id, users.id || ':cat:bills', 'Electricity', 'expense', '#9060F0', 'EL', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:bills:internet', users.id, users.id || ':cat:bills', 'Internet', 'expense', '#00B8D4', 'NT', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:health', users.id, NULL, 'Health', 'expense', '#F04060', 'HE', 1
FROM users;

INSERT INTO categories (id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default)
SELECT users.id || ':cat:shopping', users.id, NULL, 'Shopping', 'expense', '#C02040', 'SH', 1
FROM users;
