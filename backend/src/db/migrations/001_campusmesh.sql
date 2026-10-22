-- CampusMesh complete schema migration
-- Fresh databases apply this file transactionally; schema_migrations records it once.

-- 001 CORE USERS
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  username VARCHAR(100) UNIQUE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255),
  phone_number VARCHAR(20),
  avatar_url TEXT,
  bio TEXT,
  department VARCHAR(255),
  hostel VARCHAR(255),
  otp VARCHAR(12),
  otp_expiry TIMESTAMP,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  active_mode VARCHAR(20) NOT NULL DEFAULT 'RENT',
  delivery_available BOOLEAN NOT NULL DEFAULT FALSE,
  courier_reliability_score NUMERIC(5,2) NOT NULL DEFAULT 100,
  account_type VARCHAR(30) NOT NULL DEFAULT 'STUDENT',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_mode_check CHECK (active_mode IN ('RENT','DELIVERY'))
);

CREATE TABLE system_config (
  key VARCHAR(100) PRIMARY KEY,
  value VARCHAR(255) NOT NULL,
  description TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 002 MARKETPLACE CART
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  category VARCHAR(255) NOT NULL,
  image_url TEXT,
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  condition VARCHAR(50) NOT NULL DEFAULT 'Good',
  rent_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  deposit NUMERIC(10,2) NOT NULL DEFAULT 0,
  location VARCHAR(255) NOT NULL DEFAULT 'Library',
  pickup_location_id TEXT,
  delivery_available BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0,
  pickup_time VARCHAR(100) NOT NULL DEFAULT '5 min',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  listing_type VARCHAR(30) NOT NULL DEFAULT 'RENTAL',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cart (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INTEGER NOT NULL,
  price_per_day NUMERIC(10,2) NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL,
  delivery_mode VARCHAR(20) NOT NULL DEFAULT 'SELF_PICKUP',
  delivery_requested BOOLEAN NOT NULL DEFAULT FALSE,
  drop_location_id TEXT,
  delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, item_id),
  CONSTRAINT cart_dates_check CHECK (end_date >= start_date)
);

CREATE TABLE wishlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, item_id)
);

