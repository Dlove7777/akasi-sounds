'use strict';
/**
 * Akasi Sounds MCP door — exposes the local sound library to agents (Hermes Music
 * Director, Claude, etc.) over stdio. Read-only against the app's SQLite index;
 * semantic search runs the same CLAP sidecar the app uses. Runs under the app's
 * Electron ABI: `ELECTRON_RUN_AS_NODE=1 <electron> mcp/server.js` (see run.sh).
 *
 * Tools: search_sounds · get_sound · list_collections · library_stats
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const { openDb } = require('../src/db');
const sidecar = require('../src/sidecar');
const { blendedSearch } = require('../src/search');

function defaultDbPath() {
  if (process.env.AKASI_SOUNDS_DB) return process.env.AKASI_SOUNDS_DB;
  // Electron userData: productName "Akasi Sounds" on macOS.
  return path.join(os.homedir(), 'Library', 'Application Support', 'Akasi Sounds', 'akasi-sounds-index.db');
}

const DB_PATH = defaultDbPath();
if (!fs.existsSync(DB_PATH)) {
  process.stderr.write(`Akasi Sounds DB not found at ${DB_PATH}. Launch the app once, or set AKASI_SOUNDS_DB.\n`);
  process.exit(1);
}
// Open read-write so an older DB gets the AI columns migrated in (WAL allows this
// alongside the running app). Safety is enforced by exposing NO write tools below.
const db = openDb(DB_PATH);

// Warm CLAP so semantic queries work; degrade to keyword-only if unavailable.
let clapReady = false;
if (sidecar.available()) sidecar.startClap().then(() => { clapReady = true; }).catch(() => {});

const server = new McpServer({ name: 'akasi-sounds', version: '0.2.0' });

const fmt = (r) => ({
  id: r.id, name: r.name, kind: r.kind, source: r.source,
  duration: r.duration, bpm: r.bpm, key: r.key,
  genre: r.genre || r.ai_genre || undefined,
  vocals: r.vocals == null ? undefined : r.vocals ? 'vocals' : 'instrumental',
  license: r.license, attribution: r.attribution || undefined,
  matchedBySound: r._sem ? true : undefined,
  path: r.path || r.cached_path || undefined,
});

server.registerTool(
  'search_sounds',
  {
    title: 'Search the sound library',
    description:
      'Search Akasi Sounds by keyword AND by describing the sound in plain language ' +
      '(semantic AI). Filter by kind, BPM, duration, genre, and instrumental/vocals. ' +
      'Returns matching sounds with metadata and file paths.',
    inputSchema: {
      query: z.string().describe('keywords or a natural-language description, e.g. "tense metallic riser"'),
      kind: z.enum(['sfx', 'music']).optional(),
      genre: z.string().optional(),
      instrumental: z.boolean().optional().describe('true = instrumental only, false = vocals only'),
      bpmMin: z.number().optional(),
      bpmMax: z.number().optional(),
      durMin: z.number().optional().describe('minimum duration in seconds'),
      durMax: z.number().optional().describe('maximum duration in seconds'),
      limit: z.number().optional().default(20),
    },
  },
  async (a) => {
    const opts = {
      kind: a.kind, genre: a.genre,
      vocals: a.instrumental === undefined ? undefined : a.instrumental ? 0 : 1,
      bpmMin: a.bpmMin, bpmMax: a.bpmMax, durMin: a.durMin, durMax: a.durMax,
      limit: Math.min(a.limit || 20, 100),
    };
    const rows = await blendedSearch(db, sidecar, a.query, opts, clapReady);
    const payload = { count: rows.length, semantic: clapReady, results: rows.slice(0, opts.limit).map(fmt) };

    // Guide the agent out of the metadata-filter trap: if filters wiped everything
    // out but the same query WITHOUT metadata filters would return matches, say so.
    // (Common before ⚡ Analyze has run — bpm/vocals/genre are still NULL.)
    const metaFilters = ['genre', 'vocals', 'bpmMin', 'bpmMax', 'durMin', 'durMax'];
    const hadMeta = metaFilters.some((k) => opts[k] != null);
    if (rows.length === 0 && hadMeta) {
      const bare = { kind: opts.kind, limit: opts.limit };
      const without = await blendedSearch(db, sidecar, a.query, bare, clapReady);
      if (without.length) {
        payload.hint =
          `0 results with your filters, but ${without.length} match without them. The library ` +
          `likely has not been analyzed yet (BPM/vocals/genre are unset until "Analyze Library" ` +
          `runs), so metadata filters exclude everything. Re-search WITHOUT instrumental/bpm/genre ` +
          `filters and judge from names/tags instead.`;
        payload.previewWithoutFilters = without.slice(0, opts.limit).map(fmt);
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
  }
);

server.registerTool(
  'get_sound',
  { title: 'Get one sound', description: 'Full metadata + file path for a sound id.', inputSchema: { id: z.number() } },
  async ({ id }) => {
    const r = db.getSound(id);
    return { content: [{ type: 'text', text: r ? JSON.stringify(fmt(r), null, 2) : `No sound with id ${id}` }] };
  }
);

server.registerTool(
  'list_collections',
  { title: 'List collections', description: 'User-defined collections with counts.', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: JSON.stringify(db.listCollections(), null, 2) }] })
);

server.registerTool(
  'library_stats',
  { title: 'Library stats', description: 'Totals, favorites, music count, genres, and whether AI search is active.', inputSchema: {} },
  async () => {
    const s = db.stats();
    return { content: [{ type: 'text', text: JSON.stringify({ ...s, genres: db.genres(), aiSearch: clapReady }, null, 2) }] };
  }
);

(async () => {
  await server.connect(new StdioServerTransport());
  process.stderr.write(`akasi-sounds MCP door up — db=${DB_PATH} ai=${sidecar.available()}\n`);
})();
