'use strict';
/**
 * Akasi Sounds local index — SQLite (better-sqlite3) with FTS5 keyword search.
 *
 * One portable file holds the whole library index. Rows describe sounds from any
 * provider (local folder, Freesound, …); the actual audio lives at `path` (local)
 * or is streamed/cached from `url`. Semantic (CLAP) search lands in V2 as an extra
 * column + vector index — the schema below reserves `embedding` for it.
 */
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL,              -- 'local' | 'freesound' | ...
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
  tags         TEXT,                       -- space/comma separated
  favorite     INTEGER NOT NULL DEFAULT 0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  added_at     INTEGER NOT NULL,
  embedding    BLOB,                       -- reserved: CLAP vector (V2)
  UNIQUE(source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_sounds_source   ON sounds(source);
CREATE INDEX IF NOT EXISTS idx_sounds_favorite ON sounds(favorite);
CREATE INDEX IF NOT EXISTS idx_sounds_added    ON sounds(added_at);

-- FTS5 over the searchable text; kept in sync via triggers.
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

CREATE TABLE IF NOT EXISTS folders (
  path       TEXT PRIMARY KEY,
  added_at   INTEGER NOT NULL,
  scanned_at INTEGER
);
`;

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return new AkasiDb(db);
}

/** Turn a free-text query into a safe FTS5 prefix-match expression. */
function toFtsQuery(q) {
  const terms = String(q || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return null;
  return terms.map((t) => `${t}*`).join(' ');
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
      added_at: now,
    };
    const stmt = this.db.prepare(`
      INSERT INTO sounds (source, source_id, name, path, url, cached_path, duration,
                          samplerate, channels, filesize, license, attribution, tags, added_at)
      VALUES (@source, @source_id, @name, @path, @url, @cached_path, @duration,
              @samplerate, @channels, @filesize, @license, @attribution, @tags, @added_at)
      ON CONFLICT(source, source_id) DO UPDATE SET
        name=excluded.name, path=excluded.path, url=excluded.url,
        cached_path=COALESCE(excluded.cached_path, sounds.cached_path),
        duration=excluded.duration, samplerate=excluded.samplerate,
        channels=excluded.channels, filesize=excluded.filesize,
        license=excluded.license, attribution=excluded.attribution, tags=excluded.tags
      RETURNING id
    `);
    return stmt.get(row).id;
  }

  upsertMany(sounds) {
    const tx = this.db.transaction((rows) => rows.map((r) => this.upsertSound(r)));
    return tx(sounds);
  }

  /**
   * Keyword search. Empty query → most-recent library rows (browse mode).
   * opts: { limit, offset, source, favoritesOnly }
   */
  search(query, opts = {}) {
    const limit = Math.min(opts.limit || 100, 500);
    const offset = opts.offset || 0;
    const filters = [];
    const params = {};
    if (opts.source) {
      filters.push('s.source = @source');
      params.source = opts.source;
    }
    if (opts.favoritesOnly) filters.push('s.favorite = 1');

    const fts = toFtsQuery(query);
    if (fts) {
      params.fts = fts;
      const where = ['s.id IN (SELECT rowid FROM sounds_fts WHERE sounds_fts MATCH @fts)', ...filters].join(' AND ');
      return this.db
        .prepare(
          `SELECT s.* FROM sounds s
           JOIN sounds_fts f ON f.rowid = s.id
           WHERE ${where}
           ORDER BY bm25(sounds_fts), s.use_count DESC
           LIMIT @limit OFFSET @offset`
        )
        .all({ ...params, limit, offset });
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT s.* FROM sounds s ${where} ORDER BY s.added_at DESC LIMIT @limit OFFSET @offset`)
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

  stats() {
    const total = this.db.prepare('SELECT COUNT(*) c FROM sounds').get().c;
    const bySource = this.db.prepare('SELECT source, COUNT(*) c FROM sounds GROUP BY source').all();
    const favorites = this.db.prepare('SELECT COUNT(*) c FROM sounds WHERE favorite = 1').get().c;
    return { total, favorites, bySource };
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
