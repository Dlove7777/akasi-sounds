'use strict';
/**
 * Provider registry. Each provider is a small module exposing:
 *   id, label, available(), search(query, opts) -> { count, results:[normalized] }
 * Adding Internet Archive, a dataset importer, etc. later means dropping a file
 * here — the UI and index don't change.
 */
const freesound = require('./freesound');
const jamendo = require('./jamendo');
const pixabay = require('./pixabay');

// Order = search order. Freesound (SFX) + Jamendo (music) are the live pair; Pixabay
// is an inert stub (Cloudflare-gated) that stays hidden until a headless path is added.
const PROVIDERS = [freesound, jamendo, pixabay];

function all() {
  return PROVIDERS;
}
function get(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}
function availableProviders() {
  return PROVIDERS.filter((p) => p.available()).map((p) => ({ id: p.id, label: p.label }));
}

module.exports = { all, get, availableProviders };
