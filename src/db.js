'use strict';
/**
 * Akasi Sounds local index — SQLite (better-sqlite3) with FTS5 keyword search.
 *
 * One portable file holds the whole library index. Rows describe sounds from any
 * provider (local folder, Freesound, generate, …); the audio lives at `path` (local)
 * or is streamed/cached from `url`. Music metadata (artist/genre/bpm) is read from
 * embedded tags at scan time. Semantic (CLAP) search lands later as the `embedding`
 * column + a vector index. Collections group sounds many-to-many.
 */
const Database = require('better-sqlite3');
const thesaurus = require('./thesaurus');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL,              -- 'local' | 'freesound' | 'generate' | ...
  source_id    TEXT,                       -- provider's own id (for dedupe/refetch)
  name         TEXT NOT NULL,
  path         TEXT,                       -- local absolute path, if downloaded/local
  url          TEXT,                       -- remote preview/stream url, if not local
  cached_path  TEXT,                       -- local cache of a remote preview
  duration     REAL,                       -- seconds
  samplerate   INTEGER,
  channels     INTEGER,
  filesize     INTEGER,
  license      TEXT,
  attribution  TEXT,                       -- required credit string, if any
  tags         TEXT,                       -- space/comma separated (incl. artist/genre for FTS)
  kind         TEXT NOT NULL DEFAULT 'sfx',-- 'sfx' | 'music'
  artist       TEXT,
  album        TEXT,
  genre        TEXT,
  bpm          REAL,
  year         INTEGER,
  favorite     INTEGER NOT NULL DEFAULT 0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  added_at     INTEGER NOT NULL,
  embedding    BLOB,                       -- reserved: CLAP vector (semantic search)
  UNIQUE(source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_sounds_source   ON sounds(source);
CREATE INDEX IF NOT EXISTS idx_sounds_favorite ON sounds(favorite);
CREATE INDEX IF NOT EXISTS idx_sounds_added    ON sounds(added_at);
CREATE INDEX IF NOT EXISTS idx_sounds_kind     ON sounds(kind);

CREATE VIRTUAL TABLE IF NOT EXISTS sounds_fts USING fts5(
  name, tags, content='sounds', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS sounds_ai AFTER INSERT ON sounds BEGIN
  INSERT INTO sounds_fts(rowid, name, tags) VALUES (new.id, new.name, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS sounds_ad AFTER DELETE ON sounds BEGIN
  INSERT INTO sounds_fts(sounds_fts, rowid, name, tags) VALUES('delete', old.id, old.name, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS sounds_au AFTER UPDATE ON sounds BEGIN
  INSERT INTO sounds_fts(sounds_fts, rowid, name, tags) VALUES('delete', old.id, old.name, old.tags);
  INSERT INTO sounds_fts(rowid, name, tags) VALUES (new.id, new.name, new.tags);
END;

-- Read-only view over the FTS index vocabulary — powers search autocomplete.
CREATE VIRTUAL TABLE IF NOT EXISTS sounds_fts_v USING fts5vocab('sounds_fts', 'row');

CREATE TABLE IF NOT EXISTS folders (
  path       TEXT PRIMARY KEY,
  added_at   INTEGER NOT NULL,
  scanned_at INTEGER
);

CREATE TABLE IF NOT EXISTS collections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_sounds (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  sound_id      INTEGER NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, sound_id)
);
CREATE INDEX IF NOT EXISTS idx_cs_sound ON collection_sounds(sound_id);
`;

// Columns added after the original V1 schema — ALTER them in for pre-existing DBs.
const ADDED_COLUMNS = [
  ['kind', "TEXT NOT NULL DEFAULT 'sfx'"],
  ['artist', 'TEXT'],
  ['album', 'TEXT'],
  ['genre', 'TEXT'],
  ['bpm', 'REAL'],
  ['year', 'INTEGER'],
  ['peaks', 'BLOB'], // 160-byte waveform envelope for inline row rendering
];

function migrate(db) {
  const cols = new Set(db.prepare(`PRAGMA table_info(sounds)`).all().map((c) => c.name));
  for (const [col, def] of ADDED_COLUMNS) {
    if (!cols.has(col)) db.exec(`ALTER TABLE sounds ADD COLUMN ${col} ${def}`);
  }
}

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return new AkasiDb(db);
}

/**
 * Turn a free-text query into a safe FTS5 expression: AND across the user's terms,
 * OR within each term's thesaurus group — "swish hit" matches files tagged only
 * "whoosh impact".
 */
function toFtsQuery(q) {
  const terms = String(q || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return null;
  return terms
    .map((t) => {
      const syn = thesaurus.expand(t);
      return syn.length > 1 ? `(${syn.map((s) => `${s}*`).join(' OR ')})` : `${t}*`;
    })
    .join(' ');
}

class AkasiDb {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  /** Insert or update a sound by (source, source_id). Returns the row id. */
  upsertSound(s) {
    const now = Date.now();
    const row = {
      source: s.source,
      source_id: s.source_id != null ? String(s.source_id) : null,
      name: s.name || 'untitled',
      path: s.path || null,
      url: s.url || null,
      cached_path: s.cached_path || null,
      duration: s.duration ?? null,
      samplerate: s.samplerate ?? null,
      channels: s.channels ?? null,
      filesize: s.filesize ?? null,
      license: s.license || null,
      attribution: s.attribution || null,
      tags: Array.isArray(s.tags) ? s.tags.join(' ') : s.tags || null,
      kind: s.kind || 'sfx',
      artist: s.artist || null,
      album: s.album || null,
      genre: s.genre || null,
      bpm: s.bpm ?? null,
      year: s.year ?? null,
      added_at: now,
    };
    const stmt = this.db.prepare(`
      INSERT INTO sounds (source, source_id, name, path, url, cached_path, duration,
                          samplerate, channels, filesize, license, attribution, tags,
                          kind, artist, album, genre, bpm, year, added_at)
      VALUES (@source, @source_id, @name, @path, @url, @cached_path, @duration,
              @samplerate, @channels, @filesize, @license, @attribution, @tags,
              @kind, @artist, @album, @genre, @bpm, @year, @added_at)
      ON CONFLICT(source, source_id) DO UPDATE SET
        name=excluded.name, path=excluded.path, url=excluded.url,
        cached_path=COALESCE(excluded.cached_path, sounds.cached_path),
        duration=excluded.duration, samplerate=excluded.samplerate,
        channels=excluded.channels, filesize=excluded.filesize,
        license=excluded.license, attribution=excluded.attribution, tags=excluded.tags,
        kind=excluded.kind, artist=excluded.artist, album=excluded.album,
        genre=excluded.genre, bpm=excluded.bpm, year=excluded.year
      RETURNING id
    `);
    return stmt.get(row).id;
  }

  upsertMany(sounds) {
    const tx = this.db.transaction((rows) => rows.map((r) => this.upsertSound(r)));
    return tx(sounds);
  }

  /**
   * Keyword search. Empty query → browse mode.
   * opts: { limit, offset, source, favoritesOnly, kind, collectionId, recentOnly,
   *         sort: 'relevance' | 'newest' | 'duration' | 'used' }
   * 'relevance' means bm25 when a query is present, else falls back to newest.
   */
  search(query, opts = {}) {
    const limit = Math.min(opts.limit || 200, 2000);
    const offset = opts.offset || 0;
    const filters = [];
    const params = {};
    if (opts.source) {
      filters.push('s.source = @source');
      params.source = opts.source;
    }
    if (opts.favoritesOnly) filters.push('s.favorite = 1');
    if (opts.recentOnly) filters.push('s.last_used_at IS NOT NULL');
    if (opts.kind) {
      filters.push('s.kind = @kind');
      params.kind = opts.kind;
    }
    if (opts.collectionId) {
      filters.push('s.id IN (SELECT sound_id FROM collection_sounds WHERE collection_id = @collectionId)');
      params.collectionId = opts.collectionId;
    }

    const ORDERS = {
      newest: 's.added_at DESC',
      duration: 's.duration ASC NULLS LAST',
      used: 's.use_count DESC, s.last_used_at DESC',
      recent: 's.last_used_at DESC',
    };
    // Recent scope defaults to last-used order; everything else to newest.
    const fallback = opts.recentOnly ? ORDERS.recent : ORDERS.newest;
    const explicit = ORDERS[opts.sort] || null;

    const fts = toFtsQuery(query);
    if (fts) {
      params.fts = fts;
      const where = ['sounds_fts MATCH @fts', ...filters].join(' AND ');
      const order = explicit || 'bm25(sounds_fts), s.use_count DESC'; // relevance
      return this.db
        .prepare(
          `SELECT s.* FROM sounds s
           JOIN sounds_fts ON sounds_fts.rowid = s.id
           WHERE ${where}
           ORDER BY ${order}
           LIMIT @limit OFFSET @offset`
        )
        .all({ ...params, limit, offset });
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT s.* FROM sounds s ${where} ORDER BY ${explicit || fallback} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset });
  }

  getSound(id) {
    return this.db.prepare('SELECT * FROM sounds WHERE id = ?').get(id);
  }

  toggleFavorite(id) {
    return this.db.prepare('UPDATE sounds SET favorite = 1 - favorite WHERE id = ?').run(id).changes;
  }

  markUsed(id) {
    return this.db
      .prepare('UPDATE sounds SET use_count = use_count + 1, last_used_at = ? WHERE id = ?')
      .run(Date.now(), id).changes;
  }

  setCachedPath(id, cachedPath) {
    return this.db.prepare('UPDATE sounds SET cached_path = ? WHERE id = ?').run(cachedPath, id).changes;
  }

  setPeaks(id, buf) {
    return this.db.prepare('UPDATE sounds SET peaks = ? WHERE id = ?').run(buf, id).changes;
  }

  /** Autocomplete: indexed terms starting with `prefix`, most frequent first. */
  suggest(prefix, limit = 8) {
    const p = String(prefix || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (p.length < 2) return [];
    return this.db
      .prepare(`SELECT term FROM sounds_fts_v WHERE term LIKE ? || '%' AND length(term) > 2
                ORDER BY cnt DESC LIMIT ?`)
      .all(p, limit)
      .map((r) => r.term);
  }

  stats() {
    const total = this.db.prepare('SELECT COUNT(*) c FROM sounds').get().c;
    const bySource = this.db.prepare('SELECT source, COUNT(*) c FROM sounds GROUP BY source').all();
    const favorites = this.db.prepare('SELECT COUNT(*) c FROM sounds WHERE favorite = 1').get().c;
    const music = this.db.prepare("SELECT COUNT(*) c FROM sounds WHERE kind = 'music'").get().c;
    const recent = this.db.prepare('SELECT COUNT(*) c FROM sounds WHERE last_used_at IS NOT NULL').get().c;
    return { total, favorites, music, recent, bySource };
  }

  /* ---------------------------- collections ---------------------------- */

  createCollection(name) {
    return this.db
      .prepare('INSERT INTO collections(name, created_at) VALUES (?, ?) RETURNING id')
      .get(name, Date.now()).id;
  }
  renameCollection(id, name) {
    return this.db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name, id).changes;
  }
  deleteCollection(id) {
    return this.db.prepare('DELETE FROM collections WHERE id = ?').run(id).changes;
  }
  addToCollection(collectionId, soundId) {
    return this.db
      .prepare('INSERT OR IGNORE INTO collection_sounds(collection_id, sound_id, added_at) VALUES (?, ?, ?)')
      .run(collectionId, soundId, Date.now()).changes;
  }
  removeFromCollection(collectionId, soundId) {
    return this.db
      .prepare('DELETE FROM collection_sounds WHERE collection_id = ? AND sound_id = ?')
      .run(collectionId, soundId).changes;
  }
  /** Collections with member counts, newest first. */
  listCollections() {
    return this.db
      .prepare(
        `SELECT c.id, c.name, c.created_at,
                (SELECT COUNT(*) FROM collection_sounds cs WHERE cs.collection_id = c.id) AS count
         FROM collections c ORDER BY c.name COLLATE NOCASE`
      )
      .all();
  }
  /** Collection ids a given sound belongs to. */
  collectionsForSound(soundId) {
    return this.db
      .prepare('SELECT collection_id FROM collection_sounds WHERE sound_id = ?')
      .all(soundId)
      .map((r) => r.collection_id);
  }

  addFolder(p) {
    this.db.prepare('INSERT OR IGNORE INTO folders(path, added_at) VALUES (?, ?)').run(p, Date.now());
  }
  listFolders() {
    return this.db.prepare('SELECT * FROM folders ORDER BY added_at').all();
  }
  markFolderScanned(p) {
    this.db.prepare('UPDATE folders SET scanned_at = ? WHERE path = ?').run(Date.now(), p);
  }
}

module.exports = { openDb, toFtsQuery, AkasiDb };
