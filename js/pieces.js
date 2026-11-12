// Built-in demo pieces (public domain, all composers dead > 70 years) as
// compact, proof-readable note data plus a small compiler into the demo
// player's score format [{ t, dur, midi, manual } | { t, dur: 0, reg } | { t, dur: 0, piston }].
// Pure module (no DOM, no audio); validated in the node tests.
//
// Every piece is an EXCERPT ("Ausschnitt"). Pachelbel and Bach BWV 147 are NOTE-FAITHFUL
// transcriptions of a named, freely licensed text source (URL + licence in the comment
// above each piece and in its `source` field; the node tests compare the voices with note
// lists extracted from that source); their only liberties (manual assignment, the cut,
// at most a held final chord) are listed there. Elgar and Clarke follow a transcription
// for melody (and alto/harmony) only; the per-piece comments say what is simplified or added.
//
// ---- note syntax (one string per bar, comments mark bar numbers) -----------
//   token   = pitch[+pitch…][:dur][suffix]       e.g.  d5:4  f#5:3  g4+b4+d5:8  r:6
//   pitch   = letter [# | b] octave              c4 = middle C = MIDI 60; bb3 = B♭3, f#5 = F♯5
//   r       = rest
//   dur     = length in the piece's `unit` (fraction of a crotchet beat); omitted = previous
//             token's length in the same bar (the first token of a bar needs one)
//   suffix  = '  staccato (sounds half the value)      ~  tie into the next token with the same pitch
// Every bar of every voice must add up to `meter` units (checked by checkPiece).
//
// ---- piece fields ----------------------------------------------------------
//   unit, meter            unit in crotchets; units per bar
//   bpm, tempo             crotchets per minute; { bar: bpm } changes from that bar on (ritardando)
//   tempoRange             [lo, hi] plausible main tempo (sanity check)
//   scale, accidentals     allowed pitch classes; accidentals = { pc: 'reason' } deliberate chromatics
//   form                   [{ from, to, reg? }] bars to play in order (repeats = listed twice)
//   registration           { stops, couplers, tremulants, swell: { pedalId: 0..1 } } at the start
//   changes                [{ bar, at?, on?, off?, swell?, ramp?: { id, from, to, bars } }]
//                          applied every time that bar is played; at = offset in units
//   voices                 [{ name, manual, from?, art?, melody?, manualFrom?: { bar: manual }, bars: [...] }]

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

