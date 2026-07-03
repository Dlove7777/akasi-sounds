'use strict';
// Live end-to-end generation smoke against VIDI ACE-Step. Bare-node safe (no sqlite).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
try {
  for (const line of fs.readFileSync(path.join(os.homedir(), '.secrets.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* env */ }
const gen = require('../src/providers/generate');
console.log('url:', gen.baseUrl(), 'available:', gen.available());
(async () => {
  const t0 = Date.now();
  try {
    const r = await gen.generate({ caption: 'calm warm ambient pad, gentle, instrumental', durationSec: 10 },
      { onStatus: (s) => process.stderr.write(`[${Date.now() - t0}ms] status:${s}\n`), pollMs: 2000 });
    const out = path.join(os.tmpdir(), 'acestep-live-test.wav');
    fs.writeFileSync(out, r.bytes);
    console.log(`OK in ${Date.now() - t0}ms — ${r.bytes.length} bytes -> ${out}`);
  } catch (e) { console.log('ERR:', e.message); process.exit(1); }
})();
