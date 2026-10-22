-- Keep retry metadata, never PAN or full bank details. An ambiguous request
-- must reuse the same provider idempotency key and the same input.
ALTER TABLE payout_accounts
  ADD COLUMN onboarding_method TEXT NOT NULL DEFAULT 'operator'
    CHECK (onboarding_method IN ('operator','composite')),
  ADD COLUMN onboarding_key UUID,
  ADD COLUMN onboarding_hash TEXT,
  ADD COLUMN onboarding_busy_until TIMESTAMPTZ,
  ADD COLUMN onboarding_submitted_at TIMESTAMPTZ;
