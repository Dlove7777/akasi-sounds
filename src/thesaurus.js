'use strict';
/**
 * SFX search thesaurus — sound-editor vocabulary, curated not generated.
 * A query term that belongs to a group expands to OR across the group, so
 * searching "swish" finds files tagged only "whoosh".
 *
 * GROUPS data lives in thesaurus-groups.json (single source of truth — the
 * renderer imports the same JSON via its own thin ESM loader in
 * renderer/lib/thesaurus.js). Extend by editing the JSON: one array per
 * concept, lowercase, singular where sensible (lookup strips a trailing "s").
 */
const GROUPS = require('./thesaurus-groups.json');

const INDEX = new Map();
for (const group of GROUPS) {
  for (const term of group) INDEX.set(term, group);
}

/** term → [term, ...synonyms] (deduped); [term] when no group matches. */
function expand(term) {
  const t = String(term || '').toLowerCase();
  const group = INDEX.get(t) || INDEX.get(t.replace(/s$/, ''));
  return group ? [...new Set([t, ...group])] : [t];
}

/** Synonyms of term, excluding the term itself (for UI hints). */
function synonymsOf(term) {
  return expand(term).filter((s) => s !== String(term || '').toLowerCase());
}

module.exports = { expand, synonymsOf, GROUPS };
