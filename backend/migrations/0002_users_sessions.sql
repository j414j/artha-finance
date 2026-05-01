CREATE TABLE users (
    id              TEXT PRIMARY KEY NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    avatar_initials TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);

CREATE TABLE sessions (
    id         TEXT PRIMARY KEY NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user_id   ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
