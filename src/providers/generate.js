'use strict';
/**
 * ACE-Step 1.5 generation client (the "Generate" source).
 *
 * NOT a normal search provider — deliberately NOT registered in providers/index.js,
 * so it never fires from the `search_online` fan-out (which would burn GPU on every
 * search). main.js calls it directly from an explicit `generate:run` IPC / director
 * tool.
 *
 * Talks to the ACE-Step first-party REST server on VIDI (async job queue):
 *   POST /release_task -> {task_id} ; poll POST /query_result ; GET /v1/audio?path=
 * Field names are read tolerantly (the exact keys are pinned against the live server
 * on first connect). Weights auto-download on VIDI on the first call.
 *
 * Config (env, from ~/.secrets.env):
 *   VIDI_ACESTEP_URL   e.g. http://vidi-laptop:8001   (absent -> unavailable)
 *   ACESTEP_API_KEY    optional bearer token
 */
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = () => (process.env.VIDI_ACESTEP_URL || '').replace(/\/$/, '') || null;
const available = () => Boolean(baseUrl());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.ACESTEP_API_KEY) h.Authorization = `Bearer ${process.env.ACESTEP_API_KEY}`;
  return h;
}

async function jpost(p, body, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl() + p, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: ac.signal });
    if (!res.ok) throw new Error(`ACE-Step ${p} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return res.json();
  } finally { clearTimeout(t); }
}

// Tolerant field readers — pin to real keys after the first live call.
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };

/**
 * Generate a track. opts.onStatus(status) streams progress. Returns
 * { bytes:Buffer, ext, meta:{durationSec} }.
 */
async function generate(spec, opts = {}) {
  if (!available()) throw new Error('Generation unavailable — set VIDI_ACESTEP_URL (ACE-Step on VIDI).');
  const onStatus = opts.onStatus || (() => {});
  const durationSec = spec.durationSec || 30;
  const rel = await jpost('/release_task', {
    task_type: 'text2music',
    caption: spec.caption,
    prompt: spec.caption,
    lyrics: spec.lyrics || '',
    audio_duration: durationSec,
    use_random_seed: spec.seed == null,
    seed: spec.seed ?? 0,
    format: 'wav',
  });
  const taskId = pick(rel, 'task_id', 'taskId', 'id');
  if (!taskId) throw new Error('ACE-Step: no task_id in release_task response');
  onStatus('queued');

  const deadline = Date.now() + (opts.timeoutMs || 240000);
  let audioPath = null;
  while (Date.now() < deadline) {
    await sleep(opts.pollMs || 2500);
    const q = await jpost('/query_result', { task_id: taskId, taskId });
    const status = pick(q, 'status', 'state') || 'running';
    onStatus(status);
    const done = status === 'done' || status === 'success' || status === 'finished' || q.finished === true || pick(q, 'path', 'audio_path', 'output_path');
    if (pick(q, 'error') || status === 'failed' || status === 'error') throw new Error(`ACE-Step task failed: ${pick(q, 'error') || status}`);
    if (done) {
      audioPath = pick(q, 'path', 'audio_path', 'output_path') || pick(q.result || {}, 'path', 'audio_path');
      if (audioPath) break;
    }
  }
  if (!audioPath) throw new Error('ACE-Step generation timed out');

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60000);
  try {
    const res = await fetch(`${baseUrl()}/v1/audio?path=${encodeURIComponent(audioPath)}`, { headers: headers(), signal: ac.signal });
    if (!res.ok) throw new Error(`ACE-Step /v1/audio ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), ext: 'wav', meta: { durationSec } };
  } finally { clearTimeout(t); }
}

/**
 * Materialize a generated result into a library row (write file + upsert). Pure of
 * the network so it's unit-testable with canned bytes. Returns the new row id.
 * `analyze` (optional) is called with (id, filePath) to attach CLAP/DSP analysis.
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
    license: 'ACE-Step 1.5 / MIT',
    attribution: `Generated · ACE-Step 1.5 — ${caption}`,
    tags: 'generated ace-step ' + String(caption || ''),
  });
  return id;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) { h = (h * 31 + String(s).charCodeAt(i)) | 0; }
  return h;
}

module.exports = { id: 'generate', label: 'Generate (ACE-Step)', available, generate, materialize, baseUrl };
