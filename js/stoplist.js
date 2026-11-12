// =============================================================================
// stoplist.js — Royal Albert Hall, London: the Grand Organ ("Voice of Jupiter")
// Henry Willis & Sons 1871 · Harrison & Harrison 1924/1933 (and 1970s) · Mander Organs 2004
//
// SINGLE SOURCE OF TRUTH for the specification as it stands since the 2004 Mander
// restoration. Console drawknobs, audio synthesis and pipe geometry are generated
// from this file. ES module, no imports, plain data + small helpers.
//
// SOURCES (stop names, pitches, mixture compositions, couplers, accessories are facts
// taken from these; nothing was invented to reach a target number):
//   [M] Mander Organs specification PDF (builder's 2004 spec, primary source):
//       https://mander-organs.com/wp-content/uploads/2017/02/roy_alb_hall_spec.pdf
//   [MP] Mander Organs project page: https://mander-organs.com/the-grand-organ-royal-albert-hall/
//   [W] Wikipedia "Royal Albert Hall Organ", section "Stoplist since 2004" (stop numbering
//       1-147, coupler numbering I-XXVI; cites NPOR D00733)
//   [N] National Pipe Organ Register D00733: https://www.npor.org.uk/survey/D00733
//   [O] OHS Pipe Organ Database #75298: https://pipeorgandatabase.org/instruments/75298
//   [R] Royal Albert Hall history page (9,999 pipes):
//       https://www.royalalberthall.com/about-the-hall/building-and-history/our-history/new-history-page-5/
//
// COUNTING CONVENTION (reconciles the commonly cited "147 stops" with the owner's
// target of 129 registers + 15 transmissions/extensions):
//   147 numbered stop controls (drawstops 1-147, [M]/[W])
//   =  129 independent SPEAKING stops (own pipes; every stop with no "(from n)" note)
//   +   15 DERIVED stops — the 15 Pedal stops marked "(from n)" in [M]/[W]:
//          10 extensions (pitch differs from source rank) + 5 transmissions (same pitch)
//   +    3 PERCUSSION stops (Carillons, Tubular Bells, Bass Drum — no pipes)
//   Couplers (23), tremulants (3) and pistons are NOT counted as stops.
//   Stops per division: Pedal 36 (20 own + 15 derived + 1 percussion),
//   Choir 11, Orchestral 16, Great 32, Swell 25, Solo 17 (incl. 2 perc), Bombard 10.
//
// PIPE COUNT (9,999 per [R] and the owner; NB [M]/[MP]/[O] state 9,997 speaking pipes —
// the 2-pipe difference is unexplained in the sources). Per-stop pipe counts are NOT
// published, so every stop is pipesExact:false and counts are DERIVED:
//   manual stops 61 notes × ranks; pedal 32 notes × ranks; mixtures = ranks × 61 (or 32)
//   ignoring breaks; transmissions = 0; extensions = only the added octave (12 pipes);
//   Double Quint 21 1/3 uses the 32' extension of Open Diapason II (0 extra); Acoustic
//   Bass 64' treated as a resultant (0 pipes); percussion = 0.
//   Derived total = 10,023. Reconciled to 9,999 by PIPE_COUNT_ADJUSTMENTS (−24, both
//   estimated: celeste second ranks of Violes Celestes II and Unda Maris II assumed to
//   start at tenor C, encoded per stop as rankStart: [0, 12] — see FIELD NOTES).
//   `pipesDerived` keeps the unadjusted figure on every stop.
//
// FIELD NOTES
//   semitones: offset of the stop's unison rank from 8' (16'=-12, 4'=+12, 2 2/3=+19 ...);
//              0 for mixtures and percussion.
//   composition: semitone offsets from 8' of each rank at bottom C (mixtures: from the
//              published interval numbers, 8=+12, 10=+16, 12=+19, 15=+24, 17=+28, 19=+31,
//              21=+34 (harmonic 7th, ≈33.69 in just tuning), 22=+36, 26=+43, 29=+48,
//              31=+52, 33=+55, 36=+60). Pedal mixture interval numbers are read on a 16'
//              basis (so −12 is applied) — ASSUMPTION. Breaks are not published. Celestes
//              list both ranks at unison pitch.
//   rankStart: optional array, one entry per rank = index of the first note (0 = bottom C
//              of the stop's own compass, 12 = tenor C) at which that rank has pipes and
//              sounds; missing/absent = 0 for every rank. Below its start a rank is silent
//              and has no pipes (audio emits no 'pipeon' for it). For stops carrying it,
//              validate() checks sum over ranks of (compass − rankStart[r]) === pipes.
//              Used by Violes Celestes II and Unda Maris II: rankStart [0, 12] (second rank
//              from tenor C, 61 + 49 = 110) — ASSUMPTION, see PIPE_COUNT_ADJUSTMENTS.
//   derived.semitones: offset of the derived stop relative to its source rank.
//   loudness: informed relative estimate (0..1), not measured.
//   construction: conventional practice for each stop type, NOT documented per stop.
//   subdivision 'great-second': the asterisked Great stops [M] = "Great Second Division",
//              which coupler XIII puts on the Choir manual (Mander's rationalised split;
//              the Fourniture IV added in 2004 belongs to it and [MP] calls it part of the
//              Willis chorus). 'bombard-tubas': Contra Tuba, Tuba Mirabilis, Tuba Clarion,
//              the 3 unenclosed Bombard stops ([M]: "first 7 enclosed in Solo box").
//   location: Pedal stops physically placed in/borrowed from another box.
//   Name spellings follow [W] where [M] has evident typos (Leiblich Gedackt, Quintation,
//   Furniture). Pedal Clarion pitch: 8' per [W]/[O], 4' per [M] (flagged pitchConflict).
//   Wind pressures are not published for the 2004 state; only notes are given.
// =============================================================================

