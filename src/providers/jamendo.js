'use strict';
/**
 * Jamendo provider — https://developer.jamendo.com/v3.0
 *
 * Jamendo is a catalogue of FULL Creative-Commons MUSIC tracks with a real API — the
 * complement to Freesound (which is SFX-heavy). This is what fills the "music bed"
 * gap: search by mood/genre tags and get streamable CC tracks that land in the index
 * as kind='music' with artist + genre, ready to audition and drag.
 *
 * Auth is a free client_id (register at devportal.jamendo.com). No id → the provider
 * reports unavailable and is skipped, exactly like Freesound with no token.
 *   secret add JAMENDO_CLIENT_ID <your-client-id>
 */
const API = 'https://api.jamendo.com/v3.0';

function clientId() {
  return process.env.JAMENDO_CLIENT_ID || null;
}
function available() {
  return Boolean(clientId());
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function normalize(t) {
  const genres = t.musicinfo?.tags?.genres || [];
  const instruments = t.musicinfo?.tags?.instruments || [];
  return {
    source: 'jamendo',
    source_id: t.id,
    name: t.name,
    // `audio` is a public streamable mp3 URL — plays + caches on drag like any preview.
    url: t.audio || t.audiodownload || null,
    duration: t.duration,
    license: t.license_ccurl || 'https://creativecommons.org/',
    attribution: t.artist_name ? `"${t.name}" by ${t.artist_name} (jamendo.com/track/${t.id})` : null,
    tags: [...genres, ...instruments].join(' '),
    kind: 'music', // Jamendo is a music catalogue
    artist: t.artist_name || null,
    album: t.album_name || null,
    genre: genres[0] ? cap(genres[0]) : null,
  };
}

/**
 * Search Jamendo by mood/genre — `fuzzytags` matches the track's tags, which is how
 * you find beds by vibe ("tension", "ambient", "cinematic"). opts: { page, pageSize }.
 * Returns { count, results: [normalized] }.
 */
async function search(query, opts = {}) {
  const cid = clientId();
  if (!cid) throw new Error('JAMENDO_CLIENT_ID not set');
  const pageSize = Math.min(opts.pageSize || 30, 200);
  const params = new URLSearchParams({
    client_id: cid,
    format: 'json',
    limit: String(pageSize),
    offset: String(((opts.page || 1) - 1) * pageSize),
    audioformat: 'mp32',
    include: 'musicinfo',
    fuzzytags: query || '',
    order: 'popularity_total',
  });
  const res = await fetch(`${API}/tracks/?${params}`);
  if (!res.ok) throw new Error(`Jamendo search ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  if (data.headers?.status && data.headers.status !== 'success') {
    throw new Error(`Jamendo: ${data.headers.error_message || data.headers.status}`);
  }
  const results = (data.results || []).map(normalize).filter((r) => r.url);
  return { count: data.headers?.results_fullcount ?? results.length, results };
}

/** Fetch preview bytes for a normalized track (public URL → Buffer). */
async function fetchPreview(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jamendo preview ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { id: 'jamendo', label: 'Jamendo (music)', available, search, fetchPreview, normalize };
