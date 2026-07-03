'use strict';
/**
 * Tiny local RAG over the scoring reference corpus (src/scoring/*.md).
 *
 * The always-on Scoring Playbook (src/playbook.js) is the seed; this is the deeper
 * layer the director retrieves on demand via the lookup_scoring_ref tool. Chunks are
 * embedded with the SAME CLAP text encoder used for search (sidecar.embedText) and
 * ranked by cosine — no fine-tuning, no external service. Retrieved chunks are
 * CONTEXT, never pickable files, so the honesty invariant is untouched.
 *
 * Pure functions + injectable embedder → fully smoke-testable without the model.
 */
const fs = require('node:fs');
const path = require('node:path');

const CORPUS_DIR = path.join(__dirname, 'scoring');

/** Split markdown into retrieval chunks: by heading section, long sections by paragraph. */
function chunkMarkdown(text, { maxChars = 700 } = {}) {
  const out = [];
  for (const section of String(text || '').split(/\n(?=#{1,6}\s)/)) {
    const t = section.trim();
    if (!t) continue;
    if (t.length <= maxChars) { out.push(t); continue; }
    let cur = '';
    for (const para of t.split(/\n\n+/)) {
      if (cur && (cur + '\n\n' + para).length > maxChars) { out.push(cur.trim()); cur = para; }
      else cur = cur ? cur + '\n\n' + para : para;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

/** Load + chunk every .md under a corpus dir → [{file, text}]. */
function loadCorpus(dir = CORPUS_DIR) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    for (const text of chunkMarkdown(fs.readFileSync(path.join(dir, f), 'utf8'))) out.push({ file: f, text });
  }
  return out;
}

function cosineArr(a, b) {
  let s = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return s / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/**
 * Retrieve top-k chunks for a query. `embed` is async (text)->number[]. Caches each
 * chunk's vector on the object so repeated calls in a session don't re-embed.
 */
async function retrieve(query, { corpus, embed, topK = 4 }) {
  if (!corpus || !corpus.length) return [];
  const qv = await embed(query);
  if (!qv || !qv.length) return [];
  const scored = [];
  for (const c of corpus) {
    if (!c._vec) c._vec = await embed(c.text);
    scored.push({ file: c.file, text: c.text, score: c._vec && c._vec.length ? cosineArr(qv, c._vec) : 0 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = { chunkMarkdown, loadCorpus, retrieve, cosineArr, CORPUS_DIR };
