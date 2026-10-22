ALTER TABLE users ADD COLUMN wish_available BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE listings ADD COLUMN demo_slug TEXT UNIQUE;

CREATE TABLE wish_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  details VARCHAR(1500) NOT NULL,
  pickup_hint VARCHAR(250) NOT NULL DEFAULT '',
  drop_location_id TEXT NOT NULL REFERENCES campus_locations(id),
  drop_details VARCHAR(250) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CHECKING','QUOTED','PAYMENT_PENDING','IN_DELIVERY','COMPLETED','CANCELLED')),
  courier_id UUID REFERENCES users(id),
  claim_expires_at TIMESTAMPTZ,
  current_quote_id UUID,
  delivery_id UUID REFERENCES delivery_requests(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE wish_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wish_id UUID NOT NULL REFERENCES wish_requests(id) ON DELETE CASCADE,
  courier_id UUID NOT NULL REFERENCES users(id),
  amount_paise INTEGER NOT NULL CHECK(amount_paise BETWEEN 100 AND 10000000),
  pickup_place VARCHAR(250) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','EXPIRED','WITHDRAWN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE wish_requests ADD CONSTRAINT wish_current_quote_fk FOREIGN KEY(current_quote_id) REFERENCES wish_quotes(id);
CREATE TABLE wish_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wish_id UUID NOT NULL REFERENCES wish_requests(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL UNIQUE REFERENCES wish_quotes(id),
  payer_id UUID NOT NULL REFERENCES users(id),
  amount_paise INTEGER NOT NULL CHECK(amount_paise>0),
  gateway_order_id TEXT NOT NULL UNIQUE,
  gateway_payment_id TEXT UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
ALTER TABLE delivery_requests ADD COLUMN wish_request_id UUID UNIQUE REFERENCES wish_requests(id) ON DELETE CASCADE;
ALTER TABLE delivery_requests ADD COLUMN agreed_amount NUMERIC(10,2);
CREATE INDEX wish_requester_idx ON wish_requests(requester_id,created_at DESC);
CREATE INDEX wish_open_idx ON wish_requests(status,created_at DESC);
CREATE UNIQUE INDEX wish_one_reserved_courier ON wish_requests(courier_id) WHERE status IN ('CHECKING','QUOTED','PAYMENT_PENDING');
