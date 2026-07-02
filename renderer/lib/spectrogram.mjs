// Offline spectrogram from decoded PCM — pure JS (no deps, no DOM), shared by the
// player and the smoke test. STFT with a Hann window and an iterative radix-2 FFT.

/** In-place iterative radix-2 FFT. re/im are Float64Array of power-of-2 length. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

/**
 * STFT heatmap: samples (Float32Array) → { cols, bins, data } where data is a
 * Uint8Array(cols*bins), column-major-ish [col*bins + bin], bin 0 = lowest
 * frequency, values dB-scaled 0..255. `bins` ≤ fftSize/2; when smaller, bins are
 * log-spaced across the spectrum (musical) — equal only when bins === fftSize/2.
 */
export function computeSpectrogram(samples, { fftSize = 512, cols = 440, bins = 96 } = {}) {
  const half = fftSize / 2;
  const n = samples.length;
  if (n < fftSize) return null;
  cols = Math.min(cols, Math.max(1, Math.floor(n / fftSize)) * 4);
  const hop = Math.max(1, Math.floor((n - fftSize) / Math.max(1, cols - 1)));
  const hann = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));

  const mags = new Float64Array(cols * bins);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  let max = 1e-9;

  // Precompute bin → spectrum index ranges (log-spaced unless 1:1).
  const edges = new Array(bins + 1);
  if (bins === half) {
    for (let b = 0; b <= bins; b++) edges[b] = b;
  } else {
    const lo = 1, hi = half;
    for (let b = 0; b <= bins; b++) edges[b] = Math.round(lo * Math.pow(hi / lo, b / bins));
  }

  for (let c = 0; c < cols; c++) {
    const off = c * hop;
    for (let i = 0; i < fftSize; i++) {
      re[i] = (samples[off + i] || 0) * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const from = Math.max(bins === half ? b : 1, edges[b]);
      const to = Math.max(from + 1, edges[b + 1]);
      let m = 0;
      for (let k = from; k < to && k < half; k++) {
        const v = re[k] * re[k] + im[k] * im[k];
        if (v > m) m = v;
      }
      const db = Math.sqrt(m);
      mags[c * bins + b] = db;
      if (db > max) max = db;
    }
  }

  // Log compression → 0..255
  const data = new Uint8Array(cols * bins);
  for (let i = 0; i < mags.length; i++) {
    const norm = Math.log10(1 + 9 * (mags[i] / max)); // 0..1
    data[i] = Math.max(0, Math.min(255, Math.round(norm * 255)));
  }
  return { cols, bins, data };
}

export default { fft, computeSpectrogram };
