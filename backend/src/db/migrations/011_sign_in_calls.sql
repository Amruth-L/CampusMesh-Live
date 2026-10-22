-- Repeat sign-in greetings require their own explicit consent. Existing welcome
-- consent continues to authorize only the original one-time welcome.
ALTER TABLE call_preferences ADD COLUMN login_calls_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE call_consent_events ADD COLUMN login_calls_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users ADD COLUMN last_signed_in_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN last_sign_in_id UUID;
ALTER TABLE users ADD COLUMN last_sign_in_phone VARCHAR(20);

-- These are opted-in call intents, not a history of all sign-ins. Retain the
-- attempt IDs so retrying an earlier request cannot become a new greeting.
CREATE TABLE sign_in_call_events (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, attempt_id)
);
ALTER TABLE sign_in_call_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE automated_calls DROP CONSTRAINT automated_calls_kind_check;
ALTER TABLE automated_calls ADD CONSTRAINT automated_calls_kind_check
  CHECK (kind IN ('WELCOME','SIGN_IN_GREETING','BOOKING_CONFIRMATION','DUE_REMINDER','RECOMMENDATION'));
