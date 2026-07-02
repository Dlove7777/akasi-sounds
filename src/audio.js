'use strict';
/**
 * Audio utilities via ffmpeg/ffprobe (system binaries; ffmpeg 8.x present).
 *  - probe():  read duration/samplerate/channels for indexing.
 *  - render(): export a (optionally cropped + faded) selection to a temp WAV.
 *              This rendered file is what gets handed to the OS for drag-into-NLE,
 *              so Premiere/Resolve/FCP receive a real clip, not a stream URL.
 */
const { spawn, execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const FFMPEG = process.env.AKASI_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.AKASI_FFPROBE || 'ffprobe';

function probe(input) {
  return new Promise((resolve) => {
    execFile(
      FFPROBE,
      ['-v', 'error', '-show_entries', 'format=duration:format_tags:stream=sample_rate,channels',
       '-of', 'json', input],
      (err, stdout) => {
        if (err) return resolve({});
        try {
          const j = JSON.parse(stdout);
          const stream = (j.streams || [])[0] || {};
          const t = {};
          for (const [k, v] of Object.entries(j.format?.tags || {})) t[k.toLowerCase()] = v;
          const num = (v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : null;
          };
          resolve({
            duration: j.format?.duration ? Number(j.format.duration) : null,
            samplerate: stream.sample_rate ? Number(stream.sample_rate) : null,
            channels: stream.channels ?? null,
            tags: {
              title: t.title || null,
              artist: t.artist || t.album_artist || null,
              album: t.album || null,
              genre: t.genre || null,
              bpm: num(t.tbpm || t.bpm),
              year: num(t.date || t.year) != null ? Math.trunc(num(t.date || t.year)) : null,
            },
          });
        } catch {
          resolve({});
        }
      }
    );
  });
}

/**
 * Render `input` to a WAV in the temp dir.
 * opts: { start, end, fadeIn, fadeOut, outDir, name }  (all seconds; times optional)
 * Returns the output path.
 */
function render(input, opts = {}) {
  return new Promise((resolve, reject) => {
    const outDir = opts.outDir || path.join(os.tmpdir(), 'akasi-sounds-drops');
    fs.mkdirSync(outDir, { recursive: true });
    const base = (opts.name || 'clip').replace(/[^\w.-]+/g, '_').replace(/\.[^.]+$/, '');
    const out = path.join(outDir, `${base}.wav`);

    const args = ['-y'];
    if (opts.start != null) args.push('-ss', String(opts.start));
    args.push('-i', input);
    if (opts.end != null) {
      const dur = Math.max(0.01, opts.end - (opts.start || 0));
      args.push('-t', String(dur));
    }
    const af = [];
    if (opts.fadeIn) af.push(`afade=t=in:st=0:d=${opts.fadeIn}`);
    if (opts.fadeOut) {
      const dur = (opts.end != null ? opts.end - (opts.start || 0) : null);
      if (dur) af.push(`afade=t=out:st=${Math.max(0, dur - opts.fadeOut)}:d=${opts.fadeOut}`);
    }
    if (af.length) args.push('-af', af.join(','));
    args.push('-c:a', 'pcm_s24le', out);

    const p = spawn(FFMPEG, args);
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-400)}`))));
  });
}

/**
 * Compute a compact peak envelope for inline row waveforms.
 * Decodes to mono s16le @4kHz via ffmpeg, buckets |samples| into `buckets` maxima,
 * normalizes to 0..255. Returns a Buffer of length `buckets` (tiny — cacheable in
 * the DB) or null if the file can't be decoded.
 */
function pcmPeaks(input, buckets = 160) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-i', input, '-ac', '1', '-ar', '4000', '-f', 's16le', '-']);
    const chunks = [];
    let size = 0;
    p.stdout.on('data', (d) => {
      size += d.length;
      if (size <= 24_000_000) chunks.push(d); // cap ~50min of 4kHz mono — plenty
    });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const raw = Buffer.concat(chunks);
      const n = Math.floor(raw.length / 2);
      if (n < buckets) return resolve(null);
      const per = Math.floor(n / buckets);
      const peaks = Buffer.alloc(buckets);
      let globalMax = 1;
      const maxima = new Array(buckets);
      for (let b = 0; b < buckets; b++) {
        let max = 0;
        const base = b * per * 2;
        for (let i = 0; i < per; i++) {
          const v = Math.abs(raw.readInt16LE(base + i * 2));
          if (v > max) max = v;
        }
        maxima[b] = max;
        if (max > globalMax) globalMax = max;
      }
      for (let b = 0; b < buckets; b++) peaks[b] = Math.round((maxima[b] / globalMax) * 255);
      resolve(peaks);
    });
  });
}

module.exports = { probe, render, pcmPeaks, FFMPEG, FFPROBE };