export const META = {
  name: 'The Grand Organ, Royal Albert Hall, London',
  nickname: 'The Voice of Jupiter',
  builders: [
    { name: 'Henry Willis & Sons', year: 1871, work: 'original organ, 4 manuals, 111 stops' },
    { name: 'Harrison & Harrison', year: 1924, work: 'rebuild stage 1, electro-pneumatic action' },
    { name: 'Harrison & Harrison', year: 1933, work: 'rebuild stage 2, 146 stops incl. 3 percussion' },
    { name: 'Harrison & Harrison', year: 1974, work: 'console refurbished, switchgear, Choir Nazard & Tierce, Great split' },
    { name: 'Mander Organs', year: 2004, work: 'restoration: new soundboards/actions, Great split rationalised, Fourniture IV added (147 stops)' },
  ],
  totalPipes: 9999,
  totalPipesAlt: { value: 9997, note: 'speaking pipes per Mander Organs and OHS database; 9,999 per Royal Albert Hall' },
  pipesDerivedTotal: 10023,
  compass: { manual: { notes: 61, range: 'C-c4' }, pedal: { notes: 32, range: 'C-f1' } },
  manuals: ['Choir & Orchestral (I)', 'Great (II)', 'Swell (III)', 'Solo & Bombard (IV)', 'Pedal'],
  counts: {
    numberedStops: 147,
    speakingStops: 129,
    derivedStops: 15,
    extensions: 10,
    transmissions: 5,
    percussionStops: 3,
    couplers: 23,
    tremulants: 3,
    byDivision: {
      pedal: { total: 36, speaking: 20, derived: 15, percussion: 1 },
      choir: { total: 11, speaking: 11, derived: 0, percussion: 0 },
      orchestral: { total: 16, speaking: 16, derived: 0, percussion: 0 },
      great: { total: 32, speaking: 32, derived: 0, percussion: 0 },
      swell: { total: 25, speaking: 25, derived: 0, percussion: 0 },
      solo: { total: 17, speaking: 15, derived: 0, percussion: 2 },
      bombard: { total: 10, speaking: 10, derived: 0, percussion: 0 },
    },
  },
  countingConvention:
    '147 numbered stops = 129 speaking stops with their own pipes + 15 derived Pedal stops ' +
    '(those marked "from n" in the builder\'s specification: 10 extensions + 5 transmissions) + ' +
    '3 percussion stops (Carillons, Tubular Bells, Bass Drum). Couplers (23), tremulants (3) and ' +
    'pistons are not counted as stops. Pipes: 9,999 (Royal Albert Hall); per-stop counts are derived ' +
    '(61/32 notes × ranks, extensions = added octave only, transmissions/percussion = 0) giving 10,023, ' +
    'reconciled by the estimated PIPE_COUNT_ADJUSTMENTS (−24).',
  sources: [
    'https://mander-organs.com/wp-content/uploads/2017/02/roy_alb_hall_spec.pdf',
    'https://mander-organs.com/the-grand-organ-royal-albert-hall/',
    'https://en.wikipedia.org/wiki/Royal_Albert_Hall_Organ',
    'https://www.npor.org.uk/survey/D00733',
    'https://pipeorgandatabase.org/instruments/75298',
    'https://www.royalalberthall.com/about-the-hall/building-and-history/our-history/new-history-page-5/',
  ],
  conflicts: [
    'Pedal Clarion: 8′ in Wikipedia/NPOR and OHS; 4′ in the Mander specification PDF. 8′ used.',
    'Pipe total: 9,999 (Royal Albert Hall, used) vs 9,997 speaking pipes (Mander, OHS).',
    'Coupler V "Choir (unenclosed) on Solo" is listed by Wikipedia/NPOR but not in the Mander PDF; included.',
    'Bombard fixed pistons: Mander PDF says 6 but names 5; the 6th is recorded unnamed.',
  ],
};

// manual index: 0 Choir, 1 Great, 2 Swell, 3 Solo, 4 Pedal
export const DIVISIONS = [
  { id: 'pedal', name: 'Pedal Organ', manual: 4, enclosed: false, compass: 32,
    note: 'Some Pedal stops stand in other boxes: Trombone 16′ and Double Trombone 32′ in the Swell; Viole, Clarinet, Trumpet, Bassoon are transmissions from enclosed divisions. Pedal reeds 25″/15″ were reduced to 19″/13″ in the 1970s.' },
  { id: 'choir', name: 'Choir Organ (First Division, unenclosed)', manual: 0, enclosed: false, compass: 61, parent: 'choir-orchestral' },
  { id: 'orchestral', name: 'Orchestral Organ (Second Division, enclosed)', manual: 0, enclosed: true, compass: 61, parent: 'choir-orchestral' },
  { id: 'great', name: 'Great Organ', manual: 1, enclosed: false, compass: 61,
    windPressure: 'reeds restored by Mander (2004) to their 1924 pressures (reduced in the 1970s from 25″/15″ to 19″/13″)',
    note: 'Stops with subdivision "great-second" form the Great Second Division, playable on the Choir by coupler XIII.' },
  { id: 'swell', name: 'Swell Organ', manual: 2, enclosed: true, compass: 61 },
  { id: 'solo', name: 'Solo Organ (First Division, enclosed)', manual: 3, enclosed: true, compass: 61, parent: 'solo-bombard' },
  { id: 'bombard', name: 'Bombard Organ (Second Division)', manual: 3, enclosed: true, compass: 61, parent: 'solo-bombard',
    note: 'First 7 stops enclosed in the Solo box; the 3 Tubas (subdivision "bombard-tubas") are unenclosed (stop.enclosed=false).' },
];

