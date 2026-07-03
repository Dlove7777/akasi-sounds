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
const { blendedSearch, similarByEmbedding } = require('./search');
const { SCORING_PLAYBOOK } = require('./playbook');
const genprompt = require('./genprompt');
const rag = require('./rag');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Bake-off winner (grounded mode): 100% honest, richest real pools, usable cue sheets,
// ~$0.006/run. See docs/plans/DIRECTOR-BAKEOFF-RESULTS.md. deepseek was disqualified
// (fabricated a filename); glm-5.2 too slow (65s); haiku honest but 4× the cost.
const DEFAULT_MODEL = 'google/gemini-3-flash-preview';
const DEFAULT_RETRIEVER_MODEL = 'deepseek/deepseek-v4-flash'; // cheap retriever for triad (needs semantic search — unevaluated)
const MAX_STEPS = 12;

const SYSTEM = `You are Dennis's music supervisor with live access to his personal sound + music library through tools. Turn any brief into a tight cue sheet of REAL files he can drop straight into an edit.

FIRST, classify the brief:
- MUSICAL (bed, underscore, score, track, theme, song, groove, cue) → you are picking MUSIC. Always pass kind="music" on your searches. NEVER put a sound effect (an impact, whoosh, footstep, stinger, foley hit) in a music cue sheet — a one-shot SFX is not a bed. If the brief also implies no singing ("instrumental", "under a VO", "bed"), pass instrumental=true.
- SFX (whoosh, impact, foley, ambience, transition, hit) → pass kind="sfx".

TWO SOURCES:
- search_sounds = Dennis's OWN library. ALWAYS try this first — his files are highest quality and license-clean.
- search_online = Creative-Commons libraries online, all at once: Freesound (SFX, textures, ambiences, loops) and Jamendo (full CC MUSIC tracks — real beds/underscore). Reach for it when his library lacks a good fit — his library is SFX-heavy, so for MUSIC beds especially, search_online (Jamendo) is where you'll find them. Results are CC-licensed — flag CC-BY (needs credit) and NEVER present CC-BY-NC as client-safe. When local and online are equal quality, prefer his local file.

How to work:
- Run 2-3 DIVERSE searches, not one. Vary the angle: a mood/feeling query ("dark brooding tension"), a genre/instrumentation query ("ambient synth pad", "minimal piano"), and a literal one. Semantic AI search matches the *feeling* — describe it, don't just keyword.
- If the local library comes up thin or off-target, DON'T give up — try search_online before concluding there's no fit (for a music bed, that means Jamendo).
- SOUNDS-LIKE: for "sounds like <artist/track/vibe>" requests, call match_reference (an anchorId of a library file, or a text style description). It matches by SOUND (CLAP), returning real files — you write the style words, it finds the sonic match.
- Apply the filters the brief states: tempo words → bpmMin/bpmMax (chill <90, mid 90-120, driving 120+); "short sting" → durMax; "full bed" → durMin (a bed is usually >20s, not a 1-second file).
- If a filtered search is thin, WIDEN (drop the bpm or duration filter) and search again before settling — don't grab a weak match just to fill the sheet. Use library_stats to see available genres.
- Then STOP searching and write the cue sheet.

GENERATION: when the library AND online genuinely lack a fit, or the user asks to create/generate a track, call write_generation_prompt({brief}) to draft a ready-to-use generation prompt (paste into ACE-Step/Suno, or generate in-app when VIDI is connected). Pass samplePath to ground it in an analyzed reference. Offer this as a next step rather than forcing a weak library pick.

How to answer:
- Pick the best 2-6 that genuinely fit, favoring variety over near-duplicates. Fewer strong picks beat padding with weak ones.
- If the library honestly lacks a good fit (e.g. it's SFX-heavy and has no real tension bed), SAY SO plainly and offer the closest usable option as a clearly-labeled compromise — do not dress up an SFX as a bed.
- Per pick: **exact file name** — one line on why it fits (mood / tempo / instrumentation), then \`BPM · key · genre\`.
- Lead with your top recommendation. Flag licensing only when it matters (CC-BY needs credit, CC-BY-NC is not client-safe).
- NEVER invent a sound. Recommend ONLY files the tools returned, by their exact name. Be concise — an editor wants picks, not prose.

${SCORING_PLAYBOOK}`;

