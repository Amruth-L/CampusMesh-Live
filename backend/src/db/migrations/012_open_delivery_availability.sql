-- Availability no longer requires a declared journey. Existing sessions stay route-based.
ALTER TABLE courier_route_availability
  ALTER COLUMN origin_location_id DROP NOT NULL,
  ALTER COLUMN destination_location_id DROP NOT NULL,
  ADD COLUMN availability_mode TEXT NOT NULL DEFAULT 'ROUTE',
  ADD CONSTRAINT courier_availability_mode CHECK (
    (availability_mode = 'OPEN' AND origin_location_id IS NULL AND destination_location_id IS NULL)
    OR (availability_mode = 'ROUTE' AND origin_location_id IS NOT NULL AND destination_location_id IS NOT NULL)
  );
