-- Incrementing this version invalidates every token previously issued to a user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS request_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS request_rate_limits_expiry ON request_rate_limits(expires_at);
