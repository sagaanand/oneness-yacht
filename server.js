const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Load Datasets
const yachts = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'yachts.json'), 'utf8'));
const packages = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'packages.json'), 'utf8'));
const services = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'services.json'), 'utf8'));
const blogs = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'blogs.json'), 'utf8'));
const gallery = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'gallery.json'), 'utf8'));

// Middleware
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
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'Files', 'assets')));

// Logging helper for incoming inquiries
const logInquiry = (inquiry) => {
  const logFile = path.join(__dirname, 'inquiries.log');
  const line = `[${new Date().toISOString()}] ${JSON.stringify(inquiry)}\n`;
  fs.appendFileSync(logFile, line);
};

// ============================================================================
// CORE ROUTES
// ============================================================================

// 1. Homepage
app.get(['/', '/index.html'], (req, res) => {
  res.render('index', {
    yachts,
    packages,
    services,
    blogs,
    gallery,
    title: 'Oneness: Luxury Yacht Charters & VIP Rentals Dubai'
  });
});

// 2. Fleet Browser
app.get(['/fleet', '/fleet.html', '/yachts'], (req, res) => {
  const filter = req.query.filter || 'all';
  res.render('fleet', {
    yachts,
    filter,
    title: 'Prestige Fleet (39 Yachts) | Oneness Luxury Yachts Dubai'
  });
});

// Backward compatibility redirects for legacy categories
app.get(['/VIP-yacht-rental.html', '/vip-yacht-rental'], (req, res) => {
  res.redirect('/fleet?filter=vip');
});
app.get(['/standard-yachts.html', '/standard-yachts'], (req, res) => {
  res.redirect('/fleet?filter=standard');
});

// 3. Single Yacht Showcase
app.get(['/yacht/:slug', '/yacht/:slug.html'], (req, res) => {
  let slug = req.params.slug.replace(/\.html$/, '');
  const yacht = yachts.find(y => y.slug.toLowerCase() === slug.toLowerCase());

  if (!yacht) {
    return res.status(404).render('404', { activeNav: '' });
  }

  res.render('yacht-detail', {
    yacht,
    activeNav: 'fleet',
    title: `${yacht.title} (${yacht.lengthFt} FT) | Oneness Luxury Yachts Dubai`
  });
});

// 4. Packages & Celebrations
app.get(['/packages', '/dubai-packages.html', '/dubai-packages', '/new-year-packages.html'], (req, res) => {
  res.render('packages', {
    packages,
    activeNav: 'packages',
    title: 'Dubai Luxury Yacht Packages & Celebrations | Oneness Yachts'
  });
});

app.get('/packages/:slug', (req, res) => {
  const slug = req.params.slug.replace(/\.html$/, '');
  const pkg = packages.find(p => p.slug === slug) || packages[0];
  res.render('packages', {
    packages: [pkg, ...packages.filter(p => p.slug !== slug)],
    activeNav: 'packages',
    title: `${pkg.title} | Oneness Luxury Yachts Dubai`
  });
});

// 5. Amenities & VIP Services
app.get(['/amenities', '/amenities.html', '/services'], (req, res) => {
  res.render('amenities', {
    services,
    activeNav: 'amenities',
    title: 'Luxury Yacht Amenities & Services Dubai | Oneness Yachts'
  });
});

// 6. About Page
app.get(['/about', '/about.html'], (req, res) => {
  res.render('about', {
    activeNav: 'about',
    title: 'About Oneness Luxury Yachts | 16+ Years of Dubai Nautical Excellence'
  });
});

// 7. Contact & Booking Page
app.get(['/contact', '/contact.html'], (req, res) => {
  const defaultYacht = req.query.yacht || '';
  res.render('contact', {
    defaultYacht,
    activeNav: 'contact',
    title: 'Contact VIP Concierge | Oneness Luxury Yachts Dubai'
  });
});

// 8. Blogs Page
app.get(['/blogs', '/blogs.html'], (req, res) => {
  res.render('blogs', {
    blogs,
    activeNav: 'blogs',
    title: 'Luxury Yachting & Dubai Stories | Oneness Yachts Blog'
  });
});


// ============================================================================
// API ENDPOINTS
// ============================================================================

app.post(['/api/inquire', '/api/contact'], (req, res) => {
  const { name, phone, email, yacht, date, guests, notes } = req.body;

  if (!name || !phone) {
    return res.status(400).json({
      success: false,
      message: 'Please provide at least your name and a contact phone/WhatsApp number.'
    });
  }

  const inquiry = {
    id: 'INQ-' + Date.now(),
    timestamp: new Date().toISOString(),
    name,
    phone,
    email: email || '',
    yacht: yacht || 'General Inquiry',
    date: date || '',
    guests: guests || '10',
    notes: notes || '',
    ip: req.ip
  };

  try {
    logInquiry(inquiry);
    console.log('New VIP Yacht Inquiry Received:', inquiry);

    res.json({
      success: true,
      inquiryId: inquiry.id,
      message: 'Your charter inquiry has been received by the Oneness Concierge team.'
    });
  } catch (err) {
    console.error('Error logging inquiry:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error while saving inquiry.'
    });
  }
});

// Health Check Endpoint for Orchestrators & Load Balancers
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    vesselsLoaded: yachts.length
  });
});

// 404 Catch-All
app.use((req, res) => {
  res.status(404).render('404', { activeNav: '', title: '404 - Horizon Not Found | Oneness Luxury Yachts Dubai' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  ONENESS LUXURY YACHTS - NODE.JS SERVER RUNNING`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`  Fleet Yachts Loaded: ${yachts.length}`);
  console.log(`  Packages Loaded: ${packages.length}`);
  console.log(`  Services Loaded: ${services.length}`);
  console.log(`=======================================================`);
});