const JUDGE_SYSTEM = `You are Dennis's music supervisor. You are given a music brief and a POOL of REAL candidate files already retrieved from his library. Do NOT search — pick the best 3-6 from the pool ONLY, favoring variety over near-duplicates. Per pick: **name** — one line on why it fits, then \`BPM · key · genre\`. Lead with your top pick. NEVER invent a file; reference each by its exact name. Concise.

${SCORING_PLAYBOOK}`;

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
  {
    type: 'function',
    function: {
      name: 'match_reference',
      description:
        "Find library files that SOUND LIKE a reference (CLAP audio-similarity) — use for \"sounds like X\" requests. Pass anchorId (a library sound id to match against) OR description (a text style description, e.g. \"lo-fi Nujabes-style jazzy beat\"). Returns real library rows; you supply the style words, CLAP supplies the sonic match.",
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Textual style description to match by sound.' },
          anchorId: { type: 'number', description: 'A library sound id to find similar-sounding files to.' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_scoring_ref',
      description:
        'Look up DEEPER scoring craft — music-theory→emotion, genre fingerprints, and format-specific scoring conventions (film/TV/commercial/short-form) — to ground a tricky curation call or a generation prompt. Returns reference TEXT (context), not files.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_generation_prompt',
      description:
        "Draft a ready-to-use MUSIC GENERATION prompt (for ACE-Step / Suno / Udio, or in-app generation) when the library and online sources lack a fit, or the user asks to create/generate a track. Returns a structured prompt (caption, duration, bpm, genre, instrumental). Optionally pass samplePath to ground it in an analyzed reference file.",
      parameters: {
        type: 'object',
        properties: {
          brief: { type: 'string', description: 'What to generate — mood, genre, tempo, use.' },
          samplePath: { type: 'string', description: 'Optional path to a reference audio file to analyze and match.' },
        },
        required: ['brief'],
      },
    },
  },
];

// Only offered when a remote provider is wired (main process passes remoteSearch).
const ONLINE_TOOL = {
  type: 'function',
  function: {
    name: 'search_online',
    description:
      "Search ONLINE Creative-Commons libraries when Dennis's own library lacks a good fit. Spans every connected source at once: Freesound (SFX, textures, ambiences, loops) and Jamendo (full CC MUSIC tracks — the place to find real beds/underscore). Results become real, draggable rows (previews cache on drag). Flag licensing: CC-BY needs credit, CC-BY-NC is NOT client-safe.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords / mood / genre to search online for.' },
        limit: { type: 'number', description: 'Max results (default 20).' },
      },
      required: ['query'],
    },
  },
};

// Only offered when generation is connected (VIDI ACE-Step reachable).
const GENERATE_TOOL = {
  type: 'function',
  function: {
    name: 'generate_music',
    description:
      "Generate a NEW music track with ACE-Step (on VIDI) when the library AND online have no fit. Returns a real, draggable generated row added to the library. Provide a `brief` (I'll draft the caption) OR a finished `caption` (from write_generation_prompt), plus durationSec. Generation takes several seconds; only reach for it after search + search_online genuinely come up short.",
    parameters: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'What to generate (a caption is drafted from it).' },
        caption: { type: 'string', description: 'A finished generation caption; overrides brief.' },
        durationSec: { type: 'number', description: 'Target length in seconds (default 30).' },
      },
    },
  },
};

