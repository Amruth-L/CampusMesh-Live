CREATE TABLE IF NOT EXISTS auth_codes (
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email, purpose)
);
-- Codes are accessed only by the server's PostgreSQL connection, never PostgREST.
ALTER TABLE auth_codes ENABLE ROW LEVEL SECURITY;
-- Existing plaintext codes must be reissued through the purpose-specific flow.
UPDATE users SET otp = NULL, otp_expiry = NULL;
