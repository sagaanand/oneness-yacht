const fs = require('fs');
const path = require('path');

const yachtDir = path.join(__dirname, '..', 'Files', 'yacht');
const yachtFiles = fs.readdirSync(yachtDir).filter(f => f.endsWith('.html'));

const yachts = [];

yachtFiles.forEach(file => {
  const slug = file.replace('.html', '');
  const content = fs.readFileSync(path.join(yachtDir, file), 'utf8');

  // Title & subtitle
  const titleMatch = content.match(/<h1[^>]*class="title"[^>]*>([\s\S]*?)<\/h1>/i);
  const towerMatch = content.match(/<p[^>]*class="tower"[^>]*>([\s\S]*?)<\/p>/i);
  const title = titleMatch ? titleMatch[1].trim() : slug.replace(/-/g, ' ').toUpperCase();
  const subtitle = towerMatch ? towerMatch[1].trim() : '';

  // Extract length in feet
  let lengthFt = 0;
  const ftMatch = (slug + ' ' + subtitle + ' ' + title).match(/(\d+)\s*[-_ ]*(?:ft|feet)/i);
  if (ftMatch) {
    lengthFt = parseInt(ftMatch[1], 10);
  }

  // Images
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  const images = [];
  let m;
  while ((m = imgRegex.exec(content)) !== null) {
    const src = m[1];
    if (src.includes('/assets/images/yacht/') && !images.includes(src)) {
      images.push(src);
    }
  }

  // Specs
  const specs = {};
  const specItems = content.match(/<li>([^<:]+):\s*([^<]+)<\/li>/gi);
  if (specItems) {
    specItems.forEach(item => {
      const match = item.match(/<li>([^<:]+):\s*([^<]+)<\/li>/i);
      if (match) {
        specs[match[1].trim()] = match[2].trim();
      }
    });
  }

  // Overview
  let overview = '';
  const overviewMatch = content.match(/<h2[^>]*class="title"[^>]*>Overview<\/h2>[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  if (overviewMatch) {
    overview = overviewMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // Crew
  let crew = '';
  const crewMatch = content.match(/<h2[^>]*class="title"[^>]*>CREW<\/h2>[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  if (crewMatch) {
    crew = crewMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // Prices
  let priceHourly = 'Contact Us';
  let priceFullDay = 'Contact Us';
  const hourMatch = content.match(/Price Per Hour[\s\S]*?<p class="price">([\s\S]*?)<\/p>/i);
  if (hourMatch) {
    priceHourly = hourMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  const dayMatch = content.match(/Price Full Day[\s\S]*?<p class="price">([\s\S]*?)<\/p>/i);
  if (dayMatch) {
    priceFullDay = dayMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  // Capacity
  let capacity = specs['Capacity'] || specs['capacity'] || '20-50 guests';

  // Category
  const category = (lengthFt >= 100 || file.includes('royalty') || file.includes('burkut') || file.includes('santorini') || file.includes('sunseeker-131')) 
    ? 'VIP Superyacht' 
    : 'Standard Luxury';

  yachts.push({
    slug,
    title: title || slug,
    subtitle,
    lengthFt,
    category,
    images: images.length > 0 ? images : ['/assets/images/yacht/BENETTI - 110 Ft/img48.jpg'],
    primaryImage: images[0] || '/assets/images/home/hero-banner.jpg',
    specs,
    overview,
    crew,
    priceHourly,
    priceFullDay,
    capacity
  });
});

// Sort by length descending
yachts.sort((a, b) => b.lengthFt - a.lengthFt);

fs.writeFileSync(path.join(__dirname, '..', 'data', 'yachts.json'), JSON.stringify(yachts, null, 2));
console.log(`Successfully extracted ${yachts.length} yachts to data/yachts.json`);
