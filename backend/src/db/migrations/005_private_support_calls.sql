-- These records are served only through the authenticated Express API.
-- No direct Supabase browser access is needed. The backend database owner
-- retains access; anon/authenticated roles have no row policies.
ALTER TABLE call_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_verification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE automated_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_turns ENABLE ROW LEVEL SECURITY;
CREATE INDEX support_tickets_user_created_idx ON support_tickets(user_id,created_at DESC);
CREATE INDEX phone_verification_user_created_idx ON phone_verification_attempts(user_id,created_at DESC);
