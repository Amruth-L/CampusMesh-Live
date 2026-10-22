-- Direct payments are recipient attestations, never gateway captures or bank verification.
ALTER TABLE rentals ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'RAZORPAY'
  CHECK (payment_method IN ('RAZORPAY','DIRECT_UPI'));
CREATE TABLE upi_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  upi_id TEXT NOT NULL,
  payee_name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE direct_upi_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT UNIQUE NOT NULL,
  rental_id UUID NOT NULL REFERENCES rentals(id),
  delivery_id UUID REFERENCES delivery_requests(id),
  kind TEXT NOT NULL CHECK(kind IN ('RENTAL','DEPOSIT','DELIVERY','RETURN_DELIVERY','DEPOSIT_REFUND')),
  payer_id UUID NOT NULL REFERENCES users(id),
  recipient_id UUID NOT NULL REFERENCES users(id),
  amount_paise BIGINT NOT NULL CHECK(amount_paise>0),
  upi_id TEXT NOT NULL,
  payee_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','REPORTED','CONFIRMED','DISPUTED')),
  reference TEXT,
  reported_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(payer_id<>recipient_id)
);
CREATE UNIQUE INDEX direct_upi_reference_once ON direct_upi_payments(reference) WHERE reference IS NOT NULL;
CREATE INDEX direct_upi_recipient ON direct_upi_payments(recipient_id,status);
CREATE TABLE direct_upi_events (
  id BIGSERIAL PRIMARY KEY,
  payment_id UUID REFERENCES direct_upi_payments(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
