-- Keep delivery evidence associated with the provider that accepted the call.
ALTER TABLE automated_calls ADD COLUMN provider TEXT NOT NULL DEFAULT 'twilio'
  CHECK (provider IN ('twilio','authkey'));

-- Provider-generated OTPs are never stored or returned by CampusMesh.
CREATE TABLE call_phone_verifications (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 VARCHAR(20) NOT NULL,
  request_id UUID NOT NULL,
  provider_reference TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE call_phone_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_verification_attempts ADD COLUMN phone_e164 VARCHAR(20);
ALTER TABLE phone_verification_attempts ADD COLUMN purpose TEXT
  CHECK (purpose IN ('send','check'));
CREATE INDEX phone_verification_phone_created_idx
  ON phone_verification_attempts(phone_e164,created_at DESC);
