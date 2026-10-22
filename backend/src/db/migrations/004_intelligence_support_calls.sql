ALTER TABLE delivery_requests ADD COLUMN route_distance_meters NUMERIC(10,2);
ALTER TABLE delivery_requests ADD COLUMN eta_prediction JSONB;
CREATE TABLE call_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 VARCHAR(20), phone_verified_at TIMESTAMPTZ,
  reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  recommendations_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  language VARCHAR(10) NOT NULL DEFAULT 'en-IN' CHECK(language='en-IN'),
  consent_version TEXT NOT NULL DEFAULT '2026-10-14',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE call_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminders_enabled BOOLEAN NOT NULL, recommendations_enabled BOOLEAN NOT NULL,
  consent_version TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE phone_verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE automated_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rental_id UUID REFERENCES rentals(id) ON DELETE CASCADE, listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('DUE_REMINDER','RECOMMENDATION')),
  dedupe_key TEXT NOT NULL UNIQUE, scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('PREVIEW','QUEUED','DISPATCHING','SENT','RINGING','ANSWERED','COMPLETED','FAILED','CANCELLED','UNKNOWN')),
  payload JSONB NOT NULL DEFAULT '{}', script TEXT NOT NULL, provider_sid TEXT UNIQUE,
  outcome TEXT, last_error TEXT, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
  provider_sequence INTEGER NOT NULL DEFAULT -1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX calls_queue_idx ON automated_calls(status,scheduled_at);
CREATE INDEX calls_user_recent_idx ON automated_calls(user_id,created_at DESC);
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(150) NOT NULL, details VARCHAR(3000) NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_REVIEW','RESOLVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE support_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question VARCHAR(1500) NOT NULL, answer TEXT NOT NULL, mode TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX support_turns_user_idx ON support_turns(user_id,created_at DESC);
