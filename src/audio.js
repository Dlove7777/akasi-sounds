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
 * Render `input` to a WAV in the temp dir, baking the audition FX exactly as heard.
 * opts: { start, end, fadeIn, fadeOut, outDir, name,          (seconds; optional)
 *         speed,   — varispeed rate multiplier (2^(semi/12)); pitch+tempo together
 *         reverse, — boolean
 *         gainDb } — ±dB
 * Filter order mirrors the preview: reverse → crop → varispeed → gain → fades.
 * When reversing, the crop selection refers to the REVERSED timeline the user heard,
 * so trimming happens after areverse (atrim), not via input seek.
 * Returns the output path.
 */
async function render(input, opts = {}) {
  const outDir = opts.outDir || path.join(os.tmpdir(), 'akasi-sounds-drops');
  fs.mkdirSync(outDir, { recursive: true });
  const base = (opts.name || 'clip').replace(/[^\w.-]+/g, '_').replace(/\.[^.]+$/, '');
  const out = path.join(outDir, `${base}.wav`);

  const speed = opts.speed && opts.speed !== 1 ? opts.speed : null;
  const hasCrop = opts.start != null || opts.end != null;

  const args = ['-y'];
  const af = [];

  if (opts.reverse) {
    args.push('-i', input);
    af.push('areverse');
    if (hasCrop) {
      const s = opts.start || 0;
      af.push(opts.end != null ? `atrim=${s}:${opts.end}` : `atrim=start=${s}`, 'asetpts=PTS-STARTPTS');
    }
  } else {
    // Both -ss and -t as INPUT options: crop selects input seconds. (-t after -i
    // would cap OUTPUT seconds — with varispeed that silently pulls extra input.)
    if (opts.start != null) args.push('-ss', String(opts.start));
    if (opts.end != null) args.push('-t', String(Math.max(0.01, opts.end - (opts.start || 0))));
    args.push('-i', input);
  }

  if (speed) {
    // True varispeed (pitch + tempo together) needs the source samplerate.
    const meta = await probe(input);
    const sr = meta.samplerate || 48000;
    af.push(`asetrate=${Math.round(sr * speed)}`, `aresample=${sr}`);
  }
  if (opts.gainDb) af.push(`volume=${opts.gainDb}dB`);

  // Fades run last, on the post-varispeed timeline.
  const cropDur = opts.end != null ? Math.max(0.01, opts.end - (opts.start || 0)) : null;
  const outDur = cropDur != null ? cropDur / (speed || 1) : null;
  if (opts.fadeIn) af.push(`afade=t=in:st=0:d=${opts.fadeIn}`);
  if (opts.fadeOut && outDur) af.push(`afade=t=out:st=${Math.max(0, outDur - opts.fadeOut)}:d=${opts.fadeOut}`);

  if (af.length) args.push('-af', af.join(','));
  args.push('-c:a', 'pcm_s24le', out);

  return new Promise((resolve, reject) => {
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

/**
 * Detect non-silent segments (Soundly-style "Segments" — variation files often pack
 * several takes separated by silence). Runs silencedetect and inverts the silence
 * windows into sound regions. Returns [{start, end}] — a single full-length region
 * means "no meaningful split" (UI hides the chips).
 */
function detectSegments(input, opts = {}) {
  const noise = opts.noiseDb ?? -35; // dB threshold
  const minSilence = opts.minSilence ?? 0.25; // s of quiet that splits takes
  const minSeg = opts.minSeg ?? 0.12; // discard blips shorter than this
  return new Promise(async (resolve) => {
    const meta = await probe(input);
    const dur = meta.duration;
    if (!dur) return resolve([]);
    const p = spawn(FFMPEG, ['-i', input, '-af', `silencedetect=noise=${noise}dB:d=${minSilence}`, '-f', 'null', '-']);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => resolve([{ start: 0, end: dur }]));
    p.on('close', () => {
      const silences = [];
      const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
      let m;
      while ((m = re.exec(err))) silences.push({ start: parseFloat(m[1]), end: parseFloat(m[2]) });
      // Trailing silence may report a start with no end — close it at EOF.
      const lastStart = err.match(/silence_start:\s*([\d.]+)\s*$/m);
      if (lastStart && (!silences.length || silences[silences.length - 1].end < parseFloat(lastStart[1]))) {
        silences.push({ start: parseFloat(lastStart[1]), end: dur });
      }
      const segs = [];
      let cursor = 0;
      for (const s of silences.sort((a, b) => a.start - b.start)) {
        if (s.start - cursor >= minSeg) segs.push({ start: cursor, end: s.start });
        cursor = Math.max(cursor, s.end);
      }
      if (dur - cursor >= minSeg) segs.push({ start: cursor, end: dur });
      resolve(segs.length ? segs : [{ start: 0, end: dur }]);
    });
  });
}

module.exports = { probe, render, pcmPeaks, detectSegments, FFMPEG, FFPROBE };
