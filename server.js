require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const { securityHeaders } = require('./src/middleware/security');
const { optionalCustomerAuth } = require('./src/middleware/customerAuth');
const { requireAdminAuth, clearAdminSessionCookie } = require('./src/middleware/adminAuth');
const adminAuthService = require('./src/services/adminAuthService');

// Middleware
app.use(securityHeaders);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Customer session middleware — sets req.customer on all routes
app.use(optionalCustomerAuth);
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload format.' });
  }
  next(err);
});

// Template Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static Assets
const filesDir = path.join(__dirname, 'Files');
app.use('/assets', express.static(path.join(filesDir, 'assets')));
app.use(express.static(filesDir, { extensions: ['html', 'htm'] }));

// Load Yachts Dataset
let yachts = [];
try {
  const yachtsDataPath = path.join(__dirname, 'data', 'yachts.json');
  if (fs.existsSync(yachtsDataPath)) {
    yachts = JSON.parse(fs.readFileSync(yachtsDataPath, 'utf8'));
    console.log(`Loaded ${yachts.length} yachts into memory.`);
  }
} catch (err) {
  console.error('Failed to load data/yachts.json:', err.message);
}

// Helper to parse numeric hourly price from string (e.g. "14,000 AED" -> 14000)
const parsePrice = (priceStr) => {
  if (!priceStr) return 0;
  const match = priceStr.toString().replace(/,/g, '').match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

// Logging helper for incoming inquiries
const LOG_DIR = process.env.VERCEL ? '/tmp' : __dirname;
const logInquiry = (inquiry) => {
  try {
    const logFile = path.join(LOG_DIR, 'inquiries.log');
    const line = `[${new Date().toISOString()}] ${JSON.stringify(inquiry)}\n`;
    fs.appendFileSync(logFile, line);
  } catch (e) { console.log('[LOG]', JSON.stringify(inquiry)); }
};

// Logging helper for charter bookings
const logBooking = (booking) => {
  try {
    const logFile = path.join(LOG_DIR, 'bookings.log');
    const line = `[${new Date().toISOString()}] ${JSON.stringify(booking)}\n`;
    fs.appendFileSync(logFile, line);
  } catch (e) { console.log('[BOOKING]', JSON.stringify(booking)); }
  logInquiry({ ...booking, type: 'Yacht Charter Booking' });
};

// ============================================================================
// CORE NODE.JS ROUTES (AUTHENTIC ONENESS YACHTS APPLICATION)
// ============================================================================

// 1. Homepage
app.get(['/', '/index', '/index.html'], (req, res) => {
  res.render('index', {
    activeNav: 'home',
    yachts
  });
});

// 2. VIP Yacht Rental
// New luxury fleet listing page
app.get(['/yachts', '/fleet'], (req, res) => {
  res.render('yachts', { activeNav: 'yachts' });
});

// Legacy VIP/fleet routes → redirect to new luxury fleet
app.get(['/VIP-yacht-rental', '/VIP-yacht-rental.html', '/fleet.html'], (req, res) => {
  res.redirect(301, '/yachts');
});

// 3. Standard Yachts
app.get(['/standard-yachts', '/standard-yachts.html'], (req, res) => {
  res.render('standard-yachts', {
    activeNav: 'standard',
    yachts
  });
});

// 4. Dubai Packages & Experiences
app.get(['/dubai-packages', '/dubai-packages.html', '/packages', '/experiences'], (req, res) => {
  res.render('dubai-packages', {
    activeNav: 'dubai-packages'
  });
});

// 5. Miami Packages
app.get(['/miami-packages', '/miami-packages.html'], (req, res) => {
  res.render('miami-packages', {
    activeNav: 'miami-packages'
  });
});

// 6. Amenities
app.get(['/amenities', '/amenities.html'], (req, res) => {
  res.render('amenities', {
    activeNav: 'amenities'
  });
});

// 7. About Us
app.get(['/about', '/about.html'], (req, res) => {
  res.render('about', {
    activeNav: 'about'
  });
});

// 8. Contact Us
app.get(['/contact', '/contact.html'], (req, res) => {
  res.render('contact', {
    activeNav: 'contact',
    defaultYacht: req.query.yacht || ''
  });
});

// NEW luxury booking wizard
app.get(['/book', '/book-now'], (req, res) => {
  res.render('book', { activeNav: 'booking' });
});

// Legacy /booking → redirect to new wizard
app.get(['/booking', '/booking.html'], (req, res) => {
  const q = new URLSearchParams(req.query).toString();
  res.redirect(301, `/book${q ? '?' + q : ''}`);
});

// Auth pages
app.get(['/auth', '/signin', '/login'], (req, res) => {
  if (req.customer) return res.redirect(req.query.returnTo || '/account');
  res.render('auth', { activeNav: '' });
});
app.get('/auth/google/callback', async (req, res) => {
  // OAuth callback — exchange code and set session cookie
  const customerAuthService = require('./src/services/customerAuthService');
  const { setSessionCookie } = require('./src/middleware/customerAuth');
  try {
    // In production: exchange code for tokens from Google, extract user info
    // For now, redirect to auth page if not configured
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.redirect('/auth?error=google_not_configured');
    }
    // TODO: Exchange code for Google profile via googleapis
    res.redirect('/auth?error=google_callback_not_fully_implemented');
  } catch (err) {
    res.redirect('/auth?error=oauth_failed');
  }
});

