// Local Standard MIDI File support for the demo player (pure, no DOM).
//   parseMidiFile(bytes)          -> { ok: true, format, division, tracks, notes, duration } | { ok: false, error }
//   midiToScore(parsed, options)  -> { ok: true, score, duration, notices, ... } | { ok: false, error }
// Everything runs in the browser; nothing is uploaded or stored.

const MAN_MIN = 36;
const MAN_MAX = 96;
const PED_MAX = 67;
const GREAT = 1, SWELL = 2, CHOIR = 0, SOLO = 3, PEDAL = 4;
const DRUM_CHANNEL = 9; // MIDI channel 10

export const MIDI_MAX_SECONDS = 600;
export const MIDI_MAX_POLYPHONY = 14;
export const MIDI_MAX_BYTES = 4 * 1024 * 1024;
export const MIDI_PEDAL_SPLIT = 48;
const MIN_DUR = 0.04;
const GAP = 0.01;

const ERR_INVALID = 'Das ist keine gültige MIDI-Datei (Standard MIDI File, .mid).';
const ERR_TRUNCATED = 'Die MIDI-Datei ist unvollständig oder beschädigt.';
const ERR_FORMAT2 = 'MIDI-Format 2 (unabhängige Sequenzen) wird nicht unterstützt.';
const ERR_EMPTY = 'Die MIDI-Datei enthält keine spielbaren Noten.';
const ERR_TOO_BIG = 'Die Datei ist zu groß (höchstens 4 MB).';

class Truncated extends Error {}
class Invalid extends Error {}

/** Parses a Standard MIDI File (formats 0 and 1). Never throws. */
export function parseMidiFile(input) {
  try {
    const b = input instanceof Uint8Array ? input
      : input instanceof ArrayBuffer ? new Uint8Array(input)
      : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : Array.isArray(input) ? Uint8Array.from(input) : null;
    if (!b) return { ok: false, error: ERR_INVALID };
    if (b.length > MIDI_MAX_BYTES) return { ok: false, error: ERR_TOO_BIG };
    return parseBytes(b);
  } catch (err) {
    if (err instanceof Truncated) return { ok: false, error: ERR_TRUNCATED };
    if (err instanceof Invalid) return { ok: false, error: err.message || ERR_INVALID };
    return { ok: false, error: ERR_INVALID };
  }
}

function parseBytes(b) {
  let p = 0;
  const need = (n) => { if (p + n > b.length) throw new Truncated(); };
  const u8 = () => { need(1); return b[p++]; };
  const u16 = () => { need(2); const v = (b[p] << 8) | b[p + 1]; p += 2; return v; };
  const u32 = () => { need(4); const v = ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; p += 4; return v; };
  const tag = () => { need(4); const s = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]); p += 4; return s; };

  if (b.length < 4) throw b.length && 'MThd'.startsWith(String.fromCharCode(...b)) ? new Truncated() : new Invalid(ERR_INVALID);
  if (tag() !== 'MThd') throw new Invalid(ERR_INVALID);
  const hlen = u32();
  if (hlen < 6) throw new Invalid(ERR_INVALID);
  need(hlen);
  const hs = p;
  const format = u16();
  const ntrks = u16();
  const division = u16();
  p = hs + hlen;
  if (format === 2) throw new Invalid(ERR_FORMAT2);
  if (format > 2 || ntrks === 0 || division === 0) throw new Invalid(ERR_INVALID);

  const tracks = [];
  const tempos = [];
  while (tracks.length < ntrks) {
    if (p >= b.length) throw new Truncated();
    const id = tag();
    const len = u32();
    if (p + len > b.length) throw new Truncated();
    if (id !== 'MTrk') { p += len; continue; } // unknown chunk: skip
    tracks.push(parseTrack(b, p, p + len, tracks.length, tempos));
    p += len;
  }

  // ---- tick -> seconds (tempo map)
  let tickToSec;
  if (division & 0x8000) {
    const fps = 256 - (division >> 8); // two's complement: -24, -25, -29, -30
    const tpf = division & 0xff;
    const tps = (fps === 29 ? 29.97 : fps) * tpf;
    if (!(tps > 0)) throw new Invalid(ERR_INVALID);
    tickToSec = (tick) => tick / tps;
  } else {
    const tpq = division;
    tempos.sort((a, b2) => a.tick - b2.tick);
    const seg = [{ tick: 0, sec: 0, us: 500000 }];
    for (const t of tempos) {
      const last = seg[seg.length - 1];
      const sec = last.sec + ((t.tick - last.tick) * last.us) / (tpq * 1e6);
      if (t.tick === last.tick) { last.us = t.us; continue; }
      seg.push({ tick: t.tick, sec, us: t.us });
    }
    tickToSec = (tick) => {
      let lo = 0, hi = seg.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (seg[mid].tick <= tick) lo = mid; else hi = mid - 1; }
      const s = seg[lo];
      return s.sec + ((tick - s.tick) * s.us) / (tpq * 1e6);
    };
  }

  const notes = [];
  for (const tr of tracks) {
    for (const n of tr.notes) {
      const t = tickToSec(n.on);
      notes.push({ t, dur: Math.max(0, tickToSec(n.off) - t), midi: n.note, vel: n.vel, ch: n.ch, track: n.track });
    }
  }
  notes.sort((a, c) => a.t - c.t || a.midi - c.midi);
  const duration = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
  return {
    ok: true, format, division,
    tracks: tracks.map((t) => ({ name: t.name, noteCount: t.notes.length })),
    tempos: tempos.map((t) => ({ tick: t.tick, usPerQuarter: t.us })),
    notes, duration,
  };
}

