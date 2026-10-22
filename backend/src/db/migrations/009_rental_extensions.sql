-- Rental details and the extension workflow both read this table. Keep it in
-- the migration ledger so a fresh deployment has the same schema as the API.
CREATE TABLE rental_extensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id UUID NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  borrower_id UUID NOT NULL REFERENCES users(id),
  owner_id UUID NOT NULL REFERENCES users(id),
  additional_days INTEGER NOT NULL CHECK (additional_days BETWEEN 1 AND 60),
  old_end_date DATE NOT NULL,
  new_end_date DATE NOT NULL CHECK (new_end_date > old_end_date),
  additional_fee NUMERIC(10,2) NOT NULL CHECK (additional_fee >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP
);

CREATE INDEX rental_extensions_history_idx ON rental_extensions(rental_id, created_at DESC);
CREATE UNIQUE INDEX rental_extensions_pending_idx ON rental_extensions(rental_id) WHERE status = 'PENDING';
