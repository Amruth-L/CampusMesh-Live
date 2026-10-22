-- Tie an offer to the route that produced it; timestamps cannot identify
-- route replacement reliably when saves and matching run concurrently.
ALTER TABLE delivery_offers ADD COLUMN route_availability_id UUID REFERENCES courier_route_availability(id) ON DELETE SET NULL;
