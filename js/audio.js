// WebAudio pipe-organ synthesizer for the Royal Albert Hall Grand Organ model.
// No samples, no external libraries. Importing this file has no side effects
// (no AudioContext, no DOM access) so the pure parts can be tested in node.
//
// The specification comes entirely from stoplist.js (147 numbered stops,
// 23 couplers, 3 tremulants, 3 swell boxes).
//
// ---------------------------------------------------------------------------
// ARCHITECTURE
//   1. voiceKey(reg, midi, manual)  (pure)
//      Expands one physically played key into the set of sounding
//      "rank-notes" (one pipe of one rank) through the coupler network,
//      transmissions/extensions (resolveSource) and mixture breaks.
//      Identical pipes reached by several paths are counted once (pipe key =
//      source stop + rank + key position on the source rank).
//   2. planNote(voicing, midi, tremOn)  (pure)
//      Groups the rank-notes of one key by output path
//      (swell box × active tremulant). All ranks of a group are SUMMED into
//      one PeriodicWave whose fundamental is the greatest common divisor of
//      the (just-intonation) rank ratios — 64′ … 1′, quints, tierces and the
//      harmonic seventh all become exact harmonics of that fundamental.
//      Spare oscillators of the per-note budget (MAX_OSC_PER_NOTE) are given
//      to celeste ranks (own, sharp-detuned oscillator → beating) and to
//      chorus splits of large groups (two detuned halves).
//   3. createOrganAudio()  (WebAudio engine)
//      Per note ≤ MAX_OSC_PER_NOTE oscillators (+ one noise chiff),
//      percussion one-shots (1 oscillator each), waves cached per
//      registration signature, held notes re-voiced with a 30 ms crossfade
//      when stops, couplers or tremulants change.
//      Graph: voices → [tremulant gain] → swell box (gain + lowpass) → mix →
//      dry + hall convolver (≈4.5 s) → limiter → master.
// ---------------------------------------------------------------------------

import {
  STOPS, DIVISIONS, COUPLERS, ACCESSORIES,
  stopById, resolveSource, couplerSourceStops, MANUAL_DIVISIONS, rankStartOf,
} from './stoplist.js';

export const PEDAL_MANUAL = 4;
export const MANUAL_COMPASS = [36, 96];
export const PEDAL_COMPASS = [36, 67];
export const MAX_RANK_HZ = 9000;          // no partial / mixture rank above this
export const MAX_OSC_PER_NOTE = 6;        // pipe oscillators per held key (percussion extra)
export const MAX_NOTES = 32;              // polyphony (held keys)
const MIX_TOP_MIDI = 69 + 12 * Math.log2(8600 / 440); // mixture ranks break back below ≈8.6 kHz
const MAX_HARMONIC = 2047;                // PeriodicWave table limit
const CELESTE_CENTS = 7;
const CHORUS_CENTS = 1.6;

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// ---------------------------------------------------------------------------
// Static lookup tables derived from the stop list
// ---------------------------------------------------------------------------
const DIV_BY_ID = new Map(DIVISIONS.map((d) => [d.id, d]));
const DIV_STOPS = new Map(DIVISIONS.map((d) => [d.id, STOPS.filter((s) => s.division === d.id)]));
export const COUPLER_BY_ID = new Map(COUPLERS.map((c) => [c.id, c]));
export const COUPLER_SOURCES = new Map(COUPLERS.map((c) => [c.id, new Set(couplerSourceStops(c).map((s) => s.id))]));

/** tremulant accessory id per division id */
export const TREMULANT_OF_DIVISION = Object.fromEntries(
  ACCESSORIES.filter((a) => a.kind === 'tremulant').map((a) => [a.division, a.id]));
const DIVISION_OF_TREMULANT = Object.fromEntries(Object.entries(TREMULANT_OF_DIVISION).map(([d, id]) => [id, d]));
/** swell pedal accessory id -> box id */
export const SWELL_PEDAL_BOX = Object.fromEntries(
  ACCESSORIES.filter((a) => a.kind === 'swell-pedal').map((a) => [a.id, a.division]));
export const BOXES = ['open', 'orchestral', 'swell', 'solo'];

/** Which swell box the pipes of a (source) stop stand in. */
export function boxOfStop(stop) {
  if (!stop || !stop.enclosed) return 'open';
  if (stop.location && BOXES.includes(stop.location)) return stop.location;
  if (stop.division === 'bombard') return 'solo';
  if (BOXES.includes(stop.division)) return stop.division;
  return 'swell';
}

// lowest pipe of every source rank relative to its own key 36 (downward extensions)
const RANK_BASE = new Map();
for (const s of STOPS) {
  if (!s.derived) continue;
  const r = resolveSource(s);
  if (!r) continue;
  // a resultant sounds its source an octave and a fourth lower (-12 / -5), not at its nominal pitch
  const low = s.resultant ? r.semitones + 12 : r.semitones;
  RANK_BASE.set(r.stop.id, Math.min(RANK_BASE.get(r.stop.id) ?? 0, low));
}

const INTRA_OCTAVE = new Map(); // division -> octave / sub-octave couplers acting on it
const UNISON_OFF = new Map();   // division -> unison-off coupler id
for (const c of COUPLERS) {
  if (typeof c.from !== 'string') continue;
  if (c.kind === 'octave' || c.kind === 'suboctave') {
    if (!INTRA_OCTAVE.has(c.from)) INTRA_OCTAVE.set(c.from, []);
    INTRA_OCTAVE.get(c.from).push(c);
  } else if (c.kind === 'unison-off') UNISON_OFF.set(c.from, c.id);
}

const asHas = (x) => {
  if (!x) return new Set();
  if (typeof x.has === 'function') return x;
  return new Set(x);
};

