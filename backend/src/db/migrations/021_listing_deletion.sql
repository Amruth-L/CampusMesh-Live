-- Keep listings referenced by rentals so receipts, delivery and returns stay intact.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
