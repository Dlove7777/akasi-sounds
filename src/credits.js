'use strict';
/**
 * Credits / attribution manifest — the licensing deliverable for client work.
 * Classifies each sound's license, groups obligations, and renders Markdown + CSV.
 * "Client-safe" mode EXCLUDES CC-BY-NC material (non-commercial) and says so
 * loudly instead of silently shipping a violation.
 */

function classifyLicense(l) {
  if (!l || l === 'local') return 'local';
  const s = String(l).toLowerCase();
  if (/apache|ace-step|stable ?audio|stability|generated/.test(s)) return 'generated';
  if (/nc\b|non-?commercial|by-nc/.test(s)) return 'cc-by-nc';
  if (/zero|cc0|publicdomain|public domain/.test(s)) return 'cc0';
  if (/creativecommons|cc[- ]by|licenses\/by/.test(s)) return 'cc-by';
  return 'other';
}

const GROUP_LABELS = {
  'cc-by': 'Creative Commons — attribution required',
  cc0: 'CC0 / Public domain — no attribution required',
  generated: 'Generated in-app (self-hosted, commercially-licensed model)',
  local: 'Own / licensed library files',
  other: 'Other licenses — review manually',
};

/**
 * rows: sound rows (name, source, license, attribution).
 * opts: { title, clientSafe } — clientSafe excludes CC-BY-NC from the manifest body.
 * Returns { markdown, csv, count, flagged: [rows], excluded: boolean }
 */
function buildManifest(rows, opts = {}) {
  const { title = 'Audio credits', clientSafe = false } = opts;
  const groups = { 'cc-by': [], cc0: [], generated: [], local: [], other: [], 'cc-by-nc': [] };
  for (const r of rows) groups[classifyLicense(r.license)].push(r);
  const flagged = groups['cc-by-nc'];
  const included = clientSafe ? rows.filter((r) => classifyLicense(r.license) !== 'cc-by-nc') : rows;

  const md = [`# ${title}`, '', `${included.length} sounds${clientSafe ? ' (client-safe: non-commercial material excluded)' : ''}`, ''];
  for (const key of ['cc-by', 'generated', 'cc0', 'local', 'other']) {
    const g = groups[key];
    if (!g.length) continue;
    md.push(`## ${GROUP_LABELS[key]}`, '');
    for (const r of g) md.push(`- ${r.attribution || r.name}${key === 'other' ? `  (license: ${r.license})` : ''}`);
    md.push('');
  }
  if (flagged.length) {
    md.push(`## ⚠️ CC-BY-NC — NON-COMMERCIAL ONLY${clientSafe ? ' (EXCLUDED from this manifest)' : ' (INCLUDED — not client-safe!)'}`, '');
    for (const r of flagged) md.push(`- ${r.attribution || r.name}`);
    md.push('');
  }

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    'name,source,license,classification,attribution',
    ...included.map((r) => [esc(r.name), esc(r.source), esc(r.license), esc(classifyLicense(r.license)), esc(r.attribution)].join(',')),
  ].join('\n');

  return { markdown: md.join('\n'), csv, count: included.length, flagged, excluded: clientSafe && flagged.length > 0 };
}

module.exports = { classifyLicense, buildManifest, GROUP_LABELS };
