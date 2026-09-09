require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const { securityHeaders } = require('./src/middleware/security');

// Middleware
app.use(securityHeaders);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
const logInquiry = (inquiry) => {
  const logFile = path.join(__dirname, 'inquiries.log');
  const line = `[${new Date().toISOString()}] ${JSON.stringify(inquiry)}\n`;
  fs.appendFileSync(logFile, line);
};

// Logging helper for charter bookings
const logBooking = (booking) => {
  const logFile = path.join(__dirname, 'bookings.log');
  const line = `[${new Date().toISOString()}] ${JSON.stringify(booking)}\n`;
  fs.appendFileSync(logFile, line);
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
app.get(['/VIP-yacht-rental', '/VIP-yacht-rental.html', '/fleet', '/fleet.html', '/yachts'], (req, res) => {
  res.render('vip-yacht-rental', {
    activeNav: 'vip',
    yachts
  });
});

// 3. Standard Yachts
app.get(['/standard-yachts', '/standard-yachts.html'], (req, res) => {
  res.render('standard-yachts', {
    activeNav: 'standard',
    yachts
  });
});

// 4. Dubai Packages
app.get(['/dubai-packages', '/dubai-packages.html', '/packages'], (req, res) => {
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

// 8b. Dedicated Yacht Booking Engine
app.get(['/booking', '/book-now', '/booking.html'], (req, res) => {
  const selectedSlug = (req.query.yacht || '').toLowerCase().replace(/\.html$/, '');
  const yachtsWithPrice = yachts.map(y => ({
    ...y,
    numericPrice: parsePrice(y.price)
  }));
  res.render('booking', {
    activeNav: 'booking',
    yachts: yachtsWithPrice,
    selectedSlug,
    defaultGuests: req.query.guests || '10',
    defaultDate: req.query.date || ''
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

// 12. Dynamic Yacht Detail Page
app.get(['/yacht/:slug', '/yacht/:slug.html'], (req, res, next) => {
  const slug = req.params.slug.replace(/\.html$/, '').toLowerCase();
  const yacht = yachts.find(y => y.slug.toLowerCase() === slug);

  if (yacht) {
    return res.render('yacht-detail', { yacht });
  }
  next();
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

// Admin Operations OS
app.get(['/admin', '/admin/operations'], async (req, res) => {
  const manifest = await bookingService.getTodaysManifest();
  res.render('admin/operations', {
    activeNav: 'admin',
    todayCharters: manifest.todayCharters,
    metrics: manifest.metrics,
    nextCharter: manifest.nextCharter
  });
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

// Start Server & Background Sweeper
const holdService = require('./src/services/holdService');
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

const server = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  ONENESS YACHTS - NODE.JS (EXPRESS + EJS) RUNNING`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`  Yachts in memory: ${yachts.length}`);
  console.log(`=======================================================`);
});

module.exports = { app, server };


