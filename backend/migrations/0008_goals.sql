CREATE TABLE goals (
    id                     TEXT PRIMARY KEY NOT NULL,
    user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    color_hex              TEXT NOT NULL,
    target_amount_paise    INTEGER NOT NULL CHECK (target_amount_paise > 0),
    source_account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    target_date            TEXT,
    current_blocked_paise  INTEGER NOT NULL DEFAULT 0 CHECK (current_blocked_paise >= 0),
    completed_amount_paise INTEGER,
    status                 TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'completed', 'cancelled')),
    notes                  TEXT,
    completed_at           TEXT,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);

CREATE INDEX idx_goals_user_status ON goals(user_id, status);
CREATE INDEX idx_goals_user_source_account ON goals(user_id, source_account_id);

CREATE TABLE goal_events (
    id           TEXT PRIMARY KEY NOT NULL,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    event_type   TEXT NOT NULL
               CHECK (event_type IN ('block', 'release', 'complete_release', 'cancel_release')),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    date         TEXT NOT NULL,
    notes        TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);

CREATE INDEX idx_goal_events_goal_date ON goal_events(user_id, goal_id, date, created_at);