// Customer Account
app.get('/account', async (req, res) => {
  res.render('account', { customer: req.customer || null, activeNav: 'account' });
});

// Booking Confirmed
app.get('/booking-confirmed', (req, res) => {
  res.render('booking-confirmed', { ref: req.query.ref || '', activeNav: '' });
});

// Payment page (Stripe Elements)
app.get('/payment', (req, res) => {
  res.render('payment', {
    bookingId: req.query.bookingId || '',
    clientSecret: req.query.client_secret || '',
    activeNav: ''
  });
});

// 9. Blogs
app.get(['/blogs', '/blogs.html'], (req, res) => {
  res.render('blogs', {
    activeNav: 'blogs'
  });
});

// 10. New Year Packages
app.get(['/new-year-packages', '/new-year-packages.html'], (req, res) => {
  res.render('new-year-packages', {
    activeNav: 'dubai-packages'
  });
});

// 11. Legal Policies
app.get(['/privacy-policy', '/privacy-policy.html'], (req, res) => {
  res.render('privacy-policy', { activeNav: '' });
});
app.get(['/security-policy', '/security-policy.html'], (req, res) => {
  res.render('security-policy', { activeNav: '' });
});
app.get(['/terms-and-conditions', '/terms-and-conditions.html'], (req, res) => {
  res.render('terms-and-conditions', { activeNav: '' });
});

// New luxury yacht detail — tries DB first, falls back to JSON data
app.get(['/yachts/:slug', '/yachts/:slug.html'], async (req, res, next) => {
  const slug = req.params.slug.replace(/\.html$/, '').toLowerCase();
  try {
    const db = require('./src/db/connection');
    const dbRes = await db.query('SELECT * FROM yachts WHERE slug = $1 LIMIT 1', [slug]);
    if (dbRes.rows[0]) {
      const y = dbRes.rows[0];
      if (typeof y.images_json === 'string') try { y.images_json = JSON.parse(y.images_json); } catch {}
      if (typeof y.amenities_json === 'string') try { y.amenities_json = JSON.parse(y.amenities_json); } catch {}
      if (typeof y.whats_included_json === 'string') try { y.whats_included_json = JSON.parse(y.whats_included_json); } catch {}
      if (typeof y.specs_json === 'string') try { y.specs_json = JSON.parse(y.specs_json); } catch {}

      const jsonMatch = yachts.find(item => item.slug && item.slug.toLowerCase() === slug);
      y.images = (Array.isArray(y.images_json) && y.images_json.length) ? y.images_json : (jsonMatch ? jsonMatch.images : ['/assets/images/home/01.jpg']);
      y.specs = (Array.isArray(y.specs_json) && y.specs_json.length) ? y.specs_json : (jsonMatch ? jsonMatch.specs : []);
      y.price = y.base_hourly_rate ? `${parseFloat(y.base_hourly_rate).toLocaleString()} AED / hour` : (jsonMatch ? jsonMatch.price : 'Inquire');
      y.capacity = y.capacity_day || (jsonMatch ? jsonMatch.capacity : 20);
      y.lengthFt = y.length_ft || (jsonMatch ? jsonMatch.lengthFt : 60);
      y.overview = y.description || (jsonMatch ? jsonMatch.overview : '');
      return res.render('yacht-detail', { yacht: y });
    }
  } catch {}
  // Fallback to JSON data
  const yacht = yachts.find(y => y.slug && y.slug.toLowerCase() === slug);
  if (yacht) return res.render('yacht-detail', { yacht });
  next();
});

// Legacy /yacht/:slug → redirect to /yachts/:slug
app.get(['/yacht/:slug', '/yacht/:slug.html'], (req, res) => {
  const slug = req.params.slug.replace(/\.html$/, '').toLowerCase();
  res.redirect(301, `/yachts/${slug}`);
});

