'use strict';
/**
 * Music Director model + architecture bake-off.
 *
 * Runs a matrix of {model × mode × brief} through the REAL library and scores each
 * on what actually matters for a librarian agent: HONESTY (never names a file that
 * isn't a real candidate), TOOL-DISCIPLINE (few steps, converges), and COST. NOT
 * reasoning depth — the task is simple; the failures we saw locally were reliability.
 *
 * Real OpenRouter calls → run under the app's Electron ABI against the live DB:
 *   ELECTRON_RUN_AS_NODE=1 <electron> scripts/director-bakeoff.js [--quick]
 * or via: npm run bakeoff       (see package.json)
 *
 * Writes docs/plans/DIRECTOR-BAKEOFF-RESULTS.md. Keep spend small — few briefs.
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

/* Prices per 1M tokens (USD), from docs/plans/OPENROUTER-MODEL-CANDIDATES.md.
 * [in, out]. Update if OpenRouter pricing moves. */
const PRICES = {
  'google/gemini-3-flash-preview': [0.5, 3.0],
  'z-ai/glm-5.2': [0.93, 3.0],
  'deepseek/deepseek-v4-flash': [0.089, 0.18],
  'google/gemini-3.1-flash-lite': [0.25, 1.5],
  'anthropic/claude-haiku-4.5': [1.0, 5.0],
};

const MODELS = Object.keys(PRICES);
const MODES = ['grounded', 'triad'];

const BRIEFS = [
  'a tense instrumental bed under 90 BPM for a promo',
  'uplifting corporate track around 120 BPM, no vocals',
  'a cinematic sting for an intro',
  'warm lo-fi beat for a talking-head segment',
  'a whoosh or transition for a hard cut',
  'dark ambient underscore for a documentary',
];

const AUDIO_EXT = /\.(wav|mp3|aiff?|flac|m4a|ogg|opus|wma)$/i;

/**
 * Honesty check — did the model NAME any file that isn't a real candidate?
 * Looks at bolded segments and quoted strings that look like filenames (or match a
 * pool row) and confirms each maps to a real pooled row. Emphasis like **top pick**
 * is ignored (no extension, matches no row), so it never false-flags.
 * Pure + exported so the smoke test can lock the contract without a network call.
 */
