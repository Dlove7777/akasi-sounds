'use strict';
/**
 * Generation prompt-writer (Tier 1) — turns a brief (and optionally a real analyzed
 * reference sample) into a structured, ACE-Step-ready generation prompt. Useful with
 * NO generator wired: the caption is copy-pasteable into ACE-Step / Suno / Udio. It's
 * also the exact param contract the in-app generator (U7/U8) consumes.
 *
 * Pure + deterministic (no network, no LLM) so it's fully smoke-testable. When a
 * sample's analyzed attributes are passed, they override the brief-derived guesses —
 * real CLAP/librosa analysis beats keyword inference.
 */

// Genre → ACE-Step caption hint (instrumentation/texture fingerprint).
const GENRE_HINTS = {
  Cinematic: 'orchestral hybrid film score, evolving strings, low brass, rising ostinato',
  Ambient: 'evolving synth pads, drones, granular texture, no strong beat',
  'Lo-Fi': 'dusty boom-bap drums, vinyl crackle, mellow Rhodes, jazzy chords',
  'Hip Hop': '808 sub-bass, crisp hats, boom-bap kit, confident',
  Electronic: 'layered synths, sidechain pump, analog bass, build and drop',
  Rock: 'electric guitars, live drums, driving bass',
  Jazz: 'upright bass, brushed drums, piano comping, warm horns',
  Classical: 'acoustic orchestra, expressive strings, piano',
  Folk: 'acoustic guitar, mandolin, hand percussion, warm and sincere',
  Pop: 'bright synths, punchy drums, catchy topline',
  Tension: 'dissonant pulses, unresolved harmony, sparse dread, clock-tick percussion',
  Funk: 'syncopated bass, tight drums, clav and horns, groove',
  Piano: 'solo felt piano, intimate, spacious',
  Corporate: 'uplifting piano and strings, light percussion, claps, hopeful build',
  World: 'traditional instruments, organic percussion',
};

// Words in the brief → a genre fingerprint key.
const GENRE_WORDS = [
  [/cinematic|trailer|epic|film ?score|orchestral/i, 'Cinematic'],
  [/ambient|atmospher|drone|underscore|texture/i, 'Ambient'],
  [/lo-?fi|chill(?!.*edm)|study beat/i, 'Lo-Fi'],
  [/hip ?hop|boom ?bap|rap|trap/i, 'Hip Hop'],
  [/tense|tension|suspense|dark|dread|ominous|thriller|horror|eerie|unsettl/i, 'Tension'],
  [/corporate|uplift|inspir|motivat|promo|business/i, 'Corporate'],
  [/edm|techno|house|electronic|synthwave|dance/i, 'Electronic'],
  [/jazz|swing|bebop/i, 'Jazz'],
  [/folk|acoustic|country|americana/i, 'Folk'],
  [/piano/i, 'Piano'],
  [/funk|soul|groove/i, 'Funk'],
  [/rock|guitar|band/i, 'Rock'],
  [/classical|orchestra|strings/i, 'Classical'],
  [/\bpop\b/i, 'Pop'],
];

function inferGenre(brief) {
  for (const [re, g] of GENRE_WORDS) if (re.test(brief)) return g;
  return null;
}

function inferBpm(brief) {
  const explicit = brief.match(/(\d{2,3})\s*bpm/i);
  if (explicit) return Math.max(40, Math.min(220, +explicit[1]));
  if (/\b(slow|chill|down-?tempo|ballad|reflective|mournful)\b/i.test(brief)) return 75;
  if (/\b(driving|fast|energetic|urgent|uptempo|hype)\b/i.test(brief)) return 128;
  if (/\b(mid-?tempo|groove|walking|steady)\b/i.test(brief)) return 105;
  return null;
}

function inferDuration(brief) {
  if (/\bsting(er)?\b|\bhit\b|\bbutton\b|\blogo\b/i.test(brief)) return 8;
  if (/\bloop\b/i.test(brief)) return 16;
  if (/\bfull|\bbed\b|underscore|track|song|score/i.test(brief)) return 60;
  const s = brief.match(/(\d{1,3})\s*(?:s|sec|seconds)\b/i);
  if (s) return Math.max(4, Math.min(600, +s[1]));
  const m = brief.match(/(\d)\s*(?:m|min|minutes)\b/i);
  if (m) return Math.max(4, Math.min(600, +m[1] * 60));
  return 30;
}

function inferInstrumental(brief) {
  if (/\bvocal|singing|lyrics|sung|vocalist|choir\b/i.test(brief)) return false;
  return /instrumental|no vocals|under (a )?(vo|voice ?over|narration|dialog)|bed|underscore/i.test(brief) || true;
}

/**
 * @param {{brief?:string, sample?:{genre?,bpm?,vocals?,key?}}} input
 * @returns {{caption,lyrics,suggestedDurationSec,bpm,genre,instrumental,notes}}
 */
function buildGenerationPrompt(input = {}) {
  const brief = String(input.brief || '').trim();
  const s = input.sample || null;
  const genre = (s && s.genre) || inferGenre(brief);
  const bpm = (s && s.bpm) ? Math.round(s.bpm) : inferBpm(brief);
  const instrumental = s && s.vocals != null ? s.vocals === 0 : inferInstrumental(brief);
  const durationSec = inferDuration(brief);
  const hint = genre && GENRE_HINTS[genre];

  const caption = [
    brief || (genre ? `${genre} music` : 'instrumental music'),
    genre && !new RegExp(genre, 'i').test(brief) ? `${genre} style` : null,
    hint,
    instrumental ? 'instrumental, no vocals' : 'with vocals',
    bpm ? `around ${bpm} BPM` : null,
    s && s.key ? `in ${s.key}` : null,
  ].filter(Boolean).join(', ');

  const notes = s
    ? `Derived from an analyzed reference (${[s.genre, s.key, s.bpm && Math.round(s.bpm) + ' BPM', s.vocals === 0 ? 'instrumental' : s.vocals === 1 ? 'vocals' : null].filter(Boolean).join(' · ')}).`
    : 'Derived from the brief. Paste `caption` into ACE-Step / Suno / Udio, or generate in-app when VIDI is connected.';

  return { caption, lyrics: '', suggestedDurationSec: durationSec, bpm: bpm || null, genre: genre || null, instrumental, notes };
}

module.exports = { buildGenerationPrompt, inferGenre, inferBpm, inferDuration, GENRE_HINTS };
