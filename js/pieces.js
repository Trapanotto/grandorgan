// Built-in demo piece (public domain) as compact, proof-readable note data plus a small
// compiler into the demo player's score format
//   [{ t, dur, midi, manual } | { t, dur: 0, reg } | { t, dur: 0, piston }]   (seconds, sorted by t).
// ALL performance timing (tempo map, fermatas, ornaments, arpeggio) is baked into these events,
// so the player needs nothing beyond the score. Pure module (no DOM, no audio); validated in node tests.
//
// The piece is Bach's Toccata und Fuge d-Moll BWV 565, COMPLETE (143 bars) and NOTE-FAITHFUL:
// the voice strings below were GENERATED MECHANICALLY (not typed) from the Mutopia Project's
// LilyPond source (public domain); see the comment above BWV565 for source, licence and liberties.
//
// ---- note syntax (one string per bar, comments mark bar numbers) -----------
//   token   = pitch[+pitch…][:dur][suffix][ornament]   e.g.  d5:4  f#5:3  g4+b4+d5:8  r:6  a5:6{m:g5}
//   pitch   = letter [# | b] octave              c4 = middle C = MIDI 60; bb3 = B♭3, f#5 = F♯5
//   r       = rest
//   dur     = length in the piece's `unit` (fraction of a crotchet beat); omitted = previous
//             token's length in the same bar (the first token of a bar needs one)
//   suffix  = '  staccato (sounds half the value)      ~  tie into the next token with the same pitch
//             (a tie carries over bar lines; pitches of a chord without continuation simply end)
//   ornament (optional, written note keeps its value; realised by the compiler):
//             {m:PITCH}  mordent: main – PITCH – main, the first two `ornament.mordent` seconds each
//             {t:PITCH}  trill: PITCH/main alternating (starting on PITCH, ending on main) at about
//                        `ornament.trill` seconds per note over the whole (tied) note
// Every bar of every voice must add up to `meter` units (checked by checkPiece).
//
// ---- piece fields ----------------------------------------------------------
//   unit, meter            unit in crotchets; units per bar
//   bpm, tempo             crotchets per minute; tempo = { key: bpm | [bpmFrom, bpmTo] } where key is
//                          'bar' or 'bar:at' (at = offset in units). A number holds from there on; an
//                          array is a linear ritardando/accelerando up to the next tempo key.
//   holds                  optional { 'bar:at': seconds } — fermatas / breaths: that much time is
//                          inserted at the written position (notes sounding across or ending there
//                          are held longer, everything later moves on). Written values stay untouched.
//   maxGap                 optional cap (s) for the articulation gap before a note's end
//   ornament               optional { mordent: s, trill: s } speeds for {m:…} / {t:…}
//   arpeggios              optional [{ bar, at, step }] — manual notes starting there are rolled
//                          upwards across all voices, `step` seconds apart (end times unchanged)
//   sections               optional [{ title, bar, at? }]; compilePiece returns them with `time` (s)
//                          and also fills `time` in place
//   tempoRange             [lo, hi] plausible main tempo (sanity check)
//   scale, accidentals     allowed pitch classes; accidentals = { pc: 'reason' } deliberate chromatics
//   form                   [{ from, to, reg? }] bars to play in order (repeats = listed twice)
//   registration           { stops, couplers, tremulants, swell: { pedalId: 0..1 } } at the start
//   changes                [{ bar, at?, on?, off?, swell?, piston?, ramp?: { id, from, to, bars } }]
//                          applied every time that bar is played; at = offset in units
//   voices                 [{ name, manual, from?, art?, melody?, manualFrom?: { 'bar' | 'bar:at': manual }, bars }]
// Unisons: when two voices meet on the same key of the same manual, the compiler plays the key
// once (same onset: one note to the later end; otherwise the held note is re-struck).
//
// compilePiece(def) -> { score, duration, sections, timeAt(bar, at) }  (timeAt: written position -> s)

import { STOPS, COUPLERS, ACCESSORIES } from './stoplist.js';

