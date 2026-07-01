'use strict';
/**
 * Preview cache — remote sounds (Freesound previews) are downloaded once into a
 * local cache dir so they can be auditioned offline and, crucially, RENDERED for
 * drag-into-timeline (ffmpeg needs a real file, not a URL). Keyed by source+id.
 */
const fs = require('node:fs');
const path = require('node:path');

async function ensureCached(cacheDir, sound, fetchBytes) {
  if (sound.path && fs.existsSync(sound.path)) return sound.path; // already local
  if (sound.cached_path && fs.existsSync(sound.cached_path)) return sound.cached_path;
  if (!sound.url) throw new Error('sound has no local path or url');

  fs.mkdirSync(cacheDir, { recursive: true });
  const ext = path.extname(new URL(sound.url).pathname) || '.mp3';
  const dest = path.join(cacheDir, `${sound.source}_${sound.source_id}${ext}`);
  if (!fs.existsSync(dest)) {
    const bytes = await fetchBytes(sound.url);
    fs.writeFileSync(dest, bytes);
  }
  return dest;
}

module.exports = { ensureCached };
