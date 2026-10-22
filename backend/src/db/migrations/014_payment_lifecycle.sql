-- Preserve legacy refund rows; only new, provider-bound intents are unique.
ALTER TABLE refunds ADD COLUMN request_key UUID;
ALTER TABLE refunds ADD COLUMN gateway_refund_id TEXT;
ALTER TABLE refunds ADD COLUMN refund_kind TEXT NOT NULL DEFAULT 'SECURITY_DEPOSIT';
ALTER TABLE refunds ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX refund_request_once ON refunds(rental_id,refund_kind) WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX refund_gateway_once ON refunds(gateway_refund_id) WHERE gateway_refund_id IS NOT NULL;

CREATE TABLE payment_webhook_events (
  event_id TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
