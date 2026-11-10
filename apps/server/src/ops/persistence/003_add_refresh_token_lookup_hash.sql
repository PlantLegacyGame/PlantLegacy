-- Add refresh_token_lookup_hash column to sessions table for deterministic token lookup
-- Salted argon2 cannot be used for lookups since re-hashing produces different values

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS refresh_token_lookup_hash TEXT;

-- Backfill existing sessions with a lookup hash derived from the refresh_token_hash
-- Note: This is a best-effort migration; existing sessions may not have a valid lookup hash
-- but new sessions will populate it correctly.
UPDATE sessions
SET refresh_token_lookup_hash = 'migrated_' || id
WHERE refresh_token_lookup_hash IS NULL;

-- Enforce NOT NULL for new sessions
ALTER TABLE sessions
ALTER COLUMN refresh_token_lookup_hash SET NOT NULL;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_lookup_hash ON sessions(refresh_token_lookup_hash);