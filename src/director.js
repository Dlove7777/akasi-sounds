'use strict';
/**
 * In-app Music Director — an OpenRouter-brained tool loop that curates cue sheets
 * from Dennis's REAL library. Unlike the CLI director (which drives the MCP door
 * over stdio), this runs IN-PROCESS and calls `blendedSearch` directly, so the app
 * chat gets library results with zero round-trips.
 *
 * Anti-hallucination by construction: the model can only ever surface files that a
 * tool actually returned. Every row a search yields is pooled and handed back to the
 * UI as a live, auditionable, draggable candidate — the "cue sheet" is just the
 * model's ranking OF THE POOL, never invented paths.
 *
 * Two architectures (A/B — see director-bakeoff.js):
 *   - 'grounded' : one capable model fires its own searches AND judges from the
 *                  real candidates it pulled. Simple; the judge is grounded.
 *   - 'triad'    : two cheap retriever models each emit ONE query (literal +
 *                  emotional) → merged real pool → one judge model picks from it.
 *
 * Model-agnostic: pass `chat` to inject any OpenAI-compatible caller (tests inject a
 * mock; prod uses the built-in OpenRouter fetch).
 */
const { blendedSearch } = require('./search');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Bake-off winner (grounded mode): 100% honest, richest real pools, usable cue sheets,
// ~$0.006/run. See docs/plans/DIRECTOR-BAKEOFF-RESULTS.md. deepseek was disqualified
// (fabricated a filename); glm-5.2 too slow (65s); haiku honest but 4× the cost.
const DEFAULT_MODEL = 'google/gemini-3-flash-preview';
const DEFAULT_RETRIEVER_MODEL = 'deepseek/deepseek-v4-flash'; // cheap retriever for triad (needs semantic search — unevaluated)
const MAX_STEPS = 12;

const SYSTEM = `You are Dennis's music supervisor with live access to his personal sound + music library through tools. Turn any brief into a tight cue sheet of REAL files he can drop straight into an edit.

How to work:
- Call search_sounds with the INTENT. The library has semantic AI search — describe the *feeling* in \`query\`, not just keywords. Add filters only when needed: instrumental=true for "no vocals"; bpmMin/bpmMax for tempo (chill <90, mid 90-120, driving 120+); durMax for stings, durMin for full beds; kind for music vs sfx.
- Search BROAD first (query only). Judge fit from the returned name/tags/bpm/genre. If thin or off, refine and search again — 2-3 searches is plenty. Use library_stats to see available genres when unsure.
- Then STOP searching and write the cue sheet.

How to answer:
- Pick the best 3-6, favoring variety over near-duplicates.
- Per pick: **name** — one line on why it fits (mood / tempo / instrumentation), then \`BPM · key · genre\`.
- Lead with your top recommendation. Flag licensing only when it matters (CC-BY needs credit, CC-BY-NC is not client-safe).
- NEVER invent a sound. Recommend ONLY files the tools returned. Reference each pick by its exact name so the app can match it. Be concise — an editor wants picks, not prose.`;

const JUDGE_SYSTEM = `You are Dennis's music supervisor. You are given a music brief and a POOL of REAL candidate files already retrieved from his library. Do NOT search — pick the best 3-6 from the pool ONLY, favoring variety over near-duplicates. Per pick: **name** — one line on why it fits, then \`BPM · key · genre\`. Lead with your top pick. NEVER invent a file; reference each by its exact name. Concise.`;

