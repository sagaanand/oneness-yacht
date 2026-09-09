const { server } = require('../server.js');

setTimeout(async () => {
  try {
    const endpoints = [
      'http://localhost:3000/health',
      'http://localhost:3000/booking',
      'http://localhost:3000/admin',
      'http://localhost:3000/crew',
      'http://localhost:3000/api/v1/yachts',
      'http://localhost:3000/api/v1/addons',
      'http://localhost:3000/api/v1/weather/marine'
    ];

    for (const url of endpoints) {
      const res = await fetch(url);
      console.log(`[HTTP TEST] ${url} -> Status ${res.status}`);
      if (res.status >= 400) {
        throw new Error(`Endpoint failed: ${url} returned status ${res.status}`);
      }
    }
    console.log('====================================================');
    console.log('  ALL PAGES & API V1 ROUTES RETURNED 200 OK!');
    console.log('====================================================');
    if (server && server.close) {
      server.close(() => {
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('HTTP TEST FAILURE:', err);
    if (server && server.close) server.close();
    process.exit(1);
  }
}, 1500);
