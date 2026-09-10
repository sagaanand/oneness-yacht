-- ============================================================================
-- ONENESS YACHTS — MIGRATION 003: AUTH, SESSIONS & ENHANCEMENTS
-- ============================================================================

-- 1. Add password_salt column to staff_users (for Node crypto.scrypt)
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS password_salt VARCHAR(64);

-- 2. CUSTOMER SESSIONS TABLE (HttpOnly cookie auth)
CREATE TABLE IF NOT EXISTS customer_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) UNIQUE NOT NULL,   -- SHA-256 of the raw browser token
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  ip_address VARCHAR(64),
  user_agent TEXT,
  auth_provider VARCHAR(30) DEFAULT 'EMAIL_OTP'  -- EMAIL_OTP | GOOGLE | APPLE
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_token_hash ON customer_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id);

-- 3. OTP CODES TABLE (for mobile/email OTP login)
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identifier VARCHAR(200) NOT NULL,         -- email or phone
  identifier_type VARCHAR(20) NOT NULL,     -- EMAIL | PHONE
  code_hash VARCHAR(128) NOT NULL,          -- SHA-256 of 6-digit code
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  attempts INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_otp_identifier ON otp_codes(identifier, identifier_type);

-- 4. OAuth STATE TABLE (for PKCE/state param in Google/Apple OAuth)
CREATE TABLE IF NOT EXISTS oauth_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_token VARCHAR(128) UNIQUE NOT NULL,
  provider VARCHAR(30) NOT NULL,             -- GOOGLE | APPLE
  redirect_after VARCHAR(500),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Add email_verified flag to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(30) DEFAULT 'EMAIL_OTP';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS oauth_provider_id VARCHAR(200);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 6. Add payment_mode and deposit_pct to yachts
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'FULL';   -- FULL | DEPOSIT
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS deposit_pct NUMERIC(5,2) DEFAULT 30.00;    -- % if DEPOSIT
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS speed_knots INTEGER DEFAULT 20;
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS features_json JSONB DEFAULT '[]'::jsonb;
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS amenities_json JSONB DEFAULT '[]'::jsonb;
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS whats_included_json JSONB DEFAULT '[]'::jsonb;
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS marina VARCHAR(150) DEFAULT 'Dubai Marina';
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS cabins INTEGER DEFAULT 0;

-- 7. Add weekend/sunset/holiday per-yacht pricing overrides
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS weekend_rate_override NUMERIC(10,2);
ALTER TABLE yachts ADD COLUMN IF NOT EXISTS sunset_surcharge_override NUMERIC(10,2);

-- 8. ADMIN SESSIONS TABLE
CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_user_id UUID NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  ip_address VARCHAR(64),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);

-- 9. Add image_url to add_ons
ALTER TABLE add_ons ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 10. Seed initial yacht operating hours if not present
INSERT INTO yacht_operating_hours (yacht_id, day_of_week, open_time, close_time, is_closed)
SELECT y.id, d.day, '08:00:00', '23:30:00', FALSE
FROM yachts y
CROSS JOIN (SELECT generate_series(0,6) AS day) d
ON CONFLICT (yacht_id, day_of_week) DO NOTHING;

-- 11. Seed demo yachts into DB if empty
INSERT INTO yachts (slug, title, tower_label, length_ft, capacity_day, cabins, category, booking_mode,
  default_berth, base_hourly_rate, min_charter_hours, max_charter_hours, active, marina,
  description, short_description, speed_knots,
  features_json, amenities_json, whats_included_json, images_json, specs_json)