// 13. Sub-directories: /packages/:slug, /services/:slug, /amenity/:slug
const subDirs = ['packages', 'services', 'amenity'];
subDirs.forEach((folder) => {
  app.get([`/${folder}/:slug`, `/${folder}/:slug.html`], (req, res, next) => {
    const slug = req.params.slug.replace(/\.html$/, '');
    const viewPath = path.join(__dirname, 'views', folder, `${slug}.ejs`);
    if (fs.existsSync(viewPath)) {
      return res.render(`${folder}/${slug}`);
    }
    next();
  });
});

const apiV1Router = require('./src/routes/apiV1');
const boardingPassService = require('./src/services/boardingPassService');
const bookingService = require('./src/services/bookingService');

// ============================================================================
// ENTERPRISE OPERATIONAL ROUTES & PORTALS
// ============================================================================

// Customer Frictionless Boarding Pass
app.get('/my-charter/:token', async (req, res) => {
  const pass = await boardingPassService.getBoardingPass(req.params.token);
  if (!pass.success) {
    return res.status(404).render('index', { activeNav: 'home', yachts });
  }
  res.render('my-charter', { pass });
});

// Crew Sanitized QR Scan Check-in
app.get('/checkin/:token', async (req, res) => {
  const checkin = await boardingPassService.verifyCheckinToken(req.params.token);
  res.render('checkin-verify', { checkin, token: req.params.token });
});

// Admin Login Page (no auth required)
app.get('/admin/login', async (req, res) => {
  const token = req.cookies && req.cookies.ony_admin_session;
  if (token) {
    const adminUser = await adminAuthService.validateSession(token);
    if (adminUser) return res.redirect('/admin');
    clearAdminSessionCookie(res);
  }
  res.render('admin/login', { error: req.query.error || null });
});

// Admin Operations OS (auth required)
app.get(['/admin', '/admin/operations'], requireAdminAuth(), async (req, res) => {
  try {
    const manifest = await bookingService.getTodaysManifest();
    res.render('admin/operations', {
      activeNav: 'admin',
      adminUser: req.adminUser,
      todayCharters: manifest.todayCharters,
      metrics: manifest.metrics,
      nextCharter: manifest.nextCharter
    });
  } catch (err) {
    res.render('admin/operations', { activeNav: 'admin', adminUser: req.adminUser, todayCharters: [], metrics: {}, nextCharter: null });
  }
});

// Admin Bookings List
app.get('/admin/bookings', requireAdminAuth(), (req, res) => {
  res.render('admin/bookings', { activeNav: 'admin', adminUser: req.adminUser });
});

// Admin Booking Detail
app.get('/admin/bookings/:id', requireAdminAuth(), (req, res) => {
  res.render('admin/booking-detail', { activeNav: 'admin', adminUser: req.adminUser, bookingId: req.params.id });
});

// Admin Yachts Management
app.get('/admin/yachts', requireAdminAuth(), (req, res) => {
  res.render('admin/yachts', { activeNav: 'admin', adminUser: req.adminUser });
});

app.get('/admin/yachts/new', requireAdminAuth(), (req, res) => {
  res.render('admin/yacht-form', { activeNav: 'admin', adminUser: req.adminUser, yachtData: null });
});

app.get('/admin/yachts/:id/edit', requireAdminAuth(), (req, res) => {
  res.render('admin/yacht-form', { activeNav: 'admin', adminUser: req.adminUser, yachtData: null, yachtId: req.params.id });
});

// Admin Pricing
app.get('/admin/pricing', requireAdminAuth(), (req, res) => {
  res.render('admin/pricing', { activeNav: 'admin', adminUser: req.adminUser });
});

// Admin Add-ons
app.get('/admin/addons', requireAdminAuth(), (req, res) => {
  res.render('admin/addons', { activeNav: 'admin', adminUser: req.adminUser });
});

// Admin Availability
app.get('/admin/availability', requireAdminAuth(), (req, res) => {
  res.render('admin/availability', { activeNav: 'admin', adminUser: req.adminUser });
});

// Crew Mobile Run Sheet Portal
app.get(['/crew', '/crew/portal'], (req, res) => {
  res.render('crew/portal', { activeNav: 'crew' });
});

// ============================================================================
// ENTERPRISE API V1 ENGINE
// ============================================================================
app.use('/api/v1', apiV1Router);

// ============================================================================
// LEGACY / RETRO-COMPATIBLE API ENDPOINTS
// ============================================================================

// API: Get yachts list with parsed numeric pricing
app.get('/api/yachts', (req, res) => {
  const list = yachts.map(y => ({
    slug: y.slug,
    title: y.title,
    tower: y.tower,
    lengthFt: y.lengthFt,
    capacity: parseInt(y.capacity, 10) || 20,
    price: y.price,
    numericPrice: parsePrice(y.price),
    category: y.category || 'vip',
    image: (y.images && y.images[0]) || '/assets/images/home/01.jpg'
  }));
  res.json({ success: true, count: list.length, yachts: list });
});

