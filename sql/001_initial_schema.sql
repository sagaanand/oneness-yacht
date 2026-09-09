-- ============================================================================
-- ONENESS YACHTS — ENTERPRISE DATABASE SCHEMA (POSTGRESQL 14+)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Dual State Machines & Core Enums
DO $$ BEGIN
  CREATE TYPE booking_status_enum AS ENUM (
    'DRAFT',
    'HELD',
    'PENDING_PAYMENT',
    'CONFIRMED',
    'CREW_ASSIGNED',
    'READY',
    'DEPARTED',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status_enum AS ENUM (
    'UNPAID',
    'PENDING',
    'PAID',
    'FAILED',
    'PARTIALLY_REFUNDED',
    'REFUNDED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE hold_status_enum AS ENUM (
    'ACTIVE',
    'EXPIRED',
    'CONVERTED',
    'RELEASED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_mode_enum AS ENUM (
    'INSTANT_BOOK',
    'CONCIERGE_QUOTE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE addon_pricing_type_enum AS ENUM (
    'FIXED',
    'PER_GUEST',
    'PER_HOUR'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE crew_role_enum AS ENUM (
    'CAPTAIN',
    'FIRST_MATE',
    'STEWARDESS',
    'CHEF',
    'DECKHAND'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE staff_role_enum AS ENUM (
    'SUPER_ADMIN',
    'OPERATIONS',
    'CONCIERGE',
    'CREW'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 1. FLEET REGISTRY
CREATE TABLE IF NOT EXISTS yachts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(150) NOT NULL,
  tower_label VARCHAR(100),
  length_ft INTEGER NOT NULL,
  capacity_day INTEGER NOT NULL,
  capacity_overnight INTEGER DEFAULT 0,
  cabins INTEGER DEFAULT 0,
  category VARCHAR(50) DEFAULT 'vip',
  booking_mode booking_mode_enum DEFAULT 'INSTANT_BOOK',
  default_berth VARCHAR(100) DEFAULT 'Dubai Marina Yacht Club, Berth 4',
  base_hourly_rate NUMERIC(10, 2) NOT NULL,
  min_charter_hours INTEGER DEFAULT 2,
  max_charter_hours INTEGER DEFAULT 12,
  default_buffer_before_mins INTEGER DEFAULT 15,
  default_buffer_after_mins INTEGER DEFAULT 30,
  active BOOLEAN DEFAULT TRUE,
  specs_json JSONB DEFAULT '{}'::jsonb,
  images_json JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. YACHT OPERATING WINDOWS
CREATE TABLE IF NOT EXISTS yacht_operating_hours (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  yacht_id UUID NOT NULL REFERENCES yachts(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time TIME NOT NULL DEFAULT '08:00:00',
  close_time TIME NOT NULL DEFAULT '23:30:00',
  is_closed BOOLEAN DEFAULT FALSE,
  UNIQUE(yacht_id, day_of_week)
);

-- 3. PRICING RULES
CREATE TABLE IF NOT EXISTS pricing_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_name VARCHAR(100) NOT NULL,
  description TEXT,
  sunset_window_start TIME DEFAULT '17:00:00',
  sunset_window_end TIME DEFAULT '20:00:00',
  sunset_hourly_surcharge NUMERIC(10, 2) DEFAULT 500.00,
  weekend_multiplier NUMERIC(4, 2) DEFAULT 1.10,
  holiday_multiplier NUMERIC(4, 2) DEFAULT 1.25,
  vat_rate NUMERIC(4, 2) DEFAULT 0.05,
  currency VARCHAR(10) DEFAULT 'AED',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CANCELLATION POLICIES
CREATE TABLE IF NOT EXISTS cancellation_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_name VARCHAR(100) NOT NULL,
  hours_before_departure INTEGER NOT NULL,
  refund_percentage NUMERIC(5, 2) NOT NULL,
  admin_override_allowed BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ADD-ONS CATALOGUE
CREATE TABLE IF NOT EXISTS add_ons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  price NUMERIC(10, 2) NOT NULL,
  pricing_type addon_pricing_type_enum NOT NULL DEFAULT 'FIXED',
  requires_crew BOOLEAN DEFAULT FALSE,
  taxable BOOLEAN DEFAULT TRUE,
  icon VARCHAR(50),
  active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. CUSTOMERS (Frictionless)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150),
  phone VARCHAR(50) NOT NULL,
  nationality VARCHAR(80),
  vip_tier VARCHAR(50) DEFAULT 'STANDARD',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. STAFF & CREW MEMBERS
CREATE TABLE IF NOT EXISTS staff_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(80) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role staff_role_enum NOT NULL DEFAULT 'CREW',
  phone VARCHAR(50),
  license_number VARCHAR(100),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. HOLDS (Server-Authoritative 15-Min Reservations)
CREATE TABLE IF NOT EXISTS holds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hold_token VARCHAR(64) UNIQUE NOT NULL,
  yacht_id UUID NOT NULL REFERENCES yachts(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  buffer_before_mins INTEGER NOT NULL DEFAULT 15,
  buffer_after_mins INTEGER NOT NULL DEFAULT 30,
  effective_start TIMESTAMPTZ NOT NULL,
  effective_end TIMESTAMPTZ NOT NULL,
  guest_count INTEGER NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL,
  addons_total NUMERIC(10, 2) NOT NULL,
  vat_amount NUMERIC(10, 2) NOT NULL,
  total_price NUMERIC(10, 2) NOT NULL,
  pricing_breakdown_json JSONB NOT NULL,
  selected_addons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status hold_status_enum NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_hold_interval CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_holds_yacht_active_interval 
  ON holds (yacht_id, effective_start, effective_end) 
  WHERE status = 'ACTIVE';

-- 9. BOOKINGS (Core Operations Entity)
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_ref VARCHAR(20) UNIQUE NOT NULL,
  booking_access_token VARCHAR(64) UNIQUE NOT NULL,
  hold_id UUID REFERENCES holds(id),
  yacht_id UUID NOT NULL REFERENCES yachts(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  buffer_before_mins INTEGER NOT NULL DEFAULT 15,
  buffer_after_mins INTEGER NOT NULL DEFAULT 30,
  effective_start TIMESTAMPTZ NOT NULL,
  effective_end TIMESTAMPTZ NOT NULL,
  
  guest_count INTEGER NOT NULL,
  occasion VARCHAR(100),
  special_requests TEXT,
  departure_marina VARCHAR(150) NOT NULL DEFAULT 'Dubai Marina',
  berth_number VARCHAR(50) DEFAULT 'Berth 4',
  
  base_charter_price NUMERIC(10, 2) NOT NULL,
  addons_total NUMERIC(10, 2) NOT NULL,
  vat_amount NUMERIC(10, 2) NOT NULL,
  total_price NUMERIC(10, 2) NOT NULL,
  pricing_snapshot_json JSONB NOT NULL,
  
  booking_status booking_status_enum NOT NULL DEFAULT 'PENDING_PAYMENT',
  payment_status payment_status_enum NOT NULL DEFAULT 'UNPAID',
  
  assigned_captain_id UUID REFERENCES staff_users(id),
  crew_notes TEXT,
  checkin_qr_token VARCHAR(100) UNIQUE NOT NULL,
  checked_in_at TIMESTAMPTZ,
  
  source_channel VARCHAR(50) DEFAULT 'WEBSITE_ONLINE',
  created_by_staff_id UUID REFERENCES staff_users(id),
  
  confirmed_at TIMESTAMPTZ,
  departed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_booking_interval CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_bookings_yacht_interval 
  ON bookings (yacht_id, effective_start, effective_end)
  WHERE booking_status NOT IN ('CANCELLED', 'NO_SHOW');

-- 10. BOOKING EVENTS (Operational Timeline)
CREATE TABLE IF NOT EXISTS booking_events (
  id BIGSERIAL PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_type VARCHAR(60) NOT NULL,
  actor_type VARCHAR(40) NOT NULL,
  actor_id VARCHAR(100),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_events_timeline 
  ON booking_events(booking_id, created_at ASC);

-- 11. BOOKING ADD-ONS LINE ITEMS
CREATE TABLE IF NOT EXISTS booking_addons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_id UUID NOT NULL REFERENCES add_ons(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL,
  total_price NUMERIC(10, 2) NOT NULL,
  notes TEXT
);

-- 12. BOOKING CREW ROSTER
CREATE TABLE IF NOT EXISTS booking_crew_roster (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  staff_user_id UUID NOT NULL REFERENCES staff_users(id),
  role_on_board crew_role_enum NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  UNIQUE(booking_id, staff_user_id)
);

-- 13. PAYMENTS LEDGER (Idempotent)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(120) UNIQUE NOT NULL,
  payment_intent_id VARCHAR(150) UNIQUE,
  payment_ref VARCHAR(100) UNIQUE NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  gateway VARCHAR(50) NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'AED',
  status payment_status_enum NOT NULL DEFAULT 'PENDING',
  failure_reason TEXT,
  gateway_transaction_id VARCHAR(150),
  gateway_response_json JSONB DEFAULT '{}'::jsonb,
  refunded_amount NUMERIC(10, 2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- 14. MAINTENANCE BLOCKS
CREATE TABLE IF NOT EXISTS maintenance_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  yacht_id UUID NOT NULL REFERENCES yachts(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  reason VARCHAR(200) NOT NULL,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_maint_interval CHECK (end_time > start_time)
);

-- 15. AUDIT LOGS (Security Trail)
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  actor_type VARCHAR(50) NOT NULL,
  actor_id VARCHAR(100),
  changes_json JSONB DEFAULT '{}'::jsonb,
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