SELECT
  'dolce-vita-105-ft',
  'Dolce Vita',
  '105 FT Superyacht',
  105, 12, 4, 'vip', 'INSTANT_BOOK',
  'Dubai Marina Yacht Club, Berth 4',
  9000.00, 2, 12, TRUE, 'Dubai Marina',
  'The Dolce Vita is the crown jewel of the Oneness fleet — a 105-foot superyacht that defines private luxury on the water. Designed for intimate gatherings and landmark celebrations, she features expansive sun decks, a master suite, and four beautifully appointed cabins.',
  'Flagship 105ft superyacht. Perfect for intimate celebrations and VIP gatherings.',
  22,
  '["Flybridge Sun Deck","Jacuzzi","Cinema System","Full Bar","Professional Sound System"]'::jsonb,
  '["Master Suite","4 Guest Cabins","Chef''s Galley","Salon","Sundeck Lounge"]'::jsonb,
  '["Captain & Crew","Fuel","Welcome Drinks","Towels & Linens","Life Jackets","Safety Equipment"]'::jsonb,
  '["/assets/images/yacht/DOLCE VITA - 105 Ft/img11.jpg","/assets/images/yacht/DOLCE VITA - 105 Ft/img17.jpg","/assets/images/yacht/DOLCE VITA - 105 Ft/img21.jpg","/assets/images/yacht/DOLCE VITA - 105 Ft/img29.jpg","/assets/images/yacht/DOLCE VITA - 105 Ft/img37.jpg","/assets/images/yacht/DOLCE VITA - 105 Ft/img46.jpg"]'::jsonb,
  '{"type":"Motor Superyacht","beam":"24 ft","draft":"6 ft","engine":"Twin MTU Diesel 3,200 HP","fuel":"6,000 L","speed":"22 knots","generator":"2x 35 kW"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM yachts WHERE slug = 'dolce-vita-105-ft');

INSERT INTO yachts (slug, title, tower_label, length_ft, capacity_day, cabins, category, booking_mode,
  default_berth, base_hourly_rate, min_charter_hours, max_charter_hours, active, marina,
  description, short_description, speed_knots,
  features_json, amenities_json, whats_included_json, images_json, specs_json)
SELECT
  'sunseeker-95-ft',
  'Sunseeker 95',
  '95 FT Sport Yacht',
  95, 10, 3, 'vip', 'INSTANT_BOOK',
  'Dubai Marina Yacht Club, Berth 6',
  6500.00, 2, 10, TRUE, 'Dubai Marina',
  'The Sunseeker 95 combines British sporting pedigree with pure Dubai luxury. An aggressive hull design delivers breathtaking performance, while the interior rivals the finest hotels.',
  'High-performance 95ft British sport yacht — speed meets elegance.',
  28, '["Sports Flybridge","High Performance Hull","Bose Sound System","Water Toys Garage"]'::jsonb,
  '["3 Staterooms","Open Plan Salon","Gourmet Galley","Crew Quarters"]'::jsonb,
  '["Captain & Crew","Fuel","Soft Drinks","Towels","Safety Equipment"]'::jsonb,
  '["/assets/images/yacht/Sunseeker 95 - 95 Ft/1.jpg","/assets/images/yacht/Sunseeker 95 - 95 Ft/2.jpg"]'::jsonb,
  '{"type":"Sport Yacht","builder":"Sunseeker UK","engine":"Twin Volvo IPS","speed":"28+ knots"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM yachts WHERE slug = 'sunseeker-95-ft');

INSERT INTO yachts (slug, title, tower_label, length_ft, capacity_day, cabins, category, booking_mode,
  default_berth, base_hourly_rate, min_charter_hours, max_charter_hours, active, marina,
  description, short_description, speed_knots,
  features_json, amenities_json, whats_included_json, images_json, specs_json)
SELECT
  'benetti-110-ft',
  'Benetti 110',
  '110 FT Italian Superyacht',
  110, 12, 5, 'vip', 'INSTANT_BOOK',
  'Dubai Marina Yacht Club, Berth 2',
  12000.00, 3, 12, TRUE, 'Dubai Marina',
  'Crafted by the legendary Benetti shipyard in Italy, this 110-foot masterpiece represents the pinnacle of Mediterranean yacht building. Five cabins, panoramic salons, and full concierge service.',
  'Hand-crafted Italian superyacht. 5 cabins, panoramic salons.',
  20, '["Sun Deck with Jacuzzi","Panoramic Salon","Full Entertainment Suite","Hydraulic Swim Platform"]'::jsonb,
  '["Master Suite","4 VIP Cabins","Formal Dining","Sky Lounge","Sun Deck"]'::jsonb,
  '["Captain & Full Crew","Fuel","Welcome Champagne","Gourmet Canapés","Towels","Safety Equipment"]'::jsonb,
  '["/assets/images/yacht/BENETTI - 110 Ft/img48.jpg","/assets/images/yacht/BENETTI - 110 Ft/img49.jpg"]'::jsonb,
  '{"type":"Motor Superyacht","builder":"Benetti Italy","speed":"20 knots","cabins":"5"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM yachts WHERE slug = 'benetti-110-ft');

