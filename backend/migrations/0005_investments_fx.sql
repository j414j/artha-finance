-- FX rate snapshots (manual entries per currency pair per date)
CREATE TABLE fx_rates (
    id            TEXT PRIMARY KEY NOT NULL,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_currency TEXT NOT NULL,
    to_currency   TEXT NOT NULL,
    rate          REAL NOT NULL CHECK (rate > 0),
    date          TEXT NOT NULL,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_fx_rates_user_pair_date ON fx_rates(user_id, from_currency, to_currency, date DESC);

-- Investment instruments scoped per user
CREATE TABLE instruments (
    id         TEXT PRIMARY KEY NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    ticker     TEXT,
    type       TEXT NOT NULL CHECK (type IN ('equity','mf','etf','bond','gold','crypto','other')),
    currency   TEXT NOT NULL DEFAULT 'INR',
    sector     TEXT,
    geography  TEXT,
    notes      TEXT,
    is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_instruments_user_active ON instruments(user_id, is_active);

-- Manual price snapshots per instrument
CREATE TABLE price_snapshots (
    id            TEXT PRIMARY KEY NOT NULL,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    price_paise   INTEGER NOT NULL CHECK (price_paise >= 0),
    date          TEXT NOT NULL,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_price_snapshots_instrument_date ON price_snapshots(instrument_id, date DESC);
CREATE INDEX idx_price_snapshots_user ON price_snapshots(user_id);

-- Holding-side detail for investment_buy/investment_sell/dividend transactions (1:1 with transactions row)
CREATE TABLE investment_transaction_details (
    id                         TEXT PRIMARY KEY NOT NULL,
    user_id                    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id             TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    instrument_id              TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
    quantity                   REAL NOT NULL CHECK (quantity > 0),
    price_per_unit_paise       INTEGER NOT NULL CHECK (price_per_unit_paise >= 0),
    fees_paise                 INTEGER NOT NULL DEFAULT 0 CHECK (fees_paise >= 0),
    cost_basis_per_unit_paise  INTEGER,  -- filled on sells: weighted avg cost at time of sale
    created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_inv_tx_details_user_instrument ON investment_transaction_details(user_id, instrument_id);
CREATE INDEX idx_inv_tx_details_user_tx ON investment_transaction_details(user_id, transaction_id);

-- Non-cash corporate actions (split, bonus, dividend reinvested) that adjust holding quantity
CREATE TABLE corporate_actions (
    id                   TEXT PRIMARY KEY NOT NULL,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instrument_id        TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
    account_id           TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    type                 TEXT NOT NULL CHECK (type IN ('split','bonus','dividend_reinvested')),
    date                 TEXT NOT NULL,
    quantity_delta       REAL NOT NULL,
    split_ratio          TEXT,
    price_per_unit_paise INTEGER,
    notes                TEXT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_corporate_actions_user_instrument ON corporate_actions(user_id, instrument_id);
CREATE INDEX idx_corporate_actions_user_account ON corporate_actions(user_id, account_id);

-- Extend transactions table to support FX transfers (cross-currency)
-- fx_rate: units of destination currency per unit of source currency (e.g. 83 for INR→USD means 1 INR = ... wait)
-- Convention: fx_rate is "destination units per source unit" as a REAL
-- fx_to_amount_paise: amount credited to destination account (in destination currency smallest unit)
-- fx_fee_paise: fee deducted from source account (in source currency smallest unit), included in amount_paise
ALTER TABLE transactions ADD COLUMN fx_rate REAL;
ALTER TABLE transactions ADD COLUMN fx_to_amount_paise INTEGER;
ALTER TABLE transactions ADD COLUMN fx_fee_paise INTEGER NOT NULL DEFAULT 0;
