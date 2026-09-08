const fs = require('fs');
const path = require('path');

// Extract packages
const pkgDir = path.join(__dirname, '..', 'Files', 'packages');
const pkgFiles = fs.readdirSync(pkgDir).filter(f => f.endsWith('.html'));
const packages = [];

pkgFiles.forEach(file => {
  const slug = file.replace('.html', '');
  const content = fs.readFileSync(path.join(pkgDir, file), 'utf8');

  const titleMatch = content.match(/<h[123][^>]*class="title"[^>]*>([\s\S]*?)<\/h[123]>/i);
  let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : slug.replace(/-/g, ' ');
  title = title.split('\n')[0].trim();

  const pMatch = content.match(/<p>([\s\S]*?)<\/p>/i);
  const description = pMatch ? pMatch[1].replace(/<[^>]+>/g, '').trim() : 'Exclusive luxury yacht experience in Dubai.';

  const imgMatch = content.match(/<img[^>]+src=["'](\/assets\/images\/[^"']+)["']/i);
  const image = imgMatch ? imgMatch[1] : '/assets/images/home/03.jpg';

  packages.push({
    slug,
    title,
    description: description.slice(0, 240) + '...',
    image
  });
});

fs.writeFileSync(path.join(__dirname, '..', 'data', 'packages.json'), JSON.stringify(packages, null, 2));
console.log(`Extracted ${packages.length} packages to data/packages.json`);

// Extract services
const srvDir = path.join(__dirname, '..', 'Files', 'services');
const srvFiles = fs.readdirSync(srvDir).filter(f => f.endsWith('.html'));
const services = [];

srvFiles.forEach(file => {
  const slug = file.replace('.html', '');
  const content = fs.readFileSync(path.join(srvDir, file), 'utf8');

  const titleMatch = content.match(/<h[123][^>]*class="title"[^>]*>([\s\S]*?)<\/h[123]>/i);
  let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : slug.replace(/-/g, ' ');
  title = title.split('\n')[0].trim();

  const pMatch = content.match(/<p>([\s\S]*?)<\/p>/i);
  const description = pMatch ? pMatch[1].replace(/<[^>]+>/g, '').trim() : 'Premium onboard luxury hospitality and services.';

  const imgMatch = content.match(/<img[^>]+src=["'](\/assets\/images\/[^"']+)["']/i);
  const image = imgMatch ? imgMatch[1] : '/assets/images/home/04.jpg';

  services.push({
    slug,
    title,
    description: description.slice(0, 200) + '...',
    image
  });
});

fs.writeFileSync(path.join(__dirname, '..', 'data', 'services.json'), JSON.stringify(services, null, 2));
console.log(`Extracted ${services.length} services to data/services.json`);