/* ------------------------------- tool schema ------------------------------- */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_sounds',
      description:
        'Search Dennis\'s sound + music library by keyword AND by describing the sound in plain language (semantic AI). Returns real files with metadata.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language description of the sound/feeling, or keywords.' },
          kind: { type: 'string', enum: ['music', 'sfx'], description: 'Restrict to music or sound effects.' },
          instrumental: { type: 'boolean', description: 'true = no vocals only.' },
          bpmMin: { type: 'number' },
          bpmMax: { type: 'number' },
          durMin: { type: 'number', description: 'Minimum duration in seconds.' },
          durMax: { type: 'number', description: 'Maximum duration in seconds.' },
          genre: { type: 'string' },
          limit: { type: 'number', description: 'Max results (default 12).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sound',
      description: 'Get full metadata for one sound by id.',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'library_stats',
      description: 'Totals + available genres, to orient before searching.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Compact row for the model — drops the embedding blob + noisy columns. */
function slim(r) {
  return {
    id: r.id, name: r.name, kind: r.kind, duration: r.duration,
    bpm: r.bpm || undefined, key: r.key || undefined,
    genre: r.genre || r.ai_genre || undefined,
    vocals: r.vocals == null ? undefined : r.vocals ? 'vocals' : 'instrumental',
    tags: r.tags || undefined, license: r.license || undefined,
  };
}

function searchOptsFrom(args) {
  const o = { limit: Math.min(args.limit || 12, 40), sort: 'relevance' };
  if (args.kind) o.kind = args.kind;
  if (args.instrumental === true) o.vocals = 0;
  if (args.bpmMin != null) o.bpmMin = args.bpmMin;
  if (args.bpmMax != null) o.bpmMax = args.bpmMax;
  if (args.durMin != null) o.durMin = args.durMin;
  if (args.durMax != null) o.durMax = args.durMax;
  if (args.genre) o.genre = args.genre;
  return o;
}

/* ------------------------------ tool dispatch ------------------------------ */

/**
 * Run one tool call against the real library. Adds any rows it surfaces to `pool`
 * (Map id→full row) and returns a compact JSON string for the model.
 */
async function dispatch(name, args, ctx) {
  const { db, sidecar, clapReady, pool, onEvent } = ctx;
  if (name === 'search_sounds') {
    const rows = await blendedSearch(db, sidecar, String(args.query || ''), searchOptsFrom(args), clapReady);
    for (const r of rows) if (!pool.has(r.id)) pool.set(r.id, r);
    onEvent?.({ type: 'pool', rows: [...pool.values()] });
    return JSON.stringify({ count: rows.length, results: rows.map(slim) });
  }
  if (name === 'get_sound') {
    const r = db.getSound(args.id);
    if (r) { pool.set(r.id, r); onEvent?.({ type: 'pool', rows: [...pool.values()] }); }
    return JSON.stringify(r ? slim(r) : { error: 'not found' });
  }
  if (name === 'library_stats') {
    return JSON.stringify({ ...db.stats(), genres: db.genres() });
  }
  return JSON.stringify({ error: `unknown tool ${name}` });
}

/* ------------------------------ OpenRouter -------------------------------- */

function makeOpenRouterChat({ apiKey, model, timeoutMs = 90_000 }) {
  return async function chat(messages, tools) {
    // Hard timeout so a hung provider can never freeze the chat (or the bake-off).
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://akasilabs.com',
          'X-Title': 'Akasi Sounds - Music Director',
        },
        body: JSON.stringify({ model, messages, tools, temperature: 0.4 }),
      });
    } catch (e) {
      throw new Error(ac.signal.aborted ? `OpenRouter timeout after ${timeoutMs}ms` : String(e.message || e));
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const j = await res.json();
    return { message: j.choices?.[0]?.message || {}, usage: j.usage || null };
  };
}

/* --------------------------------- loop ----------------------------------- */

/**
 * @param {object} p
 * @param p.db, p.sidecar, p.clapReady   library engine
 * @param p.messages                     [{role,content}] chat history (last = user brief)
 * @param p.mode                         'grounded' | 'triad'
 * @param p.model                        judge/director model slug
 * @param p.retrieverModel               cheap model for triad retrievers
 * @param p.apiKey                       OpenRouter key (prod path)
 * @param p.chat                         inject an OpenAI-compatible caller (tests/bakeoff)
 * @param p.retrieverChat                inject retriever caller (triad; defaults to `chat`)
 * @param p.onEvent                      progress callback
 * @returns {{text, pool, steps, usage, mode}}
 */
