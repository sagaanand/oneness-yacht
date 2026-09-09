const https = require('https');
const fs = require('fs');

const pages = [
  { name: 'index.html', url: 'https://onenessyachts.com/' },
  { name: 'VIP-yacht-rental.html', url: 'https://onenessyachts.com/VIP-yacht-rental' },
  { name: 'standard-yachts.html', url: 'https://onenessyachts.com/standard-yachts' },
  { name: 'dubai-packages.html', url: 'https://onenessyachts.com/dubai-packages' },
  { name: 'amenities.html', url: 'https://onenessyachts.com/amenities' },
  { name: 'blogs.html', url: 'https://onenessyachts.com/blogs' },
  { name: 'about.html', url: 'https://onenessyachts.com/about' },
  { name: 'contact.html', url: 'https://onenessyachts.com/contact' },
  { name: 'new-year-packages.html', url: 'https://onenessyachts.com/new-year-packages' },
  { name: 'privacy-policy.html', url: 'https://onenessyachts.com/privacy-policy' },
  { name: 'security-policy.html', url: 'https://onenessyachts.com/security-policy' },
  { name: 'terms-and-conditions.html', url: 'https://onenessyachts.com/terms-and-conditions' }
];

function fetchWithRedirect(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchWithRedirect(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('Status ' + res.statusCode));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function run() {
  for (const page of pages) {
    try {
      const data = await fetchWithRedirect(page.url);
      const localPath = 'Files/' + page.name;
      const current = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';
      if (data.trim() !== current.trim()) {
        fs.writeFileSync(localPath, data, 'utf8');
        console.log(`[UPDATED] ${page.name} (${data.length} bytes)`);
      } else {
        console.log(`[OK] ${page.name} is identical.`);
      }
    } catch (err) {
      console.error(`[ERROR] ${page.name}:`, err.message);
    }
  }
  console.log('All live pages synchronized!');
}

run();