/** Tool set for a run — adds conditional tools only when their capability is wired. */
function buildTools(hasRemote, hasGenerate) {
  return [...TOOLS, ...(hasRemote ? [ONLINE_TOOL] : []), ...(hasGenerate ? [GENERATE_TOOL] : [])];
}

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
  if (name === 'match_reference') {
    let targetArr = null;
    if (args.anchorId != null) {
      targetArr = db.getEmbeddingArray(args.anchorId);
    } else if (args.description && ctx.clapReady) {
      const r = await sidecar.embedText(String(args.description)).catch(() => null);
      if (r?.embedding) targetArr = r.embedding;
    }
    if (!targetArr) {
      return JSON.stringify({ error: args.anchorId != null ? 'That anchor has no AI fingerprint yet (run Analyze).' : 'Semantic match needs the AI model warm — use search_sounds instead.', results: [] });
    }
    const rows = similarByEmbedding(db, sidecar, targetArr, { limit: Math.min(args.limit || 20, 40), excludeId: args.anchorId });
    for (const row of rows) if (!pool.has(row.id)) pool.set(row.id, row);
    onEvent?.({ type: 'pool', rows: [...pool.values()] });
    return JSON.stringify({ count: rows.length, results: rows.map((x) => ({ ...slim(x), sim: x._sim })) });
  }
  if (name === 'lookup_scoring_ref') {
    const corpus = ctx.scoringCorpus || [];
    if (!corpus.length) return JSON.stringify({ refs: [] });
    if (!ctx.clapReady) return JSON.stringify({ error: 'Reference lookup needs the AI model warm.', refs: [] });
    const embed = async (t) => { const r = await sidecar.embedText(t).catch(() => null); return (r && r.embedding) || []; };
    const refs = await rag.retrieve(String(args.query || ''), { corpus, embed, topK: 4 });
    return JSON.stringify({ refs: refs.map((r) => ({ source: r.file, text: r.text })) }); // context only — never files
  }
  if (name === 'write_generation_prompt') {
    let sample = null;
    if (args.samplePath && ctx.analyzeSample) {
      try { sample = await ctx.analyzeSample(String(args.samplePath)); } catch { /* brief-only fallback */ }
    }
    return JSON.stringify({ generationPrompt: genprompt.buildGenerationPrompt({ brief: args.brief, sample }) });
  }
  if (name === 'generate_music') {
    if (!ctx.generate) return JSON.stringify({ error: 'Generation not connected (VIDI ACE-Step offline).' });
    const gp = args.caption ? null : genprompt.buildGenerationPrompt({ brief: args.brief || '' });
    const spec = { caption: args.caption || gp.caption, durationSec: args.durationSec || (gp && gp.suggestedDurationSec) || 30 };
    onEvent?.({ type: 'generating', spec });
    let row;
    try { row = await ctx.generate(spec, (s) => onEvent?.({ type: 'generating', status: s })); }
    catch (e) { return JSON.stringify({ error: String(e.message || e) }); }
    if (row) { pool.set(row.id, row); onEvent?.({ type: 'pool', rows: [...pool.values()] }); }
    return JSON.stringify({ generated: row ? slim(row) : null });
  }
  if (name === 'search_online') {
    if (!ctx.remoteSearch) return JSON.stringify({ error: 'Online search unavailable (no provider/API key).' });
    const r = await ctx.remoteSearch(String(args.query || ''), Math.min(args.limit || 20, 40));
    if (r.error) return JSON.stringify({ error: r.error, results: [] });
    for (const row of r.results || []) if (!pool.has(row.id)) pool.set(row.id, row);
    onEvent?.({ type: 'pool', rows: [...pool.values()] });
    return JSON.stringify({ count: r.count ?? (r.results || []).length, results: (r.results || []).map((x) => ({ ...slim(x), source: x.source })) });
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
  const ctx = { db, sidecar, clapReady, pool, onEvent, remoteSearch: p.remoteSearch, analyzeSample: p.analyzeSample, generate: p.generate, scoringCorpus: p.scoringCorpus };
  const tools = buildTools(!!p.remoteSearch, !!p.generate);
  let usageTotal = { prompt_tokens: 0, completion_tokens: 0 };
  const addUsage = (u) => { if (u) { usageTotal.prompt_tokens += u.prompt_tokens || 0; usageTotal.completion_tokens += u.completion_tokens || 0; } };
  const brief = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  if (mode === 'triad') return runTriad({ ...p, chat, ctx, pool, brief, addUsage, usageTotal });

  // --- grounded: one model searches + judges ---
  const convo = [{ role: 'system', content: SYSTEM }, ...messages];
  for (let step = 0; step < maxSteps; step++) {
    const { message, usage } = await chat(convo, tools);
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

module.exports = { runDirector, TOOLS, buildTools, DEFAULT_MODEL, DEFAULT_RETRIEVER_MODEL, dispatch, slim, makeOpenRouterChat, SYSTEM, JUDGE_SYSTEM };
