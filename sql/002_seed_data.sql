-- ============================================================================
-- ONENESS YACHTS — ENTERPRISE SEED DATA
-- ============================================================================

-- 1. Default Pricing Rules
INSERT INTO pricing_rules (rule_name, description, sunset_window_start, sunset_window_end, sunset_hourly_surcharge, weekend_multiplier, holiday_multiplier, vat_rate, currency, active)
VALUES (
  'Dubai Standard Seasonal Rules',
  'Active pricing engine rules for Dubai Marina fleet including sunset premium and 5% UAE VAT',
  '17:00:00',
  '20:00:00',
  500.00,
  1.10,
  1.25,
  0.05,
  'AED',
  TRUE
) ON CONFLICT DO NOTHING;

-- 2. Cancellation Policies
INSERT INTO cancellation_policies (policy_name, hours_before_departure, refund_percentage, admin_override_allowed)
VALUES
  ('Full Refund Tier (72h+)', 72, 100.00, TRUE),
  ('Moderate Tier (48h-72h)', 48, 75.00, TRUE),
  ('Strict Tier (24h-48h)', 24, 50.00, TRUE),
  ('No Refund Tier (<24h)', 0, 0.00, TRUE)
ON CONFLICT DO NOTHING;

-- 3. Dynamic Add-ons Catalogue
INSERT INTO add_ons (code, name, description, price, pricing_type, requires_crew, taxable, icon, active, sort_order)
VALUES
  ('VIP-CHEF', 'Private Master Chef Onboard', 'Live gourmet meal preparation with tailored 4-course menu', 1800.00, 'FIXED', TRUE, TRUE, 'fa-utensils', TRUE, 1),
  ('BBQ-LIVE', 'Live Yacht BBQ Experience', 'Premium grilled meats, seafood skewers & Mediterranean salads', 450.00, 'PER_GUEST', TRUE, TRUE, 'fa-fire-burner', TRUE, 2),
  ('VIP-DECOR', 'Luxury Celebration Styling', 'Floral installations, helium balloons & customized banner', 650.00, 'FIXED', FALSE, TRUE, 'fa-wand-magic-sparkles', TRUE, 3),
  ('JET-SKI', 'Yamaha VX Cruiser Jet Ski', 'High-speed water sports companion with dedicated instructor', 600.00, 'PER_HOUR', TRUE, TRUE, 'fa-water', TRUE, 4),
  ('VIDEOGRAPHER', 'Professional Drone & Video Package', '4K cinematic highlight reel delivered within 48 hours', 1200.00, 'FIXED', FALSE, TRUE, 'fa-video', TRUE, 5),
  ('LIVE-DJ', 'Live DJ with Sound Setup', 'Curated sunset lounge & party tracks with top-tier Pioneer audio', 1500.00, 'FIXED', FALSE, TRUE, 'fa-compact-disc', TRUE, 6),
  ('BEVERAGE-PREM', 'Premium Soft Drinks & Mocktails', 'Fresh coconut, exotic mocktails, sparkling waters & ice', 120.00, 'PER_GUEST', FALSE, TRUE, 'fa-glass-water', TRUE, 7)
ON CONFLICT (code) DO UPDATE SET 
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  pricing_type = EXCLUDED.pricing_type;

-- 4. Initial Staff Users (Super Admin, Operations, Concierge, Captain)
INSERT INTO staff_users (username, password_hash, full_name, role, phone, license_number, active)
VALUES
  ('admin', 'pbkdf2_sha256_mock_hash_admin', 'Oneness Fleet Director', 'SUPER_ADMIN', '+971585441134', 'DIR-001', TRUE),
  ('ops', 'pbkdf2_sha256_mock_hash_ops', 'Rashid Operations Lead', 'OPERATIONS', '+971501112233', 'OPS-002', TRUE),
  ('concierge', 'pbkdf2_sha256_mock_hash_concierge', 'Elena VIP Concierge', 'CONCIERGE', '+971585441134', 'CON-003', TRUE),
  ('captain.ahmed', 'pbkdf2_sha256_mock_hash_capt', 'Captain Ahmed Al-Maktoum', 'CREW', '+971509988776', 'DM-MASTER-9821', TRUE),
  ('captain.tariq', 'pbkdf2_sha256_mock_hash_capt2', 'Captain Tariq Mansoor', 'CREW', '+971504433221', 'DM-MASTER-7734', TRUE)
ON CONFLICT (username) DO NOTHING;