CREATE TABLE listing_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interaction_type VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 003 RENTALS PAYMENTS
CREATE TABLE rentals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id),
  borrower_id UUID NOT NULL REFERENCES users(id),
  owner_id UUID NOT NULL REFERENCES users(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  rental_days INTEGER NOT NULL,
  rental_fee NUMERIC(10,2) NOT NULL,
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  booking_amount NUMERIC(10,2) NOT NULL,
  deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_requested BOOLEAN NOT NULL DEFAULT FALSE,
  drop_location_id TEXT,
  outbound_delivery_id UUID,
  return_delivery_id UUID,
  status VARCHAR(60) NOT NULL DEFAULT 'OWNER_PENDING',
  booking_status VARCHAR(60) NOT NULL DEFAULT 'PENDING',
  deposit_status VARCHAR(60) NOT NULL DEFAULT 'PENDING',
  payment_status VARCHAR(60) NOT NULL DEFAULT 'PENDING',
  owner_response VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  owner_responded_at TIMESTAMP,
  deposit_deadline TIMESTAMP,
  qr_code_hash VARCHAR(255),
  qr_generated_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT rental_dates_check CHECK (end_date >= start_date)
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), rental_id UUID REFERENCES rentals(id) ON DELETE CASCADE,
  payment_type VARCHAR(50) NOT NULL DEFAULT 'RENTAL', amount NUMERIC(10,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING', transaction_id VARCHAR(255), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payment_id UUID REFERENCES payments(id), rental_id UUID REFERENCES rentals(id),
  deposit_amount NUMERIC(10,2) NOT NULL, damage_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  refund_amount NUMERIC(10,2) NOT NULL, refund_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  damage_description TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pending_orders (
  id VARCHAR(255) PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_data JSONB NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 004 CAMPUS DELIVERY
CREATE TABLE campus_locations (
  id TEXT PRIMARY KEY, building_id TEXT NOT NULL, building_name TEXT NOT NULL, entrance_name TEXT,
  floor_name TEXT, room_name TEXT, location_type TEXT NOT NULL DEFAULT 'ROOM', route_node_id TEXT,
  x NUMERIC NOT NULL, y NUMERIC NOT NULL, indoor_x NUMERIC, indoor_y NUMERIC,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE campus_pathways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), start_node_id TEXT NOT NULL, end_node_id TEXT NOT NULL,
  distance_meters INTEGER NOT NULL, walking_seconds INTEGER NOT NULL, UNIQUE(start_node_id,end_node_id)
);

CREATE TABLE courier_route_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), courier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_location_id TEXT NOT NULL REFERENCES campus_locations(id), destination_location_id TEXT NOT NULL REFERENCES campus_locations(id),
  route_node_ids TEXT[] NOT NULL DEFAULT '{}', available_from TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  available_until TIMESTAMP NOT NULL, max_detour_meters INTEGER NOT NULL DEFAULT 250,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE delivery_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), rental_id UUID REFERENCES rentals(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL, customer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES users(id) ON DELETE CASCADE, courier_id UUID REFERENCES users(id) ON DELETE SET NULL,
  pickup_location VARCHAR(255) NOT NULL, drop_location VARCHAR(255) NOT NULL DEFAULT 'Campus',
  pickup_location_id TEXT REFERENCES campus_locations(id), destination_location_id TEXT REFERENCES campus_locations(id),
  distance NUMERIC(8,2) NOT NULL DEFAULT 1, estimated_time VARCHAR(100) NOT NULL DEFAULT '10 mins',
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0, courier_earning NUMERIC(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE', pickup_token VARCHAR(255), delivery_token VARCHAR(255),
  declined_by UUID[] NOT NULL DEFAULT '{}', task_type VARCHAR(30) NOT NULL DEFAULT 'RENTAL_OUTBOUND',
  xerox_request_id UUID, courier_route_id UUID REFERENCES courier_route_availability(id), match_score NUMERIC(5,2),
  order_type VARCHAR(30) NOT NULL DEFAULT 'RENTAL', item_description TEXT, special_instructions TEXT,
  travel_mode VARCHAR(20) NOT NULL DEFAULT 'WALK', accepted_at TIMESTAMP, picked_up_at TIMESTAMP, delivered_at TIMESTAMP,
  arrived_pickup_at TIMESTAMP, arrived_destination_at TIMESTAMP, pickup_verified_at TIMESTAMP,
  delivery_verified_at TIMESTAMP, completed_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE delivery_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id UUID NOT NULL REFERENCES delivery_requests(id) ON DELETE CASCADE,
  courier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, match_score NUMERIC(5,2) NOT NULL,
  score_breakdown JSONB NOT NULL DEFAULT '{}', status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  offered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP NOT NULL, responded_at TIMESTAMP,
  UNIQUE(delivery_id,courier_id)
);

CREATE TABLE delivery_location_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id UUID NOT NULL REFERENCES delivery_requests(id) ON DELETE CASCADE,
  courier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, x NUMERIC NOT NULL, y NUMERIC NOT NULL,
  route_node_id TEXT, speed NUMERIC NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 005 HANDOVER EVENTS
CREATE TABLE handover_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id UUID NOT NULL REFERENCES delivery_requests(id) ON DELETE CASCADE,
  stage VARCHAR(40) NOT NULL, credential_hash VARCHAR(128) NOT NULL, otp_hash VARCHAR(128) NOT NULL,
  shown_to_user_id UUID NOT NULL REFERENCES users(id), verified_by_user_id UUID REFERENCES users(id),
  expires_at TIMESTAMP NOT NULL, verified_at TIMESTAMP, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(delivery_id,stage)
);

CREATE TABLE transaction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), rental_id UUID REFERENCES rentals(id) ON DELETE CASCADE,
  delivery_id UUID REFERENCES delivery_requests(id) ON DELETE CASCADE, xerox_request_id UUID,
  event_type VARCHAR(60) NOT NULL, actor_user_id UUID REFERENCES users(id), metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 006 XEROX RECOMMENDATIONS
CREATE TABLE xerox_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES users(id), file_storage_path TEXT, file_data BYTEA, original_filename TEXT NOT NULL,
  page_count INTEGER NOT NULL, copies INTEGER NOT NULL DEFAULT 1, price_per_page NUMERIC(10,2) NOT NULL DEFAULT 3,
  total_amount NUMERIC(10,2) NOT NULL, pickup_location_id TEXT REFERENCES campus_locations(id),
  drop_location_id TEXT NOT NULL REFERENCES campus_locations(id), status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  delivery_id UUID REFERENCES delivery_requests(id), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP,
  CONSTRAINT xerox_price_check CHECK (total_amount = page_count * copies * price_per_page)
);

ALTER TABLE delivery_requests ADD CONSTRAINT delivery_xerox_request_fk
  FOREIGN KEY (xerox_request_id) REFERENCES xerox_requests(id) ON DELETE CASCADE;