const compassOf = (divisionId) => (divisionId === 'pedal' ? PEDAL_COMPASS : MANUAL_COMPASS);

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------
/** loudness 0..1 (stoplist estimate) -> linear rank level (0 dB = loudest stop) */
export function stopLevel(loudness) {
  return Math.pow(10, (-30 + 30 * Math.max(0, Math.min(1, loudness))) / 20);
}
/** voicing over the compass: bass a little fuller, extreme treble softer */
function track(midi) {
  return Math.min(1.45, Math.max(0.4, Math.pow(2, (60 - midi) / 46)));
}

// ---------------------------------------------------------------------------
// 1. Voicing: key -> rank-notes
// ---------------------------------------------------------------------------
/**
 * Pure. reg = { stops, couplers } (Sets / arrays of ids).
 * Returns { ranks, percussion }:
 *   ranks[i] = { key, stopId (sounding source stop), drawnId, division (of the source),
 *                rank, midi (sounding pitch), T (semitones above the played key's 8′),
 *                noteIndex (pipe index within the source rank, 0 = lowest pipe incl. extensions),
 *                level, timbre, box, trem (division whose tremulant affects it or null),
 *                celeste, flue, virtual (true = acoustic resultant tone, no pipe) }
 * A rank whose stoplist `rankStart[r]` lies above the source key (celeste ranks from
 * tenor C) contributes nothing for that key — no sound and hence no 'pipeon'.
 *   percussion[i] = { key, stopId, kind, midi, box, level }
 * Couplers do not cascade: an inter-manual coupler carries what the source
 * manual's own divisions play, including that manual's octave / sub-octave /
 * unison-off couplers, but not the source manual's own inter-manual couplers.
 */
export function voiceKey(reg, midi, manual) {
  const stops = asHas(reg && reg.stops);
  const couplers = asHas(reg && reg.couplers);
  const paths = [];

  const own = (M, k) => {
    for (const d of MANUAL_DIVISIONS(M)) {
      const drawn = (DIV_STOPS.get(d) || []).filter((s) => stops.has(s.id));
      if (!drawn.length) continue;
      const uo = UNISON_OFF.get(d);
      if (!(uo && couplers.has(uo))) paths.push({ list: drawn, key: k });
      for (const c of INTRA_OCTAVE.get(d) || []) {
        if (!couplers.has(c.id) || c.to !== M) continue;
        const src = COUPLER_SOURCES.get(c.id);
        const list = drawn.filter((s) => src.has(s.id));
        if (list.length) paths.push({ list, key: k + c.semitones });
      }
    }
  };

  own(manual, midi);
  for (const c of COUPLERS) {
    if (c.to !== manual || c.kind !== 'coupler' || !couplers.has(c.id)) continue;
    if (typeof c.from === 'number') {
      if (c.from !== manual) own(c.from, midi);
    } else {
      const src = COUPLER_SOURCES.get(c.id);
      const list = (DIV_STOPS.get(c.from) || []).filter((s) => stops.has(s.id) && src.has(s.id));
      if (list.length) paths.push({ list, key: midi });
    }
  }

  const ranks = new Map();
  const perc = new Map();
  const addRank = (item) => {
    const prev = ranks.get(item.key);
    if (!prev || prev.level < item.level) ranks.set(item.key, item);
  };

  for (const p of paths) {
    for (const s of p.list) {
      const kk = p.key;
      const [lo, hi] = compassOf(s.division);
      if (kk < lo || kk > hi) continue;
      if (s.percussion) {
        const kind = s.construction === 'drum' ? 'drum' : s.construction === 'tubular-bells' ? 'bells' : 'carillon';
        const pm = kind === 'carillon' ? kk + 12 : kk;
        const key = `${s.id}@${kk}`;
        if (!perc.has(key)) perc.set(key, { key, stopId: s.id, kind, midi: pm, box: boxOfStop(s), level: stopLevel(s.loudness) });
        continue;
      }
      const res = resolveSource(s);
      if (!res) continue;
      const src = res.stop;
      const box = boxOfStop(src);
      const trem = TREMULANT_OF_DIVISION[src.division] ? src.division : null;
      const base = RANK_BASE.get(src.id) ?? 0;
      const tim = timbreOf(src);
      const lvl = stopLevel(s.loudness);
      const mk = (r, rankAbs, off, extra = {}) => {
        const srcKey = kk + off;
        // ranks that start above bottom C (stoplist `rankStart`, e.g. celeste ranks
        // from tenor C) have no pipe here: no sound and no 'pipeon'
        if (srcKey >= 36 && srcKey - 36 < rankStartOf(src, r)) return;
        let T = (kk - midi) + rankAbs + off;
        if (src.family === 'mixture') while (midi + T > MIX_TOP_MIDI) T -= 12;
        const m = midi + T;
        const nRanks = src.ranks || 1;
        let level = lvl * track(m);
        if (src.family === 'mixture') level *= (1 - 0.05 * r) / Math.sqrt(nRanks);
        else if (nRanks > 1) level /= Math.sqrt(nRanks);
        if (extra.levelScale) level *= extra.levelScale;
        const celeste = !!src.celeste && (nRanks === 1 || r === 1);
        addRank({
          key: `${src.id}#${r}@${srcKey}`, stopId: src.id, drawnId: s.id, division: src.division,
          rank: r, midi: m, T, noteIndex: srcKey - 36 - base, level,
          timbre: tim.id, box, trem, celeste, flue: tim.flue, virtual: false, ...extra,
        });
      };
      if (s.resultant) {
        // acoustic 64′: the 32′ and 21 1/3′ pipes of the source rank together
        mk(0, src.semitones, res.semitones + 12, { levelScale: 0.9 });
        mk(0, src.semitones, res.semitones + 19, { levelScale: 0.55 });
        const T = (kk - midi) + s.semitones;
        const key = `virtual:${s.id}@${kk}`;
        ranks.set(key, {
          key, stopId: src.id, drawnId: s.id, division: src.division, rank: 0, midi: midi + T, T,
          noteIndex: -1, level: lvl * 0.5, timbre: 'resultant', box, trem, celeste: false, flue: true, virtual: true,
        });
      } else if (Array.isArray(src.composition) && src.composition.length) {
        src.composition.forEach((c, r) => mk(r, c, res.semitones));
      } else {
        mk(0, src.semitones, res.semitones);
      }
    }
  }
  return { ranks: [...ranks.values()], percussion: [...perc.values()] };
}

