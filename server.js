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

const filesDir = path.join(__dirname, 'Files');

// Serve all static assets and HTML from Files directory
app.use(express.static(filesDir, {
  extensions: ['html', 'htm']
}));
app.use('/assets', express.static(path.join(filesDir, 'assets')));

// Logging helper for incoming inquiries
const logInquiry = (inquiry) => {
  const logFile = path.join(__dirname, 'inquiries.log');
  const line = `[${new Date().toISOString()}] ${JSON.stringify(inquiry)}\n`;
  fs.appendFileSync(logFile, line);
};

// ============================================================================
// CORE ROUTES (ORIGINAL ONENESS YACHTS WEBSITE)
// ============================================================================

// 1. Homepage
app.get(['/', '/index', '/index.html'], (req, res) => {
  res.sendFile(path.join(filesDir, 'index.html'));
});

// 2. Main Pages (both clean URLs and .html extensions)
const mainPages = [
  'VIP-yacht-rental',
  'standard-yachts',
  'dubai-packages',
  'amenities',
  'blogs',
  'about',
  'contact',
  'new-year-packages',
  'privacy-policy',
  'security-policy',
  'terms-and-conditions'
];

mainPages.forEach((page) => {
  app.get([`/${page}`, `/${page}.html`], (req, res) => {
    res.sendFile(path.join(filesDir, `${page}.html`));
  });
});

// Fleet / Yachts aliases -> redirect to VIP Yacht Rental
app.get(['/fleet', '/fleet.html', '/yachts'], (req, res) => {
  res.redirect('/VIP-yacht-rental.html');
});

// 3. Sub-directories: /yacht/:slug, /packages/:slug, /services/:slug, /amenity/:slug
const subDirs = ['yacht', 'packages', 'services', 'amenity'];

subDirs.forEach((folder) => {
  app.get([`/${folder}/:slug`, `/${folder}/:slug.html`], (req, res, next) => {
    const slug = req.params.slug.replace(/\.html$/, '');
    const candidateFiles = [
      path.join(filesDir, folder, `${slug}.html`),
      path.join(filesDir, folder, `${req.params.slug}`)
    ];
    for (const f of candidateFiles) {
      if (fs.existsSync(f) && !fs.statSync(f).isDirectory()) {
        return res.sendFile(f);
      }
    }
    next();
  });
});

// ============================================================================
// API ENDPOINTS
// ============================================================================

app.post(['/api/inquire', '/api/contact', '/contact.html'], (req, res) => {
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
    res.redirect('/contact.html?submitted=true');
  } catch (err) {
    console.error('Error logging inquiry:', err);
    res.status(500).send('Internal server error');
  }
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// 404 Catch-All -> index.html
app.use((req, res) => {
  res.status(404).sendFile(path.join(filesDir, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  ONENESS YACHTS - ORIGINAL DESIGN SERVER RUNNING`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
