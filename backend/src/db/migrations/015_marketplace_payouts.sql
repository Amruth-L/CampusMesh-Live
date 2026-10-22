-- Historical payment rows are deliberately not inferred to be live money.
ALTER TABLE payments ADD COLUMN gateway_mode TEXT NOT NULL DEFAULT 'legacy' CHECK(gateway_mode IN ('legacy','test','live'));
ALTER TABLE wish_payments ADD COLUMN gateway_mode TEXT NOT NULL DEFAULT 'legacy' CHECK(gateway_mode IN ('legacy','test','live'));
CREATE TABLE payout_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  gateway_mode TEXT NOT NULL CHECK(gateway_mode IN ('test','live')),
  account_id TEXT,
  product_id TEXT,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED','REQUESTED','PENDING','ACTIVE','NEEDS_ATTENTION')),
  beneficiary_name TEXT,
  bank_last4 VARCHAR(4),
  revision INTEGER NOT NULL DEFAULT 0,
  bank_update_pending BOOLEAN NOT NULL DEFAULT FALSE,
  requested_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,gateway_mode), UNIQUE(account_id,gateway_mode)
);
CREATE TABLE payout_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_key TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('LENDER','COURIER','RETURN_COURIER','WISH_REIMBURSEMENT')),
  rental_id UUID REFERENCES rentals(id), delivery_id UUID REFERENCES delivery_requests(id),
  payment_id UUID REFERENCES payments(id), wish_payment_id UUID REFERENCES wish_payments(id),
  gateway_mode TEXT NOT NULL CHECK(gateway_mode IN ('legacy','test','live')),
  amount_paise BIGINT NOT NULL CHECK(amount_paise>0),
  status TEXT NOT NULL DEFAULT 'AWAITING_SETUP' CHECK(status IN
    ('AWAITING_SETUP','AWAITING_FUNDING','READY','SUBMITTING','PENDING','TRANSFERRED','SETTLED','FAILED','REVIEW_REQUIRED','REVERSED')),
  account_id TEXT, gateway_payment_id TEXT, gateway_transfer_id TEXT UNIQUE,
  settlement_id TEXT, reason TEXT, dispatched_at TIMESTAMPTZ, settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX payout_queue ON payout_intents(gateway_mode,status,updated_at);
CREATE INDEX payout_user ON payout_intents(user_id,created_at DESC);
CREATE TABLE payout_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id),
  payout_id UUID REFERENCES payout_intents(id), action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Financial data is accessed through authenticated Express routes. Supabase's
-- public REST roles receive no row policies; the trusted backend DB role owns
-- these tables and is responsible for the user-bound authorization above.
ALTER TABLE payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_audit ENABLE ROW LEVEL SECURITY;
