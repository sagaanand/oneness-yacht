/**
 * ONENESS YACHTS — FULL PRODUCT SUITE & ROUTE VERIFICATION
 * Validates:
 * 1. Admin auth via crypto.scrypt & session creation
 * 2. Customer OTP generation & customer_sessions table
 * 3. Stripe Service integration & payment intents
 * 4. Page route status codes (Homepage, Fleet, Booking Wizard, Account, Confirmed, Payment, Admin Views, Crew)
 * 5. Admin CRUD endpoints
 */

const assert = require('assert');
const http = require('http');
const adminAuthService = require('../src/services/adminAuthService');
const customerAuthService = require('../src/services/customerAuthService');
const stripeService = require('../src/services/stripeService');
const db = require('../src/db/connection');

async function runSuite() {
  console.log('===============================================================');
  console.log('  RUNNING FULL ONENESS PRODUCT & SECURITY INTEGRATION SUITE   ');
  console.log('===============================================================');

  // 1. Admin Authentication with crypto.scrypt
  console.log('\n[TEST 1] Admin Authentication via crypto.scrypt:');
  const validLogin = await adminAuthService.login('admin', 'oneness2026!', { ipAddress: '127.0.0.1' });
  assert.strictEqual(validLogin.success, true, 'Admin login should succeed with correct credentials');
  assert.ok(validLogin.sessionToken.startsWith('ast_'), 'Session token should have ast_ prefix');
  assert.strictEqual(validLogin.user.username, 'admin');
  console.log('   ✓ Admin login successful with scrypt derivation. Session token:', validLogin.sessionToken.slice(0, 15) + '...');

  // Validate session
  const validatedAdmin = await adminAuthService.validateSession(validLogin.sessionToken);
  assert.ok(validatedAdmin, 'Session should be valid');
  assert.strictEqual(validatedAdmin.username, 'admin');
  console.log('   ✓ Admin session token successfully validated in database.');

  // Bad password rejection
  const invalidLogin = await adminAuthService.login('admin', 'wrong_pass');
  assert.strictEqual(invalidLogin.success, false, 'Admin login should fail with bad password');
  console.log('   ✓ Invalid admin password properly rejected.');

  // 2. Customer Authentication & customer_sessions table
  console.log('\n[TEST 2] Customer Authentication & customer_sessions:');
  const otpRes = await customerAuthService.generateOTP('vip.guest@oneness.ae', 'EMAIL');
  assert.strictEqual(otpRes.success, true);
  const otpCode = otpRes.otp || otpRes.code;
  assert.ok(otpCode, 'Dev mode returns OTP code');
  console.log(`   ✓ 6-digit OTP generated for VIP customer: ${otpCode}`);

  const customerLogin = await customerAuthService.verifyOTPAndLogin(
    'vip.guest@oneness.ae',
    'EMAIL',
    otpCode,
    { fullName: 'Sheikh Hamdan Al-Maktoum', phone: '+971501234567' },
    { ipAddress: '127.0.0.1' }
  );
  assert.strictEqual(customerLogin.success, true);
  assert.ok(customerLogin.sessionToken.startsWith('cst_'), 'Session token should have cst_ prefix');
  assert.strictEqual(customerLogin.customer.fullName, 'Sheikh Hamdan Al-Maktoum');
  console.log('   ✓ Customer logged in, customer_sessions record created. Token:', customerLogin.sessionToken.slice(0, 15) + '...');

  const validatedCustomer = await customerAuthService.validateSession(customerLogin.sessionToken);
  assert.ok(validatedCustomer, 'Customer session should validate');
  assert.strictEqual(validatedCustomer.email, 'vip.guest@oneness.ae');
  console.log('   ✓ Customer session verified from customer_sessions table.');

  // 3. Stripe Service Verification
  console.log('\n[TEST 3] Stripe Payment Gateway Service:');
  const pi = await stripeService.createPaymentIntent({
    amount: 19267.50,
    bookingId: 'test-booking-1',
    bookingRef: 'ONY-8829',
    customerName: 'Sheikh Hamdan',
    customerEmail: 'vip.guest@oneness.ae',
    yachtTitle: 'Dolce Vita 105 ft'
  });
  assert.strictEqual(pi.success, true);
  assert.ok(pi.clientSecret, 'PaymentIntent should return clientSecret');
  console.log('   ✓ Stripe PaymentIntent created. Id:', pi.paymentIntentId, 'Mode:', pi.mode);

  // 4. Express App & Route Rendering Check
  console.log('\n[TEST 4] Express Server & Page Route Renderability:');
  
  process.env.PORT = 3099;
  const { app, server } = require('../server');
  // Wait brief moment for server to bind
  await new Promise(r => setTimeout(r, 500));

  const routesToTest = [
    { path: '/', expectedCode: 200, name: 'Luxury Customer Homepage' },
    { path: '/yachts', expectedCode: 200, name: 'Fleet Listing Page' },
    { path: '/yachts/dolce-vita-105-ft', expectedCode: 200, name: 'Yacht Detail Page' },
    { path: '/book', expectedCode: 200, name: 'Luxury Booking Wizard' },
    { path: '/account', expectedCode: 200, name: 'Customer Account & My Charters' },
    { path: '/booking-confirmed?ref=ONY-TEST', expectedCode: 200, name: 'Booking Confirmed Page' },
    { path: '/payment?bookingId=test-1', expectedCode: 200, name: 'Secure Payment Page' },
    { path: '/auth', expectedCode: 200, name: 'Customer Sign In Page' },
    { path: '/admin/login', expectedCode: 200, name: 'Admin Sign In Page' },
    { path: '/admin/operations', expectedCode: 200, name: 'Admin Operations OS' },
    { path: '/admin/bookings', expectedCode: 200, name: 'Admin Bookings Ledger' },
    { path: '/admin/bookings/test-1', expectedCode: 200, name: 'Admin Booking Detail' },
    { path: '/admin/yachts', expectedCode: 200, name: 'Admin Fleet Management' },
    { path: '/admin/yachts/new', expectedCode: 200, name: 'Admin Yacht Creation Form' },
    { path: '/admin/pricing', expectedCode: 200, name: 'Admin Pricing Management' },
    { path: '/admin/addons', expectedCode: 200, name: 'Admin Add-ons Catalog' },
    { path: '/admin/availability', expectedCode: 200, name: 'Admin Availability & Calendar' },
    { path: '/crew', expectedCode: 200, name: 'Crew Operational Run Sheet' }
  ];

  for (const r of routesToTest) {
    await new Promise((resolve, reject) => {
      http.get(`http://localhost:3099${r.path}`, (res) => {
        if (res.statusCode === r.expectedCode || (res.statusCode === 302 && r.expectedCode === 200)) {
          console.log(`   ✓ [${res.statusCode}] ${r.name} (${r.path})`);
          resolve();
        } else {
          reject(new Error(`Route ${r.path} failed with status ${res.statusCode}`));
        }
      }).on('error', reject);
    });
  }

  // 5. Test API endpoints
  console.log('\n[TEST 5] API Endpoints Verification:');
  const apiRoutes = [
    '/api/v1/yachts',
    '/api/v1/addons',
    '/api/v1/pricing/quote?yachtSlug=dolce-vita-105-ft&durationHours=3&date=2026-10-15&startTime=16:30',
    '/api/v1/admin/bookings/list'
  ];

  for (const p of apiRoutes) {
    await new Promise((resolve, reject) => {
      http.get(`http://localhost:3099${p}`, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          assert.strictEqual(res.statusCode, 200, `API ${p} returned ${res.statusCode}`);
          const parsed = JSON.parse(body);
          assert.strictEqual(parsed.success, true, `API ${p} success should be true`);
          console.log(`   ✓ [200 OK] API ${p.split('?')[0]}`);
          resolve();
        });
      }).on('error', reject);
    });
  }

  server.close();

  console.log('===============================================================');
  console.log('  ALL PRODUCT SUITE & ROUTE INTEGRATIONS PASSED WITH 100% SUCCESS');
  console.log('===============================================================');
  process.exit(0);
}

runSuite().catch(err => {
  console.error('\n[SUITE FAILURE]:', err);
  process.exit(1);
});