INSERT INTO yachts (slug, title, tower_label, length_ft, capacity_day, cabins, category, booking_mode,
  default_berth, base_hourly_rate, min_charter_hours, max_charter_hours, active, marina,
  description, short_description, speed_knots,
  features_json, amenities_json, whats_included_json, images_json, specs_json)
SELECT
  'majesty-88-ft',
  'Majesty 88',
  '88 FT Gulf Craft Majesty',
  88, 12, 3, 'vip', 'INSTANT_BOOK',
  'Dubai Marina Yacht Club, Berth 8',
  7500.00, 2, 10, TRUE, 'Dubai Marina',
  'The Majesty 88 is a flagship product of Gulf Craft — designed, engineered, and built in the UAE. An expression of regional pride and world-class craftsmanship, perfect for larger groups.',
  'UAE-built 88ft luxury vessel. Ideal for groups up to 12.',
  24, '["Tri-level Layout","Large Sun Deck","Premium Entertainment","Water Sports Platform"]'::jsonb,
  '["3 Staterooms","Spacious Salon","Outdoor Dining","Flybridge Bar"]'::jsonb,
  '["Captain & Crew","Fuel","Soft Beverages","Towels","Safety Equipment"]'::jsonb,
  '["/assets/images/yacht/Majesty - 88 Ft/1.jpg","/assets/images/yacht/Majesty - 88 Ft/2.jpg"]'::jsonb,
  '{"type":"Motor Yacht","builder":"Gulf Craft UAE","speed":"24 knots"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM yachts WHERE slug = 'majesty-88-ft');

INSERT INTO yachts (slug, title, tower_label, length_ft, capacity_day, cabins, category, booking_mode,
  default_berth, base_hourly_rate, min_charter_hours, max_charter_hours, active, marina,
  description, short_description, speed_knots,
  features_json, amenities_json, whats_included_json, images_json, specs_json)
SELECT
  'burkut-177-ft',
  'Burkut',
  '177 FT Mega Yacht',
  177, 50, 8, 'vip', 'CONCIERGE_QUOTE',
  'Dubai International Marine Club, Berth 1',
  28000.00, 4, 24, TRUE, 'Dubai International Marine Club',
  'The Burkut is one of the most impressive mega yachts in the UAE — 177 feet of pure opulence. Eight staterooms, multiple entertainment decks, a cinema, and a helipad. Available exclusively by concierge quote.',
  '177ft mega yacht. 8 staterooms. By concierge quote only.',
  18, '["Helipad","Cinema Room","Multiple Decks","Full Crew of 12","Jacuzzi Pool"]'::jsonb,
  '["Master Owner Suite","7 VIP Staterooms","Formal Dining","Cinema","Gymnasium","Beach Club"]'::jsonb,
  '["Full Professional Crew","All Fuel","Welcome Champagne","Gourmet Catering","Towels & Linens","Full Concierge"]'::jsonb,
  '["/assets/images/yacht/BURKUT - 177 Ft/1.jpg","/assets/images/yacht/BURKUT - 177 Ft/2.jpg"]'::jsonb,
  '{"type":"Mega Yacht","speed":"18 knots","cabins":"8","crew":"12"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM yachts WHERE slug = 'burkut-177-ft');

-- Seed operating hours for newly inserted yachts
INSERT INTO yacht_operating_hours (yacht_id, day_of_week, open_time, close_time, is_closed)
SELECT y.id, d.day, '08:00:00', '23:30:00', FALSE
FROM yachts y
CROSS JOIN (SELECT generate_series(0,6) AS day) d
ON CONFLICT (yacht_id, day_of_week) DO NOTHING;

-- Correct the staff_users mock password hashes with proper scrypt hashes
-- (Will be set by setup script at runtime; placeholder marks them as needing reset)
UPDATE staff_users SET password_salt = 'NEEDS_RESET' WHERE password_salt IS NULL;
