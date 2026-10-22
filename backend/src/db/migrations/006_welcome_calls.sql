ALTER TABLE users ADD COLUMN first_signed_in_at TIMESTAMPTZ;
ALTER TABLE call_preferences ADD COLUMN welcome_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE call_consent_events ADD COLUMN welcome_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE automated_calls DROP CONSTRAINT automated_calls_kind_check;
ALTER TABLE automated_calls ADD CONSTRAINT automated_calls_kind_check
  CHECK(kind IN ('WELCOME','DUE_REMINDER','RECOMMENDATION'));
