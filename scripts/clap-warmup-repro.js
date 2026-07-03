'use strict';
// Minimal repro/diagnostic for the CLAP warm-up deadlock under ELECTRON_RUN_AS_NODE.
// Run: cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/clap-warmup-repro.js
const sidecar = require('../src/sidecar');
const t0 = Date.now();
const el = (m) => console.log(`[+${Date.now() - t0}ms] ${m}`);
el(`available=${sidecar.available()} ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE}`);
const hard = setTimeout(() => { el('HARD TIMEOUT 55s — still hanging'); process.exit(2); }, 55000);
sidecar.startClap()
  .then((r) => { el(`READY: ${JSON.stringify(r)}`); return sidecar.embedText('dark cinematic tension'); })
  .then((r) => { el(`embedText: ${r && r.embedding ? r.embedding.length + '-d vec' : JSON.stringify(r)}`); clearTimeout(hard); sidecar.stopClap(); process.exit(0); })
  .catch((e) => { el(`ERROR: ${e.message}`); clearTimeout(hard); process.exit(1); });
