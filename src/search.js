'use strict';
/**
 * Blended search — keyword FTS (always) fused with CLAP semantic similarity (when
 * the AI sidecar is warm). Shared by the Electron main process and the MCP door so
 * an agent and the UI return identical results. Strips embedding blobs from output.
 */

function stripEmb(row) {
  const { embedding, ...rest } = row;
  return rest;
}

async function blendedSearch(db, sidecar, query, opts = {}, clapReady = false) {
  const kw = db.search(query, opts);
  const q = String(query || '').trim();
  // Keyword-only when no query, AI cold, or an explicit non-relevance sort is set.
  if (!q || !clapReady || (opts.sort && opts.sort !== 'relevance')) return kw.map(stripEmb);

  let qv;
  try {
    const r = await sidecar.embedText(q);
    if (!r?.embedding) return kw.map(stripEmb);
    qv = r.embedding;
  } catch {
    return kw.map(stripEmb);
  }

  const universe = db.search('', { ...opts, sort: 'newest', limit: opts.limit || 2000 });
  const kwRank = new Map(kw.map((row, i) => [row.id, i]));
  const scored = [];
  for (const row of universe) {
    const sem = row.embedding ? sidecar.cosine(row.embedding, qv) : 0;
    const kwScore = kwRank.has(row.id) ? 1 / (kwRank.get(row.id) + 2) : 0;
    if (sem < 0.18 && !kwRank.has(row.id)) continue;
    scored.push({ row, score: sem * 0.6 + kwScore * 0.9, sem: sem >= 0.18 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit || 500).map(({ row, sem }) => ({ ...stripEmb(row), _sem: sem ? 1 : 0 }));
}

/**
 * Nearest-neighbour search by CLAP embedding — the engine behind "Find Similar"
 * (in-library) and "match this sample". `targetArr` is a plain number[] (unit
 * vector): from `db.getEmbeddingArray(id)` for a library row, or `sidecar.embedAudio`
 * for an uploaded file. Pure cosine in JS — no CLAP warm-up needed for the in-library
 * case since every analyzed row already carries its embedding blob.
 */
function similarByEmbedding(db, sidecar, targetArr, opts = {}) {
  const limit = opts.limit || 40;
  const excludeId = opts.excludeId;
  if (!targetArr || !targetArr.length) return [];
  const scored = [];
  for (const row of db.allEmbeddings()) {
    if (row.id === excludeId) continue;
    scored.push({ id: row.id, score: sidecar.cosine(row.embedding, targetArr) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  const byId = db.getSoundsByIds(top.map((t) => t.id));
  return top
    .map((t) => {
      const row = byId.get(t.id);
      return row ? { ...stripEmb(row), _sim: +t.score.toFixed(3), _sem: 1 } : null;
    })
    .filter(Boolean);
}

module.exports = { blendedSearch, stripEmb, similarByEmbedding };
