const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Determine database mode
const databaseUrl = process.env.DATABASE_URL || '';
const isPgConfigured = Boolean(databaseUrl.trim());

// In-Memory / File-Persisted Transactional Store for Zero-Friction Local Dev
class TransactionalLocalDatabase {
  constructor() {
    this.tables = {
      yachts: new Map(),
      yacht_operating_hours: new Map(),
      pricing_rules: new Map(),
      cancellation_policies: new Map(),
      add_ons: new Map(),
      customers: new Map(),
      customer_sessions: new Map(),
      admin_sessions: new Map(),
      otp_codes: new Map(),
      staff_users: new Map(),
      holds: new Map(),
      bookings: new Map(),
      booking_events: [],
      booking_addons: new Map(),
      booking_crew_roster: new Map(),
      payments: new Map(),
      maintenance_blocks: new Map(),
      audit_logs: []
    };
    // Yacht-level mutex locks for concurrency serialization
    this.yachtLocks = new Map();
    this.initialized = false;
  }

  async acquireYachtLock(yachtId) {
    while (this.yachtLocks.get(yachtId)) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    this.yachtLocks.set(yachtId, true);
  }

  releaseYachtLock(yachtId) {
    this.yachtLocks.delete(yachtId);
  }

  init() {
    if (this.initialized) return;

    // Load yachts from data/yachts.json
    try {
      const yachtsPath = path.join(__dirname, '..', '..', 'data', 'yachts.json');
      if (fs.existsSync(yachtsPath)) {
        const rawYachts = JSON.parse(fs.readFileSync(yachtsPath, 'utf8'));
        rawYachts.forEach((y, idx) => {
          const id = crypto.randomUUID();
          const parsePrice = (priceStr) => {
            if (!priceStr) return 3500;
            const match = priceStr.toString().replace(/,/g, '').match(/(\d+)/);
            return match ? parseInt(match[1], 10) : 3500;
          };
          const baseRate = parsePrice(y.price);
          let capacity = parseInt(y.capacity, 10);
          if (Array.isArray(y.specs)) {
            const capSpec = y.specs.find(s => /capacity:\s*(\d+)/i.test(s));
            if (capSpec) {
              const m = capSpec.match(/capacity:\s*(\d+)/i);
              if (m) capacity = parseInt(m[1], 10);
            }
          }
          if (!capacity || capacity < 6) capacity = 20;
          const lengthFt = parseInt(y.lengthFt, 10) || 60;
          const category = lengthFt >= 100 ? 'superyacht' : (y.category || 'vip');
          const bookingMode = lengthFt >= 100 ? 'CONCIERGE_QUOTE' : 'INSTANT_BOOK';

          this.tables.yachts.set(id, {
            id,
            slug: y.slug.toLowerCase(),
            title: y.title,
            tower_label: y.tower || `${lengthFt}FT Luxury Yacht`,
            length_ft: lengthFt,
            capacity_day: capacity,
            capacity_overnight: 6,
            cabins: 3,
            category,
            booking_mode: bookingMode,
            default_berth: 'Dubai Marina Yacht Club, Berth 4',
            base_hourly_rate: baseRate,
            min_charter_hours: lengthFt >= 100 ? 3 : 2,
            max_charter_hours: 12,
            default_buffer_before_mins: 15,
            default_buffer_after_mins: 30,
            active: true,
            specs_json: y.specs || [],
            images_json: y.images || [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

          // Operating hours (every day 08:00 to 23:30)
          for (let day = 0; day <= 6; day++) {
            const ohId = crypto.randomUUID();
            this.tables.yacht_operating_hours.set(ohId, {
              id: ohId,
              yacht_id: id,
              day_of_week: day,
              open_time: '08:00:00',
              close_time: '23:30:00',
              is_closed: false
            });
          }
        });
      }
    } catch (e) {
      console.warn('[DB] Warning loading yachts:', e.message);
    }

    // Seed Pricing Rules
    const prId = crypto.randomUUID();
    this.tables.pricing_rules.set(prId, {
      id: prId,
      rule_name: 'Dubai Standard Seasonal Rules',
      description: 'Active pricing engine rules for Dubai Marina fleet including sunset premium and 5% UAE VAT',
      sunset_window_start: '17:00:00',
      sunset_window_end: '20:00:00',
      sunset_hourly_surcharge: 500.00,
      weekend_multiplier: 1.10,
      holiday_multiplier: 1.25,
      vat_rate: 0.05,
      currency: 'AED',
      active: true,
      created_at: new Date().toISOString()
    });

    // Seed Cancellation Policies
    const policies = [
      { name: 'Full Refund Tier (72h+)', hours: 72, pct: 100.00 },
      { name: 'Moderate Tier (48h-72h)', hours: 48, pct: 75.00 },
      { name: 'Strict Tier (24h-48h)', hours: 24, pct: 50.00 },
      { name: 'No Refund Tier (<24h)', hours: 0, pct: 0.00 }
    ];
    policies.forEach(p => {
      const pId = crypto.randomUUID();
      this.tables.cancellation_policies.set(pId, {
        id: pId,
        policy_name: p.name,
        hours_before_departure: p.hours,
        refund_percentage: p.pct,
        admin_override_allowed: true,
        created_at: new Date().toISOString()
      });
    });

    // Seed Dynamic Add-ons Catalogue
    const addons = [
      { code: 'VIP-CHEF', name: 'Private Master Chef Onboard', desc: 'Live gourmet meal preparation with tailored 4-course menu', price: 1800, type: 'FIXED', crew: true, icon: 'fa-utensils', sort: 1 },
      { code: 'BBQ-LIVE', name: 'Live Yacht BBQ Experience', desc: 'Premium grilled meats, seafood skewers & Mediterranean salads', price: 450, type: 'PER_GUEST', crew: true, icon: 'fa-fire-burner', sort: 2 },
      { code: 'VIP-DECOR', name: 'Luxury Celebration Styling', desc: 'Floral installations, helium balloons & customized banner', price: 650, type: 'FIXED', crew: false, icon: 'fa-wand-magic-sparkles', sort: 3 },
      { code: 'JET-SKI', name: 'Yamaha VX Cruiser Jet Ski', desc: 'High-speed water sports companion with dedicated instructor', price: 600, type: 'PER_HOUR', crew: true, icon: 'fa-water', sort: 4 },
      { code: 'VIDEOGRAPHER', name: 'Professional Drone & Video Package', desc: '4K cinematic highlight reel delivered within 48 hours', price: 1200, type: 'FIXED', crew: false, icon: 'fa-video', sort: 5 },
      { code: 'LIVE-DJ', name: 'Live DJ with Sound Setup', desc: 'Curated sunset lounge & party tracks with top-tier Pioneer audio', price: 1500, type: 'FIXED', crew: false, icon: 'fa-compact-disc', sort: 6 },
      { code: 'BEVERAGE-PREM', name: 'Premium Soft Drinks & Mocktails', desc: 'Fresh coconut, exotic mocktails, sparkling waters & ice', price: 120, type: 'PER_GUEST', crew: false, icon: 'fa-glass-water', sort: 7 }
    ];
    addons.forEach(a => {
      const aId = crypto.randomUUID();
      this.tables.add_ons.set(aId, {
        id: aId,
        code: a.code,
        name: a.name,
        description: a.desc,
        price: a.price,
        pricing_type: a.type,
        requires_crew: a.crew,
        taxable: true,
        icon: a.icon,
        active: true,
        sort_order: a.sort,
        created_at: new Date().toISOString()
      });
    });

    // Seed Staff Users
    const staff = [
      { user: 'admin', name: 'Oneness Fleet Director', role: 'SUPER_ADMIN', phone: '+971585441134', lic: 'DIR-001' },
      { user: 'ops', name: 'Rashid Operations Lead', role: 'OPERATIONS', phone: '+971501112233', lic: 'OPS-002' },
      { user: 'concierge', name: 'Elena VIP Concierge', role: 'CONCIERGE', phone: '+971585441134', lic: 'CON-003' },
      { user: 'captain.ahmed', name: 'Captain Ahmed Al-Maktoum', role: 'CREW', phone: '+971509988776', lic: 'DM-MASTER-9821' },
      { user: 'captain.tariq', name: 'Captain Tariq Mansoor', role: 'CREW', phone: '+971504433221', lic: 'DM-MASTER-7734' }
    ];
    staff.forEach(s => {
      const sId = crypto.randomUUID();
      this.tables.staff_users.set(sId, {
        id: sId,
        username: s.user,
        password_hash: 'hash_demo_123',
        full_name: s.name,
        role: s.role,
        phone: s.phone,
        license_number: s.lic,
        active: true,
        created_at: new Date().toISOString()
      });
    });

    // Seed Demo Customers & Today's 4 Charters matching executive dashboard
    if (this.tables.bookings.size === 0) {
      const todayStr = new Date().toISOString().split('T')[0];
      const dolceYacht = Array.from(this.tables.yachts.values()).find(y => y.slug.includes('dolce')) || Array.from(this.tables.yachts.values())[0];
      const majestyYacht = Array.from(this.tables.yachts.values()).find(y => y.slug.includes('majesty')) || Array.from(this.tables.yachts.values())[1];
      const sunseekerYacht = Array.from(this.tables.yachts.values()).find(y => y.slug.includes('sunseeker')) || Array.from(this.tables.yachts.values())[2];
      const captAhmed = Array.from(this.tables.staff_users.values()).find(s => s.username === 'captain.ahmed') || { id: null };
      const captTariq = Array.from(this.tables.staff_users.values()).find(s => s.username === 'captain.tariq') || { id: null };

      const demoCustomers = [
        { id: 'cust_ahmed', name: 'Mr. Ahmed', phone: '+971501112233', email: 'ahmed@dubai.ae' },
        { id: 'cust_sara', name: 'Ms. Sara', phone: '+971502223344', email: 'sara@luxury.com' },
        { id: 'cust_kumar', name: 'Mr. Kumar', phone: '+971585441134', email: 'kumar@vip.com' },
        { id: 'cust_john', name: 'Mr. John', phone: '+971503334455', email: 'john@yachting.co' }
      ];

      demoCustomers.forEach(c => {
        this.tables.customers.set(c.id, {
          id: c.id,
          full_name: c.name,
          email: c.email,
          phone: c.phone,
          nationality: 'UAE / International',
          vip_tier: 'VIP',
          notes: '',
          created_at: new Date().toISOString()
        });
      });

      const demoBookings = [
        {
          id: 'b_1842',
          ref: 'ONY-1842',
          token: 'bat_1842',
          qr: 'qr_1842',
          yacht: majestyYacht,
          cust: demoCustomers[0],
          start: `${todayStr}T10:00:00.000Z`,
          end: `${todayStr}T13:00:00.000Z`,
          guests: 8,
          status: 'CONFIRMED',
          payStatus: 'PAID',
          total: 15000,
          berth: 'Berth 3',
          captId: captAhmed.id,
          specialRequests: 'Morning refreshments & fruits'
        },
        {
          id: 'b_1843',
          ref: 'ONY-1843',
          token: 'bat_1843',
          qr: 'qr_1843',
          yacht: sunseekerYacht,
          cust: demoCustomers[1],
          start: `${todayStr}T14:00:00.000Z`,
          end: `${todayStr}T17:00:00.000Z`,
          guests: 6,
          status: 'READY',
          payStatus: 'PAID',
          total: 13000,
          berth: 'Berth 2',
          captId: captTariq.id,
          specialRequests: 'Canapes & sparkling water'
        },
        {
          id: 'b_4198',
          ref: 'ONY-4198',
          token: 'bat_4198',
          qr: 'qr_4198',
          yacht: dolceYacht,
          cust: demoCustomers[2],
          start: `${todayStr}T17:00:00.000Z`,
          end: `${todayStr}T20:00:00.000Z`,
          guests: 8,
          occasion: 'Birthday Cruise',
          specialRequests: 'Birthday + BBQ',
          status: 'CONFIRMED',
          payStatus: 'PAID',
          total: 20500,
          berth: 'Berth 4',
          captId: captAhmed.id
        },
        {
          id: 'b_1845',
          ref: 'ONY-1845',
          token: 'bat_1845',
          qr: 'qr_1845',
          yacht: majestyYacht,
          cust: demoCustomers[3],
          start: `${todayStr}T20:00:00.000Z`,
          end: `${todayStr}T23:00:00.000Z`,
          guests: 10,
          status: 'PENDING_PAYMENT',
          payStatus: 'UNPAID',
          total: 15000,
          berth: 'Berth 3',
          captId: null,
          specialRequests: 'Starlight dinner cruise'
        }
      ];

      demoBookings.forEach(b => {
        this.tables.bookings.set(b.id, {
          id: b.id,
          booking_ref: b.ref,
          booking_access_token: b.token,
          checkin_qr_token: b.qr,
          hold_id: null,
          yacht_id: b.yacht.id,
          customer_id: b.cust.id,
          start_time: b.start,
          end_time: b.end,
          buffer_before_mins: 15,
          buffer_after_mins: 30,
          effective_start: new Date(new Date(b.start).getTime() - 15 * 60000).toISOString(),
          effective_end: new Date(new Date(b.end).getTime() + 30 * 60000).toISOString(),
          guest_count: b.guests,
          occasion: b.occasion || 'Private Charter',
          special_requests: b.specialRequests || '',
          departure_marina: 'Dubai Marina Yacht Club',
          berth_number: b.berth,
          base_charter_price: b.total * 0.85,
          addons_total: b.total * 0.1,
          vat_amount: b.total * 0.05,
          total_price: b.total,
          pricing_snapshot_json: { grandTotal: b.total, currency: 'AED' },
          booking_status: b.status,
          payment_status: b.payStatus,
          assigned_captain_id: b.captId,
          crew_notes: 'VIP Guest manifest approved',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      });
    }

    this.initialized = true;
    console.log(`[DB-LOCAL] Initialized transactional data store with ${this.tables.yachts.size} fleet vessels and ${this.tables.bookings.size} operational charters.`);
  }

  // Transaction client simulating pg.Client with yacht-level row locking
  async getClient() {
    this.init();
    const self = this;
    let lockedYachtId = null;

    return {
      async query(sqlText, params = []) {
        return self.execute(sqlText, params, (yId) => {
          lockedYachtId = yId;
        });
      },
      async release() {
        if (lockedYachtId) {
          self.releaseYachtLock(lockedYachtId);
          lockedYachtId = null;
        }
      }
    };
  }

  async query(sqlText, params = []) {
    this.init();
    return this.execute(sqlText, params);
  }

  async execute(sqlText, params = [], onLockYacht = null) {
    const text = sqlText.trim().replace(/\s+/g, ' ');

    // 1. SELECT ... FROM yachts ... FOR UPDATE (Locking Protocol)
    if (/SELECT .* FROM yachts .* FOR UPDATE/i.test(text)) {
      const yachtId = params[0];
      await this.acquireYachtLock(yachtId);
      if (onLockYacht) onLockYacht(yachtId);

      const yacht = this.tables.yachts.get(yachtId) || Array.from(this.tables.yachts.values()).find(y => y.slug === yachtId);
      return { rows: yacht ? [{ ...yacht }] : [] };
    }

    // 2. Query yachts
    if (/^SELECT .* FROM yachts/i.test(text)) {
      let results = Array.from(this.tables.yachts.values());
      if (/WHERE id =.*OR slug =/i.test(text) || /WHERE slug =.*OR id =/i.test(text)) {
        const val = (params[0] || '').toLowerCase();
        results = results.filter(y => y.id === params[0] || y.slug === val);
      } else if (/WHERE slug =/i.test(text)) {
        const slug = (params[0] || '').toLowerCase();
        results = results.filter(y => y.slug === slug);
      } else if (/WHERE id =/i.test(text)) {
        const id = params[0];
        results = results.filter(y => y.id === id || y.slug === (id || '').toLowerCase());
      }
      return { rows: results.map(r => ({ ...r })) };
    }

    // 3. Query add_ons
    if (/^SELECT .* FROM add_ons/i.test(text)) {
      let results = Array.from(this.tables.add_ons.values())
        .filter(a => a.active)
        .sort((a, b) => a.sort_order - b.sort_order);
      if (/WHERE code =/i.test(text)) {
        results = results.filter(a => a.code === params[0]);
      } else if (/WHERE id =/i.test(text)) {
        results = results.filter(a => a.id === params[0]);
      }
      return { rows: results.map(r => ({ ...r })) };
    }

    // 4. Query pricing_rules
    if (/^SELECT .* FROM pricing_rules/i.test(text)) {
      const activeRules = Array.from(this.tables.pricing_rules.values()).filter(r => r.active);
      return { rows: activeRules.map(r => ({ ...r })) };
    }

    // 5. Query cancellation_policies
    if (/^SELECT .* FROM cancellation_policies/i.test(text)) {
      const list = Array.from(this.tables.cancellation_policies.values())
        .sort((a, b) => b.hours_before_departure - a.hours_before_departure);
      return { rows: list.map(r => ({ ...r })) };
    }

    // 6. Query yacht_operating_hours
    if (/^SELECT .* FROM yacht_operating_hours/i.test(text)) {
      let results = Array.from(this.tables.yacht_operating_hours.values());
      if (/WHERE yacht_id =/i.test(text)) {
        results = results.filter(oh => oh.yacht_id === params[0]);
      }
      return { rows: results.map(r => ({ ...r })) };
    }

    // 7. Query active holds for a yacht
    if (/^SELECT .* FROM holds/i.test(text)) {
      let list = Array.from(this.tables.holds.values());
      if (/WHERE hold_token =/i.test(text)) {
        list = list.filter(h => h.hold_token === params[0]);
      } else if (/WHERE yacht_id =/i.test(text) && /status = 'ACTIVE'/i.test(text)) {
        const yachtId = params[0];
        const now = new Date().toISOString();
        list = list.filter(h => h.yacht_id === yachtId && h.status === 'ACTIVE' && h.expires_at > now);
      }
      return { rows: list.map(r => ({ ...r })) };
    }

    // 8. Query active bookings for a yacht
    if (/^SELECT .* FROM bookings/i.test(text)) {
      let list = Array.from(this.tables.bookings.values());
      if (/WHERE id =/i.test(text)) {
        list = list.filter(b => b.id === params[0]);
      } else if (/WHERE booking_ref =/i.test(text)) {
        list = list.filter(b => b.booking_ref === params[0]);
      } else if (/WHERE booking_access_token =/i.test(text)) {
        list = list.filter(b => b.booking_access_token === params[0]);
      } else if (/WHERE checkin_qr_token =/i.test(text)) {
        list = list.filter(b => b.checkin_qr_token === params[0]);
      } else if (/WHERE yacht_id =/i.test(text)) {
        const yachtId = params[0];
        list = list.filter(b => b.yacht_id === yachtId && !['CANCELLED', 'NO_SHOW'].includes(b.booking_status));
      }
      return { rows: list.map(r => ({ ...r })) };
    }

    // 9. Query maintenance_blocks
    if (/^SELECT .* FROM maintenance_blocks/i.test(text)) {
      let list = Array.from(this.tables.maintenance_blocks.values());
      if (/WHERE yacht_id =/i.test(text)) {
        list = list.filter(m => m.yacht_id === params[0]);
      }
      return { rows: list.map(r => ({ ...r })) };
    }

    // 10. Query payments by idempotency_key
    if (/^SELECT .* FROM payments WHERE idempotency_key =/i.test(text)) {
      const key = params[0];
      const match = Array.from(this.tables.payments.values()).find(p => p.idempotency_key === key);
      return { rows: match ? [{ ...match }] : [] };
    }

    // 11. Query booking_events
    if (/^SELECT .* FROM booking_events WHERE booking_id =/i.test(text)) {
      const bookingId = params[0];
      const events = this.tables.booking_events
        .filter(e => e.booking_id === bookingId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return { rows: events.map(e => ({ ...e })) };
    }

    // 12. Query staff_users
    if (/^SELECT .* FROM staff_users/i.test(text)) {
      let list = Array.from(this.tables.staff_users.values());
      if (/WHERE role =/i.test(text)) {
        list = list.filter(s => s.role === params[0]);
      } else if (/WHERE id =.*OR username =/i.test(text) || /WHERE id =/i.test(text)) {
        list = list.filter(s => s.id === params[0] || s.username === params[0]);
      }
      return { rows: list.map(r => ({ ...r })) };
    }

    // 12b. Query customers
    if (/^SELECT .* FROM customers/i.test(text)) {
      let list = Array.from(this.tables.customers.values());
      if (/WHERE id =/i.test(text)) {
        list = list.filter(c => c.id === params[0]);
      } else if (/WHERE email =/i.test(text)) {
        list = list.filter(c => c.email && c.email.toLowerCase() === (params[0] || '').toLowerCase());
      } else if (/WHERE phone =/i.test(text)) {
        list = list.filter(c => c.phone === params[0]);
      }
      return { rows: list.map(c => ({ ...c })) };
    }

    // 13. INSERT INTO holds
    if (/^INSERT INTO holds/i.test(text)) {
      const hold = {
        id: params[0] || crypto.randomUUID(),
        hold_token: params[1],
        yacht_id: params[2],
        start_time: params[3],
        end_time: params[4],
        buffer_before_mins: params[5],
        buffer_after_mins: params[6],
        effective_start: params[7],
        effective_end: params[8],
        guest_count: params[9],
        subtotal: params[10],
        addons_total: params[11],
        vat_amount: params[12],
        total_price: params[13],
        pricing_breakdown_json: typeof params[14] === 'string' ? JSON.parse(params[14]) : params[14],
        selected_addons_json: typeof params[15] === 'string' ? JSON.parse(params[15]) : params[15],
        status: params[16] || 'ACTIVE',
        expires_at: params[17],
        created_at: new Date().toISOString()
      };
      this.tables.holds.set(hold.id, hold);
      return { rows: [hold] };
    }

    // 14. UPDATE holds SET ...
    if (/^UPDATE holds SET/i.test(text)) {
      if (/expires_at <=/i.test(text)) {
        const status = params[0];
        const threshold = params[1] || new Date().toISOString();
        const expiredHolds = [];
        for (const hold of this.tables.holds.values()) {
          if (hold.status === 'ACTIVE' && hold.expires_at <= threshold) {
            hold.status = status;
            expiredHolds.push(hold);
          }
        }
        return { rows: expiredHolds };
      }
      if (/expires_at\s*=/i.test(text)) {
        const expiresAt = params[0];
        const holdId = params[1];
        const hold = this.tables.holds.get(holdId) || Array.from(this.tables.holds.values()).find(h => h.id === holdId || h.hold_token === holdId);
        if (hold) {
          hold.expires_at = expiresAt;
          return { rows: [hold] };
        }
        return { rows: [] };
      }
      const status = params[0];
      const holdTokenOrId = params[1];
      const hold = Array.from(this.tables.holds.values()).find(h => h.hold_token === holdTokenOrId || h.id === holdTokenOrId);
      if (hold) {
        hold.status = status;
        return { rows: [hold] };
      }
      return { rows: [] };
    }

    // 15. INSERT INTO customers
    if (/^INSERT INTO customers/i.test(text)) {
      const customer = {
        id: params[0] || crypto.randomUUID(),
        full_name: params[1],
        email: params[2],
        phone: params[3],
        nationality: params[4] || 'UAE / International',
        vip_tier: params[5] || 'STANDARD',
        notes: params[6] || '',
        created_at: new Date().toISOString()
      };
      this.tables.customers.set(customer.id, customer);
      return { rows: [customer] };
    }

    // 16. INSERT INTO bookings
    if (/^INSERT INTO bookings/i.test(text)) {
      const booking = {
        id: params[0] || crypto.randomUUID(),
        booking_ref: params[1],
        booking_access_token: params[2],
        hold_id: params[3],
        yacht_id: params[4],
        customer_id: params[5],
        start_time: params[6],
        end_time: params[7],
        buffer_before_mins: params[8],
        buffer_after_mins: params[9],
        effective_start: params[10],
        effective_end: params[11],
        guest_count: params[12],
        occasion: params[13],
        special_requests: params[14],
        departure_marina: params[15] || 'Dubai Marina',
        berth_number: params[16] || 'Berth 4',
        base_charter_price: params[17],
        addons_total: params[18],
        vat_amount: params[19],
        total_price: params[20],
        pricing_snapshot_json: typeof params[21] === 'string' ? JSON.parse(params[21]) : params[21],
        booking_status: params[22] || 'PENDING_PAYMENT',
        payment_status: params[23] || 'UNPAID',
        checkin_qr_token: params[24],
        source_channel: params[25] || 'WEBSITE_ONLINE',
        assigned_captain_id: params[26] || null,
        crew_notes: params[27] || '',
        created_by_staff_id: params[28] || null,
        confirmed_at: null,
        departed_at: null,
        completed_at: null,
        cancelled_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this.tables.bookings.set(booking.id, booking);
      return { rows: [booking] };
    }

    // 17. UPDATE bookings
    if (/^UPDATE bookings SET/i.test(text)) {
      // Find booking by ID (often last param)
      const bookingId = params[params.length - 1];
      const booking = this.tables.bookings.get(bookingId);
      if (booking) {
        if (/booking_status\s*=\s*'([^']+)'/i.test(text)) {
          booking.booking_status = text.match(/booking_status\s*=\s*'([^']+)'/i)[1];
        } else if (/booking_status\s*=\s*\$(\d+)/i.test(text)) {
          const m = text.match(/booking_status\s*=\s*\$(\d+)/i);
          booking.booking_status = params[parseInt(m[1], 10) - 1];
        }

        if (/payment_status\s*=\s*'([^']+)'/i.test(text)) {
          booking.payment_status = text.match(/payment_status\s*=\s*'([^']+)'/i)[1];
        } else if (/payment_status\s*=\s*\$(\d+)/i.test(text)) {
          const m = text.match(/payment_status\s*=\s*\$(\d+)/i);
          booking.payment_status = params[parseInt(m[1], 10) - 1];
        }
        if (/assigned_captain_id =/i.test(text)) {
          const capMatch = text.match(/assigned_captain_id\s*=\s*\$(\d+)/i);
          if (capMatch) booking.assigned_captain_id = params[parseInt(capMatch[1], 10) - 1];
        }
        if (/start_time =/i.test(text)) {
          // Rescheduling update
          const sMatch = text.match(/start_time\s*=\s*\$(\d+)/i);
          const eMatch = text.match(/end_time\s*=\s*\$(\d+)/i);
          const esMatch = text.match(/effective_start\s*=\s*\$(\d+)/i);
          const eeMatch = text.match(/effective_end\s*=\s*\$(\d+)/i);
          if (sMatch) booking.start_time = params[parseInt(sMatch[1], 10) - 1];
          if (eMatch) booking.end_time = params[parseInt(eMatch[1], 10) - 1];
          if (esMatch) booking.effective_start = params[parseInt(esMatch[1], 10) - 1];
          if (eeMatch) booking.effective_end = params[parseInt(eeMatch[1], 10) - 1];
        }
        if (/confirmed_at =/i.test(text)) booking.confirmed_at = new Date().toISOString();
        if (/departed_at =/i.test(text)) booking.departed_at = new Date().toISOString();
        if (/completed_at =/i.test(text)) booking.completed_at = new Date().toISOString();
        if (/cancelled_at =/i.test(text)) booking.cancelled_at = new Date().toISOString();
        if (/checked_in_at =/i.test(text)) booking.checked_in_at = new Date().toISOString();
        booking.updated_at = new Date().toISOString();
        return { rows: [booking] };
      }
      return { rows: [] };
    }

    // 18. INSERT INTO booking_events
    if (/^INSERT INTO booking_events/i.test(text)) {
      const event = {
        id: this.tables.booking_events.length + 1,
        booking_id: params[0],
        event_type: params[1],
        actor_type: params[2],
        actor_id: params[3] || null,
        metadata: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4] || {},
        created_at: new Date().toISOString()
      };
      this.tables.booking_events.push(event);
      return { rows: [event] };
    }

    // 19. INSERT INTO payments
    if (/^INSERT INTO payments/i.test(text)) {
      const payment = {
        id: params[0] || crypto.randomUUID(),
        booking_id: params[1],
        idempotency_key: params[2],
        payment_intent_id: params[3],
        payment_ref: params[4],
        payment_method: params[5],
        gateway: params[6],
        amount: params[7],
        currency: params[8] || 'AED',
        status: params[9] || 'PENDING',
        failure_reason: params[10] || null,
        gateway_transaction_id: params[11] || null,
        gateway_response_json: typeof params[12] === 'string' ? JSON.parse(params[12]) : params[12] || {},
        refunded_amount: 0.00,
        created_at: new Date().toISOString(),
        paid_at: params[9] === 'PAID' ? new Date().toISOString() : null
      };
      this.tables.payments.set(payment.id, payment);
      return { rows: [payment] };
    }

    // 20. UPDATE payments
    if (/^UPDATE payments SET status =/i.test(text)) {
      const status = params[0];
      const pId = params[params.length - 1];
      const payment = this.tables.payments.get(pId);
      if (payment) {
        payment.status = status;
        if (status === 'PAID') payment.paid_at = new Date().toISOString();
        return { rows: [payment] };
      }
      return { rows: [] };
    }

    // 21. INSERT INTO audit_logs
    if (/^INSERT INTO audit_logs/i.test(text)) {
      const log = {
        id: this.tables.audit_logs.length + 1,
        entity_type: params[0],
        entity_id: params[1],
        action: params[2],
        actor_type: params[3],
        actor_id: params[4] || null,
        changes_json: typeof params[5] === 'string' ? JSON.parse(params[5]) : params[5] || {},
        ip_address: params[6] || '127.0.0.1',
        created_at: new Date().toISOString()
      };
      this.tables.audit_logs.push(log);
      return { rows: [log] };
    }

    // 22. INSERT INTO maintenance_blocks
    if (/^INSERT INTO maintenance_blocks/i.test(text)) {
      const block = {
        id: params[0] || crypto.randomUUID(),
        yacht_id: params[1],
        start_time: params[2],
        end_time: params[3],
        reason: params[4],
        created_by: params[5],
        created_at: new Date().toISOString()
      };
      this.tables.maintenance_blocks.set(block.id, block);
      return { rows: [block] };
    }

    // 23. INSERT INTO admin_sessions
    if (/^INSERT INTO admin_sessions/i.test(text)) {
      const session = {
        id: crypto.randomUUID(),
        staff_user_id: params[0],
        token_hash: params[1],
        expires_at: params[2],
        ip_address: params[3],
        user_agent: params[4],
        created_at: new Date().toISOString(),
        revoked_at: null,
        last_used_at: new Date().toISOString()
      };
      this.tables.admin_sessions.set(session.token_hash, session);
      return { rows: [session] };
    }

    // 24. SELECT FROM admin_sessions
    if (/^SELECT .* FROM admin_sessions/i.test(text)) {
      const tokenHash = params[0];
      const session = this.tables.admin_sessions.get(tokenHash);
      if (session && !session.revoked_at && new Date(session.expires_at) > new Date()) {
        const staff = this.tables.staff_users.get(session.staff_user_id) ||
          Array.from(this.tables.staff_users.values()).find(s => s.id === session.staff_user_id);
        return {
          rows: [{
            ...session,
            username: staff ? staff.username : 'admin',
            full_name: staff ? staff.full_name : 'Fleet Director',
            role: staff ? staff.role : 'SUPER_ADMIN',
            phone: staff ? staff.phone : ''
          }]
        };
      }
      return { rows: [] };
    }

    // 25. INSERT INTO customer_sessions
    if (/^INSERT INTO customer_sessions/i.test(text)) {
      const session = {
        id: crypto.randomUUID(),
        customer_id: params[0],
        token_hash: params[1],
        expires_at: params[2],
        ip_address: params[3],
        user_agent: params[4],
        auth_provider: params[5] || 'EMAIL_OTP',
        created_at: new Date().toISOString(),
        revoked_at: null,
        last_used_at: new Date().toISOString()
      };
      this.tables.customer_sessions.set(session.token_hash, session);
      return { rows: [session] };
    }

    // 26. SELECT FROM customer_sessions
    if (/^SELECT .* FROM customer_sessions/i.test(text)) {
      const tokenHash = params[0];
      const session = this.tables.customer_sessions.get(tokenHash);
      if (session && !session.revoked_at && new Date(session.expires_at) > new Date()) {
        const cust = this.tables.customers.get(session.customer_id) ||
          Array.from(this.tables.customers.values()).find(c => c.id === session.customer_id);
        return {
          rows: [{
            ...session,
            full_name: cust ? cust.full_name : 'Guest',
            email: cust ? cust.email : null,
            phone: cust ? cust.phone : null,
            vip_tier: cust ? cust.vip_tier : 'VIP'
          }]
        };
      }
      return { rows: [] };
    }

    // 27. INSERT INTO otp_codes
    if (/^INSERT INTO otp_codes/i.test(text)) {
      const otp = {
        id: crypto.randomUUID(),
        identifier: params[0],
        identifier_type: params[1],
        code_hash: params[2],
        expires_at: params[3],
        attempts: 0,
        used_at: null,
        created_at: new Date().toISOString()
      };
      this.tables.otp_codes.set(otp.id, otp);
      return { rows: [otp] };
    }

    // 28. SELECT FROM otp_codes
    if (/^SELECT .* FROM otp_codes/i.test(text)) {
      const identifier = params[0];
      const type = params[1];
      const otps = Array.from(this.tables.otp_codes.values())
        .filter(o => o.identifier === identifier && o.identifier_type === type && !o.used_at && new Date(o.expires_at) > new Date());
      otps.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return { rows: otps };
    }

    // 29. UPDATE staff_users
    if (/^UPDATE staff_users SET/i.test(text)) {
      const id = params[params.length - 1];
      const staff = this.tables.staff_users.get(id) ||
        Array.from(this.tables.staff_users.values()).find(s => s.id === id);
      if (staff) {
        if (/password_hash\s*=\s*\$1/.test(text)) staff.password_hash = params[0];
        if (/password_salt\s*=\s*\$2/.test(text)) staff.password_salt = params[1];
        return { rows: [staff] };
      }
      return { rows: [] };
    }

    // Fallback default response
    return { rows: [] };
  }
}

// Global Singleton Setup
let pool = null;
const localDb = new TransactionalLocalDatabase();
localDb.init();

if (isPgConfigured) {
  pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  console.log('[DB] Connected to PostgreSQL with connection pooling.');
} else {
  console.log('[DB] Operating in Zero-Friction Transactional Mode (Production schema compatible, thread-safe yacht locking).');
}

module.exports = {
  isPgConfigured,
  pool,
  localDb,
  query: async (text, params) => {
    if (pool) {
      return pool.query(text, params);
    }
    return localDb.query(text, params);
  },
  getClient: async () => {
    if (pool) {
      return pool.connect();
    }
    return localDb.getClient();
  }
};
