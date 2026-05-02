PRAGMA foreign_keys = OFF;

CREATE TABLE transaction_splits_new (
    id             TEXT PRIMARY KEY NOT NULL,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category_id    TEXT REFERENCES categories(id) ON DELETE RESTRICT,
    amount_paise   INTEGER NOT NULL CHECK (amount_paise > 0),
    notes          TEXT
);

INSERT INTO transaction_splits_new (id, user_id, transaction_id, category_id, amount_paise, notes)
SELECT id, user_id, transaction_id, category_id, amount_paise, notes
FROM transaction_splits;

DROP TABLE transaction_splits;

ALTER TABLE transaction_splits_new RENAME TO transaction_splits;

CREATE INDEX idx_transaction_splits_user_transaction ON transaction_splits(user_id, transaction_id);
CREATE INDEX idx_transaction_splits_user_category ON transaction_splits(user_id, category_id);

PRAGMA foreign_keys = ON;
