const https = require('https');
const fs = require('fs');
const path = require('path');

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

async function syncDir(subDir) {
  const dirPath = path.join('Files', subDir);
  if (!fs.existsSync(dirPath)) return;
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.html'));

  console.log(`Syncing ${subDir}: ${files.length} pages...`);
  for (const file of files) {
    const slug = file.replace(/\.html$/, '');
    const url = `https://onenessyachts.com/${subDir}/${slug}`;
    try {
      const data = await fetchWithRedirect(url);
      const localFile = path.join(dirPath, file);
      const current = fs.readFileSync(localFile, 'utf8');
      if (data.trim() !== current.trim()) {
        fs.writeFileSync(localFile, data, 'utf8');
        console.log(`  [UPDATED] ${subDir}/${file}`);
      }
    } catch (err) {
      // If clean URL fails, try with .html
      try {
        const data = await fetchWithRedirect(`https://onenessyachts.com/${subDir}/${file}`);
        const localFile = path.join(dirPath, file);
        const current = fs.readFileSync(localFile, 'utf8');
        if (data.trim() !== current.trim()) {
          fs.writeFileSync(localFile, data, 'utf8');
          console.log(`  [UPDATED] ${subDir}/${file}`);
        }
      } catch (err2) {
        // Keep existing local file if remote 404
      }
    }
  }
}

(async () => {
  await syncDir('yacht');
  await syncDir('services');
  await syncDir('packages');
  console.log('All subdirectories synchronized!');
})();
