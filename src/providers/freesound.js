'use strict';
/**
 * Freesound provider — https://freesound.org/docs/api/
 *
 * Token auth (query param) is enough to SEARCH and to fetch the mp3/ogg PREVIEWS,
 * which is all Akasi Sounds needs to seed a browsable, auditionable library. Downloading
 * the original full-quality file requires OAuth2 — deferred to a later pass; for an
 * editor's rough-cut workflow the high-quality preview is plenty.
 *
 * Every result carries its Creative Commons license + attribution string so credit
 * can be surfaced/exported. No key → provider reports unavailable and is skipped.
 */
const API = 'https://freesound.org/apiv2';
const FIELDS = 'id,name,tags,license,username,duration,samplerate,channels,filesize,previews';

function apiKey() {
  return process.env.FREESOUND_API_KEY || null;
}

function available() {
  return Boolean(apiKey());
}

function normalize(r) {
  const preview = r.previews?.['preview-hq-mp3'] || r.previews?.['preview-lq-mp3'] || null;
  return {
    source: 'freesound',
    source_id: r.id,
    name: r.name,
    url: preview,
    duration: r.duration,
    samplerate: r.samplerate,
    channels: r.channels,
    filesize: r.filesize,
    license: r.license,
    attribution: r.username ? `"${r.name}" by ${r.username} (freesound.org/s/${r.id})` : null,
    tags: Array.isArray(r.tags) ? r.tags.join(' ') : '',
  };
}

/**
 * Text search. opts: { page, pageSize, sort }
 * Returns { count, results: [normalized] }.
 */
async function search(query, opts = {}) {
  const key = apiKey();
  if (!key) throw new Error('FREESOUND_API_KEY not set');
  const params = new URLSearchParams({
    query: query || '',
    fields: FIELDS,
    page: String(opts.page || 1),
    page_size: String(Math.min(opts.pageSize || 30, 150)),
    token: key,
  });
  if (opts.sort) params.set('sort', opts.sort);
  const res = await fetch(`${API}/search/text/?${params}`);
  if (!res.ok) throw new Error(`Freesound search ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return { count: data.count, next: data.next, results: (data.results || []).map(normalize) };
}

/** Fetch the preview bytes for a normalized sound (returns a Buffer). */
async function fetchPreview(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Freesound preview ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { id: 'freesound', label: 'Freesound', available, search, fetchPreview, normalize };
