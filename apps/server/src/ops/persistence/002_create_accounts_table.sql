-- T08C: Accounts and Sessions schema
-- Argon2id password hashing, JWT tokens, rate limits, lockout

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Rate limiting table (IP-based)
CREATE TABLE IF NOT EXISTS rate_limits (
    id BIGSERIAL PRIMARY KEY,
    ip_address TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint ON rate_limits(ip_address, endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_accounts_updated_at ON accounts;
CREATE TRIGGER trigger_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();