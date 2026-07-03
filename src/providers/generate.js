'use strict';
/**
 * Music generation client — talks to our OWN thin synchronous server (Stable Audio 3
 * Medium, self-hosted on VIDI under WSL2). Replaces the ACE-Step async job-queue
 * client: no release_task / poll / query_result — one blocking POST returns the WAV.
 * That removes the entire class of "worker never drains the queue" failure.
 *
 * NOT registered in providers/index.js, so it never fires from the search_online
 * fan-out (which would burn GPU on every search). main.js calls it directly from an
 * explicit generate:run IPC / director generate_music tool.
 *
 * Server contract (services/vidi-stableaudio3/server.py):
 *   POST /generate {prompt, duration, steps?, seed?} -> audio/wav bytes (200)
 *   GET  /health -> {status:'ok', model, ...}
 *
 * Config (env, from ~/.secrets.env):
 *   STABLE_AUDIO_URL       e.g. http://vidi-laptop:8005   (absent -> unavailable)
 *   STABLE_AUDIO_API_KEY   optional bearer token
 *
 * License: Stable Audio 3 Medium output is usable commercially under the Stability AI
 * Community License (orgs under $1M/yr revenue) and requires "Powered by Stability AI"
 * attribution — stamped onto every generated row below.
 */
const fs = require('node:fs');
const path = require('node:path');

const GEN_LICENSE = 'Stable Audio 3 Medium / Stability AI Community License';
const GEN_ATTRIB_SUFFIX = 'Powered by Stability AI';

const baseUrl = () => (process.env.STABLE_AUDIO_URL || '').replace(/\/$/, '') || null;
const available = () => Boolean(baseUrl());

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.STABLE_AUDIO_API_KEY) h.Authorization = `Bearer ${process.env.STABLE_AUDIO_API_KEY}`;
  return h;
}

/**
 * Generate a track — one synchronous call. opts.onStatus(status) for UI progress.
 * Returns { bytes:Buffer, ext:'wav', meta:{durationSec} }.
 */
async function generate(spec, opts = {}) {
  if (!available()) throw new Error('Generation unavailable - set STABLE_AUDIO_URL (Stable Audio 3 on VIDI).');
  const onStatus = opts.onStatus || (() => {});
  const durationSec = Math.max(1, Math.min(spec.durationSec || 30, 380));
  onStatus('generating');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs || 300000);
  try {
    const res = await fetch(`${baseUrl()}/generate`, {
      method: 'POST',
      signal: ac.signal,
      headers: headers(),
      body: JSON.stringify({
        prompt: spec.caption,
        duration: durationSec,
        steps: spec.steps,
        seed: spec.seed,
      }),
    });
    if (!res.ok) throw new Error(`Stable Audio ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new Error('Stable Audio returned empty audio');
    return { bytes, ext: 'wav', meta: { durationSec } };
  } catch (e) {
    throw new Error(ac.signal.aborted ? `Generation timed out after ${(opts.timeoutMs || 300000) / 1000}s` : String(e.message || e));
  } finally {
    clearTimeout(t);
  }
}

/**
 * Materialize a generated result into a library row (write file + upsert). Pure of
 * the network so it's unit-testable with canned bytes. Returns the new row id.
 */
async function materialize(db, { bytes, ext = 'wav', caption, durationSec, seed }, saveDir) {
  fs.mkdirSync(saveDir, { recursive: true });
  const stamp = seed != null ? `s${seed}` : Math.abs(hashStr(caption)).toString(36);
  const sourceId = `${hashStr(caption)}_${durationSec}_${stamp}`;
  const safe = String(caption || 'generated').slice(0, 48).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'generated';
  const file = path.join(saveDir, `gen_${sourceId}_${safe}.${ext}`);
  fs.writeFileSync(file, bytes);
  const id = db.upsertSound({
    source: 'generate',
    source_id: sourceId,
    name: `${safe.replace(/_/g, ' ')} (generated)`,
    path: file,
    duration: durationSec ?? null,
    kind: 'music',
    license: GEN_LICENSE,
    attribution: `Generated - Stable Audio 3 (${GEN_ATTRIB_SUFFIX}) - ${caption}`,
    tags: 'generated stable-audio music ' + String(caption || ''),
  });
  return id;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) { h = (h * 31 + String(s).charCodeAt(i)) | 0; }
  return h;
}

module.exports = { id: 'generate', label: 'Generate (Stable Audio 3)', available, generate, materialize, baseUrl, GEN_LICENSE };