function honestyReport(text, pool) {
  const poolNames = pool.map((r) => String(r.name || '').toLowerCase());
  const raw = [...String(text || '').matchAll(/\*\*(.+?)\*\*|["“]([^"”]+?)["”]/g)].map((m) => (m[1] || m[2] || '').trim());
  const matchesPool = (c) => { const lc = c.toLowerCase(); return poolNames.some((n) => n === lc || n.includes(lc) || lc.includes(n)); };
  // Count a segment as a FILE CLAIM only if it looks like a filename or matches a row.
  const fileClaims = raw.filter((c) => AUDIO_EXT.test(c) || matchesPool(c));
  const matched = fileClaims.filter(matchesPool);
  const fabricated = fileClaims.filter((c) => !matchesPool(c));
  return { claims: fileClaims, matched, fabricated, honest: fabricated.length === 0 };
}

function costOf(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return 0;
  return ((usage.prompt_tokens || 0) * p[0] + (usage.completion_tokens || 0) * p[1]) / 1e6;
}

/* --------------------------------- runner --------------------------------- */

async function main() {
  // Load ~/.secrets.env for OPENROUTER_API_KEY.
  try {
    for (const line of fs.readFileSync(path.join(os.homedir(), '.secrets.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* env may already be set */ }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) { console.error('No OPENROUTER_API_KEY — add it to ~/.secrets.env'); process.exit(1); }

  const { openDb } = require('../src/db');
  const sidecar = require('../src/sidecar');
  const { runDirector, makeOpenRouterChat } = require('../src/director');

  const dbPath = process.env.AKASI_SOUNDS_DB
    || path.join(os.homedir(), 'Library', 'Application Support', 'Akasi Sounds', 'akasi-sounds-index.db');
  if (!fs.existsSync(dbPath)) { console.error(`DB not found at ${dbPath} — launch the app once.`); process.exit(1); }
  const db = openDb(dbPath);

  // Keyword search only — CLAP warm-up deadlocks under ELECTRON_RUN_AS_NODE and the
  // semantic layer doesn't change the axes we rank (honesty / tool-discipline / cost).
  const clapReady = false;

  const quick = process.argv.includes('--quick');
  const briefs = quick ? BRIEFS.slice(0, 2) : BRIEFS;
  const now = () => Number(process.hrtime.bigint() / 1000000n);

  const rows = [];
  for (const model of MODELS) {
    for (const mode of MODES) {
      const chat = makeOpenRouterChat({ apiKey, model });
      const agg = { model, mode, runs: 0, errors: 0, steps: 0, latency: 0, cost: 0, dishonest: 0, poolTotal: 0, samples: [] };
      for (const brief of briefs) {
        const t0 = now();
        try {
          const r = await runDirector({
            db, sidecar, clapReady, mode, model, retrieverModel: model,
            chat, retrieverChat: chat,
            messages: [{ role: 'user', content: brief }],
          });
          const h = honestyReport(r.text, r.pool);
          agg.runs += 1;
          agg.steps += r.steps;
          agg.latency += now() - t0;
          agg.cost += costOf(model, r.usage);
          agg.poolTotal += r.pool.length;
          if (!h.honest) agg.dishonest += 1;
          if (agg.samples.length < 1) agg.samples.push({ brief, text: r.text.slice(0, 400), honest: h.honest, fabricated: h.fabricated });
          process.stderr.write(`  ✓ ${model} · ${mode} · "${brief.slice(0, 30)}" — ${r.steps} steps, ${r.pool.length} cand, honest=${h.honest}\n`);
        } catch (e) {
          agg.errors += 1;
          process.stderr.write(`  ✗ ${model} · ${mode} · "${brief.slice(0, 30)}" — ${String(e.message).slice(0, 80)}\n`);
        }
      }
      const n = agg.runs || 1;
      agg.avgSteps = +(agg.steps / n).toFixed(2);
      agg.avgLatency = Math.round(agg.latency / n);
      agg.avgCost = agg.cost / n;
      agg.honestyRate = agg.runs ? +((agg.runs - agg.dishonest) / agg.runs).toFixed(3) : 0;
      agg.avgPool = +(agg.poolTotal / n).toFixed(1);
      rows.push(agg);
    }
  }
  db.close();

  // Rank: PRODUCTIVE configs first (a run that surfaced 0 candidates and made no
  // picks is trivially "honest" but useless — it must not win), then honesty desc,
  // then tool-discipline (fewer steps) asc, then cost asc.
  const productive = (r) => (r.avgPool > 0 ? 1 : 0);
  rows.sort((a, b) => productive(b) - productive(a) || b.honestyRate - a.honestyRate || a.avgSteps - b.avgSteps || a.avgCost - b.avgCost);

  const md = [];
  md.push('# Music Director — Model & Architecture Bake-off\n');
  md.push(`Ran ${briefs.length} briefs × ${MODELS.length} models × ${MODES.length} modes against the live library. `);
  md.push('Ranked on **honesty** (no fabricated filenames) → **tool-discipline** (fewer steps) → **cost/run**. Reasoning depth deliberately not scored. ');
  md.push('Search ran in **keyword mode** (semantic CLAP layer off in the harness); this affects candidate pools equally across models, not the ranking axes.\n');
  md.push('| Rank | Model | Mode | Honesty | Avg steps | Avg cand | Avg cost/run | Avg latency | Errors |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  rows.forEach((r, i) => {
    md.push(`| ${i + 1} | \`${r.model}\` | ${r.mode} | ${(r.honestyRate * 100).toFixed(0)}% | ${r.avgSteps} | ${r.avgPool} | $${r.avgCost.toFixed(5)} | ${r.avgLatency}ms | ${r.errors} |`);
  });
  const winner = rows.find((r) => r.errors === 0 && r.avgPool > 0) || rows.find((r) => r.errors === 0) || rows[0];
  md.push(`\n## Recommendation\n\nDefault: **\`${winner.model}\`** in **${winner.mode}** mode — ${(winner.honestyRate * 100).toFixed(0)}% honest, ${r0(winner.avgSteps)} avg steps, $${winner.avgCost.toFixed(5)}/run.\n`);
  md.push('\n## Sample outputs\n');
  for (const r of rows) {
    if (!r.samples.length) continue;
    const s = r.samples[0];
    md.push(`\n**\`${r.model}\` · ${r.mode}** — "${s.brief}" (honest=${s.honest}${s.fabricated?.length ? `, fabricated: ${s.fabricated.join(', ')}` : ''})\n`);
    md.push('> ' + s.text.replace(/\n/g, '\n> '));
  }
  const out = path.join(__dirname, '..', 'docs', 'plans', 'DIRECTOR-BAKEOFF-RESULTS.md');
  fs.writeFileSync(out, md.join('\n') + '\n');
  console.log(`\nWrote ${out}`);
  console.log(`Winner: ${winner.model} (${winner.mode}) — honesty ${(winner.honestyRate * 100).toFixed(0)}%, ${winner.avgSteps} steps, $${winner.avgCost.toFixed(5)}/run`);
}
const r0 = (n) => (Math.round(n * 100) / 100);

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { honestyReport, costOf, PRICES, BRIEFS };
