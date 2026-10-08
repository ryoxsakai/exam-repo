// Read-only public deployment verification; no API/authentication or data writes.
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const index = fs.readFileSync('index.html');
const files = ['index.html', 'assets/js/store.js', 'assets/js/viewer.js',
  index.toString().match(/href="(assets\/css\/main[^"?]+)/)[1],
  index.toString().match(/src="(assets\/js\/markup[^"?]+)/)[1],
  'setting/index.html', 'assets/js/settings.js'];
const expected = new Map(files.map(file => [file, hash(fs.readFileSync(file))]));
(async () => {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const results = await Promise.all(files.map(async file => {
        const url = new URL(file === 'index.html' ? '/' : '/' + file, 'https://exam.lrnr.jp');
        url.searchParams.set('verify', `${process.env.GITHUB_SHA || 'local'}-${attempt}`);
        const response = await fetch(url, {signal: AbortSignal.timeout(20000), cache: 'no-store'});
        if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
        const actual = hash(Buffer.from(await response.arrayBuffer()));
        return {file, expected: expected.get(file), actual, matches: actual === expected.get(file)};
      }));
      console.log(JSON.stringify({commit: process.env.GITHUB_SHA, attempt, results}));
      if (results.every(result => result.matches)) return;
    } catch (error) { console.log(`Attempt ${attempt}: ${error.message}`); }
    if (attempt < 20) await new Promise(resolve => setTimeout(resolve, 30000));
  }
  throw new Error('Public HTML/JS/CSS did not match this commit within the Pages CD window');
})().catch(error => { console.error(error); process.exitCode = 1; });
