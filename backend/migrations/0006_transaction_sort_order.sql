CREATE INDEX IF NOT EXISTS idx_transactions_user_deleted_date_created
    ON transactions(user_id, deleted_at, date DESC, created_at DESC);
