CREATE TABLE IF NOT EXISTS login_attempt_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempt_limits_expiry ON login_attempt_limits(expires_at);
