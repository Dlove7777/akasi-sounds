'use strict';
/**
 * Provider registry. Each provider is a small module exposing:
 *   id, label, available(), search(query, opts) -> { count, results:[normalized] }
 * Adding Pixabay (site scrape), Internet Archive, or a dataset importer later means
 * dropping a file here — the UI and index don't change.
 */
const freesound = require('./freesound');

const PROVIDERS = [freesound];

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