async function runDirector(p) {
  const {
    db, sidecar, clapReady = false, messages, mode = 'grounded',
    model = DEFAULT_MODEL, retrieverModel, apiKey, onEvent, maxSteps = MAX_STEPS,
  } = p;
  const chat = p.chat || makeOpenRouterChat({ apiKey, model });
  const pool = new Map();
  const ctx = { db, sidecar, clapReady, pool, onEvent };
  let usageTotal = { prompt_tokens: 0, completion_tokens: 0 };
  const addUsage = (u) => { if (u) { usageTotal.prompt_tokens += u.prompt_tokens || 0; usageTotal.completion_tokens += u.completion_tokens || 0; } };
  const brief = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  if (mode === 'triad') return runTriad({ ...p, chat, ctx, pool, brief, addUsage, usageTotal });

  // --- grounded: one model searches + judges ---
  const convo = [{ role: 'system', content: SYSTEM }, ...messages];
  for (let step = 0; step < maxSteps; step++) {
    const { message, usage } = await chat(convo, TOOLS);
    addUsage(usage);
    convo.push(message);
    if (!message.tool_calls?.length) {
      const text = message.content || '(no answer)';
      onEvent?.({ type: 'final', text, pool: [...pool.values()] });
      return { text, pool: [...pool.values()], steps: step + 1, usage: usageTotal, mode };
    }
    for (const call of message.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* bad json */ }
      onEvent?.({ type: 'tool', name: call.function.name, args });
      const out = await dispatch(call.function.name, args, ctx);
      convo.push({ role: 'tool', tool_call_id: call.id, content: out });
    }
    if (step === maxSteps - 3) {
      convo.push({ role: 'user', content: 'Stop searching now. Write the final cue sheet from the results you already have.' });
    }
  }
  const text = '(stopped — no final cue sheet)';
  onEvent?.({ type: 'final', text, pool: [...pool.values()] });
  return { text, pool: [...pool.values()], steps: maxSteps, usage: usageTotal, mode };
}

/**
 * Triad: separate RETRIEVAL from JUDGMENT. Two cheap retrievers each propose ONE
 * query (literal keywords vs emotional description) → merged real pool → a capable
 * judge picks from the pool only. Retrievers never judge; the judge never searches.
 */
async function runTriad({ chat, retrieverChat: injectedRetriever, ctx, pool, brief, addUsage, usageTotal, retrieverModel, apiKey, onEvent }) {
  const retrieverChat = injectedRetriever
    || (retrieverModel && apiKey ? makeOpenRouterChat({ apiKey, model: retrieverModel }) : chat);

  const RETRIEVERS = [
    { role: 'keyword-librarian', ask: 'Give ONE short keyword search query (literal sound words, no prose) to find files for this brief. Reply with ONLY the query text.' },
    { role: 'mood-supervisor', ask: 'Give ONE short natural-language query describing the FEELING/mood/energy to semantically match files for this brief. Reply with ONLY the query text.' },
  ];
  for (const r of RETRIEVERS) {
    const { message, usage } = await retrieverChat(
      [{ role: 'system', content: `You are the ${r.role}. ${r.ask}` }, { role: 'user', content: brief }],
      undefined
    );
    addUsage(usage);
    const q = String(message.content || brief).trim().replace(/^["']|["']$/g, '').slice(0, 200);
    onEvent?.({ type: 'tool', name: 'search_sounds', args: { query: q, via: r.role } });
    await dispatch('search_sounds', { query: q, limit: 12 }, ctx);
  }
  const candidates = [...pool.values()].map(slim);
  const judgeConvo = [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: `Brief: ${brief}\n\nCandidate pool (pick from these ONLY):\n${JSON.stringify(candidates, null, 0)}` },
  ];
  const { message, usage } = await chat(judgeConvo, undefined);
  addUsage(usage);
  const text = message.content || '(no answer)';
  onEvent?.({ type: 'final', text, pool: [...pool.values()] });
  return { text, pool: [...pool.values()], steps: 3, usage: usageTotal, mode: 'triad' };
}

module.exports = { runDirector, TOOLS, DEFAULT_MODEL, DEFAULT_RETRIEVER_MODEL, dispatch, slim, makeOpenRouterChat };
