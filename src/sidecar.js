'use strict';
/**
 * AI sidecar manager — bridges the Electron main process to the local Python venv.
 *  - clap: long-running clap_service.py (JSONL over stdio, id-correlated) for
 *    text/audio embeddings + zero-shot classification. Model loads once.
 *  - analyzeBatch: one-shot analyze.py run (librosa BPM/key) over many files.
 * Degrades cleanly: available() is false until sidecar/setup.sh has been run,
 * and every caller treats the AI as optional.
 */
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

const SIDECAR_DIR = path.join(__dirname, '..', 'sidecar');
const VENV_PY = path.join(SIDECAR_DIR, 'venv', 'bin', 'python');

function available() {
  return fs.existsSync(VENV_PY);
}

/* ------------------------------ CLAP service ------------------------------ */

let proc = null;
let rl = null;
let nextId = 1;
const pending = new Map(); // id → {resolve}
let readyPromise = null;

function startClap() {
  if (proc) return readyPromise;
  if (!available()) return Promise.reject(new Error('sidecar venv missing — run sidecar/setup.sh'));
  proc = spawn(VENV_PY, [path.join(SIDECAR_DIR, 'clap_service.py')], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  rl = readline.createInterface({ input: proc.stdout });
  readyPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('CLAP service start timeout (5min — first run downloads the model)')), 300_000);
    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.ready) { clearTimeout(t); resolve(msg); return; }
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p.resolve(msg); }
    });
    proc.on('error', (e) => { clearTimeout(t); reject(e); });
    proc.on('exit', () => {
      for (const p of pending.values()) p.resolve({ error: 'CLAP service exited' });
      pending.clear();
      proc = null; rl = null; readyPromise = null;
    });
  });
  return readyPromise;
}

async function clapRequest(req, timeoutMs = 120_000) {
  await startClap();
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve({ error: 'CLAP request timeout' }); }
    }, timeoutMs);
    proc.stdin.write(JSON.stringify({ ...req, id }) + '\n');
  });
}

const embedText = (text) => clapRequest({ op: 'embed_text', text });
const embedAudio = (p) => clapRequest({ op: 'embed_audio', path: p });
const classify = (p) => clapRequest({ op: 'classify', path: p });

function stopClap() {
  if (proc) { try { proc.kill(); } catch { /* already gone */ } }
}

/* --------------------------- librosa batch (BPM/key) --------------------------- */

/** files: [paths] → Map(path → {bpm,key,duration}|{error}) */
function analyzeBatch(files) {
  return new Promise((resolve) => {
    if (!available() || !files.length) return resolve(new Map());
    const p = execFile(VENV_PY, [path.join(SIDECAR_DIR, 'analyze.py')],
      { maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000 }, (err, stdout) => {
        const out = new Map();
        for (const line of String(stdout || '').split('\n')) {
          if (!line.trim()) continue;
          try { const r = JSON.parse(line); out.set(r.path, r); } catch { /* skip */ }
        }
        resolve(out);
      });
    p.stdin.write(files.join('\n'));
    p.stdin.end();
  });
}

/* ------------------------------- similarity ------------------------------- */

/** Cosine over unit vectors stored as Float32 BLOBs. */
function cosine(bufA, arrB) {
  const a = new Float32Array(bufA.buffer, bufA.byteOffset, bufA.byteLength / 4);
  let s = 0;
  for (let i = 0; i < a.length && i < arrB.length; i++) s += a[i] * arrB[i];
  return s;
}

module.exports = { available, startClap, embedText, embedAudio, classify, stopClap, analyzeBatch, cosine };