// ---------------------------------------------------------------------------
// Timbres (amplitude of partial n at frequency f, before normalisation)
// ---------------------------------------------------------------------------
const formant = (f, fc, widthOct) => Math.exp(-Math.pow(Math.log2(f / fc) / widthOct, 2));
const table = (arr, tail = 2) => (n) => (n <= arr.length ? arr[n - 1] : arr[arr.length - 1] * Math.pow(arr.length / n, tail));

const RECIPES = {
  // --- principals
  diapason:      { flue: true, chiff: 0.7, attack: 0.045, amp: table([1, 0.5, 0.3, 0.2, 0.13, 0.09], 1.8) },
  largediapason: { flue: true, chiff: 0.6, attack: 0.05,  amp: table([1, 0.58, 0.4, 0.27, 0.2, 0.14, 0.1], 1.6) },
  pedaldiapason: { flue: true, chiff: 0.5, attack: 0.08,  amp: table([1, 0.55, 0.3, 0.16, 0.1], 1.9) },
  geigen:        { flue: true, chiff: 0.6, attack: 0.05,  amp: table([1, 0.62, 0.46, 0.36, 0.3, 0.24], 1.25) },
  gemshorn:      { flue: true, chiff: 0.5, attack: 0.05,  amp: table([1, 0.32, 0.18, 0.08, 0.05], 2.2) },
  dulciana:      { flue: true, chiff: 0.35, attack: 0.06, amp: table([1, 0.26, 0.12, 0.06, 0.03], 2.4) },
  mixture:       { flue: true, chiff: 0.5, attack: 0.035, amp: table([1, 0.38, 0.18, 0.09], 2.2) },
  cymbale:       { flue: true, chiff: 0.6, attack: 0.03,  amp: table([1, 0.45, 0.25, 0.14], 1.8) },
  // --- flutes
  stopped:       { flue: true, chiff: 0.9, attack: 0.05,  amp: table([1, 0.03, 0.22, 0.012, 0.07, 0.005, 0.025, 0.002, 0.01], 3) },
  halfstopped:   { flue: true, chiff: 0.9, attack: 0.05,  amp: table([1, 0.08, 0.16, 0.04, 0.13, 0.02, 0.04, 0.01], 3) },
  quintaton:     { flue: true, chiff: 0.8, attack: 0.06,  amp: table([1, 0.04, 0.55, 0.02, 0.12, 0.01, 0.04], 3) },
  harmonicflute: { flue: true, chiff: 1.0, attack: 0.055, amp: table([1, 0.2, 0.07, 0.035, 0.012], 3) },
  pavillon:      { flue: true, chiff: 0.9, attack: 0.05,  amp: table([1, 0.32, 0.16, 0.08, 0.04, 0.02], 2.6) },
  openflute:     { flue: true, chiff: 0.9, attack: 0.05,  amp: table([1, 0.22, 0.09, 0.045, 0.02, 0.01], 2.8) },
  openwood:      { flue: true, chiff: 0.6, attack: 0.09,  amp: table([1, 0.36, 0.13, 0.06, 0.03], 2.6) },
  softflute:     { flue: true, chiff: 0.4, attack: 0.07,  amp: table([1, 0.09, 0.025, 0.01], 3) },
  flutemutation: { flue: true, chiff: 0.8, attack: 0.045, amp: table([1, 0.13, 0.05, 0.02], 3) },
  resultant:     { flue: true, chiff: 0,   attack: 0.12,  amp: (n) => (n === 1 ? 1 : 0) },
  // --- strings
  violedorch:    { flue: true, chiff: 0.3, attack: 0.08,  amp: (n) => (n === 1 ? 0.45 : 0.8 * Math.pow(n, -0.52)) * Math.exp(-n / 44) },
  gamba:         { flue: true, chiff: 0.35, attack: 0.07, amp: (n) => (n === 1 ? 0.7 : 0.78 * Math.pow(n, -0.75)) * Math.exp(-n / 30) },
  softstring:    { flue: true, chiff: 0.25, attack: 0.08, amp: (n) => (n === 1 ? 0.85 : 0.5 * Math.pow(n, -0.9)) * Math.exp(-n / 22) },
  cello:         { flue: true, chiff: 0.35, attack: 0.09, amp: (n) => (n === 1 ? 0.85 : 0.72 * Math.pow(n, -0.8)) * Math.exp(-n / 26) },
  // --- chorus reeds
  trumpet:       { flue: false, attack: 0.022, amp: (n, f) => Math.pow(n, -0.72) * (1 + 1.3 * formant(f, 1300, 0.9)) },
  tromba:        { flue: false, attack: 0.026, amp: (n, f) => Math.pow(n, -0.92) * (1 + 1.1 * formant(f, 850, 0.9)) },
  harmtrumpet:   { flue: false, attack: 0.022, amp: (n, f) => Math.pow(n, -0.62) * (1 + 1.4 * formant(f, 1800, 0.9)) },
  trombone:      { flue: false, attack: 0.03,  amp: (n, f) => Math.pow(n, -0.82) * (1 + 1.5 * formant(f, 620, 1.0)) },
  orchtrumpet:   { flue: false, attack: 0.02,  amp: (n, f) => Math.pow(n, -0.58) * (1 + 1.2 * formant(f, 2100, 0.8)) },
  tuba:          { flue: false, attack: 0.03,  amp: (n, f) => Math.pow(n, -1.0) * (1 + 1.8 * formant(f, 520, 1.1)) },
  // --- orchestral reeds
  clarinet:      { flue: false, attack: 0.03,  amp: (n, f) => (n % 2 ? Math.pow(n, -0.75) : 0.12 * Math.pow(n, -1.1)) * (f > 3200 ? 0.5 : 1) },
  oboe:          { flue: false, attack: 0.026, amp: (n, f) => (n === 1 ? 0.45 : Math.pow(n, -0.9)) * (1 + 2.6 * formant(f, 1250, 0.6)) },
  coranglais:    { flue: false, attack: 0.03,  amp: (n, f) => (n === 1 ? 0.6 : Math.pow(n, -0.95)) * (1 + 2.2 * formant(f, 900, 0.6)) },
  bassoon:       { flue: false, attack: 0.03,  amp: (n, f) => (n === 1 ? 0.55 : Math.pow(n, -0.9)) * (1 + 2.4 * formant(f, 460, 0.7)) },
  horn:          { flue: false, attack: 0.045, amp: (n, f) => Math.pow(n, -1.5) * (1 + 0.8 * formant(f, 400, 1.0)) * Math.exp(-f / 2600) },
  voxhumana:     { flue: false, attack: 0.035, amp: (n, f) => (n === 1 ? 0.5 : Math.pow(n, -0.85)) * (1 + 2.0 * formant(f, 520, 0.5) + 1.6 * formant(f, 1550, 0.45)) },
};