function parseTrack(b, start, end, index, tempos) {
  let p = start;
  let tick = 0;
  let running = 0;
  let name = '';
  const notes = [];
  const open = new Map(); // `${ch}:${note}` -> [{ on, vel }]
  const need = (n) => { if (p + n > end) throw new Truncated(); };
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      need(1);
      const c = b[p++];
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new Invalid(ERR_INVALID);
  };
  const noteOff = (ch, note) => {
    const q = open.get(`${ch}:${note}`);
    if (!q || !q.length) return;
    const o = q.shift(); // FIFO: the earliest unmatched note-on of this key
    notes.push({ on: o.on, off: tick, note, vel: o.vel, ch, track: index });
  };
  let ended = false;
  while (p < end && !ended) {
    tick += vlq();
    need(1);
    let status = b[p];
    if (status & 0x80) { p++; } else {
      if (!running) throw new Invalid(ERR_TRUNCATED);
      status = running;
    }
    if (status === 0xff) {
      running = 0;
      need(1); const type = b[p++];
      const len = vlq();
      need(len);
      if (type === 0x51 && len >= 3) {
        const us = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
        if (us > 0) tempos.push({ tick, us });
      } else if (type === 0x03 && !name) {
        name = String.fromCharCode(...b.subarray(p, p + Math.min(len, 64))).replace(/[^\x20-\x7e]/g, '').trim();
      } else if (type === 0x2f) ended = true;
      p += len;
    } else if (status === 0xf0 || status === 0xf7) {
      running = 0;
      const len = vlq(); need(len); p += len;
    } else if (status >= 0xf0) {
      running = 0;
      p += status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0;
      need(0);
    } else {
      running = status;
      const cmd = status & 0xf0, ch = status & 0x0f;
      const n = cmd === 0xc0 || cmd === 0xd0 ? 1 : 2;
      need(n);
      const d1 = b[p] & 0x7f, d2 = n === 2 ? b[p + 1] & 0x7f : 0;
      p += n;
      if (cmd === 0x90 && d2 > 0) {
        const k = `${ch}:${d1}`;
        let q = open.get(k);
        if (!q) open.set(k, (q = []));
        q.push({ on: tick, vel: d2 });
      } else if (cmd === 0x80 || cmd === 0x90) noteOff(ch, d1);
    }
  }
  if (p > end) throw new Truncated();
  // notes still held at the end of the track end there
  for (const [k, q] of open) { const [ch, note] = k.split(':').map(Number); while (q.length) noteOff(ch, note); }
  return { name, notes };
}

/** Octave-folds a note into a manual's compass. */
export function foldIntoCompass(midi, manual) {
  const max = manual === PEDAL ? PED_MAX : MAN_MAX;
  let m = midi;
  while (m < MAN_MIN) m += 12;
  while (m > max) m -= 12;
  return m;
}

/** Marks the lowest voice below `split` as pedal: one monophonic line, lowest note of each onset. */
export function splitPedal(notes, split = MIDI_PEDAL_SPLIT) {
  const sorted = [...notes].sort((a, b) => a.t - b.t || a.midi - b.midi);
  const pedal = new Set();
  let busyUntil = -Infinity;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].t - sorted[i].t < 0.02) j++;
    const low = sorted[i]; // lowest of this onset group
    if (low.midi < split && low.t >= busyUntil - 0.03) { pedal.add(low); busyUntil = low.t + low.dur; }
    i = j;
  }
  return pedal;
}

const mean = (ns) => ns.reduce((s, n) => s + n.midi, 0) / ns.length;

/**
 * Parsed file -> demo score [{ t, dur, midi, manual }].
 * Groups = MIDI channels (when the file uses several) else tracks; channel 10 is ignored.
 * >= 3 groups: the lowest group (mean < 52) -> pedal. Others in file order -> Great, Swell, Choir, Solo (5th+ -> Great).
 * Without a pedal group, the lowest voice below MIDI 48 of the lowest manual group -> pedal.
 */
