const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Logging helper for incoming inquiries
const logInquiry = (inquiry) => {
  const logFile = path.join(__dirname, 'inquiries.log');
  const line = `[${new Date().toISOString()}] ${JSON.stringify(inquiry)}\n`;
  fs.appendFileSync(logFile, line);
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

// ============================================================================
// API ENDPOINTS
// ============================================================================

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

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  ONENESS YACHTS - NODE.JS (EXPRESS + EJS) RUNNING`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`  Yachts in memory: ${yachts.length}`);
  console.log(`=======================================================`);
});
