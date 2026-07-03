'use strict';
/**
 * Pixabay Music provider — INERT stub (deliberately unavailable).
 *
 * Pixabay's music library (pixabay.com/music) is NOT in their public API — that API
 * only serves images and video. The music pages sit behind a Cloudflare JS challenge
 * (any plain fetch returns HTTP 403 "Just a moment"), so reaching audio would require
 * bundling a headless browser to solve the challenge — heavy, brittle, and ToS-gray.
 *
 * We keep this file as the drop-in point: if a headless-fetch path is ever wired, put
 * it in search() and flip available() to check for that capability. Until then it
 * reports unavailable, so the registry skips it (not listed, not searched). The
 * PIXABAY_API_KEY in ~/.secrets.env is an images/video key and does not unlock audio.
 */
function available() {
  return false; // Cloudflare-gated; needs a headless browser — not wired.
}

async function search() {
  return { count: 0, results: [] };
}

module.exports = {
  id: 'pixabay',
  label: 'Pixabay Music',
  available,
  search,
  normalize: (r) => r,
  note: 'Cloudflare-gated (HTTP 403); no audio API — needs headless to enable.',
};