// One object per stop, console order within each division. `number` = drawstop number 1-147.
export const STOPS = [
  {"id":"pedal-acoustic-bass","number":1,"division":"pedal","name":"Acoustic Bass","pitch":"64","pitchFt":64,"semitones":-36,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-open-wood-ii","semitones":-24},"loudness":0.55,"order":0,"enclosed":false,"resultant":true,"note":"Resultant (acoustic) 64′ derived from Open Wood II."},
  {"id":"pedal-double-open-wood","number":2,"division":"pedal","name":"Double Open Wood","pitch":"32","pitchFt":32,"semitones":-24,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":12,"pipesDerived":12,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-open-wood-ii","semitones":-12},"loudness":0.7,"order":1,"enclosed":false},
  {"id":"pedal-double-open-diapason","number":3,"division":"pedal","name":"Double Open Diapason","pitch":"32","pitchFt":32,"semitones":-24,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":12,"pipesDerived":12,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-open-diapason-ii","semitones":-12},"loudness":0.72,"order":2,"enclosed":false},
  {"id":"pedal-contra-violone","number":4,"division":"pedal","name":"Contra Violone","pitch":"32","pitchFt":32,"semitones":-24,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":{"kind":"transmission","from":"great-contra-violone","semitones":0},"loudness":0.4,"order":3,"enclosed":false},
  {"id":"pedal-double-quint","number":5,"division":"pedal","name":"Double Quint","pitch":"21 1/3","pitchFt":21.333333333333332,"semitones":-17,"ranks":1,"composition":null,"family":"mutation","construction":"metal","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-open-diapason-ii","semitones":-5},"loudness":0.45,"order":4,"enclosed":false},
  {"id":"pedal-open-wood-i","number":6,"division":"pedal","name":"Open Wood I","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.75,"order":5,"enclosed":false},
  {"id":"pedal-open-wood-ii","number":7,"division":"pedal","name":"Open Wood II","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.65,"order":6,"enclosed":false},
  {"id":"pedal-open-diapason-i","number":8,"division":"pedal","name":"Open Diapason I","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.7,"order":7,"enclosed":false},
  {"id":"pedal-open-diapason-ii","number":9,"division":"pedal","name":"Open Diapason II","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.6,"order":8,"enclosed":false},
  {"id":"pedal-violone","number":10,"division":"pedal","name":"Violone","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.45,"order":9,"enclosed":false},
  {"id":"pedal-sub-bass","number":11,"division":"pedal","name":"Sub Bass","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.4,"order":10,"enclosed":false},
  {"id":"pedal-salicional","number":12,"division":"pedal","name":"Salicional","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.25,"order":11,"enclosed":false},
  {"id":"pedal-viole","number":13,"division":"pedal","name":"Viole","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":{"kind":"transmission","from":"orchestral-contra-viole","semitones":0},"loudness":0.3,"order":12,"enclosed":true,"location":"orchestral"},
  {"id":"pedal-quint","number":14,"division":"pedal","name":"Quint","pitch":"10 2/3","pitchFt":10.666666666666666,"semitones":-5,"ranks":1,"composition":null,"family":"mutation","construction":"wood","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.4,"order":13,"enclosed":false},
  {"id":"pedal-octave-wood","number":15,"division":"pedal","name":"Octave Wood","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":12,"pipesDerived":12,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-open-wood-i","semitones":12},"loudness":0.55,"order":14,"enclosed":false},
  {"id":"pedal-principal","number":16,"division":"pedal","name":"Principal","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":12,"pipesDerived":12,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-open-diapason-i","semitones":12},"loudness":0.55,"order":15,"enclosed":false},
  {"id":"pedal-violoncello","number":17,"division":"pedal","name":"Violoncello","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.4,"order":16,"enclosed":false},
  {"id":"pedal-flute","number":18,"division":"pedal","name":"Flute","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.35,"order":17,"enclosed":false},
  {"id":"pedal-octave-quint","number":19,"division":"pedal","name":"Octave Quint","pitch":"5 1/3","pitchFt":5.333333333333333,"semitones":7,"ranks":1,"composition":null,"family":"mutation","construction":"metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.4,"order":18,"enclosed":false},
  {"id":"pedal-super-octave","number":20,"division":"pedal","name":"Super Octave","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.45,"order":19,"enclosed":false},
  {"id":"pedal-harmonics","number":21,"division":"pedal","name":"Harmonics","pitch":"VII","pitchFt":null,"semitones":0,"ranks":7,"composition":[4,7,12,16,19,22,24],"family":"mixture","construction":"metal","pipes":224,"pipesDerived":224,"pipesExact":false,"derived":null,"loudness":0.6,"order":20,"enclosed":false},
  {"id":"pedal-mixture","number":22,"division":"pedal","name":"Mixture","pitch":"V","pitchFt":null,"semitones":0,"ranks":5,"composition":[12,19,24,31,36],"family":"mixture","construction":"metal","pipes":160,"pipesDerived":160,"pipesExact":false,"derived":null,"loudness":0.6,"order":21,"enclosed":false},
  {"id":"pedal-double-ophicleide","number":23,"division":"pedal","name":"Double Ophicleide","pitch":"32","pitchFt":32,"semitones":-24,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":12,"pipesDerived":12,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-ophicleide","semitones":-12},"loudness":0.95,"order":22,"enclosed":false},
  {"id":"pedal-double-trombone","number":24,"division":"pedal","name":"Double Trombone","pitch":"32","pitchFt":32,"semitones":-24,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":12,"pipesDerived":12,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-trombone","semitones":-12},"loudness":0.8,"order":23,"enclosed":true,"location":"swell"},
  {"id":"pedal-ophicleide","number":25,"division":"pedal","name":"Ophicleide","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.95,"order":24,"enclosed":false},
  {"id":"pedal-bombard","number":26,"division":"pedal","name":"Bombard","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.85,"order":25,"enclosed":false},
  {"id":"pedal-trombone","number":27,"division":"pedal","name":"Trombone","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.75,"order":26,"enclosed":true,"location":"swell"},
  {"id":"pedal-fagotto","number":28,"division":"pedal","name":"Fagotto","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.45,"order":27,"enclosed":false},
  {"id":"pedal-trumpet","number":29,"division":"pedal","name":"Trumpet","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":{"kind":"transmission","from":"swell-double-trumpet","semitones":0},"loudness":0.65,"order":28,"enclosed":true,"location":"swell"},
  {"id":"pedal-clarinet","number":30,"division":"pedal","name":"Clarinet","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":{"kind":"transmission","from":"orchestral-double-clarinet","semitones":0},"loudness":0.35,"order":29,"enclosed":true,"location":"orchestral"},
  {"id":"pedal-bassoon","number":31,"division":"pedal","name":"Bassoon","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":{"kind":"transmission","from":"solo-double-bassoon","semitones":0},"loudness":0.45,"order":30,"enclosed":true,"location":"solo"},
  {"id":"pedal-quint-trombone","number":32,"division":"pedal","name":"Quint Trombone","pitch":"10 2/3","pitchFt":10.666666666666666,"semitones":-5,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.7,"order":31,"enclosed":false},
  {"id":"pedal-posaune","number":33,"division":"pedal","name":"Posaune","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":12,"pipesDerived":12,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-ophicleide","semitones":12},"loudness":0.85,"order":32,"enclosed":false},
  {"id":"pedal-clarion","number":34,"division":"pedal","name":"Clarion","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":32,"pipesDerived":32,"pipesExact":false,"derived":null,"loudness":0.75,"order":33,"enclosed":false,"pitchConflict":["8","4"],"note":"Pitch 8′ per Wikipedia/NPOR and OHS Pipe Organ Database; the Mander specification PDF prints 4′."},
  {"id":"pedal-octave-posaune","number":35,"division":"pedal","name":"Octave Posaune","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":12,"pipesDerived":12,"pipesExact":false,"derived":{"kind":"extension","from":"pedal-ophicleide","semitones":24},"loudness":0.8,"order":34,"enclosed":false},
  {"id":"pedal-bass-drum","number":36,"division":"pedal","name":"Bass Drum","pitch":"","pitchFt":null,"semitones":0,"ranks":0,"composition":null,"family":"percussion","construction":"drum","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":null,"loudness":0.7,"order":35,"enclosed":false,"percussion":true},
  {"id":"choir-open-diapason","number":37,"division":"choir","name":"Open Diapason","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":0,"enclosed":false},
  {"id":"choir-lieblich-gedeckt","number":38,"division":"choir","name":"Lieblich Gedeckt","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.22,"order":1,"enclosed":false},
  {"id":"choir-dulciana","number":39,"division":"choir","name":"Dulciana","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.15,"order":2,"enclosed":false},
  {"id":"choir-gemshorn","number":40,"division":"choir","name":"Gemshorn","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.3,"order":3,"enclosed":false},
  {"id":"choir-lieblich-flute","number":41,"division":"choir","name":"Lieblich Flute","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.22,"order":4,"enclosed":false},
  {"id":"choir-nazard","number":42,"division":"choir","name":"Nazard","pitch":"2 2/3","pitchFt":2.6666666666666665,"semitones":19,"ranks":1,"composition":null,"family":"mutation","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.25,"order":5,"enclosed":false,"note":"Harrison & Harrison 1974."},
  {"id":"choir-flageolet","number":43,"division":"choir","name":"Flageolet","pitch":"2","pitchFt":2,"semitones":24,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.25,"order":6,"enclosed":false},
  {"id":"choir-tierce","number":44,"division":"choir","name":"Tierce","pitch":"1 3/5","pitchFt":1.6,"semitones":28,"ranks":1,"composition":null,"family":"mutation","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.22,"order":7,"enclosed":false,"note":"Harrison & Harrison 1974."},
  {"id":"choir-mixture","number":45,"division":"choir","name":"Mixture","pitch":"III","pitchFt":null,"semitones":0,"ranks":3,"composition":[24,31,36],"family":"mixture","construction":"metal","pipes":183,"pipesDerived":183,"pipesExact":false,"derived":null,"loudness":0.4,"order":8,"enclosed":false,"note":"Breaks adjusted by Mander 2004."},
  {"id":"choir-trumpet","number":46,"division":"choir","name":"Trumpet","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.55,"order":9,"enclosed":false},
  {"id":"choir-clarion","number":47,"division":"choir","name":"Clarion","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.5,"order":10,"enclosed":false},
  {"id":"orchestral-contra-viole","number":48,"division":"orchestral","name":"Contra Viole","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.25,"order":0,"enclosed":true},
  {"id":"orchestral-violoncello","number":49,"division":"orchestral","name":"Violoncello","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.3,"order":1,"enclosed":true},
  {"id":"orchestral-viole-dorchestre-i","number":50,"division":"orchestral","name":"Viole d’Orchestre I","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.28,"order":2,"enclosed":true},
  {"id":"orchestral-viole-dorchestre-ii","number":51,"division":"orchestral","name":"Viole d’Orchestre II","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.28,"order":3,"enclosed":true},
  {"id":"orchestral-viole-sourdine","number":52,"division":"orchestral","name":"Viole Sourdine","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.15,"order":4,"enclosed":true},
  {"id":"orchestral-violes-celestes","number":53,"division":"orchestral","name":"Violes Celestes","pitch":"8","pitchFt":8,"semitones":0,"ranks":2,"composition":[0,0],"family":"string","construction":"metal","pipes":110,"pipesDerived":122,"pipesExact":false,"derived":null,"loudness":0.25,"order":5,"enclosed":true,"celeste":true,"rankStart":[0,12]},
  {"id":"orchestral-viole-octaviante","number":54,"division":"orchestral","name":"Viole Octaviante","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.25,"order":6,"enclosed":true},
  {"id":"orchestral-cornet-de-violes","number":55,"division":"orchestral","name":"Cornet de Violes","pitch":"V","pitchFt":null,"semitones":0,"ranks":5,"composition":[19,24,28,31,36],"family":"mixture","construction":"metal","pipes":305,"pipesDerived":305,"pipesExact":false,"derived":null,"loudness":0.35,"order":7,"enclosed":true},
  {"id":"orchestral-quintaton","number":56,"division":"orchestral","name":"Quintaton","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.2,"order":8,"enclosed":true},
  {"id":"orchestral-harmonic-flute","number":57,"division":"orchestral","name":"Harmonic Flute","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":9,"enclosed":true},
  {"id":"orchestral-concert-flute","number":58,"division":"orchestral","name":"Concert Flute","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.28,"order":10,"enclosed":true},
  {"id":"orchestral-harmonic-piccolo","number":59,"division":"orchestral","name":"Harmonic Piccolo","pitch":"2","pitchFt":2,"semitones":24,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.3,"order":11,"enclosed":true},
  {"id":"orchestral-double-clarinet","number":60,"division":"orchestral","name":"Double Clarinet","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":12,"enclosed":true},
  {"id":"orchestral-clarinet","number":61,"division":"orchestral","name":"Clarinet","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":13,"enclosed":true},
  {"id":"orchestral-orchestral-hautboy","number":62,"division":"orchestral","name":"Orchestral Hautboy","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":14,"enclosed":true},
  {"id":"orchestral-cor-anglais","number":63,"division":"orchestral","name":"Cor Anglais","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.3,"order":15,"enclosed":true},
  {"id":"great-contra-violone","number":64,"division":"great","name":"Contra Violone","pitch":"32","pitchFt":32,"semitones":-24,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.4,"order":0,"enclosed":false},
  {"id":"great-contra-gamba","number":65,"division":"great","name":"Contra Gamba","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.4,"order":1,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-double-open-diapason","number":66,"division":"great","name":"Double Open Diapason","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.65,"order":2,"enclosed":false},
  {"id":"great-double-claribel-flute","number":67,"division":"great","name":"Double Claribel Flute","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":3,"enclosed":false},
  {"id":"great-bourdon","number":68,"division":"great","name":"Bourdon","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":4,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-open-diapason-1","number":69,"division":"great","name":"Open Diapason 1","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.8,"order":5,"enclosed":false},
  {"id":"great-open-diapason-2","number":70,"division":"great","name":"Open Diapason 2","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.72,"order":6,"enclosed":false},
  {"id":"great-open-diapason-3","number":71,"division":"great","name":"Open Diapason 3","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.62,"order":7,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-open-diapason-4","number":72,"division":"great","name":"Open Diapason 4","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.6,"order":8,"enclosed":false},
  {"id":"great-open-diapason-5","number":73,"division":"great","name":"Open Diapason 5","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.52,"order":9,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-geigen","number":74,"division":"great","name":"Geigen","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.55,"order":10,"enclosed":false},
  {"id":"great-hohl-flute","number":75,"division":"great","name":"Hohl Flute","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":11,"enclosed":false},
  {"id":"great-viola-da-gamba","number":76,"division":"great","name":"Viola da Gamba","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.4,"order":12,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-rohr-flute","number":77,"division":"great","name":"Rohr Flute","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":13,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-quint","number":78,"division":"great","name":"Quint","pitch":"5 1/3","pitchFt":5.333333333333333,"semitones":7,"ranks":1,"composition":null,"family":"mutation","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.5,"order":14,"enclosed":false},
  {"id":"great-octave","number":79,"division":"great","name":"Octave","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.65,"order":15,"enclosed":false},
  {"id":"great-principal","number":80,"division":"great","name":"Principal","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.55,"order":16,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-viola","number":81,"division":"great","name":"Viola","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.38,"order":17,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-harmonic-flute","number":82,"division":"great","name":"Harmonic Flute","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":18,"enclosed":false},
  {"id":"great-octave-quint","number":83,"division":"great","name":"Octave Quint","pitch":"2 2/3","pitchFt":2.6666666666666665,"semitones":19,"ranks":1,"composition":null,"family":"mutation","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":19,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-super-octave","number":84,"division":"great","name":"Super Octave","pitch":"2","pitchFt":2,"semitones":24,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.6,"order":20,"enclosed":false},
  {"id":"great-fifteenth","number":85,"division":"great","name":"Fifteenth","pitch":"2","pitchFt":2,"semitones":24,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.5,"order":21,"enclosed":false,"subdivision":"great-second"},
  {"id":"great-mixture","number":86,"division":"great","name":"Mixture","pitch":"V","pitchFt":null,"semitones":0,"ranks":5,"composition":[12,19,24,31,36],"family":"mixture","construction":"metal","pipes":305,"pipesDerived":305,"pipesExact":false,"derived":null,"loudness":0.75,"order":22,"enclosed":false},
  {"id":"great-harmonics","number":87,"division":"great","name":"Harmonics","pitch":"VI","pitchFt":null,"semitones":0,"ranks":6,"composition":[16,24,28,31,34,36],"family":"mixture","construction":"metal","pipes":366,"pipesDerived":366,"pipesExact":false,"derived":null,"loudness":0.75,"order":23,"enclosed":false},
  {"id":"great-fourniture","number":88,"division":"great","name":"Fourniture","pitch":"IV","pitchFt":null,"semitones":0,"ranks":4,"composition":[31,36,43,48],"family":"mixture","construction":"metal","pipes":244,"pipesDerived":244,"pipesExact":false,"derived":null,"loudness":0.6,"order":24,"enclosed":false,"subdivision":"great-second","note":"New stop added by Mander 2004 (to the Willis chorus)."},
  {"id":"great-cymbale","number":89,"division":"great","name":"Cymbale","pitch":"VII","pitchFt":null,"semitones":0,"ranks":7,"composition":[31,36,43,48,52,55,60],"family":"mixture","construction":"metal","pipes":427,"pipesDerived":427,"pipesExact":false,"derived":null,"loudness":0.8,"order":25,"enclosed":false,"note":"Re-cast by Mander 2004."},
  {"id":"great-contra-tromba","number":90,"division":"great","name":"Contra Tromba","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.85,"order":26,"enclosed":false},
  {"id":"great-tromba","number":91,"division":"great","name":"Tromba","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.9,"order":27,"enclosed":false},
  {"id":"great-octave-tromba","number":92,"division":"great","name":"Octave Tromba","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.85,"order":28,"enclosed":false},
  {"id":"great-posaune","number":93,"division":"great","name":"Posaune","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.85,"order":29,"enclosed":false},
  {"id":"great-harmonic-trumpet","number":94,"division":"great","name":"Harmonic Trumpet","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.8,"order":30,"enclosed":false},
  {"id":"great-harmonic-clarion","number":95,"division":"great","name":"Harmonic Clarion","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.75,"order":31,"enclosed":false},
  {"id":"swell-double-open-diapason","number":96,"division":"swell","name":"Double Open Diapason","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.5,"order":0,"enclosed":true},
  {"id":"swell-bourdon","number":97,"division":"swell","name":"Bourdon","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.3,"order":1,"enclosed":true},
  {"id":"swell-open-diapason","number":98,"division":"swell","name":"Open Diapason","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.55,"order":2,"enclosed":true},
  {"id":"swell-viola-da-gamba","number":99,"division":"swell","name":"Viola da Gamba","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":3,"enclosed":true},
  {"id":"swell-salicional","number":100,"division":"swell","name":"Salicional","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.25,"order":4,"enclosed":true},
  {"id":"swell-vox-angelica","number":101,"division":"swell","name":"Vox Angelica","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":[0],"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.2,"order":5,"enclosed":true,"celeste":true},
  {"id":"swell-flute-a-cheminee","number":102,"division":"swell","name":"Flûte à Cheminée","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.3,"order":6,"enclosed":true},
  {"id":"swell-claribel-flute","number":103,"division":"swell","name":"Claribel Flute","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":7,"enclosed":true},
  {"id":"swell-principal","number":104,"division":"swell","name":"Principal","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.5,"order":8,"enclosed":true},
  {"id":"swell-viola","number":105,"division":"swell","name":"Viola","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.3,"order":9,"enclosed":true},
  {"id":"swell-harmonic-flute","number":106,"division":"swell","name":"Harmonic Flute","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":10,"enclosed":true},
  {"id":"swell-octave-quint","number":107,"division":"swell","name":"Octave Quint","pitch":"2 2/3","pitchFt":2.6666666666666665,"semitones":19,"ranks":1,"composition":null,"family":"mutation","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.4,"order":11,"enclosed":true},
  {"id":"swell-super-octave","number":108,"division":"swell","name":"Super Octave","pitch":"2","pitchFt":2,"semitones":24,"ranks":1,"composition":null,"family":"principal","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":12,"enclosed":true},
  {"id":"swell-harmonic-piccolo","number":109,"division":"swell","name":"Harmonic Piccolo","pitch":"2","pitchFt":2,"semitones":24,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":13,"enclosed":true},
  {"id":"swell-mixture","number":110,"division":"swell","name":"Mixture","pitch":"V","pitchFt":null,"semitones":0,"ranks":5,"composition":[12,19,24,31,36],"family":"mixture","construction":"metal","pipes":305,"pipesDerived":305,"pipesExact":false,"derived":null,"loudness":0.6,"order":14,"enclosed":true},
  {"id":"swell-fourniture","number":111,"division":"swell","name":"Fourniture","pitch":"V","pitchFt":null,"semitones":0,"ranks":5,"composition":[24,31,36,43,48],"family":"mixture","construction":"metal","pipes":305,"pipesDerived":305,"pipesExact":false,"derived":null,"loudness":0.6,"order":15,"enclosed":true},
  {"id":"swell-contra-oboe","number":112,"division":"swell","name":"Contra Oboe","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.4,"order":16,"enclosed":true},
  {"id":"swell-oboe","number":113,"division":"swell","name":"Oboe","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.4,"order":17,"enclosed":true},
  {"id":"swell-baryton","number":114,"division":"swell","name":"Baryton","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.3,"order":18,"enclosed":true},
  {"id":"swell-vox-humana","number":115,"division":"swell","name":"Vox Humana","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.25,"order":19,"enclosed":true},
  {"id":"swell-double-trumpet","number":116,"division":"swell","name":"Double Trumpet","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.75,"order":20,"enclosed":true},
  {"id":"swell-trumpet","number":117,"division":"swell","name":"Trumpet","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.8,"order":21,"enclosed":true},
  {"id":"swell-clarion","number":118,"division":"swell","name":"Clarion","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.75,"order":22,"enclosed":true},
  {"id":"swell-tuba","number":119,"division":"swell","name":"Tuba","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.88,"order":23,"enclosed":true},
  {"id":"swell-tuba-clarion","number":120,"division":"swell","name":"Tuba Clarion","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.85,"order":24,"enclosed":true},
  {"id":"solo-contra-bass","number":121,"division":"solo","name":"Contra Bass","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":0,"enclosed":true},
  {"id":"solo-flute-a-pavillon","number":122,"division":"solo","name":"Flûte à Pavillon","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.5,"order":1,"enclosed":true},
  {"id":"solo-viole-damour","number":123,"division":"solo","name":"Viole d’Amour","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"string","construction":"metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.25,"order":2,"enclosed":true},
  {"id":"solo-doppel-flute","number":124,"division":"solo","name":"Doppel Flute","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":3,"enclosed":true},
  {"id":"solo-harmonic-claribel-flute","number":125,"division":"solo","name":"Harmonic Claribel Flute","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":4,"enclosed":true},
  {"id":"solo-unda-maris","number":126,"division":"solo","name":"Unda Maris","pitch":"8","pitchFt":8,"semitones":0,"ranks":2,"composition":[0,0],"family":"flute","construction":"metal","pipes":110,"pipesDerived":122,"pipesExact":false,"derived":null,"loudness":0.18,"order":5,"enclosed":true,"celeste":true,"rankStart":[0,12]},
  {"id":"solo-wald-flute","number":127,"division":"solo","name":"Wald Flute","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.38,"order":6,"enclosed":true},
  {"id":"solo-flauto-traverso","number":128,"division":"solo","name":"Flauto Traverso","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":7,"enclosed":true},
  {"id":"solo-piccolo-traverso","number":129,"division":"solo","name":"Piccolo Traverso","pitch":"2","pitchFt":2,"semitones":24,"ranks":1,"composition":null,"family":"flute","construction":"wood","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.35,"order":8,"enclosed":true},
  {"id":"solo-double-bassoon","number":130,"division":"solo","name":"Double Bassoon","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":9,"enclosed":true},
  {"id":"solo-corno-di-bassetto","number":131,"division":"solo","name":"Corno di Bassetto","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.45,"order":10,"enclosed":true},
  {"id":"solo-hautboy","number":132,"division":"solo","name":"Hautboy","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.42,"order":11,"enclosed":true},
  {"id":"solo-bassoon","number":133,"division":"solo","name":"Bassoon","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.42,"order":12,"enclosed":true},
  {"id":"solo-double-horn","number":134,"division":"solo","name":"Double Horn","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.5,"order":13,"enclosed":true},
  {"id":"solo-french-horn","number":135,"division":"solo","name":"French Horn","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.5,"order":14,"enclosed":true},
  {"id":"solo-carillons","number":136,"division":"solo","name":"Carillons","pitch":"","pitchFt":null,"semitones":0,"ranks":0,"composition":null,"family":"percussion","construction":"bars","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":null,"loudness":0.4,"order":15,"enclosed":true,"percussion":true},
  {"id":"solo-tubular-bells","number":137,"division":"solo","name":"Tubular Bells","pitch":"","pitchFt":null,"semitones":0,"ranks":0,"composition":null,"family":"percussion","construction":"tubular-bells","pipes":0,"pipesDerived":0,"pipesExact":false,"derived":null,"loudness":0.6,"order":16,"enclosed":true,"percussion":true},
  {"id":"bombard-bombardon","number":138,"division":"bombard","name":"Bombardon","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.8,"order":0,"enclosed":true},
  {"id":"bombard-tuba","number":139,"division":"bombard","name":"Tuba","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.88,"order":1,"enclosed":true},
  {"id":"bombard-orchestral-trumpet","number":140,"division":"bombard","name":"Orchestral Trumpet","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.82,"order":2,"enclosed":true},
  {"id":"bombard-cornopean","number":141,"division":"bombard","name":"Cornopean","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.75,"order":3,"enclosed":true},
  {"id":"bombard-quint-trumpet","number":142,"division":"bombard","name":"Quint Trumpet","pitch":"5 1/3","pitchFt":5.333333333333333,"semitones":7,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.7,"order":4,"enclosed":true},
  {"id":"bombard-orchestral-clarion","number":143,"division":"bombard","name":"Orchestral Clarion","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.8,"order":5,"enclosed":true},
  {"id":"bombard-sesquialtera","number":144,"division":"bombard","name":"Sesquialtera","pitch":"V","pitchFt":null,"semitones":0,"ranks":5,"composition":[19,24,28,31,36],"family":"mixture","construction":"metal","pipes":305,"pipesDerived":305,"pipesExact":false,"derived":null,"loudness":0.65,"order":6,"enclosed":true},
  {"id":"bombard-contra-tuba","number":145,"division":"bombard","name":"Contra Tuba","pitch":"16","pitchFt":16,"semitones":-12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.95,"order":7,"enclosed":false,"subdivision":"bombard-tubas"},
  {"id":"bombard-tuba-mirabilis","number":146,"division":"bombard","name":"Tuba Mirabilis","pitch":"8","pitchFt":8,"semitones":0,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":1,"order":8,"enclosed":false,"subdivision":"bombard-tubas"},
  {"id":"bombard-tuba-clarion","number":147,"division":"bombard","name":"Tuba Clarion","pitch":"4","pitchFt":4,"semitones":12,"ranks":1,"composition":null,"family":"reed","construction":"reed-metal","pipes":61,"pipesDerived":61,"pipesExact":false,"derived":null,"loudness":0.95,"order":9,"enclosed":false,"subdivision":"bombard-tubas"},
];

export const PIPE_COUNT_ADJUSTMENTS = [
  {"stopId":"orchestral-violes-celestes","delta":-12,"estimated":true,"reason":"Assumed: second (celeste) rank begins at tenor C (49 pipes), as is conventional for celestes; not documented."},
  {"stopId":"solo-unda-maris","delta":-12,"estimated":true,"reason":"Assumed: second (undulating) rank begins at tenor C (49 pipes), as is conventional; not documented."},
];


// Couplers: `number` = Roman numeral position in [W] (VI, XVII, XX are the tremulants).
// `from` is a manual index (whole keyboard) or a division id; `filter` restricts which stops are coupled.
export const COUPLERS = [
  { id: 'choir-to-pedal', number: 'I', name: 'Choir to Pedal', from: 0, to: 4, semitones: 0, kind: 'coupler' },
  { id: 'great-to-pedal', number: 'II', name: 'Great to Pedal', from: 1, to: 4, semitones: 0, kind: 'coupler' },
  { id: 'swell-to-pedal', number: 'III', name: 'Swell to Pedal', from: 2, to: 4, semitones: 0, kind: 'coupler' },
  { id: 'solo-to-pedal', number: 'IV', name: 'Solo to Pedal', from: 3, to: 4, semitones: 0, kind: 'coupler' },
  { id: 'choir-on-solo', number: 'V', name: 'Choir (unenclosed) on Solo', from: 'choir', to: 3, semitones: 0, kind: 'coupler',
    note: 'Listed by Wikipedia/NPOR, not in the Mander PDF.' },
  { id: 'orchestral-octave', number: 'VII', name: 'Octave Orchestral', from: 'orchestral', to: 0, semitones: 12, kind: 'octave' },
  { id: 'orchestral-sub-octave', number: 'VIII', name: 'Sub Octave Second Division (Orchestral)', from: 'orchestral', to: 0, semitones: -12, kind: 'suboctave' },
  { id: 'orchestral-unison-off', number: 'IX', name: 'Unison Off', from: 'orchestral', to: 0, semitones: 0, kind: 'unison-off',
    note: 'Listed in the Choir section of [M] after the Orchestral octave couplers; assumed to act on the Orchestral division.' },
  { id: 'swell-to-choir', number: 'X', name: 'Swell to Choir', from: 2, to: 0, semitones: 0, kind: 'coupler' },
  { id: 'solo-to-choir', number: 'XI', name: 'Solo to Choir', from: 3, to: 0, semitones: 0, kind: 'coupler' },
  { id: 'great-reeds-on-choir', number: 'XII', name: 'Reeds on Choir', from: 'great', to: 0, semitones: 0, kind: 'coupler',
    filter: { family: 'reed' }, note: 'Great reeds playable on the Choir manual.' },
  { id: 'great-second-on-choir', number: 'XIII', name: 'Great Second Division on Choir', from: 'great', to: 0, semitones: 0, kind: 'coupler',
    filter: { subdivision: 'great-second' } },
  { id: 'choir-to-great', number: 'XIV', name: 'Choir to Great', from: 0, to: 1, semitones: 0, kind: 'coupler' },
  { id: 'swell-to-great', number: 'XV', name: 'Swell to Great', from: 2, to: 1, semitones: 0, kind: 'coupler' },
  { id: 'solo-to-great', number: 'XVI', name: 'Solo to Great', from: 3, to: 1, semitones: 0, kind: 'coupler' },
  { id: 'swell-octave', number: 'XVIII', name: 'Octave (16′, 8′, 4′ stops only)', from: 'swell', to: 2, semitones: 12, kind: 'octave',
    filter: { pitchFt: [16, 8, 4] } },
  { id: 'solo-to-swell', number: 'XIX', name: 'Solo to Swell', from: 3, to: 2, semitones: 0, kind: 'coupler' },
  { id: 'solo-octave', number: 'XXI', name: 'Octave', from: 'solo', to: 3, semitones: 12, kind: 'octave' },
  { id: 'solo-sub-octave', number: 'XXII', name: 'Sub Octave', from: 'solo', to: 3, semitones: -12, kind: 'suboctave' },
  { id: 'solo-unison-off', number: 'XXIII', name: 'Unison Off', from: 'solo', to: 3, semitones: 0, kind: 'unison-off' },
  { id: 'bombard-octave', number: 'XXIV', name: 'Octave Bombard (16′, 8′, 4′ stops only)', from: 'bombard', to: 3, semitones: 12, kind: 'octave',
    filter: { pitchFt: [16, 8, 4] } },
  { id: 'bombard-on-choir', number: 'XXV', name: 'Bombard on Choir', from: 'bombard', to: 0, semitones: 0, kind: 'coupler',
    filter: { excludeSubdivision: 'bombard-tubas' }, assumed: true,
    note: 'Assumed to carry the 7 enclosed Bombard stops, since the Tubas have their own coupler (XXVI).' },
  { id: 'tubas-on-choir', number: 'XXVI', name: 'Tubas on Choir', from: 'bombard', to: 0, semitones: 0, kind: 'coupler',
    filter: { subdivision: 'bombard-tubas' } },
];

// Accessories. Everything is from the Mander specification [M] unless `assumed: true`.
const _seq = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
const _interCouplers = ['choir-to-pedal', 'great-to-pedal', 'swell-to-pedal', 'solo-to-pedal', 'swell-to-choir',
  'solo-to-choir', 'choir-to-great', 'swell-to-great', 'solo-to-great', 'solo-to-swell'];

export const ACCESSORIES = [
  // tremulants
  { id: 'orchestral-tremulant', number: 'VI', name: 'Tremulant', kind: 'tremulant', division: 'orchestral' },
  { id: 'swell-tremulant', number: 'XVII', name: 'Tremulant', kind: 'tremulant', division: 'swell' },
  { id: 'solo-tremulant', number: 'XX', name: 'Tremulant', kind: 'tremulant', division: 'solo' },
  // expression (not stated in [M]; one pedal per enclosed box is implied by the three swell boxes)
  { id: 'orchestral-swell-pedal', name: 'Orchestral swell pedal', kind: 'swell-pedal', division: 'orchestral', assumed: true },
  { id: 'swell-swell-pedal', name: 'Swell swell pedal', kind: 'swell-pedal', division: 'swell', assumed: true },
  { id: 'solo-swell-pedal', name: 'Solo & Bombard swell pedal', kind: 'swell-pedal', division: 'solo', assumed: true,
    note: 'The Solo box also encloses Bombard stops 138-144 and the Pedal-located reeds are in the Swell box.' },
  // divisional thumb pistons (adjustable)
  ..._seq(5, (i) => ({ id: `choir-piston-${i}`, name: `Choir ${i}`, kind: 'piston', division: 'choir', adjustable: true, manual: 0 })),
  ..._seq(5, (i) => ({ id: `orchestral-piston-${i}`, name: `Orchestral ${i}`, kind: 'piston', division: 'orchestral', adjustable: true, manual: 0 })),
  { id: 'orchestral-piston-clarinet', name: 'Clarinet', kind: 'piston', division: 'orchestral', adjustable: false, manual: 0, stops: ['orchestral-clarinet'] },
  { id: 'orchestral-piston-hautboy', name: 'Orchestral Hautboy', kind: 'piston', division: 'orchestral', adjustable: false, manual: 0, stops: ['orchestral-orchestral-hautboy'] },
  ..._seq(10, (i) => ({ id: `great-piston-${i}`, name: `Great ${i}`, kind: 'piston', division: 'great', adjustable: true, manual: 1 })),
  ..._seq(10, (i) => ({ id: `swell-piston-${i}`, name: `Swell ${i}`, kind: 'piston', division: 'swell', adjustable: true, manual: 2 })),
  ..._seq(5, (i) => ({ id: `solo-piston-${i}`, name: `Solo ${i}`, kind: 'piston', division: 'solo', adjustable: true, manual: 3 })),
  { id: 'solo-piston-corno-di-bassetto', name: 'Corno di Bassetto', kind: 'piston', division: 'solo', adjustable: false, manual: 3, stops: ['solo-corno-di-bassetto'] },
  { id: 'solo-piston-french-horn', name: 'French Horn', kind: 'piston', division: 'solo', adjustable: false, manual: 3, stops: ['solo-french-horn'] },
  // Bombard: 6 fixed pistons per [M], of which 5 are named
  { id: 'bombard-piston-tuba', name: 'Tuba', kind: 'piston', division: 'bombard', adjustable: false, manual: 3, stops: ['bombard-tuba'] },
  { id: 'bombard-piston-orchestral-trumpet', name: 'Orchestral Trumpet', kind: 'piston', division: 'bombard', adjustable: false, manual: 3, stops: ['bombard-orchestral-trumpet'] },
  { id: 'bombard-piston-full-enclosed', name: 'Full Enclosed', kind: 'piston', division: 'bombard', adjustable: false, manual: 3 },
  { id: 'bombard-piston-tuba-mirabilis', name: 'Tuba Mirabilis', kind: 'piston', division: 'bombard', adjustable: false, manual: 3, stops: ['bombard-tuba-mirabilis'] },
  { id: 'bombard-piston-full-tubas', name: 'Full Tubas', kind: 'piston', division: 'bombard', adjustable: false, manual: 3,
    stops: ['bombard-contra-tuba', 'bombard-tuba-mirabilis', 'bombard-tuba-clarion'] },
  { id: 'bombard-piston-6', name: 'Bombard 6', kind: 'piston', division: 'bombard', adjustable: false, manual: 3, unnamed: true,
    note: '[M] states 6 fixed Bombard pistons but names only 5.' },
  // pedal toe pistons
  ..._seq(10, (i) => ({ id: `pedal-toe-piston-${i}`, name: `Pedal ${i}`, kind: 'toe-piston', division: 'pedal', adjustable: true })),
  // generals
  ..._seq(12, (i) => ({ id: `general-piston-${i}`, name: `General ${i}`, kind: 'general-piston', adjustable: true })),
  ..._seq(12, (i) => ({ id: `general-toe-piston-${i}`, name: `General ${i} (toe)`, kind: 'toe-piston', adjustable: true, duplicates: `general-piston-${i}` })),
  // reversibles
  ..._interCouplers.map((c) => ({ id: `reversible-${c}`, name: `${c.replace(/-/g, ' ')} reversible`, kind: 'reversible-piston', coupler: c,
    assumed: true, note: '[M]: "reversible pistons to all principal inter-departmental couplers" — exact set not listed.' })),
  { id: 'reversible-pedal-ophicleide', name: 'Pedal Ophicleide reversible', kind: 'reversible-piston', stop: 'pedal-ophicleide' },
  { id: 'reversible-toe-great-to-pedal', name: 'Great to Pedal (toe)', kind: 'reversible-toe-piston', coupler: 'great-to-pedal' },
  { id: 'reversible-toe-solo-to-pedal', name: 'Solo to Pedal (toe)', kind: 'reversible-toe-piston', coupler: 'solo-to-pedal' },
  { id: 'reversible-toe-solo-to-great-and-pedal', name: 'Solo to Great & Pedal (toe)', kind: 'reversible-toe-piston', coupler: ['solo-to-great', 'solo-to-pedal'] },
  // sequencer
  { id: 'sequencer-advance-great', name: 'Sequencer advance (below Great treble)', kind: 'sequencer', action: 'advance', manual: 1 },
  { id: 'sequencer-advance-swell', name: 'Sequencer advance (below Swell treble)', kind: 'sequencer', action: 'advance', manual: 2 },
  { id: 'sequencer-advance-toe', name: 'Sequencer advance (toe)', kind: 'sequencer', action: 'advance', toe: true },
  { id: 'sequencer-back-swell', name: 'Sequencer back (below Swell bass)', kind: 'sequencer', action: 'back', manual: 2 },
  { id: 'sequencer-back-toe', name: 'Sequencer back (toe)', kind: 'sequencer', action: 'back', toe: true },
  { id: 'sequencer-advance-rocker', name: 'Sequencer advance rocker (treble keycheek)', kind: 'rocker-tablet', action: 'advance' },
  { id: 'sequencer-back-rocker', name: 'Sequencer back rocker (treble keycheek)', kind: 'rocker-tablet', action: 'back' },
  { id: 'great-pedal-combinations-coupled', name: 'Great and Pedal combinations coupled', kind: 'rocker-tablet' },
  { id: 'swell-on-general-toe-pistons', name: 'Swell combinations on General toe pistons', kind: 'rocker-tablet' },
  // cancels & setter
  { id: 'choir-cancel', name: 'Choir cancel', kind: 'cancel', manual: 0 },
  { id: 'great-cancel', name: 'Great cancel', kind: 'cancel', manual: 1 },
  { id: 'swell-cancel', name: 'Swell cancel', kind: 'cancel', manual: 2 },
  { id: 'solo-cancel', name: 'Solo cancel', kind: 'cancel', manual: 3 },
  { id: 'pedal-cancel-toe', name: 'Pedal cancel (toe)', kind: 'cancel', division: 'pedal', toe: true },
  { id: 'general-cancel', name: 'General cancel', kind: 'general-cancel' },
  { id: 'setter', name: 'Setter', kind: 'setter' },
  // system
  { id: 'combination-system', name: 'Capture combination system', kind: 'combination', memoryLevels: 64,
    note: 'Generals and divisionals separately switchable; floppy-disk storage.' },
  { id: 'ventils', name: 'Ventil switches to non-slider chests', kind: 'ventil' },
];

// ----------------------------------------------------------------------------- helpers
const _byId = new Map(STOPS.map((s) => [s.id, s]));

export const MANUAL_DIVISIONS = (manual) => DIVISIONS.filter((d) => d.manual === manual).map((d) => d.id);

export function stopsOfDivision(id) {
  return STOPS.filter((s) => s.division === id).sort((a, b) => a.order - b.order);
}

export function stopById(id) {
  return _byId.get(id) ?? null;
}

/** Follows the derived chain to the stop that owns the sounding pipes.
 *  Returns { stop, semitones } where semitones is the total offset relative to that source rank. */
export function resolveSource(stop) {
  let s = typeof stop === 'string' ? stopById(stop) : stop;
  let semitones = 0;
  const seen = new Set();
  while (s && s.derived) {
    if (seen.has(s.id)) return null;
    seen.add(s.id);
    semitones += s.derived.semitones;
    s = stopById(s.derived.from);
  }
  return s ? { stop: s, semitones } : null;
}

/** Stops a coupler draws from (respecting its filter). */
export function couplerSourceStops(coupler) {
  const divs = typeof coupler.from === 'number' ? MANUAL_DIVISIONS(coupler.from) : [coupler.from];
  const f = coupler.filter || {};
  return STOPS.filter((s) => divs.includes(s.division)
    && (!f.family || s.family === f.family)
    && (!f.subdivision || s.subdivision === f.subdivision)
    && (!f.excludeSubdivision || s.subdivision !== f.excludeSubdivision)
    && (!f.pitchFt || f.pitchFt.includes(s.pitchFt)));
}

/** First note index (0 = the stop's bottom C) at which rank `r` has pipes. */
export function rankStartOf(stop, r) {
  return (stop && stop.rankStart && stop.rankStart[r]) || 0;
}

export function validate() {
  const problems = [];
  const ids = new Set();
  for (const s of STOPS) {
    if (ids.has(s.id)) problems.push(`duplicate id ${s.id}`);
    ids.add(s.id);
    if (!DIVISIONS.some((d) => d.id === s.division)) problems.push(`${s.id}: unknown division`);
    if (!s.id.startsWith(s.division + '-')) problems.push(`${s.id}: id not prefixed by division`);
    if (s.derived) {
      const src = stopById(s.derived.from);
      if (!src) problems.push(`${s.id}: derived.from ${s.derived.from} missing`);
      else if (s.semitones - src.semitones !== s.derived.semitones) problems.push(`${s.id}: derived.semitones mismatch`);
      if (!resolveSource(s)) problems.push(`${s.id}: derived chain broken`);
      if (s.derived.kind === 'transmission' && s.pipes !== 0) problems.push(`${s.id}: transmission with pipes`);
      if (s.derived.kind === 'extension' && (s.pipes < 0 || s.pipes > 24)) problems.push(`${s.id}: extension pipes out of range`);
    }
    if (s.percussion && s.pipes !== 0) problems.push(`${s.id}: percussion with pipes`);
    if (s.composition && s.composition.length !== s.ranks) problems.push(`${s.id}: composition/ranks mismatch`);
    if (!(s.loudness >= 0 && s.loudness <= 1)) problems.push(`${s.id}: loudness out of range`);
    if (s.rankStart) {
      const compass = DIVISIONS.find((d) => d.id === s.division)?.compass ?? 61;
      if (!Array.isArray(s.rankStart) || s.rankStart.length !== s.ranks
        || s.rankStart.some((n) => !Number.isInteger(n) || n < 0 || n >= compass)) problems.push(`${s.id}: bad rankStart`);
      else if (s.rankStart.reduce((t, n) => t + (compass - n), 0) !== s.pipes) problems.push(`${s.id}: rankStart/pipes mismatch`);
    }
  }
  const nums = new Set(STOPS.map((s) => s.number));
  if (nums.size !== 147 || Math.min(...nums) !== 1 || Math.max(...nums) !== 147) problems.push('stop numbers are not 1..147');
  for (const d of DIVISIONS) {
    const list = stopsOfDivision(d.id);
    list.forEach((s, i) => { if (s.order !== i) problems.push(`${s.id}: order gap`); });
    const c = META.counts.byDivision[d.id];
    if (c && c.total !== list.length) problems.push(`${d.id}: count ${list.length} != META ${c.total}`);
  }
  for (const a of PIPE_COUNT_ADJUSTMENTS) if (!stopById(a.stopId)) problems.push(`adjustment for missing ${a.stopId}`);
  const derivedSum = STOPS.reduce((t, s) => t + s.pipesDerived, 0);
  const adjSum = PIPE_COUNT_ADJUSTMENTS.reduce((t, a) => t + a.delta, 0);
  const totalPipes = STOPS.reduce((t, s) => t + s.pipes, 0);
  if (derivedSum + adjSum !== totalPipes) problems.push('pipesDerived + adjustments != pipes');
  if (derivedSum !== META.pipesDerivedTotal) problems.push(`pipesDerived total ${derivedSum} != META`);
  if (totalPipes !== META.totalPipes) problems.push(`pipe total ${totalPipes} != ${META.totalPipes}`);
  const speakingStops = STOPS.filter((s) => !s.derived && !s.percussion).length;
  const derived = STOPS.filter((s) => s.derived);
  const derivedCount = derived.length;
  if (speakingStops !== META.counts.speakingStops) problems.push(`speaking ${speakingStops} != META`);
  if (derivedCount !== META.counts.derivedStops) problems.push(`derived ${derivedCount} != META`);
  if (derived.filter((s) => s.derived.kind === 'extension').length !== META.counts.extensions) problems.push('extension count != META');
  const cids = new Set();
  for (const c of COUPLERS) {
    if (cids.has(c.id)) problems.push(`duplicate coupler ${c.id}`);
    cids.add(c.id);
    if (typeof c.from === 'string' && !DIVISIONS.some((d) => d.id === c.from)) problems.push(`${c.id}: bad from`);
    if (!couplerSourceStops(c).length) problems.push(`${c.id}: couples no stops`);
  }
  if (COUPLERS.length !== META.counts.couplers) problems.push('coupler count != META');
  const aids = new Set();
  for (const a of ACCESSORIES) {
    if (aids.has(a.id)) problems.push(`duplicate accessory ${a.id}`);
    aids.add(a.id);
    for (const sid of a.stops || []) if (!stopById(sid)) problems.push(`${a.id}: unknown stop ${sid}`);
    for (const cid of [].concat(a.coupler || [])) if (!cids.has(cid)) problems.push(`${a.id}: unknown coupler ${cid}`);
    if (a.stop && !stopById(a.stop)) problems.push(`${a.id}: unknown stop ${a.stop}`);
  }
  return {
    speakingStops, derivedCount, percussion: STOPS.filter((s) => s.percussion).length, numberedStops: STOPS.length,
    totalPipes, pipesDerived: derivedSum, couplers: COUPLERS.length, accessories: ACCESSORIES.length,
    tremulants: ACCESSORIES.filter((a) => a.kind === 'tremulant').length, ok: problems.length === 0, problems,
  };
}