/** One bar string -> [{ pitches: [midi…] | null (rest), dur, stacc, tie }]; throws on syntax errors. */
export function parseBar(str) {
  const out = [];
  let last = null;
  for (const tok of String(str).trim().split(/\s+/).filter(Boolean)) {
    const m = /^([^:'~]+)(?::(\d+(?:\.\d+)?))?(['~]*)$/.exec(tok);
    if (!m) throw new Error(`Token „${tok}“ unlesbar`);
    const dur = m[2] !== undefined ? +m[2] : last;
    if (!(dur > 0)) throw new Error(`Token „${tok}“ ohne Dauer`);
    last = dur;
    const rest = m[1] === 'r';
    const pitches = rest ? null : m[1].split('+').map(pitch);
    if (pitches && pitches.some((p) => !Number.isFinite(p))) throw new Error(`Tonhöhe in „${tok}“ unlesbar`);
    out.push({ pitches, dur, stacc: m[3].includes("'"), tie: m[3].includes('~') });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Johann Pachelbel (1653–1706): Canon (from "Canon and Gigue in D", P. 37), D major, 4/4.
//    SOURCE (note-faithful): the LilyPond <score> example in the English Wikipedia article
//    "Pachelbel's Canon", section "Analysis" (revision 1384536400, 8 Nov 2026):
//      https://en.wikipedia.org/w/index.php?title=Pachelbel%27s_Canon&oldid=1384536400#Analysis
//    Licence of the example: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0),
//    © the Wikipedia contributors; the music itself is public domain.
//    Taken over EXACTLY (pitch and rhythm, bars 1–10): Violin I, II, III (strict canon at two
//    bars: crotchet variation, quaver variation, Violin I's next two bars) and the cello's
//    ground bass D A B F♯ G D G A. The example's chord symbols (only bars 1–2) are not used.
//    LIBERTIES: voice-to-manual assignment (Violin I Solo, II Swell, III Great, cello in the
//    pedal at written pitch, i.e. 16′ + 8′); the cut after bar 10 with ONE added held final
//    chord (bar 11: d′′ / f♯′ / d′ over D, each canon voice resolving by step); ritardando in
//    bars 10–11; registration build-up. Semiquaver unit, crotchet 62 (the example: 56).
// ---------------------------------------------------------------------------
const PACHELBEL = {
  id: 'pachelbel', composer: 'Johann Pachelbel', dates: '1653–1706',
  title: 'Pachelbel: Kanon D-Dur',
  subtitle: 'Johann Pachelbel (1653–1706) · Kanon aus „Canon und Gigue“ D-Dur, Takte 1–10 · Ausschnitt · notengetreu nach Wikipedia-Notenbeispiel (CC BY-SA 4.0)',
  source: {
    url: 'https://en.wikipedia.org/w/index.php?title=Pachelbel%27s_Canon&oldid=1384536400#Analysis',
    licence: 'CC BY-SA 4.0', credit: 'Wikipedia-Autoren, Artikel „Pachelbel’s Canon“ (Notenbeispiel, LilyPond)', short: 'Wikipedia-Notenbeispiel (CC BY-SA 4.0)',
  },
  key: 'D-Dur', unit: 0.25, meter: 16, bpm: 62, tempoRange: [56, 63], tempo: { 10: 58, 11: 48 },
  scale: ['d', 'e', 'f#', 'g', 'a', 'b', 'c#'], accidentals: {},
  form: [{ from: 1, to: 11 }],
  registration: {
    stops: ['solo-harmonic-claribel-flute', 'swell-salicional', 'great-hohl-flute', 'pedal-sub-bass', 'pedal-flute'],
    couplers: [], tremulants: [],
    swell: { 'swell-swell-pedal': 0.5, 'solo-swell-pedal': 0.6 },
  },
  changes: [
    // quaver variation: Swell flute joins the strings, Swell box opens gently
    { bar: 7, on: ['swell-claribel-flute'], ramp: { id: 'swell-swell-pedal', from: 0.5, to: 0.85, bars: 4 } },
    // third pair of bars: 4′ flute on the Solo, 8′ string in the pedal
    { bar: 9, on: ['solo-flauto-traverso', 'pedal-violoncello'], swell: { 'solo-swell-pedal': 0.8 } },
  ],
  voices: [
    {
      name: 'Violine I (Solo)', manual: 3, from: 3, art: 0.94, melody: true,
      bars: [
        'f#5:4 e5:4 d5:4 c#5:4', //                        3  crotchet variation
        'b4:4 a4:4 b4:4 c#5:4', //                         4
        'd5:4 c#5:4 b4:4 a4:4', //                         5
        'g4:4 f#4:4 g4:4 e4:4', //                         6
        'd4:2 f#4:2 a4:2 g4:2 f#4:2 d4:2 f#4:2 e4:2', //   7  quaver variation
        'd4:2 b3:2 d4:2 a4:2 g4:2 b4:2 a4:2 g4:2', //      8
        'f#4:2 d4:2 e4:2 c#5:2 d5:2 f#5:2 a5:2 a4:2', //   9
        'b4:2 g4:2 a4:2 f#4:2 d4:2 d5:2 d5:3 c#5:1', //    10
        'd5:16', //                                        11 added final chord
      ],
    },
    {
      name: 'Violine II (Swell)', manual: 2, from: 5, art: 0.94,
      bars: [
        'f#5:4 e5:4 d5:4 c#5:4', 'b4:4 a4:4 b4:4 c#5:4', 'd5:4 c#5:4 b4:4 a4:4', 'g4:4 f#4:4 g4:4 e4:4', //  5–8
        'd4:2 f#4:2 a4:2 g4:2 f#4:2 d4:2 f#4:2 e4:2', 'd4:2 b3:2 d4:2 a4:2 g4:2 b4:2 a4:2 g4:2', //          9–10
        'f#4:16', //                                                                                           11
      ],
    },
    {
      name: 'Violine III (Great)', manual: 1, from: 7, art: 0.94,
      bars: ['f#5:4 e5:4 d5:4 c#5:4', 'b4:4 a4:4 b4:4 c#5:4', 'd5:4 c#5:4 b4:4 a4:4', 'g4:4 f#4:4 g4:4 e4:4', 'd4:16'], // 7–11
    },
    {
      name: 'Bass (Pedal)', manual: 4, art: 0.9,
      bars: [
        ...Array.from({ length: 5 }, () => ['d3:4 a2:4 b2:4 f#2:4', 'g2:4 d2:4 g2:4 a2:4']).flat(), // 1–10 ground bass, five times
        'd3:16', //                                                                                   11
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Johann Sebastian Bach (1685–1750): "Jesus bleibet meine Freude", chorale movement of
//    Cantata BWV 147 (no. 10; = no. 6), G major, 9/8.
//    SOURCE (note-faithful): Open Hymnal Project, "Jesus, Joy of Man's Desiring", 2005 edition,
//    setting "Johann Sebastian Bach, 1723, alt. Brian J. Dumont, 2005" (choir + keyboard
//    reduction), file declared "copyright: public domain. Arrangement released into public
//    domain 09 June 2005" (ABC text):
//      https://github.com/mzealey/openhymnal/blob/d35811b2d5c9b0bbc5887d60a2936454815416e8/Choir/JesuJoyOfMansDesiring/JesuJoyOfMansDesiring.abc
//      (mirror of openhymnal.org). The source notates the 9/8 in 9/4 (L:1/4): ONE UNIT HERE =
//      one source crotchet = one triplet quaver; bpm counts dotted crotchets of the 9/8 bar.
//    Taken over EXACTLY (pitch and rhythm): bars 1–8 ritornello (triplet line = "Piano" treble
//    voice 1, bass = "Piano" bass), bars 9–16 the first two chorale lines ("Jesus, joy of man's
//    desiring" / "Holy wisdom, love most bright") with all four choir voices, the interlude
//    triplets bars 12–13 and the bass throughout; bar 17 = the chorale's closing chord.
//    LIBERTIES: voice-to-manual assignment (triplets Swell 8′+4′ flutes; chorale soprano =
//    top note of the source's choir voice S1V1 on the Solo Hautboy; alto = rest of S1V1 + S1V2
//    on the Choir; tenor/choir bass = S2V1 + S2V2 on the Great; bass in the pedal 16′ + 8′ at
//    written pitch); unisons of S2V1 and S2V2 (same key, same onset; bars 11, 16) are played
//    once, as they share the Great; the
//    source's keyboard doubling of the choir in bars 9–11 and 14–16 (treble voices 1 and 2) is
//    left out; the cut: in bar 17 only the choir's chord sounds, the pedal holds G (source:
//    G G′ E, the ritornello starting again), ritardando in bars 16–17.
// ---------------------------------------------------------------------------
const BWV147 = {
  id: 'bwv147', composer: 'Johann Sebastian Bach', dates: '1685–1750',
  title: 'Bach: Jesus bleibet meine Freude (BWV 147)',
  subtitle: 'Johann Sebastian Bach (1685–1750) · „Jesus bleibet meine Freude“ aus der Kantate BWV 147: Ritornell und erste zwei Choralzeilen · Ausschnitt · notengetreu nach Open Hymnal (gemeinfrei)',
  source: {
    url: 'https://github.com/mzealey/openhymnal/blob/d35811b2d5c9b0bbc5887d60a2936454815416e8/Choir/JesuJoyOfMansDesiring/JesuJoyOfMansDesiring.abc',
    licence: 'gemeinfrei (Public Domain)', credit: 'Open Hymnal Project (openhymnal.org), Satz „J. S. Bach, alt. Brian J. Dumont, 2005“', short: 'Open Hymnal (gemeinfrei)',
  },
  key: 'G-Dur', unit: 1 / 3, meter: 9, bpm: 76, tempoRange: [63, 80], tempo: { 16: 68, 17: 50 },
  scale: ['g', 'a', 'b', 'c', 'd', 'e', 'f#'], accidentals: { 'c#': 'chromatischer Durchgang im Bass c–cis–d (Takt 7)' },
  form: [{ from: 1, to: 17 }],
  registration: {
    stops: [
      'swell-claribel-flute', 'swell-harmonic-flute', // triplets 8′ + 4′
      'solo-hautboy', //                                  chorale melody
      'choir-lieblich-gedeckt', 'choir-dulciana', //     alto
      'great-hohl-flute', 'great-viola-da-gamba', //     tenor and choir bass
      'pedal-sub-bass', 'pedal-flute', //                bass 16′ + 8′
    ],
    couplers: [], tremulants: [],
    swell: { 'swell-swell-pedal': 0.7, 'solo-swell-pedal': 0.8 },
  },
  changes: [
    // chorale enters: Swell box a little closed, the bass gets an 8′ string
    { bar: 9, on: ['pedal-violoncello'], swell: { 'swell-swell-pedal': 0.55 } },
  ],
  voices: [
    {
      name: 'Choral (Solo)', manual: 3, from: 9, art: 0.95, melody: true,
      bars: [
        'b4:6 c5:3', 'd5:6 d5:3', 'c5:6 b4:3', 'a4:3 a4:6', 'r:9', //            9–13  Jesus, joy of man's desiring
        'b4:6 c5:3', 'd5:6 b4:3', 'a4:1.5 b4:0.75 c5:0.75 b4:3 a4:3', //         14–16 holy wisdom, love most bright
        'g4:6~ g4:3', //                                                          17
      ],
    },
    {
      name: 'Triolen (Swell)', manual: 2, art: 0.9,
      bars: [
        'r:1 g4:1 a4:1 b4:1 d5:1 c5:1 c5:1 e5:1 d5:1', //     1
        'd5:1 g5:1 f#5:1 g5:1 d5:1 b4:1 g4:1 a4:1 b4:1', //   2
        'c5:1 d5:1 e5:1 d5:1 c5:1 b4:1 a4:1 b4:1 g4:1', //    3
        'f#4:1 g4:1 a4:1 d4:1 f#4:1 a4:1 c5:1 b4:1 a4:1', //  4
        'b4:1 g4:1 a4:1 b4:1 d5:1 c5:1 c5:1 e5:1 d5:1', //    5
        'd5:1 g5:1 f#5:1 g5:1 d5:1 b4:1 g4:1 a4:1 b4:1', //   6
        'e4:1 d5:1 c5:1 b4:1 a4:1 g4:1 d4:1 g4:1 f#4:1', //   7
        'g4:1 b4:1 d5:1 g5:1 d5:1 b4:1 g4:1 b4:1 d5:1', //    8
        'r:9', 'r:9', 'r:9', //                               9–11 (source: keyboard doubles the choir)
        'f#4+a4:1 d4:1 e4:1 f#4:1 a4:1 g4:1 a4:1 c5:1 b4:1', // 12 interlude
        'c5:1 a4:1 f#4:1 d4:1 f#4:1 a4:1 c5:1 b4:1 a4:1', //  13
      ],
    },
    {
      name: 'Alt (Choir)', manual: 0, from: 9, art: 0.95,
      bars: ['g4:6 g4:3', 'a4:3 g4:3 f#4:3', 'g4:3 d4:3 b4:3', 'd4:3 d4:6', 'r:9', 'g4:6 g4:3', 'g4:3 d4:3 e4:3', 'e4:3 f#4:3 f#4:3', 'd4:6~ d4:3'], // 9–17
    },
    {
      name: 'Tenor (Great)', manual: 1, from: 9, art: 0.95,
      bars: ['d4:6 e4:3', 'a3:6 b3:3', 'b3:3 a3:3 g3:3', 'f#3:3 f#3:6', 'r:9', 'd4:6 e4:3', 'd4:6 g3:3', 'c4:1.5 a3:1.5 d4:1.5 b3:1.5 c4:3', 'g3+b3:6~ g3+b3:3'], // 9–17
    },
    {
      name: 'Chorbass (Great)', manual: 1, from: 9, art: 0.95,
      bars: ['g3:3 f#3:3 e3:3', 'f#3:3 e3:3 d3:3', 'e3:3 f#3:3 r:3', 'd3:3 d3:6', 'r:9', 'g3:3 f#3:3 e3:3', 'b3:3 b2:3 e3:3', 'c3:1.5 r:1.5 c3:1.5 r:1.5 d3:3'], // 9–16
    },
    {
      name: 'Bass (Pedal)', manual: 4, art: 0.9,
      bars: [
        'g2:3 g3:3 e3:3', 'b2:3 e3:3 e2:3', 'a2:3 b2:3 c3:3', 'd3:3 f#3:3 d3:3', //                    1–4
        'g3:3 e3:3 c3:3', 'g2:3 e3:3 d3:3', 'c3:3 c#3:3 d3:3', 'g2:4~ g2:1 g3:1 e3:2 b2:1', //         5–8
        'g2:3 f#3:3 e3:3', 'f#3:3 e3:3 d3:3', 'e3:3 f#3:3 g3:3', 'd3:3 d3:2 d3:1 d3:2 d3:1', //        9–12
        'd2:3 r:2 d3:1 d3:2 d3:1', 'g3:3 f#3:3 e3:3', 'b2:3 b2:3 e3:3', 'c3:3 d3:3 d3:3', //          13–16
        'g2:9', //                                                                                      17 held (cut)
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Edward Elgar (1857–1934): Pomp and Circumstance March No. 1, Op. 39/1 — the Trio
//    tune ("Land of Hope and Glory"), one statement in G major (the trio's key), 2/4,
//    crotchet ≈ 70, broadening at the end. Melody and its rhythm as commonly
//    transcribed; the second half lies an octave higher (as in the reprise).
//    The harmony follows the tune's standard chords with Elgar's stepwise
//    descending bass; inner voices are SIMPLIFIED to two- and three-part chords.
//    Bars 1–18 = the tune up to "make thee mightier", bars 19–21 = the final
//    cadence (the first-time ending is left out).
// ---------------------------------------------------------------------------
const ELGAR = {
  id: 'elgar1', composer: 'Edward Elgar', dates: '1857–1934',
  title: 'Elgar: Pomp and Circumstance Nr. 1 – Trio',
  subtitle: 'Edward Elgar (1857–1934) · Op. 39/1, Trio-Melodie („Land of Hope and Glory“) · Ausschnitt · Melodie und Harmonien nach Transkription, Mittelstimmen vereinfacht · Diapasons, Schluss mit Tubas',
  key: 'G-Dur', unit: 0.25, meter: 8, bpm: 70, tempoRange: [66, 72], tempo: { 17: 66, 19: 60, 20: 54, 21: 40 },
  scale: ['g', 'a', 'b', 'c', 'd', 'e', 'f#'], accidentals: { 'c#': 'A7 = Dominante zur Dominante (Takte 5, 7, 13)' },
  form: [{ from: 1, to: 21 }],
  registration: {
    stops: [
      'great-open-diapason-2', 'great-open-diapason-3', 'great-octave',
      'swell-open-diapason', 'swell-claribel-flute', 'swell-principal', 'swell-oboe',
      'pedal-open-wood-ii', 'pedal-sub-bass', 'pedal-violone', 'pedal-principal',
    ],
    couplers: ['swell-to-great', 'swell-to-pedal', 'great-to-pedal'], tremulants: [],
    swell: { 'swell-swell-pedal': 0.6 },
  },
  changes: [
    { bar: 9, on: ['great-open-diapason-1', 'great-principal', 'pedal-open-diapason-ii'], swell: { 'swell-swell-pedal': 0.85 } },
    { bar: 17, on: ['solo-to-great', 'bombard-tuba', 'great-super-octave', 'swell-trumpet', 'pedal-trombone', 'pedal-open-wood-i'], swell: { 'swell-swell-pedal': 1, 'solo-swell-pedal': 1 } },
    { bar: 19, on: ['bombard-tuba-mirabilis', 'pedal-ophicleide'] },
  ],
  voices: [
    {
      name: 'Melodie', manual: 1, art: 0.95, melody: true,
      bars: [
        'g4:4 f#4:1 g4:1 a4:2', //  1  Land of hope and
        'e4:4 d4:4', //             2  glo-ry
        'c4:4 b3:1 c4:1 d4:2', //   3
        'a3:8', //                  4
        'b3:4 c#4:1 d4:2 e4:1', //  5
        'a4:4 d4:4', //             6
        'g4:4 g4:1 f#4:2 e4:1', //  7
        'd4:8', //                  8
        'g5:4 f#5:1 g5:1 a5:2', //  9  (an octave higher)
        'e5:4 d5:4', //             10
        'c5:4 b4:1 c5:1 d5:2', //   11
        'a4:8', //                  12
        'b4:4 c#5:1 d5:2 e5:1', //  13
        'a5:4 d5:4', //             14
        'c6:4 c6:1 b5:2 a5:1', //   15
        'b5:8', //                  16
        'e5:4 f#5:1 g5:2 a5:1', //  17 (Tubas)
        'd5:4 g5:4', //             18
        'g5:8', //                  19 final cadence
        'c6:2 b5:4 a5:2', //        20
        'g5:8', //                  21
      ],
    },
    {
      name: 'Altstimme', manual: 1, from: 9, art: 0.95,
      bars: ['d5:4 c5:4', 'b4:8', 'g4:8', 'e4:4 f#4:4', 'g4:8', 'f#5:4 b4:4', 'e5:4 f#5:4', 'g5:8', 'c5:8', 'b4:8', 'e5:8', 'f#5:8', 'd5:8'], // 9–21
    },
    {
      name: 'Begleitung (Swell)', manual: 2, art: 0.93,
      bars: [
        'b3+d4:4 a3+c4:4', 'g3+b3:8', 'e3+g3:4 d3+g3:4', 'c3+e3:4 c3+f#3:4', //   1–4
        'd3+g3:4 e3+g3:4', 'f#3+a3:4 f#3+b3:4', 'g3+b3:4 a3+c#4:4', 'f#3+a3:4 f#3+c4:4', // 5–8
        'g3+b3:4 a3+c4:4', 'g3+b3:8', 'e3+c4:4 d3+b3:4', 'a3+c4:8', //            9–12
        'b3+d4:4 a3+e4:4', 'a3+d4:4 g3+d4:4', 'g3+c4:4 a3+c4:4', 'b3+d4:4 b3+e4:4', // 13–16
        'g3+e4:4 a3+f#4:4', 'g3+d4:4 g3+e4:4', 'a3+c4:8', 'a3+c4:8', 'g3+b3:8', //     17–21
      ],
    },
    {
      name: 'Pedal', manual: 4, art: 0.94,
      bars: [
        'g3:4 f#3:4', 'e3:4 d3:4', 'c3:4 b2:4', 'a2:4 d3:4', //   1–4  descending bass
        'd3:4 c#3:4', 'd3:4 b2:4', 'e3:4 a2:4', 'd3:4 c3:4', //   5–8
        'b2:4 a2:4', 'g2:8', 'c3:4 b2:4', 'a2:4 d3:4', //        9–12
        'd3:4 c#3:4', 'd3:8', 'e3:4 d3:4', 'd3:4 b2:4', //       13–16
        'c3:8', 'b2:4 e3:4', 'c3:8', 'd3:8', 'g2:8', //          17–21
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Jeremiah Clarke (c. 1674–1707): The Prince of Denmark's March ("Trumpet Voluntary")
//    D major, written here in 2/4 with semiquaver unit (as in common editions), crotchet 108.
//    The tune and the alto line follow a common two-part transcription; tenor and
//    bass are a SIMPLE added harmonisation. Rondeau: main strain, its repeat, the
//    first couplet (to the dominant) and the main strain again — so the excerpt
//    reaches a playable length; the trumpet colour changes each time.
// ---------------------------------------------------------------------------
const CLARKE = {
  id: 'clarke', composer: 'Jeremiah Clarke', dates: 'um 1674–1707',
  title: 'Clarke: Prince of Denmark’s March',
  subtitle: 'Jeremiah Clarke (um 1674–1707) · „Trumpet Voluntary“, D-Dur · Ausschnitt · Melodie und Alt nach Transkription, Tenor/Bass eigene Harmonisierung · Solo-Trompete und Tuba',
  key: 'D-Dur', unit: 0.25, meter: 8, bpm: 108, tempoRange: [104, 112], tempo: {},
  scale: ['d', 'e', 'f#', 'g', 'a', 'b', 'c#'], accidentals: { 'g#': 'Leitton zur Dominante A (E-Dur als V/V, Takte 9 und 13)' },
  form: [
    { from: 1, to: 8 }, //                                                            main strain
    { from: 1, to: 8, reg: { on: ['bombard-tuba'], off: ['bombard-orchestral-trumpet'] } }, // its repeat: Tuba
    { from: 9, to: 16, reg: { on: ['bombard-orchestral-trumpet'], off: ['bombard-tuba'] } }, // couplet
    { from: 1, to: 8, reg: { on: ['bombard-tuba', 'pedal-octave-wood'] } }, //               main strain: Trumpet + Tuba
  ],
  registration: {
    stops: [
      'bombard-orchestral-trumpet',
      'great-open-diapason-4', 'great-hohl-flute', 'great-harmonic-flute', 'choir-lieblich-gedeckt', 'choir-lieblich-flute',
      'pedal-sub-bass', 'pedal-violone', 'pedal-flute',
    ],
    couplers: ['choir-to-great', 'great-to-pedal'], tremulants: [],
    swell: { 'solo-swell-pedal': 0.9 },
  },
  changes: [],
  voices: [
    {
      name: 'Trompete (Solo)', manual: 3, art: 0.88, melody: true,
      bars: [
        'd5:4 e5:2 d5:1 e5:1', //            1
        'f#5:3 g5:1 f#5:2 e5:2', //          2
        'd5:2 e5:2 f#5:2 e5:1 d5:1', //      3
        'e5:2 a4:1 a4:1 a4:2 a4:2', //       4  (half close)
        'd5:4 e5:2 d5:1 e5:1', //            5
        'f#5:3 g5:1 f#5:2 e5:2', //          6
        'd5:1 e5:1 d5:1 e5:1 e5:3 d5:1', //  7  (written-out trill)
        'd5:8', //                           8
        'f#5:4 g#5:2 f#5:1 g#5:1', //        9  couplet
        'a5:3 b5:1 a5:2 g5:2', //            10
        'f#5:2 d5:2 d5:2 a4:2', //           11
        'd5:2 a4:2 f#4:2 d4:2', //           12
        'f#5:4 g#5:2 f#5:1 g#5:1', //        13
        'a5:3 b5:1 a5:2 g5:2', //            14
        'f#5:2 e5:1 d5:1 d5:1 e5:1 f#5:1 g5:1', // 15
        'e5:2 r:6', //                       16 (on the dominant)
      ],
    },
    {
      name: 'Altstimme', manual: 1, art: 0.9,
      bars: [
        'f#4:4 a4:4', 'd5:3 e5:1 d5:2 a4:2', 'f#4:2 a4:2 d5:2 f#4:2', 'a4:2 a4:1 a4:1 a4:2 a4:2', //   1–4
        'f#4:4 a4:4', 'd5:3 e5:1 d5:2 a4:2', 'f#4:2 g4:2 a4:3 g4:1', 'f#4:8', //                      5–8
        'd5:4 e5:4', 'a4:6 c#5:2', 'd5:2 a4:2 f#4:4', 'a4:2 f#4:2 d4:4', //                            9–12
        'd5:4 e5:4', 'a4:6 c#5:2', 'd5:2 a4:2 f#4:2 d4:2', 'a4:2 r:6', //                              13–16
      ],
    },
    {
      name: 'Tenor', manual: 1, art: 0.9,
      bars: [
        'a3:8', 'a3:8', 'a3:4 b3:4', 'c#4:4 e4:4', 'a3:8', 'a3:8', 'b3:4 c#4:4', 'a3:8', //            1–8
        'a3:4 b3:4', 'c#4:4 e4:4', 'a3:8', 'a3:8', 'a3:4 b3:4', 'c#4:4 e4:4', 'a3:4 b3:4', 'c#4:2 r:6', // 9–16
      ],
    },
    {
      name: 'Pedal', manual: 4, art: 0.9,
      bars: [
        'd3:8', 'd3:4 a2:4', 'd3:4 b2:4', 'a2:4 c#3:4', 'd3:8', 'd3:4 a2:4', 'b2:4 a2:4', 'd2:8', //   1–8
        'd3:4 e3:4', 'a2:8', 'd3:4 f#3:4', 'd3:4 a2:4', 'd3:4 e3:4', 'a2:8', 'd3:4 b2:4', 'a2:2 r:6', // 9–16
      ],
    },
  ],
};

/** The built-in pieces after BWV 565, in menu order. */
export const PIECES = [PACHELBEL, BWV147, ELGAR, CLARKE];

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------
const lastKeyAtOrBelow = (map, bar, dflt) => { let v = dflt, best = -Infinity; for (const [k, x] of Object.entries(map || {})) if (+k <= bar && +k > best) { best = +k; v = x; } return v; };
const voiceBar = (v, bar) => { const i = bar - (v.from || 1); return i >= 0 && i < v.bars.length ? v.bars[i] : null; };

/** play plan: [{ bar, t, unitSec, section, first }] and the end time */
function playPlan(def) {
  const plan = [];
  let t = START;
  for (const sec of def.form) {
    for (let b = sec.from; b <= sec.to; b++) {
      const unitSec = (def.unit * 60) / lastKeyAtOrBelow(def.tempo, b, def.bpm);
      plan.push({ bar: b, t, unitSec, section: sec, first: b === sec.from });
      t += def.meter * unitSec;
    }
  }
  return { plan, end: t };
}

/** def -> { score, duration } (score sorted by t). Throws on syntax errors (caught by checkPiece). */
export function compilePiece(def) {
  const ev = [];
  const { plan } = playPlan(def);
  const regEvent = (t, r) => { const reg = {}; if (r.on && r.on.length) reg.on = [...r.on]; if (r.off && r.off.length) reg.off = [...r.off]; if (r.swell) reg.swell = { ...r.swell }; ev.push({ t, dur: 0, reg }); };
  // registration changes
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (p.first && p.section.reg) regEvent(p.t, p.section.reg);
    for (const c of def.changes || []) {
      if (c.bar !== p.bar) continue;
      const t = p.t + (c.at || 0) * p.unitSec;
      if (c.on || c.off || c.swell) regEvent(t, c);
      if (c.piston) ev.push({ t, dur: 0, piston: c.piston });
      if (c.ramp) {
        const { id, from, to, bars } = c.ramp;
        const endIdx = Math.min(plan.length, i + bars);
        const t1 = endIdx < plan.length ? plan[endIdx].t : p.t + bars * def.meter * p.unitSec;
        const steps = Math.max(1, Math.round(bars * 4));
        for (let k = 0; k <= steps; k++) regEvent(t + ((t1 - t) * k) / steps, { swell: { [id]: Math.round((from + ((to - from) * k) / steps) * 1000) / 1000 } });
      }
    }
  }
  // notes, voice by voice; ties carry over bar lines
  for (const v of def.voices) {
    const art = v.art ?? 0.92;
    let tied = new Map(); // midi -> open note
    const close = (n) => { const seg = n.lastSeg; const gap = n.stacc ? seg * 0.5 : Math.max(0.025, seg * (1 - art)); n.dur = Math.max(0.03, n.end - n.t - Math.min(gap, seg * 0.6)); delete n.end; delete n.lastSeg; delete n.stacc; };
    const open = [];
    for (const p of plan) {
      const str = voiceBar(v, p.bar);
      const manual = lastKeyAtOrBelow(v.manualFrom, p.bar, v.manual);
      if (str === null) { for (const n of tied.values()) close(n); tied = new Map(); continue; }
      let t = p.t;
      for (const tok of parseBar(str)) {
        const d = tok.dur * p.unitSec;
        const next = new Map();
        if (tok.pitches) {
          for (const m of tok.pitches) {
            let n = tied.get(m);
            if (n && n.manual === manual) { n.end = t + d; n.lastSeg = d; n.stacc = tok.stacc; tied.delete(m); } else { n = { t, dur: 0, midi: m, manual, end: t + d, lastSeg: d, stacc: tok.stacc }; ev.push(n); open.push(n); }
            if (tok.tie) next.set(m, n); else close(n);
          }
        }
        for (const n of tied.values()) close(n); // a tie that found no continuation ends here
        tied = next;
        t += d;
      }
    }
    for (const n of tied.values()) close(n);
    for (const n of open) if ('end' in n) close(n);
  }
  ev.sort((a, b) => a.t - b.t || (a.dur === 0 ? -1 : 0) - (b.dur === 0 ? -1 : 0));
  let duration = 0;
  for (const e of ev) duration = Math.max(duration, e.t + e.dur);
  return { score: ev, duration };
}

/** Initial registration snapshot of a piece for the demo player. */
export const pieceRegistration = (def) => ({
  stops: [...def.registration.stops], couplers: [...def.registration.couplers], tremulants: [...(def.registration.tremulants || [])], swell: { ...(def.registration.swell || {}) },
});

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
  // tempo
  if (!(def.bpm >= def.tempoRange[0] && def.bpm <= def.tempoRange[1])) P(`Tempo ${def.bpm} außerhalb ${def.tempoRange}`);
  for (const v of Object.values(def.tempo || {})) if (!(v >= 30 && v <= def.tempoRange[1])) P(`Tempowechsel ${v} unplausibel`);
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
      const man = lastKeyAtOrBelow(v.manualFrom, bar, v.manual);
      const [mn, mx] = MANUAL_RANGE[man];
      for (const t of toks) for (const m of t.pitches || []) {
        if (!allowed.has(m % 12)) P(`${v.name} T. ${bar}: ${nameOf(m, true)} nicht in der Tonart`);
        if (m < mn || m > mx) P(`${v.name} T. ${bar}: ${nameOf(m, true)} außerhalb des Umfangs von Manual ${man}`);
        lo = Math.min(lo, m); hi = Math.max(hi, m);
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
  return { ok: problems.length === 0, problems, stats };
}