export const MANUAL_RANGE = [[36, 96], [36, 96], [36, 96], [36, 96], [36, 67]];
const START = 0.5; // seconds of silence before the first note (registration is drawn first)
const PCS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NOTE_RE = /^([a-g])(#|b)?(\d)$/;
const NAMES_FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const NAMES_SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

/** 'c4' -> 60, 'bb3' -> 58, 'f#5' -> 78; NaN if invalid */
export function pitch(s) {
  const m = NOTE_RE.exec(s);
  if (!m) return NaN;
  return 12 * (+m[3] + 1) + PCS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
/** pitch-class number of a name like 'f#' / 'bb' */
const pcOf = (name) => { const m = /^([a-g])(#|b)?$/.exec(name); return m ? (PCS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12 : NaN; };
const nameOf = (midi, sharps = false) => `${(sharps ? NAMES_SHARP : NAMES_FLAT)[midi % 12]}${Math.floor(midi / 12) - 1}`;

const TOKEN_RE = /^([^:'~{]+)(?::(\d+(?:\.\d+)?))?(['~]*)(?:\{([mt]):([a-g][#b]?\d)\})?$/;
/** One bar string -> [{ pitches: [midi…] | null (rest), dur, stacc, tie, orn? }]; throws on syntax errors. */
export function parseBar(str) {
  const out = [];
  let last = null;
  for (const tok of String(str).trim().split(/\s+/).filter(Boolean)) {
    const m = TOKEN_RE.exec(tok);
    if (!m) throw new Error(`Token „${tok}“ unlesbar`);
    const dur = m[2] !== undefined ? +m[2] : last;
    if (!(dur > 0)) throw new Error(`Token „${tok}“ ohne Dauer`);
    last = dur;
    const rest = m[1] === 'r';
    const pitches = rest ? null : m[1].split('+').map(pitch);
    if (pitches && pitches.some((p) => !Number.isFinite(p))) throw new Error(`Tonhöhe in „${tok}“ unlesbar`);
    const t = { pitches, dur, stacc: m[3].includes("'"), tie: m[3].includes('~') };
    if (m[4]) {
      if (rest) throw new Error(`Verzierung auf Pause „${tok}“`);
      t.orn = { kind: m[4], aux: pitch(m[5]) };
    }
    out.push(t);
  }
  return out;
}

const rests = (n) => Array.from({ length: n }, () => 'r:48');

// ---------------------------------------------------------------------------
// Johann Sebastian Bach (1685–1750): Toccata und Fuge d-Moll BWV 565, complete, 4/4, 143 bars.
//   SOURCE (note-faithful): Mutopia Project, "Toccata and Fugue in D Minor", BWV 565, Mutopia ID
//   Mutopia-2011/09/11-1780 (LilyPond 2.14, typeset by "Anonymous" after the Bach-Gesellschaft
//   Ausgabe 1867), placed in the PUBLIC DOMAIN by the typesetter
//   (http://creativecommons.org/licenses/publicdomain):
//     https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1780
//     https://www.mutopiaproject.org/ftp/BachJS/BWV565/ToccataFugue/ToccataFugue.ly
//   The voices below are generated by a converter from that .ly file (LilyPond \relative, chords,
//   ties, \scaleDurations triplets, cross-staff voices, \unfoldRepeats …): every pitch and written
//   value is the source's; the node test compares them with the MIDI file Mutopia rendered from the
//   same source. Voices: RH/LH = the source's two voices per staff (a few bars need a second lane
//   for inner polyphony: names with "(b)"), pedal at written pitch.
//   LIBERTIES (performance only, the written notes are unchanged):
//   - tempo map and fermata/breath holds (`tempo`, `holds`): Adagio ♩=50, Prestissimo ♩=80,
//     bars 12–15 ♩=72, 16–21 ♩=56/52, Prestissimo ♩=80, closing chords ♩=56→40, Fuge ♩=80,
//     Recitativo ♩=60, Adagissimo ♩=32, Presto ♩=72, Adagio ♩=40 – Vivace ♩=66, Molto adagio ♩=30→26, last bar ♩=28;
//     holds at the source's fermatas plus one breath before the fugue subject (bar 30, beat 3).
//   - ornaments realised: the six opening \prall signs as mordents a–g–a (as organists play them);
//     tr. bar 11 (f′–g′), trill spans bars 87–88 (g′–a♭′) and 88–90 (g′′–a♭′′), upper-note start.
//   - the arpeggio sign bar 2 (diminished chord c♯–e–g–b♭–c♯′–e′) rolled upwards.
//   - manuals: everything on the Great (II) except the traditional echoes on the Choir (I):
//     bars 6–7 (the repeat of the Prestissimo figure of bars 4–5, from the up-beat c♯ of bar 5) and
//     bars 64–65 in the fugue (the literal repeat of bars 62–63). Pedal on the Pedal (no change).
//   - unisons between voices on one manual are played once (see compiler); registration changes.
//   - the source spells "Adagio Vivave" (bar 136): read as Adagio – Vivace.
// ---------------------------------------------------------------------------
const ECHO = { 1: 1, '5:45': 0, '7:45': 1, 64: 0, 66: 1 }; // keyboard voices: Great, echoes on the Choir

const BWV565 = {
  id: 'bwv565', composer: 'J. S. Bach', dates: '1685–1750',
  title: 'Toccata und Fuge d-Moll BWV 565',
  subtitle: 'J. S. Bach (1685–1750) · vollständig · notengetreu nach Mutopia Project (gemeinfrei) · Plenum, Echos auf dem Choir, Schluss mit 32′-Zungen und Tubas',
  source: {
    url: 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1780',
    licence: 'gemeinfrei (Public Domain, CC „No rights reserved“)',
    credit: 'Mutopia Project, „Toccata and Fugue in D Minor“ BWV 565 (Mutopia-2011/09/11-1780), LilyPond-Satz nach der Bach-Gesellschaft-Ausgabe 1867',
    short: 'Mutopia Project (gemeinfrei)',
  },
  key: 'd-Moll', unit: 1 / 12, meter: 48, bpm: 80, tempoRange: [76, 88],
  sections: [{ title: 'Toccata', bar: 1 }, { title: 'Fuge', bar: 30, at: 24 }, { title: 'Schluss', bar: 127 }],
  tempo: {
    1: 50, //                Adagio
    4: 80, //                Prestissimo
    11: [80, 60], //         cadence into the fermata of bar 12
    '12:12': 72, //          semiquavers over the repeated a′
    16: 56, //               figures with demisemiquavers
    18: 52, '21:24': [52, 44],
    '22:24': 80, //          Prestissimo (triplets)
    '27:24': 56, 28: 52, 29: [52, 40], //  closing chords of the Toccata
    '30:24': 80, //          Fuge
    126: [80, 60],
    '127:24': 60, //         Recitativo
    130: 32, //              Adagissimo
    '133:24': 72, //         Presto
    '136:36': 40, //         Adagio
    137: 66, 140: [66, 50], // Vivace
    141: 30, 142: [30, 26], 143: 28, // Molto adagio
  },
  holds: {
    '1:6': 0.9, '1:24': 0.6, '1:30': 0.9, '2:0': 0.6, //   opening: fermata a, fermata rest
    '2:6': 0.9, '2:24': 0.6, //                            third statement
    '5:24': 0.5, '7:24': 0.5, //                           rests after the Prestissimo figures
    '12:12': 1.2, //                                       d minor chord
    '30:24': 0.5, //                                       breath before the fugue subject (added)
    '127:24': 1.5, '133:24': 1.5, //                       deceptive cadence; Adagissimo chord
    '144:0': 1.5, //                                         final chord
  },
  maxGap: 0.12,
  ornament: { mordent: 0.075, trill: 0.09 },
  arpeggios: [{ bar: 2, at: 36, step: 0.09 }],
  scale: ['d', 'e', 'f', 'g', 'a', 'bb', 'c', 'c#', 'b'],
  accidentals: { eb: 'Neapolitaner / c-Moll- und g-Moll-Episoden', f: '', 'f#': 'g-Moll (Dominante D-Dur)', 'g#': 'Leitton zu a (Dominante A-Dur)', ab: 'c-Moll-Episode (Takte 86–99), Triller a♭', b: '' },
  form: [{ from: 1, to: 143 }],
  registration: {
    stops: [
      // Great: diapason chorus 16-8-4-2⅔-2 + mixtures
      'great-double-open-diapason', 'great-open-diapason-1', 'great-open-diapason-2', 'great-octave', 'great-principal',
      'great-octave-quint', 'great-super-octave', 'great-fifteenth', 'great-mixture', 'great-fourniture',
      // Swell: chorus + reeds (coupled to the Great)
      'swell-open-diapason', 'swell-principal', 'swell-super-octave', 'swell-mixture', 'swell-double-trumpet', 'swell-trumpet', 'swell-clarion',
      // Choir (echo manual): diapason chorus 8-4-2 + mixture
      'choir-open-diapason', 'choir-gemshorn', 'choir-flageolet', 'choir-mixture',
      // Pedal: 16′ chorus + reeds
      'pedal-open-wood-i', 'pedal-open-diapason-i', 'pedal-violone', 'pedal-principal', 'pedal-octave-wood', 'pedal-super-octave',
      'pedal-mixture', 'pedal-ophicleide', 'pedal-trombone',
    ],
    couplers: ['swell-to-great', 'great-to-pedal', 'swell-to-pedal'], tremulants: [],
    swell: { 'swell-swell-pedal': 1, 'solo-swell-pedal': 0.7 },
  },
  changes: [
    // Fuge: lighter chorus 8-4-2 on the Great, Swell box half closed, Choir without mixture
    {
      bar: 30, at: 24,
      off: ['great-double-open-diapason', 'great-open-diapason-1', 'great-octave-quint', 'great-fifteenth', 'great-mixture', 'great-fourniture',
        'swell-mixture', 'swell-double-trumpet', 'swell-clarion', 'choir-mixture',
        'pedal-open-wood-i', 'pedal-octave-wood', 'pedal-mixture', 'pedal-ophicleide', 'pedal-trombone'],
      on: ['pedal-sub-bass'],
      swell: { 'swell-swell-pedal': 0.6 },
    },
    { bar: 52, on: ['pedal-open-wood-i'] }, //                                  first pedal entry of the subject
    { bar: 54, ramp: { id: 'swell-swell-pedal', from: 0.6, to: 0.85, bars: 4 } },
    { bar: 72, ramp: { id: 'swell-swell-pedal', from: 0.85, to: 0.5, bars: 2 } }, // manual episode, bars 73–85
    { bar: 84, ramp: { id: 'swell-swell-pedal', from: 0.5, to: 0.9, bars: 2 } },
    // pedal subject bar 86: fuller chorus
    { bar: 86, on: ['great-open-diapason-1', 'great-fifteenth', 'great-mixture', 'swell-mixture', 'pedal-octave-wood', 'pedal-mixture', 'pedal-ophicleide'] },
    // pedal solo bar 109 (subject in the pedal) and back to full plenum
    { bar: 109, on: ['pedal-trombone'] },
    { bar: 111, on: ['great-double-open-diapason', 'great-octave-quint', 'great-fourniture', 'swell-double-trumpet', 'swell-clarion'], swell: { 'swell-swell-pedal': 1 } },
    { bar: 124, on: ['pedal-double-open-wood'] }, //                               pedal point D
    // Schluss: full organ with Tubas (Solo/Bombard coupled to Great and Pedal) and 32′ reed
    {
      bar: 127, at: 24,
      on: ['great-tromba', 'great-harmonic-trumpet', 'great-octave-tromba', 'bombard-tuba', 'bombard-tuba-clarion', 'solo-to-great', 'solo-to-pedal',
        'pedal-double-ophicleide', 'pedal-bombard', 'pedal-clarion'],
      swell: { 'solo-swell-pedal': 1 },
    },
    { bar: 141, on: ['bombard-tuba-mirabilis', 'great-harmonics', 'great-cymbale', 'pedal-double-trombone', 'pedal-double-open-diapason'] }, // Molto adagio
  ],
  voices: [
    // <generated-voices>
    { name: 'Rechte Hand, Oberstimme (a)', manual: 1, manualFrom: ECHO, from: 1, bars: [
      'a5:6{m:g5} r:1.5 g5:0.75 f5 e5 d5 c#5:1.5 d5:3 r:9 a4:6{m:g4} r:1.5 e4 f4 c#4 d4:3 r:9', // 1
      'r:36 bb3+c#4+e4:12~', // 2
      'bb3+c#4+e4:12 d4 r:21 c#4:3', // 3
      'd4:2 e4 c#4 d4 e4 c#4 d4 e4 c#4 d4:3 e4 f4:2 g4 e4 f4 g4 e4 f4 g4 e4 f4:3 g4', // 4
      'a4:2 bb4 g4 a4 bb4 g4 a4 bb4 g4 a4:3 r:24 c#5:3', // 5
      'd5:2 e5 c#5 d5 e5 c#5 d5 e5 c#5 d5:3 e5 f5:2 g5 e5 f5 g5 e5 f5 g5 e5 f5:3 g5', // 6
      'a5:2 bb5 g5 a5 bb5 g5 a5 bb5 g5 a5:3 r:24 a5:3', // 7
      'g5:2 bb5 e5 g5 bb5 e5 f5 a5 d5 f5 a5 d5 e5 g5 c5 e5 g5 c5 d5 f5 bb4 d5 f5 bb4', // 8
      'c5:2 e5 a4 c5 e5 a4 bb4 d5 g4 bb4 d5 g4 a4 c5 f4 a4 c5 f4 g4 bb4 e4 g4 bb4 e4', // 9
      'f4:2 a4 d4 f4 a4 d4 e4 g4 c#4 e4 g4 c#4 r:12 c#4+e4+g4~', // 10
      'c#4+e4+g4:12 r:36', // 11
      'f4:12 r:9 a4:3 d5 e5 f5 d5 e5 f5 g5 e5', // 12
      'f5:3 g5 a5 f5 g5 a5 bb5 g5 a5 f5 g5 e5 f5 d5 e5 c#5', // 13
      'd5:3 a4 bb4 g4 a4 f4 g4 e4 f4 d4 g4 e4 f4 d4 e4 c#4', // 14
      'd4:3 a3 bb3 g3 a3 f3 g3 e3 f3 d3 g3 e3 f3 d3 e3 c#3', // 15
      'd3:6 r:1.5 f4 bb4 f4 r e4 a4 e4 r d4 g4 d4 r:3 e4:1.5 a4 r:3 f4+bb4 r e4+a4 r d4+g4', // 16
      'e4+a4:6 r:1.5 f4 bb4 f4 r e4 a4 e4 r d4 g4 d4 r:3 e4:1.5 a4 r:3 f4+bb4 r e4+a4 r d4+g4', // 17
      'a4:13.5 g4:1.5 f4 e4 d4 c#4 b3 c#4 a3 b3 c#4 d4 e4 f4 g4 a4 g4 f4 e4 f4 d4 f4 a4 c#5', // 18
      'd5:1.5 a4 b4 c#5 d5 e5 f5:0.75 g5 a5:1.5 bb5:6 r:3 f5+bb5 r e5+a5 r d5+g5 c#5+e5+a5:6 r:1.5 f5 bb5 f5', // 19
      'r:1.5 e5 a5 e5 r d5 g5 d5 r:3 e5:1.5 a5 r:3 f5+bb5 r e5+a5 r d5+g5 c#5+e5+a5:6 f4+b4', // 20
      'c#5:9 b4:3 a4 c#5 e5:1.5 g5 bb5:3 a5:1.5 g5 f5 e5 f5 e5 d5 c#5 d5 c5 bb4 a4 g4 f4 e4 d4', // 21
      'c#5:26 e5:2 c#5 bb4 c#5 bb4 c#5 e5 c#5 bb4 c#5 bb4', // 22
      'c#5:2 e5 c#5 bb4 c#5 bb4 c#5 e5 c#5 bb4 c#5 bb4 g4 bb4 g4 e4 g4 e4 g4 bb4 g4 e4 g4 bb4', // 23
      'g4:2 bb4 g4 e4 g4 e4 g4 bb4 g4 e4 g4 e4 c#4 e4 c#4 bb3 c#4 bb3 c#4 e4 c#4 bb3 c#4 bb3', // 24
      'c#4:2 e4 c#4 bb3 c#4 bb3 c#4 e4 c#4 bb3 c#4 bb3 c#4 e4 c#4 e4 g4 e4 c#4 e4 c#4 e4 g4 e4', // 25
      'c#4:2 e4 c#4 e4 g4 e4 c#4 e4 c#4 e4 g4 e4 g4 bb4 g4 bb4 g4 bb4 g4 bb4 g4 bb4 g4 bb4', // 26
      'c#5:2 bb4 c#5 e5 c#5 e5 c#5 e5 c#5 e5 c#5 e5 a4+c#5+e5+a5:12 a4+d5+f5+a5', // 27
      'bb4+d5+g5:12 r a4+c#5+e5+g5 r', // 28
      'r:21 a4+c#5:3 f4+a4+d5:6 f4 e4:12', // 29
      'd4:24 r', // 30
      'r:48', // 31
      'r:27 d5:3 c5 d5 bb4 d5 a4 d5', // 32
      'g4:3 d5 f#4 d5 g4 d5 a4 d5 bb4 d5 d4 d5 e4 d5 f#4 d5', // 33
      "g4:3 d5 f#4 d5 g4 d5 a4 d5 bb4:6' d5' bb4' d5'", // 34
      'eb5:6 g4 eb5 g4 c5 a4 c5 a4', // 35
      'd5:6 f4 d5 f4 bb4 g4 bb4 g4', // 36
      'c#5:6 e4 c#5 e4 a4 f4 a4 f4', // 37
      'g4:6 c#4 g4 c#4 f4 d4 f4 d4', // 38
      'e4:6 bb3 e4 bb3 r:3 a5 g5 a5 f5 a5 e5 a5', // 39
      'd5:3 a5 c#5 a5 d5 a5 e5 a5 f5 a5 a4 a5 b4 a5 c#5 a5', // 40
      'd5:3 a5 c#5 a5 d5 a5 e5 a5 f5 a5 e5 a5 d5 a5 c5 a5', // 41
      'bb4:3 a5 c5 a5 d5 g5 bb4 g5 e5 g5 d5 g5 c5 g5 bb4 g5', // 42
      'a4:3 g5 bb4 g5 c5 f5 a4 f5 d5 f5 c5 f5 bb4 f5 a4 f5', // 43
      'g4:3 f5 a4 f5 bb4 e5 g4 e5 c#5 e5 bb4 e5 a4 e5 g4 e5', // 44
      'f4:3 e5 g4 e5 a4 d5 f4 d5 e4 e5 e4 e5 f4 d5 f4 d5', // 45
      'bb4:3 c#5 bb4 c#5 a4 d5 f4 d5 e4 e5 e4 e5 f4 d5 f4 d5', // 46
      'r:3 d5 c#5 d5 b4 d5 c#5 b4 c#5:12 r', // 47
      'r:3 d5 c#5 d5 f5 d5 c#5 b4 c#5:12 e5~', // 48
      'e5:6 d5:12 c#5:6 c5:12 bb4', // 49
      'a4:12 a4 g4 g4', // 50
      'f#4:6 a4:12 eb5:6 d5:12 r:6 g5~', // 51
      'g5:6 f#5 g5:12 bb4:6 d5 d5 d5', // 52
      'd5:6 d5 d5 d5 d5 d5 d5 d5', // 53
      'd5:3 g5 f5 g5 e5 f5 d5 e5 c5 a5 g5 a5 f5 g5 e5 f5', // 54
      'd5:3 bb5 a5 bb5 g5 a5 f5 g5 e5 c6 bb5 c6 a5 bb5 g5 a5', // 55
      'f5:3 eb5 d5 c5 d5 c5 bb4 a4 bb4 d5 bb4 a4 g4 bb4 g4 f4', // 56
      'e4:3 f4 g4 a4 bb4 d5 c5 bb4 a4:12 c5:6 bb4', // 57
      'a4:6 g4 a4 bb4 c5 e4 f4 g4', // 58
      'a4:6 g4 a4 bb4 c5:3 bb4 a4 g4 f4 eb4 d4 c4', // 59
      'd5:3 c5 bb4 a4 g4 f4 e4 d4 e5 d5 c5 bb4 a4 g4 f4 e4', // 60
      'f5:3 e5 d5 c5 bb4 a4 g4 f4 g5 f5 e5 d5 c5 bb4 a4 g4', // 61
      'a5:3 f5 e5 f5 c5 f5 e5 f5 a5 f5 e5 f5 c5 f5 e5 f5', // 62
      'g5:3 e5 d5 e5 c5 e5 d5 e5 g5 e5 d5 e5 c5 e5 d5 e5', // 63
      'a5:3 f5 e5 f5 c5 f5 e5 f5 a5 f5 e5 f5 c5 f5 e5 f5', // 64
      'g5:3 e5 d5 e5 c5 e5 d5 e5 g5 e5 d5 e5 c5 e5 d5 e5', // 65
      'f5:3 g5 f5 e5 d5 c5 b4 a4 b4 g4 b4 d5 f5 a5 f5 d5', // 66
      'b4:3 g4 b4 d5 f5 a5 f5 d5 bb4 g4 bb4 c5 e5 g5 e5 c5', // 67
      'bb4:3 g4 bb4 c5 e5 g5 e5 c5 a4 f4 a4 c5 d5 f5 d5 bb4', // 68
      'a4:3 f4 a4 c5 d5 f5 d5 bb4 g4 e4 g4 bb4 c#5 e5 c#5 bb4', // 69
      'g4:3 e4 g4 bb4 c#5 e5 c#5 bb4 r a5 g5 a5 f5 a5 e5 a5', // 70
      'd5:3 a5 c#5 a5 d5 a5 e5 a5 f5 a5 a4 a5 b4 a5 c#5 a5', // 71
      'd5:3 a5 c#5 a5 d5:6 e5 d5 c5 bb4 a4', // 72
      'bb4:3 a4 g4 f4 e4 d4 c#4 b3 r:24', // 73
      ...rests(11), // 74–84
      'r:15 f4:3 e4 d4 a4 r:12 e5:3 d5 c#5', // 85
      'd5:3 eb5:1.5 d5 c5 bb4 a4 g4 f#4:6 a4:12 g4:6 c5 b4', // 86
      'eb5:6 d5 eb5 b4 c5 b4 c5 d5', // 87
      'eb5:6 d5 eb5 f5 g5:24~{t:ab5}', // 88
      'g5:48~', // 89
      'g5:27 g5:3 f5 g5 eb5 f5 d5 eb5', // 90
      'c5:3 f5 eb5 f5 d5 eb5 c5 d5 bb4 eb5 d5 eb5 c5 d5 bb4 c5', // 91
      'a4:3 d5 c5 d5 bb4 c5 a4 bb4 g4 bb4 a4 bb4 c5 bb4 a4 g4', // 92
      'f#4:6 a4 d5:3 g4 c5 f#4 bb4 g4 d5 a4 bb4 g4 a4 f#4', // 93
      'g4:3 d5 f#4 d5 g4 d5 a4 d5 bb4 g4 d5 a4 bb4 g4 c5 a4', // 94
      'd5:3 c5 bb4 a4 bb4 a4 bb4 g4 a4 bb4 c5 d5 eb5 d5 c5 d5', // 95
      'bb4:3 c5 a4 bb4 g4:6 b4 c5:3 eb5 f5 g5 ab5 g5 f5 g5', // 96
      'eb5:3 f5 d5 eb5 c5:6 bb4 a4 bb4:12 a4:6~', // 97
      'a4:6 g4:12 f#4:6 f4 eb4:12 d4:3 bb4', // 98
      'a4:3 bb4 a4 g4 f#4 eb5 d5 c5 bb4 a5 g5 f#5 g5:9 f5:3', // 99
      'eb5:3 f5 d5 eb5 c#5:12 d5 c5', // 100
      'bb4:12 a4:6 c#5 d5 e5 f5:12', // 101
      'e5:24 d5:18 f5:6', // 102
      'g5:6 d5 c#5 d5 e5 d5 c#5 d5', // 103
      'e5:6 d5 c#5 d5 e5 g5 f5 d5', // 104
      'bb4:6 e5 d5 d5 c#5:12 d5:6 e5', // 105
      'f5:6 e5 f5 c#5 d5 c#5 d5 e5', // 106
      'f5:6 e5 f5 g5 a5:3 bb5 g5 a5 f5 g5 e5 f5', // 107
      'd5:3 a4 c#5 a4 d5 a4 e5 a4 f5 a4 e5 a4 f5 a4 g5 a4', // 108
      'a5:3 a4 e5 a4 f5 a4 g5 a4 a5:12 r', // 109
      'r:48', // 110
      'r:27 e5:3 d5 c#5 d5:6 r:3 f5', // 111
      'e5:3 f5 g5 a5 bb5 a5 g5 a5 f5:6 e5 d5:3 e5 f5 eb5', // 112
      'd5:3 c5 bb4 a4 g4 a4 bb4 c5 a4:12 r:6 c5~', // 113
      'c5:6 bb4 r g5 eb5:3 f5 d5 eb5 c5 bb4 a4 g4', // 114
      'a4:12 r:36', // 115
      'r:48', // 116
      'r:12 c4:3 eb4 c4 bb3 r:12 c4:3 eb4 c4 bb3', // 117
      'r:12 g4:3 bb4 g4 d4 r:12 g4:3 bb4 g4 d4', // 118
      'r:12 f#4:3 a4 f#4 eb4 r:12 f#4:3 a4 f#4 eb4', // 119
      'd4:6 r d5 c5 bb4:12 c5:6 d5', // 120
      'eb5:12 f5:6 g5 a5:12 f5:6 eb5', // 121
      'd5:3 eb5 d5 c5 bb4 c5 bb4 a4 g4 c5 bb4 a4 g4 a4 g4 f#4', // 122
      'g4:3 f4 e4 d4 c#4:6 e4 f4:3 g4 a4 b4 c#5 d5 e5 f5', // 123
      'g5:6 f5:3 e5 d5:6 c#5 d5 e5 f5 g5', // 124
      'a5:6 c#5 d5 e5 f5 e5 f5 d5', // 125
      'e5:6 d5 d5 c#5 d5 f5 e5:12', // 126
      'bb4+d5:24 r:1.5 f5 g5 a5 bb5 r:6 c5:1.5 d5 eb5 f5 r:4.5', // 127
      'r:1.5 a4 bb4 c5 d5 r:6 g4:1.5 a4 bb4 c5 r:6 f4:1.5 g4 a4 bb4 r:6 c4:1.5 d4 eb4 f4 r:4.5', // 128
      'r:1.5 a3 bb3 c4 d4 r:6 bb3:1.5 c4 d4 eb4 r:6 c4:1.5 d4 e4 f#4 r:6 f#4:1.5 g4 a4 bb4:6', // 129
      'bb4+e5:36 d5:12~', // 130
      'd5:24 r', // 131
      'r:18 b4+d5:6 c5:24~', // 132
      'c5:24 r:1.5 g4 f4 g4 e4 r:6 a4:1.5 g4 a4 f4 r:4.5', // 133
      'r:1.5 b4 a4 b4 g4 r:6 c5:1.5 b4 c5 r d5 c5 d5 r e5 d5 e5 r f5 e5 f5 r g5 f5 g5 e5 r:4.5', // 134
      'r:1.5 d5 c5 d5 b4 r:6 c5:1.5 b4 c5 a4 r:6 b4:1.5 a4 b4 r a4 g4 a4 r g#4 f#4 g#4 e4 r:4.5', // 135
      'r:1.5 d4 c4 b3 r e4 d4 c4 r f4 e4 d4 r g4 f4 e4 r a4 g4 f4 r g4 a4 b4 c5:12', // 136
      'c#5:6 r c#5 c#5 d5 r d5 d5', // 137
      'b4:6 r b4 b4 c5 r c5 c5', // 138
      'a4:6 r a4 a4 bb4 r bb4 bb4', // 139
      'bb4:6 r bb4 bb4 a4 r a4 a4~', // 140
      'a4:12 g4:24 f4:12', // 141
      'e4:24 d4~', // 142
      'd4:48', // 143
    ] },
    { name: 'Rechte Hand, Oberstimme (b)', manual: 1, manualFrom: ECHO, from: 18, bars: [
      'e4:12 r:36', // 18
      ...rests(3), // 19–21
      'e5:24 r', // 22
      ...rests(106), // 23–128
      'r:43.5 c5:1.5 d5 g4', // 129
      'r:36 a4:12', // 130
      'b4:24 r', // 131
      'r:24 a4:18 g4:3 f4', // 132
    ] },
    { name: 'Rechte Hand, 2. Stimme', manual: 1, manualFrom: ECHO, from: 1, bars: [
      'a4:6{m:g4} r:1.5 g4:0.75 f4 e4 d4 c#4:1.5 d4:3 r:33', // 1
      'r:48', // 2
      'r:12 a3 r:24', // 3
      ...rests(6), // 4–9
      'r:36 bb4:12~', // 10
      'bb4:13.5 a4:1.5 g4 f4 e4 d4 c#4 b3 c#4:3 a3 c#4 e4:1.5 g4 f4:9{t:g4} e4:3', // 11
      'd4:12 r:36', // 12
      ...rests(5), // 13–17
      'c#4:12 r:36', // 18
      'r:18 d5:3 r a4 r bb4 r e4:6 d5:1.5 r:4.5', // 19
      'c5:1.5 r:4.5 bb4:1.5 r:4.5 a4:1.5 c#5 r:3 d5 r a4 r bb4 r e4:6 b3+d4', // 20
      'a4:12 r:36', // 21
      'bb4:24 r', // 22
      ...rests(4), // 23–26
      'r:24 c#4+e4:12 d4+f4', // 27
      'd4+g4:12 r c#4+e4 r', // 28
      'r:21 e4:3 d4:6 d4:12 c#4:6', // 29
      ...rests(17), // 30–46
      'r:27 a4:3 g4 a4 e4 g4 f4 e4', // 47
      'f4:12 d4 a3:3 a4 g4 a4 c#4 g4 f4 e4', // 48
      'f4:12 e4 d4:6 a4:12 g4:6~', // 49
      'g4:12 f#4 f4 eb4~', // 50
      'eb4:6 d4 f#4 c5:12 bb4:3 a4 bb4:6 bb4', // 51
      'a4:12 d5:6 c5 bb4 a4 bb4 f#4', // 52
      'g4:6 f#4 g4 a4 bb4 a4 bb4 f#4', // 53
      'g4:3 bb4 a4 bb4 g4 a4 f4 g4 e4 c5 bb4 c5 a4 bb4 g4 a4', // 54
      'f4:3 d5 c5 d5 bb4 c5 a4 bb4 g4 e5 d5 e5 c5 d5 bb4 c5', // 55
      'a4:6 f4 bb4:3 a4 g4 f4 g4 bb4 g4 f4 e4 g4 e4 d4', // 56
      'c4:3 d4 e4 f4 g4:6 e4 f4:12 r', // 57
      ...rests(2), // 58–59
      'bb3:6 r:18 c4:6 r:18', // 60
      'd4:6 r:18 e4:6 r:18', // 61
      'f4:6 r c5 r f4 r c5 r', // 62
      'e4:6 r c5 r e4 r c5 r', // 63
      'f4:6 r c5 r f4 r c5 r', // 64
      'e4:6 r c5 r e4 r c5 r', // 65
      'd4:6 r:42', // 66
      ...rests(5), // 67–71
      'r:24 d5:6 a4 g4 f#4', // 72
      'g4:6 r:42', // 73
      ...rests(26), // 74–99
      'r:15 bb4:3 a4 g4 a4:12 f#4', // 100
      'g4:3 f4 eb4 d4 c#4:6 e4 f4 g4 r d5~', // 101
      'd5:12 c#5 a4:3 bb4 g4 a4 f4:6 a4', // 102
      'g4:6 a4 g4 f4 g4 f4 e4 a4', // 103
      'bb4:6 a4 g4 f4 a4 e5 d5 a4', // 104
      'g4:6 g4 a4 f4 r:24', // 105
      ...rests(14), // 106–119
      'r:12 g4:6 f#4 g4:12 g4:6 b4', // 120
      'c5:12 c5:6 e5 f5:12 bb4:6 a4', // 121
      'bb4:6 r:42', // 122
      ...rests(3), // 123–125
      'r:6 a4 bb4 a4 a4 d5 d5 c5', // 126
      'f4:24 r:7.5 a4:1.5 bb4 c5 d5 r:6 f4:1.5 g4 a4', // 127
      'bb4:1.5 r:6 a4:1.5 g4 f4 eb4 r:6 g4:1.5 f4 eb4 d4 r:6 a3:1.5 bb3 c4 d4 r:6 f3:1.5 g3 a3', // 128
      'bb3:1.5 r:6 c4:1.5 bb3 a3 g3 r:6 d4:1.5 c4 bb3 a3 r:6 eb4:1.5 d4 c4 bb3 r:10.5', // 129
      'e4+g4:36 f4:12', // 130
      'd4+f4:24 r', // 131
      'r:18 e4+g#4:6 e4:24', // 132
      'e4:24 r:7.5 e4:1.5 d4 e4 c4 r:6 f4:1.5 e4 f4', // 133
      'd4:1.5 r:6 g4:1.5 f4 g4 e4 r:4.5 a4:1.5 r:4.5 b4:1.5 r:4.5 c5:1.5 r:4.5 d5:1.5 r:6 c5:1.5 b4 c5', // 134
      'a4:1.5 r:6 g#4:1.5 f#4 g#4 e4 r:6 f4:1.5 e4 f4 d4 r:4.5 c4:1.5 r:4.5 b3:1.5 r:6 c4:1.5 b3 a3', // 135
      'g#3:1.5 r:4.5 a3:1.5 r:4.5 b3:1.5 r:4.5 c4:1.5 r:4.5 d4:1.5 r:4.5 e4:1.5 r:10.5 c4+e4+g4:6', // 136
      'e4+a4:6 a3:1.5 c#4 e4 a4 r:6 e4+a4 f4+a4 a3:1.5 d4 f4 a4 r:6 f4+a4', // 137
      'd4+g4:6 g3:1.5 b3 d4 g4 r:6 d4+g4 e4+g4 g3:1.5 c4 e4 g4 r:6 e4+g4', // 138
      'c4+f4:6 f3:1.5 a3 c4 f4 r:6 c4+f4 d4+f4 f3:1.5 bb3 d4 f4 r:6 d4+f4', // 139
      'e4+g4:6 e3:1.5 g3 bb3 c#4 r:6 c#4+e4+g4 d4+f#4 d3:1.5 a3 d4 f#4 r:6 d4+f#4', // 140
      'bb3+d4:24 c#4+e4:12 d4~', // 141
      'd4:12 c4:24 bb3:12', // 142
      'a3:48', // 143
    ] },
    { name: 'Linke Hand (a)', manual: 1, manualFrom: ECHO, from: 1, bars: [
      'r:24 a3:6{m:g3} r:1.5 e3 f3 c#3 d3:3 r:9', // 1
      'a3:6{m:g3} r:1.5 g3:0.75 f3 e3 d3 c#3:1.5 d3:3 r:21 g3:12~', // 2
      'g3:15 e3:3 f#3:6 r:21 c#3:3', // 3
      'd3:2 e3 c#3 d3 e3 c#3 d3 e3 c#3 d3:3 e3 f3:2 g3 e3 f3 g3 e3 f3 g3 e3 f3:3 g3', // 4
      'a3:2 bb3 g3 a3 bb3 g3 a3 bb3 g3 a3:3 r:24 c#4:3', // 5
      'd4:2 e4 c#4 d4 e4 c#4 d4 e4 c#4 d4:3 e4 f4:2 g4 e4 f4 g4 e4 f4 g4 e4 f4:3 g4', // 6
      'a4:2 bb4 g4 a4 bb4 g4 a4 bb4 g4 a4:3 r:24 a4:3', // 7
      'g4:2 bb4 e4 g4 bb4 e4 f4 a4 d4 f4 a4 d4 e4 g4 c4 e4 g4 c4 d4 f4 bb3 d4 f4 bb3', // 8
      'c4:2 e4 a3 c4 e4 a3 bb3 d4 g3 bb3 d4 g3 a3 c4 f3 a3 c4 f3 g3 bb3 e3 g3 bb3 e3', // 9
      'f3:2 a3 d3 f3 a3 d3 e3 g3 c#3 e3 g3 c#3 r:12 c#3+e3~', // 10
      'c#3+e3:12 r:36', // 11
      'd3:12 r:13.5 a4:3 a4 a4 a4 a4 a4 a4 a4:1.5', // 12
      'r:1.5 a4:3 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4:1.5', // 13
      'r:1.5 a4:3 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4:1.5', // 14
      'r:1.5 a4:3 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4 a4:1.5', // 15
      'r:6 d4:1.5 r:4.5 c4:1.5 r:4.5 bb3:1.5 r:4.5 a3:1.5 c#4 r:3 d4 r a3 r bb3 r', // 16
      'c#4:6 d4:1.5 r:4.5 c4:1.5 r:4.5 bb3:1.5 r:4.5 a3:1.5 c#4 r:3 d4 r a3 r bb3 r', // 17
      'e3:12 r:36', // 18
      ...rests(2), // 19–20
      'e4:12 r:36', // 21
      'e4:26 g4:2 e4 c#4 e4 c#4 e4 g4 e4 c#4 e4 c#4', // 22
      'e4:2 g4 e4 c#4 e4 c#4 e4 g4 e4 c#4 e4 c#4 bb3 c#4 bb3 g3 bb3 g3 bb3 c#4 bb3 g3 bb3 g3', // 23
      'bb3:2 c#4 bb3 g3 bb3 g3 bb3 c#4 bb3 g3 bb3 g3 e3 g3 e3 c#3 e3 c#3 e3 g3 e3 c#3 e3 c#3', // 24
      'e3:2 g3 e3 c#3 e3 c#3 e3 g3 e3 c#3 e3 c#3 e3 g3 e3 g3 bb3 g3 e3 g3 e3 g3 bb3 g3', // 25
      'e3:2 g3 e3 g3 bb3 g3 e3 g3 e3 g3 bb3 g3 e3 g3 e3 g3 e3 g3 bb3 c#4 bb3 c#4 bb3 c#4', // 26
      'e4:2 c#4 e4 c#4 e4 c#4 e4 c#4 e4 c#4 e4 c#4 a3:12 a3', // 27
      'r:48', // 28
      'r:21 a3:3 a3:6 a3:15 g3:3~', // 29
      'g3:6 f3:3 e3 f3:12 r:3 a4 g4 a4 f4 a4 e4 a4', // 30
      'd4:3 a4 c#4 a4 d4 a4 e4 a4 f4 a4 a3 a4 b3 a4 c#4 a4', // 31
      'd4:3 a4 c#4 a4 d4 a4 e4 a4 f4:6 f#4 g4 c4', // 32
      'bb3:6 a3 bb3 c4 d4 f#3 g3 a3', // 33
      'bb3:6 a3 bb3 f#3 g3:3 g4 g3 g4 d4 g4 d4 g4', // 34
      'c4:3 eb4 c4 eb4 c4 eb4 c4 eb4 c4 f4 c4 f4 c4 f4 c4 f4', // 35
      'bb3:3 d4 bb3 d4 bb3 d4 bb3 d4 bb3 e4 bb3 e4 bb3 e4 bb3 e4', // 36
      'a3:3 c#4 a3 c#4 a3 c#4 a3 c#4 f3 d4 f3 d4 f3 d4 f3 d4', // 37
      'e3:3 bb3 e3 bb3 e3 bb3 e3 bb3 d3 a3 d3 a3 d3 a3 d3 a3', // 38
      'e3:3 g3 e3 g3 e3 g3 e3 g3 f3:6 e3 d3 g3', // 39
      'f3:6 e3 f3 c#3 d3 c#3 d3 e3', // 40
      'f3:6 e3 f3 c#3 d3:12 f3', // 41
      'g3:12 r c3 e3', // 42
      'f3:12 r bb2 d3', // 43
      'e3:12 r a2 c#3', // 44
      'd3:12 r:6 f3 bb3 bb3 a3 a3', // 45
      'g3:12 r:6 a3 bb3 bb3 a3 a3', // 46
      'g#3:12 r:36', // 47
      'r:48', // 48
      'r:3 d4 c#4 d4 a3 a3 g3 a3 f#3 d4 c#4 d4 g3 f4 eb4 d4', // 49
      'c#4:3 e4 a3 c#4 d3 eb4 d4 c4 b3 d4 g3 b3 c3 d4 c4 bb3', // 50
      'a3:3 c4 f#3 a3 d3 c4 bb3 a3 bb3 a4 g4 f#4 g4 bb3 a3 g3', // 51
      'd4:12 r:6 d4 d4 d4 d4 c4', // 52
      'bb3:6 d4 d4 c4 bb3 d4 d4 c4', // 53
      'bb3:12 r:36', // 54
      ...rests(2), // 55–56
      'r:27 c4:3 bb3 c4 a3 c4 g3 c4', // 57
      'f3:3 c4 e3 c4 f3 c4 g3 c4 a3 c4 c3 c4 d3 c4 e3 c4', // 58
      'f3:3 c4 e3 c4 f3 c4 g3 c4 a3:12 r', // 59
      ...rests(10), // 60–69
      'r:24 a4:6 c#5 d5 g4', // 70
      'f4:6 a4 b4 c#5 d5 c#5 d5 e5', // 71
      'f5:6 e5 f5 c#5 r:3 f#4 e4 f#4 r d4 c4 d4', // 72
      'bb3:3 c4 bb3 a3 g3 f3 e3 d3 c#3 a2 c#3 e3 g3 bb3 g3 e3', // 73
      'c#3:3 a2 c#3 e3 g3 bb3 g3 e3 d3 a2 d3 f3 a3 d4 a3 f3', // 74
      'd3:3 a2 d3 f3 a3 d4 a3 f3 c#3 a2 c#3 e3 g3 bb3 g3 e3', // 75
      'c#3:3 a2 c#3 e3 g3 bb3 g3 e3 d3 a2 d3 f3 a3 d4 a3 f3', // 76
      'd3:3 a2 d3 f3 a3 d4 a3 f3 e3 c#3 e3 g3 bb3 c#4 bb3 g3', // 77
      'e3:3 c#3 e3 g3 bb3 c#4 bb3 g3 f3 d3 f3 a3 d4 f4 d4 a3', // 78
      'f3:3 d3 f3 a3 d4 f4 d4 a3 e3 c#3 e3 g3 bb3 c#4 bb3 g3', // 79
      'e3:3 c#3 e3 g3 bb3 c#4 bb3 g3 f3 d3 f3 a3 d4 f4 d4 a3', // 80
      'f3:3 d3 f3 a3 d4 f4 d4 a3 g3 e3 g3 bb3 c#4 e4 c#4 bb3', // 81
      'g3:3 e3 g3 bb3 c#4 e4 c#4 bb3 a3 f3 a3 c#4 d4 f4 d4 a3', // 82
      'bb3:3 d4 bb3 g3 f3 a3 f3 d3 a2 d3 a2 f2 d2 d3 c#3 b2', // 83
      'r:3 bb3 a3 g3 r g3 f3 e3 r bb3 a3 g3 r g3 f3 e3', // 84
      'd3:3 e3:1.5 f3 g3 a3 b3 c#4 d4:3 r:9 a3:3 b3:1.5 c#4 d4 e4 f4 g4 a4:3 g4 f4 e4', // 85
      'f4:6 r:9 eb4:3 d4 c4 bb3:6 b3 c4 g4', // 86
      'g4:48~{t:ab4}', // 87
      'g4:27 g4:3 f4 g4 eb4 g4 d4 g4', // 88
      'c4:3 g4 b3 g4 c4 g4 d4 g4 eb4 g4 g3 g4 a3 g4 b3 g4', // 89
      'c4:3 g4 b3 g4 c4 g4 d4 d4 eb4:6 d4 g4:3 ab4 f4 g4', // 90
      'eb4:6 c4 f4:3 g4 eb4 f4 d4:6 bb3 eb4:3 f4 d4 eb4', // 91
      'c4:6 f#4 g4:3 a4 f4 g4 eb4 g4 f#4 g4 a4 g4 f#4 e4', // 92
      'r:3 d4 c4 d4 bb3 d4 a3 d4 g3 d4 f#3 d4 g3 d4 a3 d4', // 93
      'bb3:3 d4 d3 d4 e3 d4 f#3 d4 g3 d4 f#3 d4 g3 d4 a3 d4', // 94
      'bb3:6 a3 g3:24 f#3:12', // 95
      'g3:6 a3 bb3:3 a3 g3 f3 eb3:6 eb4 d4:12', // 96
      'c4:6 d4 eb4:3 f4 d4 eb4 c4 eb4 d4 f4 g4 f4 eb4 f4', // 97
      'd4:3 bb3 eb4 d4 c#4 a3 d4 c4 b3 g3 c4 bb3 a3 f3 bb3 d4', // 98
      'c4:3 d4 c4 bb3 a3 c4 bb3 a3 g3 c4 bb3 a3 bb3 c4 bb3 a3', // 99
      'g3:3 a3 f3 g3 e3:12 r:3 eb4 d4 c4 d4 c4 bb3 a3', // 100
      'g3:12 a3:3 bb3 a3 g3 f3 g3 e3 a3 a4 g4 a4 f4', // 101
      'g4:3 a4 g4 a4 bb4 a4 g4 a4 f4 g4 e4 f4 d4 c4 bb3 a3', // 102
      'bb3:3 a3 g3 f3 e3 f3 e3 d3 c#3 a2 d3 a2 e3 a2 f3 a2', // 103
      'g3:3 a2 f3 a2 e3 a2 d3 a2 c#3 a3 a2 a3 d3 a3 f3 d4', // 104
      'f3:3 d4 e3 c#4 f3 d4 d3 d4 e4 a4 g4 a4 f4 a4 e4 a4', // 105
      'd4:3 a4 c#4 a4 d4 a4 e4 a4 f4 a4 a3 a4 b3 a4 c#4 a4', // 106
      'd4:3 a4 c#4 a4 d4 a4 e4 a4 f4:6 e4 d4 g4', // 107
      'f4:6 e4 f4 c#4 d4 c#4 d4 b3', // 108
      'c#4:6 g4 f4 d4 c#4:12 r', // 109
      'r:48', // 110
      'r:27 g4:3 f4 e4 f4 c#4 d4:6~', // 111
      'd4:12 c#4 d4:3 a4 b4 c#5 d5:6 c5', // 112
      'f4:18 eb4:9 c4:3 a3 f3 a3 c4 eb4 c4', // 113
      'd4:3 bb3 g3 d3 g3 bb3 d4 g4 c4 d4 bb3 c4 a3 g3 f#3 e3', // 114
      'f#3:3 d3 f#3 g3 a3 d4 a3 g3 f#3 d3 f#3 g3 a3 d4 a3 f#3', // 115
      'g3:3 d3 g3 a3 bb3 d4 bb3 a3 g3 d3 g3 a3 bb3 d4 c4 bb3', // 116
      'a3:3 f#3 a3 bb3 r:12 a3:3 f#3 a3 bb3 r:12', // 117
      'a3:3 bb3 d4 f#4 r:12 bb3:3 g3 bb3 d4 r:12', // 118
      'c4:3 a3 c4 eb4 r:12 c4:3 a3 c4 eb4 r:12', // 119
      'f#3:6 r g3 a3 bb3:12 eb4:6 b3', // 120
      'g3:12 c4:6 bb3 a3:12 bb3:6 c4', // 121
      'd4:3 g4 f4 eb4 d4 eb4 d4 c4 bb3 eb4 d4 c4 bb3 c4 bb3 a3', // 122
      'bb3:3 a3 g3 f3 e3:6 g3 a3:3 b3 c#4 d4 e4 f4 g4 a4', // 123
      'bb4:6 a4:3 g4 f4 a4 e4 a4 d4 a4 c#4 a4 d4 a4 e4 a4', // 124
      'f4:3 a4 a3 a4 b3 a4 c#4 a4 d4 a4 c#4 a4 d4 a4 b3 a4', // 125
      'c#4:6 d4 g4 e4 f4 a4 bb4 a4', // 126
      'bb3+d4:24 r', // 127
      ...rests(2), // 128–129
      'c#4:36 d4:12', // 130
      'b3:24 r', // 131
      'r:18 g#3+b3:6 c4:24~', // 132
      'c4:24 r', // 133
      ...rests(2), // 134–135
      'r:42 g3:6', // 136
      'a3:6 r:12 a3:6 a3 r:12 a3:6', // 137
      'b3:6 r:12 g3:6 g3 r:12 g3:6', // 138
      'a3:6 r:12 f3:6 f3 r:12 f3:6', // 139
      'e3:6 r:12 e3:6 f#3 r:12 f#3:6', // 140
      'g3:24 bb3:12 a3', // 141
      'a3:24 f3:12 g3', // 142
      'f3:48', // 143
    ] },
    { name: 'Linke Hand (b)', manual: 1, manualFrom: ECHO, from: 2, bars: [
      'r:36 c#3+e3:12~', // 2
      'c#3+e3:12 r:36', // 3
      ...rests(18), // 4–21
      'g4:24 r', // 22
      ...rests(7), // 23–29
      'd3+a3:24 r', // 30
      ...rests(101), // 31–131
      'r:24 a3', // 132
      'g3:24 r', // 133
    ] },
    { name: 'Linke Hand, 2. Stimme', manual: 1, manualFrom: ECHO, from: 2, bars: [
      'a2:6{m:g2} r:1.5 g2:0.75 f2 e2 d2 c#2:1.5 d2:3 r:33', // 2
      'r:12 d3 r:24', // 3
      ...rests(6), // 4–9
      'r:36 g3+bb3:12~', // 10
      'g3+bb3:12 r:36', // 11
      ...rests(5), // 12–16
      'e3:6 r:42', // 17
      ...rests(3), // 18–20
      'a3:12 r:36', // 21
      'c#4:24 r', // 22
      ...rests(16), // 23–38
      'r:24 a3:6 a3 a3 a3', // 39
      'a3:6 a3 a3 a3 a3 a3 a3 a3', // 40
      'a3:6 a3 a3 a3 a3:12 d4', // 41
      'd4:12 r c4 c4', // 42
      'c4:12 r bb3 bb3', // 43
      'bb3:12 r a3 a3', // 44
      'a3:12 r:6 d4 c#4 c#4 d4 d4', // 45
      'e4:12 r:6 d4 c#4 c#4 d4 d4', // 46
      'e4:12 r:36', // 47
      ...rests(24), // 48–71
      'r:15 a4:3 g4 a4 r:24', // 72
      ...rests(11), // 73–83
      'c#3:3 r:9 f3:3 r:9 d3:3 r:9 f3:3 r:9', // 84
      ...rests(15), // 85–99
      'r:24 f#3:12 d3', // 100
      'g3:12 r:24 d3:12', // 101
      ...rests(3), // 102–104
      'r:24 a3~', // 105
      'a3:48~', // 106
      'a3:48~', // 107
      'a3:48~', // 108
      'a3:36 r:12', // 109
      ...rests(17), // 110–126
      'f3:24 r', // 127
      ...rests(4), // 128–131
      'r:18 e3:6 e3:24~', // 132
      'e3:24 r', // 133
    ] },
    { name: 'Pedal', manual: 4, from: 2, bars: [
      'r:24 d2~', // 2
      'd2:24 r', // 3
      ...rests(6), // 4–9
      'r:24 d2~', // 10
      'd2:12 r:36', // 11
      'd2:12 r:36', // 12
      ...rests(3), // 13–15
      'r:30 d3:6 c3 bb2', // 16
      'a2:6 r:24 d3:6 c3 bb2', // 17
      'a2:12 r:36', // 18
      'r:18 d3:6 c3 bb2 a2 r', // 19
      'r:18 d3:6 c3 bb2 a2 g#2', // 20
      'g2:12 r:36', // 21
      'g3:24 r', // 22
      ...rests(4), // 23–26
      'r:24 g3:12 f3', // 27
      'bb3:18 a3:3 g3 a3:9 e3:3 f3 d3 e3 c#3', // 28
      'd3:3 b2 c#3 a2 bb2 g#2 a2 g3 f3:6 d3 a2:12', // 29
      'd2:24 r', // 30
      ...rests(21), // 31–51
      'r:3 d3 c3 d3 bb2 d3 a2 d3 g2 d3 f#2 d3 g2 d3 a2 d3', // 52
      'bb2:3 d3 d2 d3 e2 d3 f#2 d3 g2 d3 f#2 d3 g2 d3 a2 d3', // 53
      'bb2:12 r:6 b2 c3:12 r:6 c#3', // 54
      'd3:12 r:6 d3 e3:12 r:6 e3', // 55
      'f3:6 a2 bb2 d3 g2:12 r:6 bb2~', // 56
      'bb2:6 a2 g2 c3 f2:12 r', // 57
      ...rests(28), // 58–85
      'r:27 g3:3 f3 g3 eb3 g3 d3 g3', // 86
      'c3:3 g3 b2 g3 c3 g3 d3 g3 eb3 g3 g2 g3 a2 g3 b2 g3', // 87
      'c3:3 g3 b2 g3 c3 g3 d3 g3 eb3:6 d3 c3 b2', // 88
      'c3:6 d3 eb3 f3 g3 b2 c3 d3', // 89
      'eb3:6 d3 eb3 f3 g3 b2 c3 d3', // 90
      'eb3:6 a2 bb2 c3 d3 g2 a2 bb2', // 91
      'c3:6 d3 g3 d3 eb3 bb2 a2 c3', // 92
      'd3:48~', // 93
      'd3:48~', // 94
      'd3:12 r:6 g2 c3 a2 d3 d2', // 95
      'g2:12 r:6 g2 c3:18 b2:6', // 96
      'c3:12 r:36', // 97
      ...rests(11), // 98–108
      'r:27 a3:3 g3 a3 f3 a3 e3 a3', // 109
      'd3:3 a3 c#3 a3 d3 a3 e3 a3 f3 a3 a2 a3 b2 a3 c#3 a3', // 110
      'd3:3 a3 c#3 a3 d3 a3 e3 a3 f3:12 r:6 f3', // 111
      'g3:6 e3 a3 a2 d3:12 r:6 a2', // 112
      'bb2:6 g2 c3 c2 f2:12 r:6 a2', // 113
      'bb2:12 r:6 bb2 c3:12 r:6 a2', // 114
      'd3:12 r d3 r', // 115
      'd3:12 r d3 r', // 116
      'd3:12 r d3 r', // 117
      'd3:12 r d3 r', // 118
      'd3:12 r d3 r', // 119
      'r:3 d3 c3 d3 bb2 d3 a2 d3 g2 g3 f3 g3 eb3 g3 d3 g3', // 120
      'c3:3 c3 bb2 c3 a2 c3 g2 c3 f2 f3 eb3 f3 d3 f3 c3 f3', // 121
      'bb2:6 eb3 f3 f2 g2 c3 d3 d2', // 122
      'g2:12 r:3 a2 g2 a2 f2:6 d2 a2:12', // 123
      'd2:48~', // 124
      'd2:24 r:18 d3:6', // 125
      'a2:6 f2 g2 a2 f2 d2 g2 a2', // 126
      'bb2:24 r', // 127
      ...rests(2), // 128–129
      'c#3:24 f3:18 d3:6', // 130
      'g#2:24 r:3 g#3 b3 f3 g#3 d3 f3 b2', // 131
      'd3:3 g#2 a2:6 e2:36~', // 132
      'e2:24 r', // 133
      ...rests(2), // 134–135
      'r:42 e3:6', // 136
      'g3:6 r:12 g3:6 f3 r:12 f3:6', // 137
      'f3:6 r:12 f3:6 e3 r:12 e3:6', // 138
      'e3:6 r:12 e3:6 d3 r:12 d3:6', // 139
      'c#3:6 r:12 c#3:6 c3 r:12 c3:6', // 140
      'g2:12 bb2 e2 f2', // 141
      'a2:24 bb2:12 g2', // 142
      'd2+d3:48', // 143
    ] },
    // </generated-voices>
  ],
};

/** The built-in pieces, in menu order. */
export const PIECES = [BWV565];

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------
/** 'bar' | 'bar:at' -> [bar, at] */
const posKey = (k) => { const s = String(k).split(':'); return [+s[0], s.length > 1 ? +s[1] : 0]; };
const cmpPos = (a, b) => a[0] - b[0] || a[1] - b[1];
/** value of the last key at or before (bar, at) in a { 'bar' | 'bar:at': value } map */
const lastKeyAtOrBelow = (map, bar, dflt, at = 0) => {
  let v = dflt, best = null;
  for (const [k, x] of Object.entries(map || {})) { const p = posKey(k); if (cmpPos(p, [bar, at]) <= 0 && (!best || cmpPos(p, best) > 0)) { best = p; v = x; } }
  return v;
};
const voiceBar = (v, bar) => { const i = bar - (v.from || 1); return i >= 0 && i < v.bars.length ? v.bars[i] : null; };

/**
 * Time map over played positions (units from the start of the performance).
 * Returns { plan: [{ bar, p0, section, first }], T(p) -> seconds, end }.
 */
function timeMap(def) {
  const plan = [];
  let p = 0;
  for (const sec of def.form) for (let b = sec.from; b <= sec.to; b++) { plan.push({ bar: b, p0: p, section: sec, first: b === sec.from }); p += def.meter; }
  const end = p;
  const tempoKeys = Object.entries(def.tempo || {}).map(([k, v]) => ({ pos: posKey(k), v }));
  const holdKeys = Object.entries(def.holds || {}).map(([k, v]) => ({ pos: posKey(k), v }));
  // breakpoints: { p, bpm?: number | [a, b], hold?: s }
  const bps = [];
  for (const pl of plan) {
    if (pl.first) { const v = lastKeyAtOrBelow(def.tempo, pl.bar, def.bpm); bps.push({ p: pl.p0, bpm: Array.isArray(v) ? v[0] : v }); }
    for (const k of tempoKeys) if (k.pos[0] === pl.bar) bps.push({ p: pl.p0 + k.pos[1], bpm: k.v });
    for (const k of holdKeys) if (k.pos[0] === pl.bar) bps.push({ p: pl.p0 + k.pos[1], hold: k.v });
  }
  // a hold written as the first position after the last bar ('144:0') belongs to the end
  const lastBar = plan.length ? plan[plan.length - 1].bar : 0;
  for (const k of holdKeys) if (k.pos[0] === lastBar + 1 && k.pos[1] === 0) bps.push({ p: end, hold: k.v });
  bps.sort((a, b) => a.p - b.p || (a.bpm !== undefined ? -1 : 1));
  // segments [p0, p1) with linear bpm b0 -> b1
  const segs = [];
  const uSec = def.unit * 60;
  const integ = (b0, b1, len, x) => { // seconds for x units into a segment of len units, bpm b0 -> b1
    if (x <= 0) return 0;
    if (Math.abs(b1 - b0) < 1e-9 || len <= 0) return (uSec * x) / b0;
    const k = (b1 - b0) / len;
    return (uSec / k) * Math.log((b0 + k * x) / b0);
  };
  // collect distinct positions
  const positions = [...new Set([0, ...bps.map((b) => b.p), end])].sort((a, b) => a - b);
  // tempo state: for each position, bpm in force (ramps resolved to the next tempo key)
  const tempoAt = []; // [{ p, v }] only tempo breakpoints
  for (const b of bps) if (b.bpm !== undefined) tempoAt.push({ p: b.p, v: b.bpm });
  const holdAt = new Map();
  for (const b of bps) if (b.hold) holdAt.set(b.p, (holdAt.get(b.p) || 0) + b.hold);
  const bpmAt = (x) => { // instantaneous bpm at x (ramps interpolated)
    let i = -1;
    for (let j = 0; j < tempoAt.length; j++) if (tempoAt[j].p <= x) i = j;
    if (i < 0) return def.bpm;
    const { p: p0, v } = tempoAt[i];
    if (!Array.isArray(v)) return v;
    const p1 = i + 1 < tempoAt.length ? tempoAt[i + 1].p : end;
    return p1 > p0 ? v[0] + ((v[1] - v[0]) * (x - p0)) / (p1 - p0) : v[0];
  };
  let t = START;
  for (let i = 0; i < positions.length; i++) {
    const p0 = positions[i];
    t += holdAt.get(p0) || 0;
    const p1 = i + 1 < positions.length ? positions[i + 1] : p0;
    const b0 = bpmAt(p0);
    const b1 = p1 > p0 ? bpmAt(p1 - 1e-9) : b0;
    segs.push({ p0, p1, b0, b1, t0: t });
    t += integ(b0, b1, p1 - p0, p1 - p0);
  }
  const T = (x) => {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].p0 <= x + 1e-9) lo = mid; else hi = mid - 1; }
    const s = segs[lo];
    return s.t0 + integ(s.b0, s.b1, s.p1 - s.p0, Math.min(x, s.p1) - s.p0);
  };
  return { plan, T, end };
}

/** def -> { score, duration, sections, timeAt } (score sorted by t). Throws on syntax errors (caught by checkPiece). */
export function compilePiece(def) {
  const ev = [];
  const { plan, T } = timeMap(def);
  const planIdx = new Map(plan.map((p, i) => [p.bar, i])); // first time each bar is played
  const timeAt = (bar, at = 0) => { const i = planIdx.get(bar); return i === undefined ? (bar === plan[plan.length - 1].bar + 1 && at === 0 ? T(plan.length * def.meter) : NaN) : T(plan[i].p0 + at); };
  const regEvent = (t, r) => { const reg = {}; if (r.on && r.on.length) reg.on = [...r.on]; if (r.off && r.off.length) reg.off = [...r.off]; if (r.swell) reg.swell = { ...r.swell }; ev.push({ t, dur: 0, reg }); };
  // registration changes
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (p.first && p.section.reg) regEvent(T(p.p0), p.section.reg);
    for (const c of def.changes || []) {
      if (c.bar !== p.bar) continue;
      const t = T(p.p0 + (c.at || 0));
      if (c.on || c.off || c.swell) regEvent(t, c);
      if (c.piston) ev.push({ t, dur: 0, piston: c.piston });
      if (c.ramp) {
        const { id, from, to, bars } = c.ramp;
        const t1 = T(Math.min(plan.length * def.meter, p.p0 + (c.at || 0) + bars * def.meter));
        const steps = Math.max(1, Math.round(bars * 4));
        for (let k = 0; k <= steps; k++) regEvent(t + ((t1 - t) * k) / steps, { swell: { [id]: Math.round((from + ((to - from) * k) / steps) * 1000) / 1000 } });
      }
    }
  }
  // notes, voice by voice; ties carry over bar lines
  const orn = def.ornament || {};
  const maxGap = def.maxGap ?? Infinity;
  const arpPos = new Map((def.arpeggios || []).map((a) => [`${a.bar}:${a.at}`, a]));
  const arpGroups = new Map();
  for (const v of def.voices) {
    const art = v.art ?? 0.92;
    let tied = new Map(); // midi -> open note
    const gapOf = (seg, stacc) => (stacc ? seg * 0.5 : Math.min(maxGap, Math.max(0.025, seg * (1 - art))));
    const close = (n) => {
      const seg = n.lastSeg;
      const gap = Math.min(gapOf(seg, n.stacc), seg * 0.6);
      const end = n.end;
      n.dur = Math.max(0.03, end - n.t - gap);
      if (n.orn) expand(n, end, gap);
      delete n.end; delete n.lastSeg; delete n.stacc; delete n.orn;
    };
    const expand = (n, end, gap) => {
      const { kind, aux } = n.orn;
      const total = end - n.t;
      if (kind === 'm') {
        const d = Math.min(orn.mordent ?? 0.075, total / 4);
        n.dur = d * 0.85;
        ev.push({ t: n.t + d, dur: d * 0.85, midi: aux, manual: n.manual });
        ev.push({ t: n.t + 2 * d, dur: Math.max(0.03, total - 2 * d - gap), midi: n.midi, manual: n.manual });
      } else {
        let count = Math.max(2, Math.floor(total / (orn.trill ?? 0.09)));
        if (count % 2) count--;
        const L = total / count;
        n.midi = aux; n.dur = L * 0.85; // the trill starts on the auxiliary
        for (let k = 1; k < count; k++) {
          const last = k === count - 1;
          ev.push({ t: n.t + k * L, dur: last ? Math.max(0.03, L - Math.min(gap, L * 0.5)) : L * 0.85, midi: k % 2 ? n.mainMidi : aux, manual: n.manual });
        }
      }
      delete n.mainMidi;
    };
    const open = [];
    for (const pl of plan) {
      const str = voiceBar(v, pl.bar);
      if (str === null) { for (const n of tied.values()) close(n); tied = new Map(); continue; }
      let u = 0;
      for (const tok of parseBar(str)) {
        const t = T(pl.p0 + u), tEnd = T(pl.p0 + u + tok.dur);
        const d = tEnd - t;
        const manual = lastKeyAtOrBelow(v.manualFrom, pl.bar, v.manual, u);
        const next = new Map();
        if (tok.pitches) {
          for (const m of tok.pitches) {
            let n = tied.get(m);
            if (n && n.manual === manual) { n.end = tEnd; n.lastSeg = d; n.stacc = tok.stacc; tied.delete(m); } else {
              n = { t, dur: 0, midi: m, manual, end: tEnd, lastSeg: d, stacc: tok.stacc };
              if (tok.orn) { n.orn = tok.orn; n.mainMidi = m; }
              ev.push(n); open.push(n);
              const a = arpPos.get(`${pl.bar}:${u}`);
              if (a && manual < 4) (arpGroups.get(a) || arpGroups.set(a, []).get(a)).push(n);
            }
            if (tok.tie) next.set(m, n); else close(n);
          }
        }
        for (const n of tied.values()) close(n); // a tie that found no continuation ends here
        tied = next;
        u += tok.dur;
      }
    }
    for (const n of tied.values()) close(n);
    for (const n of open) if ('end' in n) close(n);
  }
  // arpeggios: roll upwards, keep the ends
  for (const [a, list] of arpGroups) {
    list.sort((x, y) => x.midi - y.midi || x.manual - y.manual);
    list.forEach((n, k) => { const sh = k * a.step; n.t += sh; n.dur = Math.max(0.05, n.dur - sh); });
  }
  // unisons on one key of one manual: play once
  const byKey = new Map();
  for (const e of ev) if (e.dur > 0) { const k = e.manual * 128 + e.midi; (byKey.get(k) || byKey.set(k, []).get(k)).push(e); }
  const drop = new Set();
  let unisons = 0;
  for (const list of byKey.values()) {
    list.sort((a, b) => a.t - b.t || b.dur - a.dur);
    let prev = null;
    for (const e of list) {
      if (prev && e.t < prev.t + prev.dur - 1e-9) {
        unisons++;
        const endMax = Math.max(prev.t + prev.dur, e.t + e.dur);
        if (e.t - prev.t < 0.03) { prev.dur = endMax - prev.t; drop.add(e); continue; }
        prev.dur = Math.max(0.03, e.t - prev.t - 0.03);
        e.dur = endMax - e.t;
      }
      prev = e;
    }
  }
  const score = drop.size ? ev.filter((e) => !drop.has(e)) : ev;
  score.sort((a, b) => a.t - b.t || (a.dur === 0 ? -1 : 0) - (b.dur === 0 ? -1 : 0));
  let duration = 0;
  for (const e of score) duration = Math.max(duration, e.t + e.dur);
  const sections = (def.sections || []).map((s) => ({ ...s, time: timeAt(s.bar, s.at || 0) }));
  (def.sections || []).forEach((s, i) => { s.time = sections[i].time; });
  return { score, duration, sections, timeAt, unisons };
}

/** Initial registration snapshot of a piece for the demo player. */
export const pieceRegistration = (def) => ({
  stops: [...def.registration.stops], couplers: [...def.registration.couplers], tremulants: [...(def.registration.tremulants || [])], swell: { ...(def.registration.swell || {}) },
});

/** Written notes of a piece (ties merged): [{ voice, bar, at, dur (units), midi, orn? }] — for tests. */
export function writtenNotes(def) {
  const out = [];
  for (const v of def.voices) {
    let tied = new Map();
    for (let i = 0; i < v.bars.length; i++) {
      const bar = (v.from || 1) + i;
      let u = 0;
      for (const tok of parseBar(v.bars[i])) {
        const next = new Map();
        for (const m of tok.pitches || []) {
          let n = tied.get(m);
          if (n) { n.dur += tok.dur; tied.delete(m); } else { n = { voice: v.name, bar, at: u, dur: tok.dur, midi: m }; if (tok.orn) n.orn = { ...tok.orn }; if (tok.stacc) n.stacc = true; out.push(n); }
          if (tok.tie) next.set(m, n);
        }
        tied = next;
        u += tok.dur;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sanity checks (used by the tests; also handy when correcting the data)
// ---------------------------------------------------------------------------
const STOP_IDS = new Set(STOPS.map((s) => s.id));
const COUPLER_IDS = new Set(COUPLERS.map((c) => c.id));
const TREM_IDS = new Set(ACCESSORIES.filter((a) => a.kind === 'tremulant').map((a) => a.id));
const SWELL_IDS = new Set(ACCESSORIES.filter((a) => a.kind === 'swell-pedal').map((a) => a.id));
const PISTON_IDS = new Set(ACCESSORIES.filter((a) => a.kind !== 'tremulant' && a.kind !== 'swell-pedal').map((a) => a.id));
const isRegId = (id) => STOP_IDS.has(id) || COUPLER_IDS.has(id) || TREM_IDS.has(id);

/** Returns { ok, problems: [string], stats } for a piece definition. */
export function checkPiece(def) {
  const problems = [];
  const P = (m) => problems.push(`${def.id}: ${m}`);
  const allowed = new Set([...def.scale, ...Object.keys(def.accidentals || {})].map(pcOf));
  const stats = { bars: 0, notes: 0, voices: {} };
  // ids
  const reg = def.registration;
  for (const id of reg.stops) if (!STOP_IDS.has(id)) P(`unbekanntes Register ${id}`);
  for (const id of reg.couplers) if (!COUPLER_IDS.has(id)) P(`unbekannte Koppel ${id}`);
  for (const id of reg.tremulants || []) if (!TREM_IDS.has(id)) P(`unbekannter Tremulant ${id}`);
  for (const id of Object.keys(reg.swell || {})) if (!SWELL_IDS.has(id)) P(`unbekannter Schweller ${id}`);
  const changeSets = [...(def.changes || []), ...def.form.filter((s) => s.reg).map((s) => s.reg)];
  for (const c of changeSets) {
    for (const id of [...(c.on || []), ...(c.off || [])]) if (!isRegId(id)) P(`unbekannte Id in Registrierwechsel: ${id}`);
    for (const id of Object.keys(c.swell || {})) if (!SWELL_IDS.has(id)) P(`unbekannter Schweller ${id}`);
    if (c.ramp && !SWELL_IDS.has(c.ramp.id)) P(`unbekannter Schweller ${c.ramp.id}`);
    if (c.piston && !PISTON_IDS.has(c.piston)) P(`unbekannter Kolben ${c.piston}`);
  }
  // tempo, holds
  if (!(def.bpm >= def.tempoRange[0] && def.bpm <= def.tempoRange[1])) P(`Tempo ${def.bpm} außerhalb ${def.tempoRange}`);
  for (const v of Object.values(def.tempo || {})) for (const x of [].concat(v)) if (!(x >= 20 && x <= def.tempoRange[1])) P(`Tempowechsel ${x} unplausibel`);
  for (const [k, s] of Object.entries(def.holds || {})) if (!(s > 0 && s <= 5) || !Number.isFinite(posKey(k)[1])) P(`Halt ${k}: ${s} s unplausibel`);
  // bars: syntax, length, pitch classes, compass
  const played = new Set(def.form.flatMap((s) => Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i)));
  stats.bars = def.form.reduce((a, s) => a + s.to - s.from + 1, 0);
  for (const v of def.voices) {
    let lo = Infinity, hi = -Infinity;
    v.bars.forEach((str, i) => {
      const bar = (v.from || 1) + i;
      if (!played.has(bar)) P(`${v.name} T. ${bar} wird nie gespielt`);
      let toks;
      try { toks = parseBar(str); } catch (err) { P(`${v.name} T. ${bar}: ${err.message}`); return; }
      const sum = toks.reduce((a, t) => a + t.dur, 0);
      if (Math.abs(sum - def.meter) > 1e-9) P(`${v.name} T. ${bar}: ${sum} statt ${def.meter} Einheiten`);
      let u = 0;
      for (const t of toks) {
        const man = lastKeyAtOrBelow(v.manualFrom, bar, v.manual, u);
        const [mn, mx] = MANUAL_RANGE[man];
        for (const m of [...(t.pitches || []), ...(t.orn ? [t.orn.aux] : [])]) {
          if (!allowed.has(m % 12)) P(`${v.name} T. ${bar}: ${nameOf(m, true)} nicht in der Tonart`);
          if (m < mn || m > mx) P(`${v.name} T. ${bar}: ${nameOf(m, true)} außerhalb des Umfangs von Manual ${man}`);
          lo = Math.min(lo, m); hi = Math.max(hi, m);
        }
        u += t.dur;
      }
    });
    stats.voices[v.name] = { lo, hi, span: hi - lo };
    if (v.melody && hi - lo > 31) P(`${v.name}: Umfang ${hi - lo} Halbtöne unplausibel`);
  }
  // compiled score: compass, overlaps on one key, durations
  let compiled;
  try { compiled = compilePiece(def); } catch (err) { P(`Übersetzung: ${err.message}`); return { ok: false, problems, stats }; }
  const byKey = new Map();
  for (const e of compiled.score) {
    if (e.dur === 0) continue;
    stats.notes++;
    if (!(e.dur > 0)) P(`Note ohne Dauer bei ${e.t.toFixed(2)} s`);
    const k = `${e.manual}:${e.midi}`;
    (byKey.get(k) || byKey.set(k, []).get(k)).push(e);
  }
  for (const [k, list] of byKey) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 1; i < list.length; i++) if (list[i].t < list[i - 1].t + list[i - 1].dur - 1e-9) P(`Überlappung auf ${k} bei ${list[i].t.toFixed(2)} s`);
  }
  stats.duration = compiled.duration;
  stats.unisons = compiled.unisons;
  return { ok: problems.length === 0, problems, stats };
}
