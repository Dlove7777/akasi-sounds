// Renderer-side thesaurus loader (ESM). Same GROUPS data as the main process —
// single source of truth in src/thesaurus-groups.json; only this thin expand
// logic is mirrored from src/thesaurus.js (CJS).
import GROUPS from '../../src/thesaurus-groups.json';

const INDEX = new Map();
for (const group of GROUPS) {
  for (const term of group) INDEX.set(term, group);
}

export function expand(term) {
  const t = String(term || '').toLowerCase();
  const group = INDEX.get(t) || INDEX.get(t.replace(/s$/, ''));
  return group ? [...new Set([t, ...group])] : [t];
}

export function synonymsOf(term) {
  return expand(term).filter((s) => s !== String(term || '').toLowerCase());
}

export default { expand, synonymsOf, GROUPS };
