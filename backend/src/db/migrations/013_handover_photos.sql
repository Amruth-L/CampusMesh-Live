-- Historical handovers remain historical; all future verifications require photos.
CREATE TABLE handover_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES delivery_requests(id),
  stage VARCHAR(24) NOT NULL CHECK (stage IN ('PICKUP','DELIVERY','RETURN_PICKUP','RETURN_RECEIVED','XEROX_PICKUP')),
  uploaded_by UUID NOT NULL REFERENCES users(id),
  object_key TEXT NOT NULL UNIQUE,
  content_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(delivery_id, stage, content_hash)
);
CREATE INDEX handover_photos_delivery ON handover_photos(delivery_id, stage);
