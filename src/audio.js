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
      ['-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,channels',
       '-of', 'json', input],
      (err, stdout) => {
        if (err) return resolve({});
        try {
          const j = JSON.parse(stdout);
          const stream = (j.streams || [])[0] || {};
          resolve({
            duration: j.format?.duration ? Number(j.format.duration) : null,
            samplerate: stream.sample_rate ? Number(stream.sample_rate) : null,
            channels: stream.channels ?? null,
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

module.exports = { probe, render, FFMPEG, FFPROBE };
