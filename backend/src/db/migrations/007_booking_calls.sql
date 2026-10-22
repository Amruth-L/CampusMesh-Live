ALTER TABLE call_preferences ADD COLUMN booking_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE call_consent_events ADD COLUMN booking_enabled BOOLEAN NOT NULL DEFAULT FALSE;
-- Only newly confirmed bookings qualify; do not call users about historical orders.
ALTER TABLE rentals ADD COLUMN booking_confirmed_at TIMESTAMPTZ;
ALTER TABLE automated_calls DROP CONSTRAINT automated_calls_kind_check;
ALTER TABLE automated_calls ADD CONSTRAINT automated_calls_kind_check
  CHECK(kind IN ('WELCOME','BOOKING_CONFIRMATION','DUE_REMINDER','RECOMMENDATION'));