ALTER TABLE transaction_events ADD CONSTRAINT event_xerox_request_fk
  FOREIGN KEY (xerox_request_id) REFERENCES xerox_requests(id) ON DELETE CASCADE;
ALTER TABLE rentals ADD CONSTRAINT rentals_outbound_delivery_fk
  FOREIGN KEY (outbound_delivery_id) REFERENCES delivery_requests(id) ON DELETE SET NULL;
ALTER TABLE rentals ADD CONSTRAINT rentals_return_delivery_fk
  FOREIGN KEY (return_delivery_id) REFERENCES delivery_requests(id) ON DELETE SET NULL;

-- 007 INDEXES CONSTRAINTS
CREATE UNIQUE INDEX one_active_courier_route ON courier_route_availability(courier_id) WHERE is_active;
CREATE INDEX listing_interactions_rank_idx ON listing_interactions(listing_id,interaction_type,created_at DESC);
CREATE INDEX rentals_listing_dates_idx ON rentals(listing_id,start_date,end_date);
CREATE INDEX delivery_courier_status_idx ON delivery_requests(courier_id,status);
CREATE INDEX delivery_offers_courier_expiry_idx ON delivery_offers(courier_id,status,expires_at);
CREATE INDEX handover_delivery_stage_idx ON handover_verifications(delivery_id,stage,status);
CREATE INDEX xerox_requester_status_idx ON xerox_requests(requester_id,status);

INSERT INTO system_config(key,value,description) VALUES
  ('deposit_timeout_minutes','30','Deposit deadline'),
  ('platform_fee_fixed','5','Platform fee')
ON CONFLICT(key) DO NOTHING;

INSERT INTO campus_locations(id,building_id,building_name,entrance_name,floor_name,room_name,location_type,route_node_id,x,y,indoor_x,indoor_y) VALUES
  ('entrance','entrance','Main Entrance',NULL,NULL,NULL,'LANDMARK','entrance',110,620,50,50),
  ('admin','admin','Admin Block','Admin Block entrance',NULL,NULL,'LANDMARK','admin',210,500,50,50),
  ('a-block-ground-floor-101','a-block','A-Block','A-Block north entrance','Ground Floor','101','ROOM','a-block',270,370,50,50),
  ('cafeteria-ground-floor-counter-04','cafeteria','Campus Cafeteria','Cafeteria east entrance','Ground Floor','Counter 04','ROOM','cafeteria',230,190,50,50),
  ('xerox-ground-floor-print-counter','xerox','Campus Xerox Desk','Xerox service counter','Ground Floor','Print Counter','ROOM','xerox',425,285,50,50),
  ('library-ground-floor-rental-counter-02','library','Central Library','Library south entrance','Ground Floor','Rental Counter 02','ROOM','library',720,185,50,50),
  ('b-block-ground-floor-101','b-block','B-Block','B-Block south entrance','Ground Floor','101','ROOM','b-block',650,360,50,50),
  ('b-block-second-floor-204','b-block','B-Block','B-Block south entrance','Second Floor','204','ROOM','b-block',650,360,50,50),
  ('parking','parking','Campus Parking',NULL,NULL,NULL,'LANDMARK','parking',480,550,50,50),
  ('hostel-ground-floor-204','hostel','Boys Hostel','Hostel west entrance','Ground Floor','204','ROOM','hostel',830,480,50,50),
  ('girls-hostel','girls-hostel','Girls Hostel','Hostel main entrance','Ground Floor','Reception','ROOM','girls-hostel',900,620,50,50)
ON CONFLICT(id) DO NOTHING;

INSERT INTO campus_pathways(start_node_id,end_node_id,distance_meters,walking_seconds) VALUES
  ('entrance','admin',170,131),('admin','entrance',170,131),('admin','a-block',145,112),('a-block','admin',145,112),
  ('a-block','cafeteria',190,147),('cafeteria','a-block',190,147),('a-block','parking',280,216),('parking','a-block',280,216),
  ('parking','b-block',255,197),('b-block','parking',255,197),('b-block','library',190,147),('library','b-block',190,147),
  ('b-block','hostel',225,174),('hostel','b-block',225,174),('hostel','girls-hostel',165,127),('girls-hostel','hostel',165,127),
  ('cafeteria','xerox',215,166),('xerox','cafeteria',215,166),('xerox','b-block',245,189),('b-block','xerox',245,189),
  ('a-block','xerox',175,135),('xerox','a-block',175,135),('parking','hostel',365,281),('hostel','parking',365,281)
ON CONFLICT(start_node_id,end_node_id) DO NOTHING;