const TIMBRE_CACHE = new Map();
/** Classifies a (source) stop from family, construction and name. */
export function classifyStop(s) {
  const n = (s.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ft = s.pitchFt || 8;
  switch (s.family) {
    case 'reed':
      if (/tuba|ophicleide|bombardon/.test(n)) return 'tuba';
      if (/clarinet|bassetto/.test(n)) return 'clarinet';
      if (/vox humana|baryton/.test(n)) return 'voxhumana';
      if (/cor anglais/.test(n)) return 'coranglais';
      if (/oboe|hautboy/.test(n)) return 'oboe';
      if (/bassoon|fagotto/.test(n)) return 'bassoon';
      if (/horn/.test(n)) return 'horn';
      if (/orchestral (trumpet|clarion)/.test(n)) return 'orchtrumpet';
      if (/harmonic/.test(n)) return 'harmtrumpet';
      if (/posaune|trombone|bombard/.test(n)) return 'trombone';
      if (/tromba/.test(n)) return 'tromba';
      return 'trumpet';
    case 'flute':
      if (/acoustic/.test(n)) return 'openwood';
      if (/bourdon|gedeckt|gedackt|sub bass|lieblich/.test(n)) return 'stopped';
      if (/rohr|cheminee/.test(n)) return 'halfstopped';
      if (/quintat/.test(n)) return 'quintaton';
      if (/pavillon/.test(n)) return 'pavillon';
      if (/harmonic|traverso|concert|piccolo/.test(n)) return 'harmonicflute';
      if (/unda maris/.test(n)) return 'softflute';
      if (/open wood|octave wood/.test(n) || (s.division === 'pedal' && s.construction === 'wood' && ft >= 16)) return 'openwood';
      return 'openflute';
    case 'string':
      if (/orchestre|octaviante|cornet de violes/.test(n)) return 'violedorch';
      if (/sourdine|salicional|angelica|amour|celestes/.test(n)) return 'softstring';
      if (/violone|contra bass|violoncello|contra viole|^viole$|^viola$/.test(n)) return 'cello';
      return 'gamba';
    case 'principal':
      if (/dulciana/.test(n)) return 'dulciana';
      if (/geigen/.test(n)) return 'geigen';
      if (/gemshorn/.test(n)) return 'gemshorn';
      if (s.division === 'pedal' && ft >= 16) return 'pedaldiapason';
      if (/open diapason( 1| 2)?$/.test(n) && ft >= 8) return 'largediapason';
      return 'diapason';
    case 'mutation':
      if (/nazard|tierce/.test(n)) return 'flutemutation';
      if (s.construction === 'wood') return 'stopped';
      return 'diapason';
    case 'mixture':
      if (/violes/.test(n)) return 'violedorch';
      if (/cymbale|fourniture/.test(n)) return 'cymbale';
      if (/sesquialtera/.test(n)) return 'flutemutation';
      return 'mixture';
    default:
      return 'diapason';
  }
}

export function timbreOf(stop) {
  let t = TIMBRE_CACHE.get(stop.id);
  if (!t) {
    const recipe = classifyStop(stop);
    t = { id: stop.id, recipe, ...RECIPES[recipe] };
    TIMBRE_CACHE.set(stop.id, t);
  }
  return t;
}
const recipeOfTimbre = (id) => (id === 'resultant' ? RECIPES.resultant : timbreOf(stopById(id)));

// ---------------------------------------------------------------------------
// Just-intonation ratio of an offset (semitones above 8′) as p / 2^e
// ---------------------------------------------------------------------------
const JUST = { 0: [1, 0], 4: [5, 2], 7: [3, 1], 10: [7, 2] }; // unison, major third, fifth, harmonic 7th
export function justRatio(T) {
  const oct = Math.floor(T / 12);
  const res = T - 12 * oct;
  let p, e;
  if (JUST[res]) [p, e] = JUST[res];
  else { p = Math.round(Math.pow(2, res / 12) * 16); e = 4; } // fallback (not used by the stop list)
  e -= oct;
  while (e > 0 && p % 2 === 0) { p /= 2; e--; }
  while (e < 0) { p *= 2; e++; }
  return { p, e };
}
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

// ---------------------------------------------------------------------------
// 2. Plan: rank-notes of one key -> oscillators
// ---------------------------------------------------------------------------
const q = (x) => Math.round(x * 2000) / 2000;
const itemSig = (i) => `${i.timbre}:${i.rank}:${i.T}:${q(i.level)}`;

/**
 * Pure. Returns { oscs: [{ sig, waveSig, group, box, trem, items, detune }], level, chiff }.
 * tremOn: Set of division ids whose tremulant is drawn.
 */
export function planNote(voicing, midi, tremOn = new Set(), budget = MAX_OSC_PER_NOTE) {
  const groups = new Map();
  let power = 0;
  let chiffPow = 0;
  for (const it of voicing.ranks) {
    const t = it.trem && tremOn.has(it.trem) ? it.trem : null;
    const g = it.box + (t ? '|T:' + t : '');
    if (!groups.has(g)) groups.set(g, { g, box: it.box, trem: t, normal: [], celeste: [] });
    (it.celeste ? groups.get(g).celeste : groups.get(g).normal).push(it);
    power += it.level * it.level;
    if (it.flue && !it.virtual) chiffPow += Math.pow(it.level * (recipeOfTimbre(it.timbre).chiff || 0), 2);
  }
  const specs = [];
  const glist = [...groups.values()];
  for (const gr of glist) {
    gr.normal.sort((a, b) => a.T - b.T || b.level - a.level || (a.key < b.key ? -1 : 1));
    gr.celeste.sort((a, b) => a.T - b.T || (a.key < b.key ? -1 : 1));
    gr.parts = [];
    if (gr.normal.length) gr.parts.push({ items: gr.normal, detune: 0 });
    else gr.parts.push({ items: gr.celeste, detune: CELESTE_CENTS, celeste: true });
  }
  let spare = budget - glist.length;
  // celestes get their own (beating) oscillator if possible, else they are folded in
  const withCel = glist.filter((g) => g.normal.length && g.celeste.length)
    .sort((a, b) => b.celeste.reduce((s, i) => s + i.level, 0) - a.celeste.reduce((s, i) => s + i.level, 0));
  for (const gr of withCel) {
    if (spare > 0) { gr.parts.push({ items: gr.celeste, detune: CELESTE_CENTS, celeste: true }); spare--; }
    else gr.parts[0].items = gr.parts[0].items.concat(gr.celeste);
  }
  // chorus: split the biggest groups into two slightly detuned halves
  const big = glist.filter((g) => g.normal.length >= 3).sort((a, b) => b.normal.length - a.normal.length);
  for (const gr of big) {
    if (spare <= 0) break;
    const main = gr.parts[0];
    const a = [], b = [];
    main.items.forEach((it, i) => (i % 2 ? b : a).push(it));
    gr.parts[0] = { items: a, detune: -CHORUS_CENTS / 2 };
    gr.parts.push({ items: b, detune: CHORUS_CENTS / 2 });
    spare--;
  }
  for (const gr of glist) {
    for (const p of gr.parts) {
      const waveSig = p.items.map(itemSig).sort().join(',') + '@' + midi;
      specs.push({ sig: `${gr.g}/${p.detune}/${waveSig}`, waveSig, group: gr.g, box: gr.box, trem: gr.trem, items: p.items, detune: p.detune });
    }
  }
  return { oscs: specs, level: Math.sqrt(power), chiff: Math.sqrt(chiffPow) };
}

// deterministic pseudo-random phase per (timbre, rank, partial)
function phaseOf(str, n) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= n * 374761393; h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/**
 * Pure: sums the harmonic recipes of several rank-notes into one Fourier table.
 * Returns { real, imag, f0, harmonics } — f0 is the oscillator frequency.
 */
export function buildWaveTable(items, midi) {
  const rs = items.map((it) => justRatio(it.T));
  const E = Math.max(0, ...rs.map((r) => r.e));
  let G = 0;
  const nums = rs.map((r) => r.p * Math.pow(2, E - r.e));
  for (const v of nums) G = gcd(G, v);
  G = G || 1;
  const fKey = midiToFreq(midi);
  const f0 = (fKey * G) / Math.pow(2, E);
  let H = 1;
  const parts = [];
  items.forEach((it, idx) => {
    const m = nums[idx] / G;           // harmonic of f0 that is this rank's fundamental
    const rec = recipeOfTimbre(it.timbre);
    const list = [];
    let norm = 0;
    for (let n = 1; ; n++) {
      const h = m * n;
      const f = f0 * h;
      if (h > MAX_HARMONIC || f > MAX_RANK_HZ) break; // ranks above ~9 kHz (top of 1⅗′, octave couplers) are left out
      if (rec === RECIPES.resultant && n > 1) break;
      let a = rec.amp(n, f) || 0;
      if (f > 5200) a *= Math.max(0, (MAX_RANK_HZ - f) / (MAX_RANK_HZ - 5200));
      norm += a * a;
      list.push([h, a, n]);
      if (n > 64) break;
    }
    const k = norm > 0 ? it.level / Math.sqrt(norm) : 0;
    for (const [h, a, n] of list) {
      if (h > H) H = h;
      parts.push([h, a * k, phaseOf(it.timbre + '#' + it.rank, n)]);
    }
  });
  const real = new Float32Array(H + 1);
  const imag = new Float32Array(H + 1);
  for (const [h, a, ph] of parts) { real[h] += a * Math.cos(ph); imag[h] += a * Math.sin(ph); }
  return { real, imag, f0, harmonics: H };
}

// ---------------------------------------------------------------------------
// Hall impulse response (pure, fills two Float32Arrays)
// ---------------------------------------------------------------------------
export function fillImpulse(left, right, sampleRate, rt60 = 4.5) {
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 2147483648 - 1;
  };
  const n = left.length;
  const total = n / sampleRate;
  [left, right].forEach((d, ch) => {
    const pre = Math.floor(sampleRate * (0.024 + ch * 0.004));
    let lp = 0;
    for (let i = 0; i < n; i++) {
      if (i < pre) { d[i] = 0; continue; }
      const t = (i - pre) / sampleRate;
      const alpha = 0.5 * Math.exp(-t * 0.8) + 0.05; // air absorption: darker tail
      lp += alpha * (rnd() - lp);
      const comp = Math.sqrt((2 - alpha) / alpha);
      const env = Math.exp((-6.91 * t) / rt60) * (1 - Math.exp(-t / 0.06));
      const fade = Math.min(1, (total - i / sampleRate) / 0.4);
      d[i] = lp * comp * env * fade * 0.45;
    }
    const early = [[0.033, 0.45], [0.051, -0.34], [0.074, 0.3], [0.098, -0.24], [0.131, 0.19], [0.17, -0.12]];
    for (const [time, a] of early) {
      const idx = pre + Math.floor(sampleRate * time * (1 + ch * 0.07));
      if (idx < n) d[idx] += a;
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Engine
// ---------------------------------------------------------------------------
const VOICE_LEVEL = 0.24;     // output of a note with rank power 1 (before the box)
const GAMMA = 0.62;           // loudness compression across registrations (L -> L^GAMMA)
const RELEASE_TC = 0.05;      // ~150 ms release
const XFADE_TC = 0.01;        // ~30 ms crossfade when re-voicing
const TREM = { orchestral: { rate: 5.8 }, swell: { rate: 5.3 }, solo: { rate: 6.1 } };
const TREM_AMP = 0.13;
const TREM_CENTS = 5;
const SWELL_SHUT_DB = -22;

export function swellGain(v) { return Math.pow(10, (SWELL_SHUT_DB * (1 - v)) / 20); }
export function swellCutoff(v) { return 750 * Math.pow(18000 / 750, v); }

export function createOrganAudio() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext || null;
  let ac = null;
  let g = null;
  let failed = false;
  let unlockStamp = -1e9;
  let volume = 0.8;
  let reverb = 0.45;
  const reg = { stops: new Set(), couplers: new Set() };
  const tremOn = new Set();                       // division ids
  const swell = { orchestral: 0.7, swell: 0.7, solo: 0.7 };
  const notes = new Map();                        // "manual:midi" -> note
  const waves = new Map();                        // waveSig -> { wave, f0 }
  const stateListeners = new Set();
  const stats = { oscillatorsStarted: 0, percussionStarted: 0, live: 0, maxPerNote: 0, waveBuilds: 0 };
  let noteSerial = 0;
  let dirty = false;

  const wallNow = () => (globalThis.performance ? performance.now() : Date.now());
  const notify = () => { for (const fn of stateListeners) { try { fn(state()); } catch { /* ignore */ } } };

  function state() {
    if (!AC || failed) return 'unavailable';
    if (!ac) return 'idle';
    return ac.state;
  }

  function build() {
    ac = new AC({ latencyHint: 'interactive' });
    const mix = ac.createGain();
    const dry = ac.createGain();
    const wet = ac.createGain();
    const conv = ac.createConvolver();
    const comp = ac.createDynamicsCompressor();
    const master = ac.createGain();
    const len = Math.floor(ac.sampleRate * 5);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    fillImpulse(ir.getChannelData(0), ir.getChannelData(1), ac.sampleRate, 4.5);
    conv.buffer = ir;
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 14;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    mix.connect(dry); mix.connect(conv); conv.connect(wet);
    dry.connect(comp); wet.connect(comp); comp.connect(master); master.connect(ac.destination);

    const boxes = {};
    for (const b of BOXES) {
      const input = ac.createGain();
      if (b === 'open') { input.connect(mix); boxes[b] = { input }; continue; }
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.5;
      input.connect(lp); lp.connect(mix);
      boxes[b] = { input, lp };
    }
    const trems = {};
    for (const [div, cfg] of Object.entries(TREM)) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = cfg.rate;
      const amp = ac.createGain(); amp.gain.value = TREM_AMP;
      const pitch = ac.createGain(); pitch.gain.value = TREM_CENTS;
      lfo.connect(amp); lfo.connect(pitch);
      lfo.start();
      trems[div] = { lfo, amp, pitch };
    }
    const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    g = { mix, dry, wet, conv, comp, master, boxes, trems, groups: new Map(), noise };
    applyMix(true);
    for (const b of Object.keys(swell)) applySwell(b, true);
    ac.onstatechange = notify;
  }

  function setParam(param, value, immediate, tc = 0.03) {
    if (immediate || !ac) param.value = value;
    else { try { param.setTargetAtTime(value, ac.currentTime, tc); } catch { param.value = value; } }
  }
  function applyMix(immediate = false) {
    if (!g) return;
    setParam(g.master.gain, volume * volume * 1.3, immediate);
    setParam(g.dry.gain, 1 - 0.55 * reverb, immediate);
    setParam(g.wet.gain, 1.5 * reverb, immediate);
  }
  function applySwell(box, immediate = false) {
    if (!g || !g.boxes[box] || !g.boxes[box].lp) return;
    setParam(g.boxes[box].input.gain, swellGain(swell[box]), immediate, 0.04);
    setParam(g.boxes[box].lp.frequency, swellCutoff(swell[box]), immediate, 0.04);
  }

  // output node of a voice group ("box" or "box|T:division")
  function groupNode(key) {
    let n = g.groups.get(key);
    if (n) return n;
    const [box, t] = key.split('|T:');
    const target = (g.boxes[box] || g.boxes.open).input;
    if (t && g.trems[t]) {
      n = ac.createGain();
      n.gain.value = 1;
      g.trems[t].amp.connect(n.gain);
      n.connect(target);
    } else n = target;
    g.groups.set(key, n);
    return n;
  }

  function waveFor(spec, midi) {
    let w = waves.get(spec.waveSig);
    if (w) { waves.delete(spec.waveSig); waves.set(spec.waveSig, w); return w; }
    const t = buildWaveTable(spec.items, midi);
    stats.waveBuilds++;
    w = { wave: ac.createPeriodicWave(t.real, t.imag, { disableNormalization: true }), f0: t.f0 };
    waves.set(spec.waveSig, w);
    if (waves.size > 600) waves.delete(waves.keys().next().value);
    return w;
  }

  function unlock() {
    if (!AC || failed) return false;
    try {
      if (!ac) build();
      unlockStamp = wallNow();
      if (ac.state === 'suspended') {
        const p = ac.resume();
        if (p && p.then) p.then(notify, () => {});
      }
      notify();
      return true;
    } catch (err) {
      failed = true; ac = null; g = null;
      console.warn('[Orgel] Audio nicht verfügbar:', err);
      notify();
      return false;
    }
  }
  function canPlay() {
    if (!ac || !g) return false;
    return ac.state === 'running' || wallNow() - unlockStamp < 1500;
  }

  const attackOf = (spec, midi) => {
    let a = 0, w = 0;
    for (const it of spec.items) { const r = recipeOfTimbre(it.timbre); a += (r.attack || 0.04) * it.level; w += it.level; }
    a = w ? a / w : 0.04;
    const low = Math.min(...spec.items.map((i) => i.midi));
    return a + (low < 48 ? ((48 - low) / 36) * 0.05 : 0) + (midi > 84 ? -0.01 : 0);
  };

  function startOsc(note, spec, t, scale, fadeTc) {
    const w = waveFor(spec, note.midi);
    const osc = ac.createOscillator();
    osc.setPeriodicWave(w.wave);
    osc.frequency.value = w.f0;
    osc.detune.value = spec.detune + (Math.random() * 2 - 1) * 0.8;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(scale, t, fadeTc ?? Math.max(0.006, attackOf(spec, note.midi) / 3));
    osc.connect(gain);
    gain.connect(groupNode(spec.group));
    let pitch = null;
    if (spec.trem && g.trems[spec.trem]) { pitch = g.trems[spec.trem].pitch; pitch.connect(osc.detune); }
    osc.start(t);
    stats.oscillatorsStarted++; stats.live++;
    const v = { osc, gain, pitch, spec, ended: false };
    osc.onended = () => {
      if (v.ended) return;
      v.ended = true; stats.live--;
      try { if (pitch) pitch.disconnect(osc.detune); } catch { /* gone */ }
      try { gain.disconnect(); } catch { /* gone */ }
    };
    return v;
  }

  function stopOsc(v, t, tc = RELEASE_TC) {
    try {
      const p = v.gain.gain;
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
      p.setTargetAtTime(0, t, tc);
      v.osc.stop(t + tc * 10 + 0.05);
    } catch { /* already stopped */ }
  }

  function chiff(note, plan, t) {
    if (!plan.chiff || !plan.oscs.length) return;
    const sounding = note.midi;
    const f = midiToFreq(sounding);
    const src = ac.createBufferSource();
    src.buffer = g.noise;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(5600, Math.max(300, f * 2.7));
    bp.Q.value = 1.3;
    const gain = ac.createGain();
    const peak = 0.4 * note.scale * plan.chiff * Math.min(1.4, Math.max(0.5, Math.pow(2, (60 - sounding) / 48)));
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.004);
    gain.gain.setTargetAtTime(0, t + 0.006, 0.01);
    src.connect(bp); bp.connect(gain);
    const flueGroup = plan.oscs.find((s) => s.items.some((i) => i.flue)) || plan.oscs[0];
    gain.connect(groupNode(flueGroup.group));
    src.start(t, Math.random() * 0.8, 0.12);
    src.onended = () => { try { gain.disconnect(); } catch { /* gone */ } };
  }

  function percussion(p, t, noteScale) {
    const out = groupNode(p.box);
    const gain = ac.createGain();
    const osc = ac.createOscillator();
    const lvl = p.level * Math.max(0.35, noteScale) * 1.3;
    let dur;
    if (p.kind === 'drum') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(62, t);
      osc.frequency.exponentialRampToValueAtTime(36, t + 0.35);
      dur = 1.6;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(lvl * 2.2, t + 0.008);
      gain.gain.setTargetAtTime(0, t + 0.01, 0.28);
      // felt thump (noise)
      const ns = ac.createBufferSource(); ns.buffer = g.noise;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(lvl * 1.5, t); ng.gain.setTargetAtTime(0, t, 0.05);
      ns.connect(lp); lp.connect(ng); ng.connect(out);
      ns.start(t, Math.random() * 0.5, 0.4);
      ns.onended = () => { try { ng.disconnect(); } catch { /* gone */ } };
    } else {
      // inharmonic partials expressed as harmonics of f/10 (bell) or f/4 (bars)
      const f = Math.min(4200, midiToFreq(p.midi));
      const bell = p.kind === 'bells';
      const div = bell ? 10 : 4;
      const spec = bell
        ? [[5, 0.45], [10, 0.8], [12, 0.55], [15, 0.3], [20, 1], [25, 0.25], [30, 0.35], [40, 0.18], [53, 0.1]]
        : [[4, 1], [11, 0.35], [22, 0.14], [36, 0.05]];
      const key = `perc:${p.kind}`;
      let w = waves.get(key);
      if (!w) {
        const n = spec[spec.length - 1][0];
        const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
        for (const [h, a] of spec) imag[h] = a;
        w = { wave: ac.createPeriodicWave(real, imag) };
        waves.set(key, w);
      }
      osc.setPeriodicWave(w.wave);
      osc.frequency.value = f / div;
      dur = bell ? 5 : 2;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(lvl, t + 0.003);
      gain.gain.setTargetAtTime(0, t + 0.004, dur / 5);
    }
    osc.connect(gain); gain.connect(out);
    osc.start(t); osc.stop(t + dur);
    stats.percussionStarted++;
    osc.onended = () => { try { gain.disconnect(); } catch { /* gone */ } };
  }

  const keyOf = (midi, manual) => `${manual}:${midi}`;

  function voice(note, t, revoice) {
    const voicing = voiceKey(reg, note.midi, note.manual);
    const plan = planNote(voicing, note.midi, tremOn);
    const scale = plan.level > 0 ? VOICE_LEVEL * Math.pow(plan.level, GAMMA - 1) : 0;
    note.scale = scale;
    const next = new Map();
    for (const spec of plan.oscs) {
      const old = note.oscs.get(spec.sig);
      if (old) {
        note.oscs.delete(spec.sig);
        try { old.gain.gain.setTargetAtTime(scale, t, XFADE_TC); } catch { /* ignore */ }
        next.set(spec.sig, old);
      } else {
        next.set(spec.sig, startOsc(note, spec, t, scale, revoice ? XFADE_TC : undefined));
      }
    }
    for (const v of note.oscs.values()) stopOsc(v, t, XFADE_TC);
    note.oscs = next;
    stats.maxPerNote = Math.max(stats.maxPerNote, next.size);
    return { voicing, plan };
  }

  function noteOn(midi, manual = 1) {
    if (!canPlay()) return;
    try {
      flush();
      const key = keyOf(midi, manual);
      if (notes.has(key)) releaseNote(key);
      if (notes.size >= MAX_NOTES) {
        let oldest = null;
        for (const [k, n] of notes) if (!oldest || n.born < oldest[1].born) oldest = [k, n];
        if (oldest) releaseNote(oldest[0]);
      }
      const t = ac.currentTime + 0.003;
      const note = { midi, manual, oscs: new Map(), born: noteSerial++, scale: 0 };
      notes.set(key, note);
      const { voicing, plan } = voice(note, t, false);
      chiff(note, plan, t);
      for (const p of voicing.percussion) percussion(p, t, note.scale);
    } catch (err) {
      console.warn('[Orgel] noteOn fehlgeschlagen:', err);
    }
  }

  function releaseNote(key) {
    const note = notes.get(key);
    if (!note || !ac) return;
    notes.delete(key);
    const t = ac.currentTime;
    for (const v of note.oscs.values()) stopOsc(v, t);
    note.oscs.clear();
  }

  function noteOff(midi, manual = 1) { try { releaseNote(keyOf(midi, manual)); } catch { /* ignore */ } }
  function allNotesOff() { try { for (const key of [...notes.keys()]) releaseNote(key); } catch { /* ignore */ } }

  /** Re-voices all held notes (batched: called once per microtask after changes). */
  function flush() {
    if (!dirty) return;
    dirty = false;
    if (!ac || !g || !notes.size) return;
    try {
      const t = ac.currentTime + 0.003;
      for (const note of notes.values()) voice(note, t, true);
    } catch (err) { console.warn('[Orgel] Umregistrieren fehlgeschlagen:', err); }
  }
  function markDirty() {
    if (dirty) return;
    dirty = true;
    const run = () => flush();
    if (typeof queueMicrotask === 'function') queueMicrotask(run); else Promise.resolve().then(run);
  }

  function setStop(id, on) {
    if (!stopById(id)) return;
    if (on) reg.stops.add(id); else reg.stops.delete(id);
    markDirty();
  }
  function setCoupler(id, on) {
    if (!COUPLER_BY_ID.has(id)) return;
    if (on) reg.couplers.add(id); else reg.couplers.delete(id);
    markDirty();
  }
  function setTremulant(id, on) {
    const div = DIVISION_OF_TREMULANT[id];
    if (!div) return;
    if (on) tremOn.add(div); else tremOn.delete(div);
    markDirty();
  }
  function setSwell(id, value) {
    const box = SWELL_PEDAL_BOX[id] || (BOXES.includes(id) ? id : null);
    if (!box || box === 'open') return;
    swell[box] = Math.min(1, Math.max(0, +value || 0));
    try { applySwell(box); } catch { /* ignore */ }
  }

  return {
    unlock, noteOn, noteOff, allNotesOff, flush,
    setStop, setCoupler, setTremulant, setSwell,
    isStopOn: (id) => reg.stops.has(id),
    activeStops: () => [...reg.stops],
    setVolume(v) { volume = Math.min(1, Math.max(0, +v || 0)); try { applyMix(); } catch { /* ignore */ } },
    setReverb(v) { reverb = Math.min(1, Math.max(0, +v || 0)); try { applyMix(); } catch { /* ignore */ } },
    getVolume: () => volume,
    getReverb: () => reverb,
    state,
    isRunning: () => state() === 'running',
    isAvailable: () => !!AC && !failed,
    onStateChange(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); },
    heldNoteCount: () => notes.size,
    oscillatorsPerNote: () => [...notes.values()].map((n) => ({ midi: n.midi, manual: n.manual, oscillators: n.oscs.size })),
    stats: () => ({ ...stats, cachedWaves: waves.size, notes: notes.size }),
    get context() { return ac; },
  };
}
