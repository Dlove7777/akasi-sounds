'use strict';
/**
 * Local folder indexer — walks a directory, finds audio files, probes them, and
 * upserts rows into the Akasi Sounds index. Tags are seeded from the folder path + filename
 * (so "footsteps/gravel/step_03.wav" is findable by "footsteps gravel"). CLAP-based
 * semantic tagging replaces/augments this in V2.
 */
const fs = require('node:fs');
const path = require('node:path');
const { probe } = require('./audio');

const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff', '.mp3', '.m4a', '.ogg', '.flac']);

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase())) yield full;
  }
}

/** Derive search tags from the path segments below `root` + the filename stem. */
function tagsFromPath(root, file) {
  const rel = path.relative(root, file);
  return rel
    .replace(/\.[^.]+$/, '')
    .split(/[\\/_\-.\s]+/)
    .filter((t) => t && t.length > 1 && !/^\d+$/.test(t))
    .map((t) => t.toLowerCase())
    .join(' ');
}

/**
 * Scan `root` into `db`. onProgress({done,total,file}) is optional.
 * Returns { added } count of upserts.
 */
async function scanFolder(db, root, onProgress) {
  const files = [...walk(root)];
  let done = 0;
  const batch = [];
  for (const file of files) {
    let meta = {};
    try {
      const st = fs.statSync(file);
      meta = await probe(file);
      meta.filesize = st.size;
    } catch {
      /* unreadable — index name-only */
    }
    batch.push({
      source: 'local',
      source_id: file, // path is a stable id for local files
      name: path.basename(file),
      path: file,
      duration: meta.duration ?? null,
      samplerate: meta.samplerate ?? null,
      channels: meta.channels ?? null,
      filesize: meta.filesize ?? null,
      license: 'local',
      tags: tagsFromPath(root, file),
    });
    done += 1;
    if (onProgress) onProgress({ done, total: files.length, file });
    if (batch.length >= 200) {
      db.upsertMany(batch.splice(0));
    }
  }
  if (batch.length) db.upsertMany(batch);
  db.addFolder(root);
  db.markFolderScanned(root);
  return { added: files.length };
}

module.exports = { scanFolder, walk, tagsFromPath, AUDIO_EXT };
