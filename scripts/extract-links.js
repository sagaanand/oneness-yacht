const fs = require('fs');
const html = fs.readFileSync('live_index.html', 'utf8');
const regex = /href=["']([^"'#]+)["']/g;
const links = new Set();
let match;
while ((match = regex.exec(html)) !== null) {
  const url = match[1];
  if (!url.startsWith('http') || url.includes('onenessyachts.com') || url.includes('oneness.com')) {
    links.add(url);
  }
}
console.log(JSON.stringify(Array.from(links).sort(), null, 2));
