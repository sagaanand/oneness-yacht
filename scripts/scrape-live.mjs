import scrape from 'website-scraper';

const urls = [
  'https://onenessyachts.com/',
  'https://onenessyachts.com/VIP-yacht-rental.html',
  'https://onenessyachts.com/standard-yachts.html',
  'https://onenessyachts.com/dubai-packages.html',
  'https://onenessyachts.com/amenities.html',
  'https://onenessyachts.com/blogs.html',
  'https://onenessyachts.com/about.html',
  'https://onenessyachts.com/contact.html',
  'https://onenessyachts.com/new-year-packages.html',
  'https://onenessyachts.com/privacy-policy.html',
  'https://onenessyachts.com/security-policy.html',
  'https://onenessyachts.com/terms-and-conditions.html'
];

const options = {
  urls,
  directory: './scraped_site',
  subdirectories: [
    { directory: 'assets/images', extensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'] },
    { directory: 'assets/js', extensions: ['.js'] },
    { directory: 'assets/css', extensions: ['.css'] }
  ],
  sources: [
    { selector: 'img', attr: 'src' },
    { selector: 'link[rel="stylesheet"]', attr: 'href' },
    { selector: 'script', attr: 'src' }
  ]
};

console.log('Starting scrape of onenessyachts.com with website-scraper...');
try {
  const result = await scrape(options);
  console.log('Scraped successfully! Total items downloaded:', result.length);
} catch (err) {
  console.error('Scrape error:', err.message);
}