export function midiToScore(parsed, { maxPolyphony = MIDI_MAX_POLYPHONY, maxSeconds = MIDI_MAX_SECONDS } = {}) {
  if (!parsed || !parsed.ok) return { ok: false, error: (parsed && parsed.error) || ERR_INVALID };
  const notices = [];
  const src = parsed.notes.filter((n) => n.ch !== DRUM_CHANNEL);
  const drums = parsed.notes.length - src.length;
  if (drums) notices.push('Schlagzeug (Kanal 10) wird nicht gespielt.');
  if (!src.length) return { ok: false, error: ERR_EMPTY };

  // ---- groups
  const chans = [...new Set(src.map((n) => n.ch))].sort((a, b) => a - b);
  const trks = [...new Set(src.map((n) => n.track))].sort((a, b) => a - b);
  const keyOf = chans.length > 1 ? (n) => n.ch : trks.length > 1 ? (n) => n.track : () => 0;
  const groups = new Map();
  for (const n of src) { const k = keyOf(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const order = [...groups.keys()].sort((a, b) => a - b).map((k) => groups.get(k));
  const manualOf = new Map();
  let pedalGroup = null;
  if (order.length >= 3) {
    const lowest = order.reduce((lo, g) => (mean(g) < mean(lo) ? g : lo), order[0]);
    if (mean(lowest) < 52) pedalGroup = lowest;
  }
  const MANUAL_ORDER = [GREAT, SWELL, CHOIR, SOLO];
  let mi = 0;
  for (const g of order) {
    if (g === pedalGroup) { manualOf.set(g, PEDAL); continue; }
    manualOf.set(g, mi < MANUAL_ORDER.length ? MANUAL_ORDER[mi] : GREAT);
    mi++;
  }
  let autoPedal = new Set();
  if (!pedalGroup) {
    const manualGroups = order.filter((g) => g !== pedalGroup);
    const low = manualGroups.reduce((lo, g) => (mean(g) < mean(lo) ? g : lo), manualGroups[0]);
    autoPedal = splitPedal(low);
  }

  // ---- map + fold + minimum length + time limit
  let limited = false;
  let out = [];
  for (const g of order) {
    for (const n of g) {
      const manual = autoPedal.has(n) ? PEDAL : manualOf.get(g);
      if (n.t >= maxSeconds) { limited = true; continue; }
      let dur = Math.max(MIN_DUR, n.dur);
      if (n.t + dur > maxSeconds) { dur = maxSeconds - n.t; limited = true; }
      if (dur < 0.01) continue;
      out.push({ t: n.t, dur, midi: foldIntoCompass(n.midi, manual), manual });
    }
  }
  if (limited) notices.push(`Die Datei ist länger als ${Math.round(maxSeconds / 60)} Minuten; gespielt werden nur die ersten ${Math.round(maxSeconds / 60)}.`);

  out = removeOverlaps(out);
  const capped = capPolyphony(out, maxPolyphony);
  if (capped.cut) notices.push(`Mehr als ${maxPolyphony} gleichzeitige Töne: Mittelstimmen wurden gekürzt.`);
  const score = capped.score.sort((a, b) => a.t - b.t || a.manual - b.manual || a.midi - b.midi);
  if (!score.length) return { ok: false, error: ERR_EMPTY };
  const duration = score.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
  const manuals = [...new Set(score.map((n) => n.manual))].sort((a, b) => a - b);
  return { ok: true, score, duration, notices, limited, manuals, polyphonyCut: capped.cut };
}

/** Same key on the same manual never overlaps (folding can create that): shorten or merge. */
export function removeOverlaps(notes) {
  const byKey = new Map();
  for (const n of notes) { const k = `${n.manual}:${n.midi}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push({ ...n }); }
  const res = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.t - b.t);
    let cur = null;
    for (const n of list) {
      if (cur && n.t < cur.t + cur.dur + GAP) {
        if (n.t - cur.t - GAP >= 0.02) { cur.dur = n.t - cur.t - GAP; res.push(cur); cur = n; }
        else cur.dur = Math.max(cur.dur, n.t + n.dur - cur.t); // re-strike too close: merge
      } else { if (cur) res.push(cur); cur = n; }
    }
    if (cur) res.push(cur);
  }
  return res;
}

/**
 * Caps simultaneous keys: when a note would exceed `max`, the oldest inner voice
 * (not pedal, not the highest or lowest sounding manual note) is cut off.
 */
export function capPolyphony(notes, max = MIDI_MAX_POLYPHONY) {
  const sorted = notes.map((n) => ({ ...n })).sort((a, b) => a.t - b.t || a.midi - b.midi);
  let active = [];
  let cut = 0;
  const keep = [];
  for (const n of sorted) {
    active = active.filter((a) => a.t + a.dur > n.t + 1e-9);
    if (active.length >= max) {
      const man = active.filter((a) => a.manual !== PEDAL);
      let hi = null, lo = null;
      for (const a of man) { if (!hi || a.midi > hi.midi) hi = a; if (!lo || a.midi < lo.midi) lo = a; }
      const inner = man.filter((a) => a !== hi && a !== lo);
      const pool = inner.length ? inner : man;
      let victim = null;
      for (const a of pool) if (!victim || a.t < victim.t) victim = a;
      if (!victim) { cut++; continue; }
      victim.dur = n.t - victim.t - GAP;
      active = active.filter((a) => a !== victim);
      cut++;
    }
    active.push(n);
    keep.push(n);
  }
  return { score: keep.filter((n) => n.dur >= 0.02), cut };
}

/** "m:ss" */
export const formatTime = (s) => { const v = Math.max(0, Math.round(s || 0)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