// API: Process Yacht Charter Booking
app.post('/api/bookings', (req, res) => {
  const {
    destination,
    date,
    timeSlot,
    duration,
    guests,
    yachtSlug,
    yachtName,
    addOns,
    guestName,
    guestEmail,
    guestPhone,
    notes,
    basePrice,
    addOnsTotal,
    vatAmount,
    grandTotal
  } = req.body;

  if (!guestName || !guestPhone) {
    return res.status(400).json({ success: false, message: 'Guest name and phone/WhatsApp number are required.' });
  }

  const bookingRef = 'ONY-' + Date.now().toString().slice(-6);
  const bookingRecord = {
    bookingRef,
    timestamp: new Date().toISOString(),
    destination: destination || 'Dubai Marina, UAE',
    date: date || new Date().toISOString().split('T')[0],
    timeSlot: timeSlot || 'Sunset Golden Hour',
    durationHours: parseInt(duration, 10) || 3,
    guests: parseInt(guests, 10) || 10,
    yacht: {
      slug: yachtSlug || '',
      name: yachtName || 'Luxury Yacht'
    },
    addOns: Array.isArray(addOns) ? addOns : [],
    pricing: {
      currency: 'AED',
      basePrice: parseFloat(basePrice) || 0,
      addOnsTotal: parseFloat(addOnsTotal) || 0,
      vatAmount: parseFloat(vatAmount) || 0,
      grandTotal: parseFloat(grandTotal) || 0
    },
    guest: {
      name: guestName,
      email: guestEmail || '',
      phone: guestPhone,
      notes: notes || ''
    },
    status: 'Confirmed - Pending Concierge Handover',
    ip: req.ip
  };

  try {
    logBooking(bookingRecord);
    console.log(`[BOOKING ENGINE] New reservation confirmed: ${bookingRef} for ${guestName} (${yachtName})`);

    return res.json({
      success: true,
      bookingRef,
      message: 'Your luxury yacht charter reservation has been confirmed with Oneness Yachts.',
      booking: bookingRecord
    });
  } catch (err) {
    console.error('Failed to log booking:', err);
    return res.status(500).json({ success: false, message: 'Server error processing booking.' });
  }
});

app.post(['/api/inquire', '/api/contact', '/contact.html', '/contact'], (req, res) => {
  const { name, phone, email, yacht, date, guests, message, notes } = req.body;

  const inquiry = {
    id: 'INQ-' + Date.now(),
    timestamp: new Date().toISOString(),
    name: name || '',
    phone: phone || '',
    email: email || '',
    yacht: yacht || 'General Inquiry',
    date: date || '',
    guests: guests || '',
    notes: notes || message || '',
    ip: req.ip
  };

  try {
    logInquiry(inquiry);
    console.log('New Oneness Yacht Inquiry Received:', inquiry);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({
        success: true,
        inquiryId: inquiry.id,
        message: 'Your inquiry has been received by Oneness Yachts.'
      });
    }
    res.redirect('/contact?submitted=true');
  } catch (err) {
    console.error('Error logging inquiry:', err);
    res.status(500).send('Internal server error');
  }
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    yachtsLoaded: yachts.length
  });
});

// 404 Catch-All -> render index or redirect
app.use((req, res) => {
  res.status(404).render('index', { activeNav: 'home', yachts });
});

// Global Enterprise Error Handler
app.use((err, req, res, next) => {
  console.error(`[UNHANDLED ERROR] ${req.method} ${req.url}:`, err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : (err.message || 'Server error.')
    });
  }
  res.status(500).render('index', { activeNav: 'home', yachts });
});

// Background Hold Sweeper (only in persistent/local environments)
const holdService = require('./src/services/holdService');
if (!process.env.VERCEL) {
  const holdSweeperInterval = setInterval(async () => {
    try {
      const sweep = await holdService.sweepExpiredHolds();
      if (sweep && sweep.sweptCount > 0) {
        console.log(`[HOLD SWEEPER] Auto-swept ${sweep.sweptCount} expired checkout hold(s).`);
      }
    } catch (e) {
      console.error('[HOLD SWEEPER] Error during hold sweep:', e.message);
    }
  }, 60000);
  if (holdSweeperInterval.unref) holdSweeperInterval.unref();
}

// Start server only when running directly (not on Vercel serverless)
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  ONENESS YACHTS - NODE.JS (EXPRESS + EJS) RUNNING`);
    console.log(`  Local URL: http://localhost:${PORT}`);
    console.log(`  Yachts in memory: ${yachts.length}`);
    console.log(`=======================================================`);
  });
  module.exports = { app, server };
} else {
  module.exports = app;
}
