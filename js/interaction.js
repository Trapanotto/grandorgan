// Interaction layer of the Royal Albert Hall Grand Organ model:
// picking, computer keyboard, Web MIDI, combination system, register panel,
// camera presets, demo player, pipe-event tracker.
//
// This module is the ONLY emitter on ctx.bus. Events (exact payloads):
//   'noteon' / 'noteoff'  { midi, manual }          key physically played (couplers add none)
//   'stop'                { id, on }                 all 147 STOPS
//   'coupler'             { id, on }                 all 23 COUPLERS
//   'tremulant'           { id, on }                 3 tremulants
//   'swell'               { id, value }              3 swell pedals, value 0 (shut) .. 1 (open)
//   'piston'              { id } | { id, on }        momentary press of any other accessory;
//                                                    toggle-type accessories (setter, rocker
//                                                    tablets, ventils) add their new state `on`
//   'pipeon' / 'pipeoff'  { stopId, division, midi, noteIndex, rank, key }
//                                                    one per sounding pipe, reference counted
// Every control (3D mesh, panel button, keyboard shortcut, demo) goes through
// the same setter functions, which emit on the bus; audio, panel and pipe
// tracker react to the bus.
//
// Importing this file touches neither DOM nor WebAudio, so the pure parts can
// be tested in node.

import { createOrganAudio, voiceKey } from './audio.js';
import { META, STOPS, COUPLERS, ACCESSORIES, stopById, stopsOfDivision } from './stoplist.js';
import { parseMidiFile, midiToScore, formatTime, MIDI_MAX_SECONDS, MIDI_MAX_POLYPHONY, MIDI_MAX_BYTES } from './demos.js';
export { parseMidiFile, midiToScore, splitPedal, foldIntoCompass, capPolyphony, removeOverlaps, formatTime, MIDI_MAX_SECONDS, MIDI_MAX_POLYPHONY } from './demos.js';

export const MANUAL_CHOIR = 0;
export const MANUAL_GREAT = 1;
export const MANUAL_SWELL = 2;
export const MANUAL_SOLO = 3;
export const MANUAL_PEDAL = 4;
export const MANUAL_MIN = 36;
export const MANUAL_MAX = 96;
export const PEDAL_MAX = 67;
export const MANUAL_LABELS = ['Choir', 'Great', 'Swell', 'Solo', 'Pedal'];
export const MANUAL_ROMAN = ['I', 'II', 'III', 'IV', 'Ped.'];

// ---------------------------------------------------------------------------
// Static tables & labels
// ---------------------------------------------------------------------------
export const DIV_LABEL = { pedal: 'Pedal', choir: 'Choir', orchestral: 'Orchestral', great: 'Great', swell: 'Swell', solo: 'Solo', bombard: 'Bombard' };
export const DIV_DE = {
  pedal: 'Pedalwerk', choir: 'Chorwerk (Choir, unverschlossen)', orchestral: 'Orchesterwerk (Orchestral, im Schwellkasten)',
  great: 'Hauptwerk (Great)', swell: 'Schwellwerk (Swell)', solo: 'Solowerk (Solo, im Schwellkasten)', bombard: 'Bombardwerk (Bombard)',
};
const DIV_ALIASES = {
  pedal: 'pedal ped pedalwerk', choir: 'choir chor chorwerk i', orchestral: 'orchestral orchester orchesterwerk i',
  great: 'great hauptwerk hw ii', swell: 'swell schwellwerk sw iii', solo: 'solo solowerk iv', bombard: 'bombard bombardwerk iv',
};
const FAMILY_DE = {
  principal: 'Prinzipal principal', flute: 'Flöte flute floete', string: 'Streicher string', reed: 'Zunge zungen reed',
  mutation: 'Aliquot mutation', mixture: 'Mixtur mixture gemischt', percussion: 'Schlagwerk percussion glocken',
};
const SWELL_BOX_OF_MANUAL = ['orchestral-swell-pedal', 'swell-swell-pedal', 'swell-swell-pedal', 'solo-swell-pedal', 'swell-swell-pedal'];

const ACC_BY_ID = new Map(ACCESSORIES.map((a) => [a.id, a]));
const STOP_IDS = STOPS.map((s) => s.id);
const STOP_SET = new Set(STOP_IDS);
const COUPLER_BY_ID = new Map(COUPLERS.map((c) => [c.id, c]));
const STOP_BY_NUMBER = new Map(STOPS.map((s) => [s.number, s]));
export const TREMULANT_IDS = ACCESSORIES.filter((a) => a.kind === 'tremulant').map((a) => a.id);
export const SWELL_IDS = ACCESSORIES.filter((a) => a.kind === 'swell-pedal').map((a) => a.id);
/** every accessory that is operated as a piston / tablet (all except tremulants and swell pedals) */
export const PISTON_IDS = ACCESSORIES.filter((a) => a.kind !== 'tremulant' && a.kind !== 'swell-pedal').map((a) => a.id);
const TOGGLE_ACCESSORIES = new Set(['great-pedal-combinations-coupled', 'swell-on-general-toe-pistons', 'ventils']);

const numOf = (id) => { const m = /-(\d+)$/.exec(id); return m ? +m[1] : null; };

export function pitchLabel(s) {
  if (!s || s.percussion || !s.pitch) return '';
  if (/^[IVX]+$/.test(s.pitch)) return s.pitch;
  return s.pitch.replace(' 1/3', '⅓').replace(' 2/3', '⅔').replace(' 3/5', '⅗') + '′';
}
export function pitchSpoken(s) {
  if (!s || s.percussion) return 'Schlagwerk';
  if (/^[IVX]+$/.test(s.pitch)) return `${s.pitch}-fach`;
  return `${s.pitch} Fuß`;
}
export const stopLabel = (s) => `${s.name} ${pitchLabel(s)}`.trim();

export function derivedInfo(s) {
  if (!s || !s.derived) return null;
  const src = stopById(s.derived.from);
  if (!src) return null;
  const st = s.derived.semitones;
  if (s.resultant) {
    return { kind: 'Resultante', short: `↗ aus Nr. ${src.number}`, text: `Akustischer Bass (Resultante 64′): ${src.name} ${pitchLabel(src)} (Nr. ${src.number}) erklingt in 32′- und 21⅓′-Lage zusammen` };
  }
  if (s.derived.kind === 'transmission') {
    return { kind: 'Transmission', short: `↗ aus Nr. ${src.number}`, text: `Transmission: dieselben Pfeifen wie Nr. ${src.number} ${src.name} ${pitchLabel(src)} (${DIV_LABEL[src.division]}) in gleicher Tonhöhe` };
  }
  const dir = st < 0 ? `${-st} Halbtöne tiefer` : `${st} Halbtöne höher`;
  return { kind: 'Extension', short: `↗ aus Nr. ${src.number}`, text: `Extension: Pfeifenreihe von Nr. ${src.number} ${src.name} ${pitchLabel(src)}, ${dir} angespielt (zusätzliche Pfeifen nur am Rand)` };
}

const SEQ_WHERE = {
  'sequencer-advance-great': 'unter dem Great-Diskant', 'sequencer-advance-swell': 'unter dem Swell-Diskant',
  'sequencer-advance-toe': 'Fußtritt', 'sequencer-back-swell': 'unter dem Swell-Bass', 'sequencer-back-toe': 'Fußtritt',
  'sequencer-advance-rocker': 'Wippe am Diskant-Backenstück', 'sequencer-back-rocker': 'Wippe am Diskant-Backenstück',
};
const couplerName = (id) => (COUPLER_BY_ID.get(id) ? COUPLER_BY_ID.get(id).name : id);

/** German label of an accessory. */
export function accessoryLabel(a) {
  if (typeof a === 'string') a = ACC_BY_ID.get(a);
  if (!a) return '';
  const n = numOf(a.id);
  switch (a.kind) {
    case 'tremulant': return `Tremulant ${DIV_LABEL[a.division]}`;
    case 'swell-pedal': return a.division === 'solo' ? 'Schwelltritt Solo & Bombard' : `Schwelltritt ${DIV_LABEL[a.division]}`;
    case 'piston':
      if (a.adjustable) return `${DIV_LABEL[a.division]} ${n}`;
      if (a.unnamed) return 'Bombard 6 (unbenannt)';
      return `${a.name} (fest)`;
    case 'toe-piston': return a.duplicates ? `General ${n} (Fuß)` : `Pedal ${n} (Fuß)`;
    case 'general-piston': return `General ${n}`;
    case 'reversible-piston': return a.stop ? 'Wechsel Pedal Ophicleide' : `Wechsel ${couplerName(a.coupler)}`;
    case 'reversible-toe-piston': return `Wechsel (Fuß) ${[].concat(a.coupler).map(couplerName).join(' + ')}`;
    case 'sequencer': return `Sequenzer ${a.action === 'advance' ? 'vor' : 'zurück'} (${SEQ_WHERE[a.id] || ''})`;
    case 'rocker-tablet':
      if (a.action) return `Sequenzer ${a.action === 'advance' ? 'vor' : 'zurück'} (Wippe)`;
      if (a.id === 'great-pedal-combinations-coupled') return 'Great- & Pedalkombinationen gekoppelt';
      if (a.id === 'swell-on-general-toe-pistons') return 'Swell-Kombinationen auf General-Fußtritten';
      return a.name;
    case 'cancel': return a.division === 'pedal' ? 'Auslöser Pedal (Fuß)' : `Auslöser ${MANUAL_LABELS[a.manual]}`;
    case 'general-cancel': return 'Generalauslöser';
    case 'setter': return 'Setzer';
    case 'combination': return 'Speicherebene';
    case 'ventil': return 'Ventile';
    default: return a.name;
  }
}

/** German description of what an accessory does (tooltips). */
export function accessoryHint(a) {
  if (typeof a === 'string') a = ACC_BY_ID.get(a);
  if (!a) return '';
  switch (a.kind) {
    case 'piston': return a.adjustable ? 'Einstellbarer Divisionalkolben' : 'Fester Kolben' + (a.stops ? `: ${a.stops.map((id) => stopById(id)?.name).join(', ')}` : '');
    case 'toe-piston': return a.duplicates ? 'General-Fußtritt (wie Generalkolben)' : 'Einstellbarer Pedal-Fußtritt';
    case 'general-piston': return 'Einstellbarer Generalkolben (ganze Orgel)';
    case 'reversible-piston': case 'reversible-toe-piston': return 'Wechselkolben: schaltet ein bzw. aus';
    case 'sequencer': return 'Schaltet durch die Generalkombinationen';
    case 'rocker-tablet': return a.action ? 'Schaltet durch die Generalkombinationen' : 'Umschalter';
    case 'cancel': return 'Stößt alle Register und Koppeln dieses Manuals ab';
    case 'general-cancel': return 'Stößt alle Register, Koppeln und Tremulanten ab';
    case 'setter': return 'Setzer: danach einen Kolben drücken, um die aktuelle Registrierung zu speichern';
    case 'combination': return 'Wechselt die Speicherebene (1–64) der Setzeranlage';
    case 'ventil': return 'Ventilschalter (Windzufuhr) – ohne Klangwirkung im Modell';
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Combination scopes and default combinations
// ---------------------------------------------------------------------------
const ids = (div, names) => names.map((n) => `${div}-${n}`);
const stopsOfDivs = (...divs) => STOPS.filter((s) => divs.includes(s.division)).map((s) => s.id);
const couplersTo = (man, pred = () => true) => COUPLERS.filter((c) => c.to === man && pred(c)).map((c) => c.id);

const DIV_SCOPE = {
  choir: { stops: stopsOfDivs('choir'), couplers: couplersTo(0, (c) => c.from !== 'orchestral'), tremulants: [] },
  orchestral: { stops: stopsOfDivs('orchestral'), couplers: COUPLERS.filter((c) => c.from === 'orchestral').map((c) => c.id), tremulants: ['orchestral-tremulant'] },
  great: { stops: stopsOfDivs('great'), couplers: couplersTo(1), tremulants: [] },
  swell: { stops: stopsOfDivs('swell'), couplers: couplersTo(2), tremulants: ['swell-tremulant'] },
  solo: { stops: stopsOfDivs('solo'), couplers: couplersTo(3, (c) => c.from !== 'bombard'), tremulants: ['solo-tremulant'] },
  bombard: { stops: stopsOfDivs('bombard'), couplers: ['bombard-octave'], tremulants: [] },
  pedal: { stops: stopsOfDivs('pedal'), couplers: couplersTo(4), tremulants: [] },
};
const ALL_SCOPE = { stops: STOP_IDS, couplers: COUPLERS.map((c) => c.id), tremulants: TREMULANT_IDS };
const union = (...sc) => ({
  stops: [...new Set(sc.flatMap((s) => s.stops))], couplers: [...new Set(sc.flatMap((s) => s.couplers))], tremulants: [...new Set(sc.flatMap((s) => s.tremulants))],
});
const CANCEL_SCOPE = {
  'choir-cancel': union(DIV_SCOPE.choir, DIV_SCOPE.orchestral),
  'great-cancel': DIV_SCOPE.great,
  'swell-cancel': DIV_SCOPE.swell,
  'solo-cancel': union(DIV_SCOPE.solo, DIV_SCOPE.bombard),
  'pedal-cancel-toe': DIV_SCOPE.pedal,
  'general-cancel': ALL_SCOPE,
};

/** Which stops / couplers / tremulants an accessory's combination covers. */
export function scopeOf(id) {
  const a = ACC_BY_ID.get(id);
  if (!a) return null;
  if (CANCEL_SCOPE[id]) return CANCEL_SCOPE[id];
  if (a.kind === 'general-piston' || a.duplicates) return ALL_SCOPE;
  if (a.kind === 'piston' || a.kind === 'toe-piston') {
    const sc = DIV_SCOPE[a.division];
    if (!sc) return null;
    return a.adjustable ? sc : { stops: sc.stops, couplers: [], tremulants: [] };
  }
  return null;
}

const snap = (stops, couplers = [], tremulants = []) => ({ stops, couplers, tremulants });
const cum = (div, steps) => { const out = []; let acc = []; for (const s of steps) { acc = acc.concat(ids(div, s)); out.push([...new Set(acc)]); } return out; };

const GREAT = cum('great', [
  ['hohl-flute'], ['open-diapason-4'], ['open-diapason-3', 'harmonic-flute'], ['open-diapason-2', 'octave'],
  ['open-diapason-1', 'principal', 'super-octave'], ['double-open-diapason', 'quint', 'octave-quint', 'fifteenth'],
  ['mixture'], ['harmonics', 'fourniture', 'double-claribel-flute', 'geigen'], ['tromba', 'harmonic-trumpet', 'harmonic-clarion', 'cymbale'],
  ['contra-tromba', 'octave-tromba', 'posaune', 'open-diapason-5', 'contra-violone', 'contra-gamba', 'bourdon', 'viola-da-gamba'],
]);
GREAT[2] = ids('great', ['open-diapason-3', 'hohl-flute', 'harmonic-flute']);
const SWELL = [
  ids('swell', ['salicional', 'vox-angelica']),
  ids('swell', ['claribel-flute', 'salicional', 'vox-angelica']),
  ids('swell', ['claribel-flute', 'harmonic-flute']),
  ids('swell', ['open-diapason', 'claribel-flute', 'principal']),
  ids('swell', ['open-diapason', 'claribel-flute', 'viola-da-gamba', 'principal', 'oboe']),
  ...cum('swell', [['open-diapason', 'bourdon', 'claribel-flute', 'principal', 'super-octave', 'mixture'], ['octave-quint', 'fourniture', 'trumpet'],
    ['double-open-diapason', 'clarion', 'oboe', 'harmonic-piccolo'], ['double-trumpet', 'viola'], ['tuba', 'tuba-clarion', 'contra-oboe']]),
];
const CHOIR = [
  ids('choir', ['lieblich-gedeckt']),
  ids('choir', ['dulciana', 'lieblich-gedeckt', 'lieblich-flute']),
  ids('choir', ['open-diapason', 'lieblich-gedeckt', 'gemshorn']),
  ids('choir', ['lieblich-gedeckt', 'lieblich-flute', 'nazard', 'flageolet', 'tierce']),
  ids('choir', ['open-diapason', 'lieblich-gedeckt', 'gemshorn', 'flageolet', 'mixture', 'trumpet', 'clarion']),
];
const ORCH_STR = ['contra-viole', 'violoncello', 'viole-dorchestre-i', 'viole-dorchestre-ii', 'violes-celestes', 'viole-octaviante'];
const ORCH = [
  ids('orchestral', ['viole-sourdine']),
  ids('orchestral', ['viole-dorchestre-i', 'violes-celestes']),
  ids('orchestral', ['harmonic-flute', 'concert-flute']),
  ids('orchestral', ORCH_STR),
  ids('orchestral', [...ORCH_STR, 'cornet-de-violes', 'quintaton', 'harmonic-flute', 'concert-flute', 'harmonic-piccolo', 'double-clarinet', 'clarinet', 'orchestral-hautboy', 'cor-anglais']),
];
const SOLO = [
  ids('solo', ['unda-maris']),
  ids('solo', ['harmonic-claribel-flute', 'wald-flute']),
  ids('solo', ['flute-a-pavillon', 'doppel-flute', 'flauto-traverso']),
  ids('solo', ['corno-di-bassetto', 'french-horn', 'doppel-flute']),
  ids('solo', ['contra-bass', 'flute-a-pavillon', 'doppel-flute', 'harmonic-claribel-flute', 'wald-flute', 'flauto-traverso', 'piccolo-traverso',
    'double-bassoon', 'hautboy', 'bassoon', 'double-horn', 'french-horn', 'corno-di-bassetto']),
];
const PEDAL = [
  ids('pedal', ['sub-bass']),
  ids('pedal', ['sub-bass', 'flute']),
  ids('pedal', ['violone', 'sub-bass', 'flute']),
  ids('pedal', ['open-wood-ii', 'sub-bass', 'flute']),
  ids('pedal', ['open-diapason-ii', 'open-wood-ii', 'sub-bass', 'principal', 'flute']),
  ...cum('pedal', [['open-diapason-i', 'open-wood-i', 'open-wood-ii', 'octave-wood', 'principal', 'super-octave', 'quint'],
    ['double-open-wood', 'violone', 'mixture', 'octave-quint', 'fagotto'],
    ['double-open-diapason', 'harmonics', 'trombone', 'bombard', 'posaune', 'violoncello'],
    ['ophicleide', 'clarion', 'quint-trombone', 'double-trombone', 'open-diapason-ii'],
    ['double-ophicleide', 'octave-posaune', 'acoustic-bass', 'contra-violone', 'double-quint']]),
];
const PEDAL_COUPLERS = (n) => (n <= 3 ? ['swell-to-pedal'] : n <= 9 ? ['swell-to-pedal', 'great-to-pedal'] : ['swell-to-pedal', 'great-to-pedal', 'solo-to-pedal']);
const BOMBARD_ENCLOSED = STOPS.filter((s) => s.division === 'bombard' && s.subdivision !== 'bombard-tubas').map((s) => s.id);
const BOMBARD_ALL = stopsOfDivs('bombard');
const BOMBARD_G10 = ids('bombard', ['bombardon', 'orchestral-trumpet', 'cornopean', 'orchestral-clarion']);

const GENERAL_PLAN = [
  // [swell, great, choir, orchestral, solo, bombard, pedal, couplers, tremulants]
  [1, 0, 1, 0, 0, null, 1, ['swell-to-pedal'], ['swell-tremulant']],
  [3, 1, 2, 0, 0, null, 2, ['swell-to-great', 'swell-to-pedal'], []],
  [4, 2, 3, 1, 0, null, 3, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal'], []],
  [5, 3, 3, 2, 2, null, 4, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal'], []],
  [6, 4, 3, 3, 3, null, 5, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal', 'swell-to-choir'], []],
  [6, 5, 4, 4, 3, null, 6, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal', 'swell-to-choir'], []],
  [7, 6, 4, 4, 4, null, 7, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal', 'swell-to-choir'], []],
  [8, 7, 5, 5, 4, null, 8, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal', 'swell-to-choir', 'choir-to-great'], []],
  [9, 8, 5, 5, 5, null, 8, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal', 'swell-to-choir', 'choir-to-great'], []],
  [9, 9, 5, 5, 5, BOMBARD_G10, 9, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal', 'swell-to-choir', 'choir-to-great', 'solo-to-great'], []],
  [10, 10, 5, 5, 5, BOMBARD_ENCLOSED, 9, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal', 'swell-to-choir', 'choir-to-great', 'solo-to-great', 'solo-to-pedal'], []],
  [10, 10, 5, 5, 5, BOMBARD_ALL, 10, ['swell-to-great', 'swell-to-pedal', 'great-to-pedal', 'swell-to-choir', 'choir-to-great', 'solo-to-great', 'solo-to-pedal', 'solo-to-choir', 'tubas-on-choir'], []],
];
const nth = (arr, n) => (n ? arr[n - 1] : []);

function buildDefaults() {
  const d = {};
  for (let i = 1; i <= 10; i++) {
    d[`great-piston-${i}`] = snap(GREAT[i - 1], i >= 2 ? ['swell-to-great'] : []);
    d[`swell-piston-${i}`] = snap(SWELL[i - 1], i >= 10 ? ['swell-octave'] : [], i <= 2 ? ['swell-tremulant'] : []);
    d[`pedal-toe-piston-${i}`] = snap(PEDAL[i - 1], PEDAL_COUPLERS(i));
  }
  for (let i = 1; i <= 5; i++) {
    d[`choir-piston-${i}`] = snap(CHOIR[i - 1], i >= 4 ? ['swell-to-choir'] : []);
    d[`orchestral-piston-${i}`] = snap(ORCH[i - 1], [], i === 2 ? ['orchestral-tremulant'] : []);
    d[`solo-piston-${i}`] = snap(SOLO[i - 1], [], i === 1 || i === 4 ? ['solo-tremulant'] : []);
  }
  GENERAL_PLAN.forEach(([sw, gt, ch, or, so, bo, pe, cp, tr], i) => {
    d[`general-piston-${i + 1}`] = snap([...nth(SWELL, sw), ...nth(GREAT, gt), ...nth(CHOIR, ch), ...nth(ORCH, or), ...nth(SOLO, so), ...(bo || []), ...nth(PEDAL, pe)], cp, tr);
  });
  // fixed pistons
  for (const a of ACCESSORIES) {
    if (a.kind !== 'piston' || a.adjustable) continue;
    if (a.stops) d[a.id] = snap([...a.stops]);
    else if (a.id === 'bombard-piston-full-enclosed') d[a.id] = snap([...BOMBARD_ENCLOSED]);
    else d[a.id] = snap([...BOMBARD_ALL]); // the unnamed 6th Bombard piston: assumed "full Bombard"
  }
  return d;
}
export const DEFAULT_COMBINATIONS = buildDefaults();
export const TUTTI_REGISTRATION = DEFAULT_COMBINATIONS['general-piston-12'];
export const DEFAULT_REGISTRATION = snap(
  [...ids('great', ['open-diapason-2', 'hohl-flute', 'octave']), ...ids('swell', ['open-diapason', 'claribel-flute', 'principal']), ...ids('pedal', ['sub-bass', 'violone', 'flute'])],
  ['swell-to-great', 'great-to-pedal']);
export const DEFAULT_SWELL = 0.7;

// ---------------------------------------------------------------------------
// Combination system (pure; state access injected)
// ---------------------------------------------------------------------------
export const COMBINATION_STORAGE_KEY = 'rah-orgel-kombinationen-v1';
export const MEMORY_LEVELS = 64;

/**
 * getState()            -> { stops: Set, couplers: Set, tremulants: Set }
 * apply(scope, snapshot) applies the snapshot inside the scope (ids in scope not in snapshot go off)
 * setCoupler(id, on), setStop(id, on) for reversibles
 * storage               localStorage-like or null
 * onChange(info)        UI feedback { message, kind }
 */
export function createCombinationSystem({ getState, apply, setStop, setCoupler, storage = null, onChange = () => {} }) {
  let level = 1;
  let armed = false;
  let seq = -1;
  const toggles = new Set(['ventils']);
  let memory = {};
  try {
    const raw = storage && storage.getItem(COMBINATION_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        memory = data.levels && typeof data.levels === 'object' ? data.levels : {};
        if (Number.isInteger(data.level) && data.level >= 1 && data.level <= MEMORY_LEVELS) level = data.level;
      }
    }
  } catch { memory = {}; }

  function persist() {
    try { if (storage) storage.setItem(COMBINATION_STORAGE_KEY, JSON.stringify({ level, levels: memory })); } catch { /* quota / private mode */ }
  }
  const sanitize = (s) => ({
    stops: (s && Array.isArray(s.stops) ? s.stops : []).filter((id) => STOP_SET.has(id)),
    couplers: (s && Array.isArray(s.couplers) ? s.couplers : []).filter((id) => COUPLER_BY_ID.has(id)),
    tremulants: (s && Array.isArray(s.tremulants) ? s.tremulants : []).filter((id) => TREMULANT_IDS.includes(id)),
  });
  function combination(id) {
    const user = memory[level] && memory[level][id];
    return sanitize(user || DEFAULT_COMBINATIONS[id] || snap([]));
  }
  function capture(scope) {
    const st = getState();
    return {
      stops: scope.stops.filter((id) => st.stops.has(id)),
      couplers: scope.couplers.filter((id) => st.couplers.has(id)),
      tremulants: scope.tremulants.filter((id) => st.tremulants.has(id)),
    };
  }
  /** maps a general toe piston to the piston whose memory it uses */
  function target(id) {
    const a = ACC_BY_ID.get(id);
    if (a && a.duplicates) {
      if (toggles.has('swell-on-general-toe-pistons')) {
        const n = numOf(id);
        return n <= 10 ? `swell-piston-${n}` : null;
      }
      return a.duplicates;
    }
    return id;
  }
  function recall(id) {
    const t = target(id);
    if (!t) { onChange({ kind: 'info', message: `${accessoryLabel(id)}: nicht belegt` }); return false; }
    const sc = scopeOf(t);
    if (!sc) return false;
    apply(sc, combination(t));
    const a = ACC_BY_ID.get(t);
    if (a.kind === 'general-piston') seq = numOf(t) - 1;
    if (a.division === 'great' && a.adjustable && toggles.has('great-pedal-combinations-coupled')) {
      const p = `pedal-toe-piston-${numOf(t)}`;
      if (ACC_BY_ID.has(p)) apply(scopeOf(p), combination(p));
    }
    return true;
  }
  function store(id) {
    const t = target(id);
    const a = t && ACC_BY_ID.get(t);
    if (!a || !a.adjustable) { onChange({ kind: 'warn', message: `${accessoryLabel(id)} ist fest eingestellt – nicht speicherbar` }); return false; }
    const sc = scopeOf(t);
    (memory[level] ||= {})[t] = capture(sc);
    persist();
    onChange({ kind: 'stored', message: `${accessoryLabel(t)} gespeichert (Ebene ${level})` });
    return true;
  }
  function cancel(id) { apply(CANCEL_SCOPE[id], snap([])); }

  function press(id) {
    const a = ACC_BY_ID.get(id);
    if (!a) return { ok: false };
    switch (a.kind) {
      case 'piston': case 'toe-piston': case 'general-piston':
        if (armed) { armed = false; const ok = store(id); onChange({ kind: 'setter', armed }); return { ok, action: 'store' }; }
        return { ok: recall(id), action: 'recall' };
      case 'general-cancel': case 'cancel':
        cancel(id); seq = a.kind === 'general-cancel' ? -1 : seq; return { ok: true, action: 'cancel' };
      case 'setter':
        armed = !armed; onChange({ kind: 'setter', armed, message: armed ? 'Setzer aktiv – Kolben drücken zum Speichern' : 'Setzer aus' });
        return { ok: true, action: 'setter', on: armed };
      case 'reversible-piston': case 'reversible-toe-piston': {
        const st = getState();
        if (a.stop) { setStop(a.stop, !st.stops.has(a.stop)); return { ok: true, action: 'reversible' }; }
        const list = [].concat(a.coupler);
        const on = !list.every((c) => st.couplers.has(c));
        for (const c of list) setCoupler(c, on);
        return { ok: true, action: 'reversible', on };
      }
      case 'sequencer': case 'rocker-tablet':
        if (a.action) {
          seq = a.action === 'advance' ? (seq + 1) % 12 : (seq <= 0 ? 11 : seq - 1);
          recall(`general-piston-${seq + 1}`);
          onChange({ kind: 'info', message: `Sequenzer: General ${seq + 1}` });
          return { ok: true, action: 'sequencer', step: seq + 1 };
        }
      // falls through: toggle tablets
      case 'ventil': {
        const on = !toggles.has(id);
        if (on) toggles.add(id); else toggles.delete(id);
        onChange({ kind: 'toggle', id, on, message: `${accessoryLabel(a)}: ${on ? 'ein' : 'aus'}` });
        return { ok: true, action: 'toggle', on };
      }
      case 'combination':
        level = (level % MEMORY_LEVELS) + 1; persist();
        onChange({ kind: 'level', level, message: `Speicherebene ${level} von ${MEMORY_LEVELS}` });
        return { ok: true, action: 'level', level };
      default:
        return { ok: false };
    }
  }

  return {
    press, recall, store, combination,
    isArmed: () => armed,
    setArmed(v) { armed = !!v; onChange({ kind: 'setter', armed }); },
    getLevel: () => level,
    setLevel(l) { if (Number.isInteger(l) && l >= 1 && l <= MEMORY_LEVELS) { level = l; persist(); onChange({ kind: 'level', level }); } },
    resetLevel() { delete memory[level]; persist(); onChange({ kind: 'info', message: `Ebene ${level}: Werkseinstellung wiederhergestellt` }); },
    isToggleOn: (id) => toggles.has(id),
    sequencerStep: () => seq + 1,
  };
}

// ---------------------------------------------------------------------------
// Pipe tracker: emits 'pipeon' / 'pipeoff' (pure apart from the bus)
// ---------------------------------------------------------------------------
export function createPipeTracker(bus, getReg) {
  const held = new Map();   // "manual:midi" -> Map(pipeKey -> payload)
  const counts = new Map(); // pipeKey -> { n, payload }
  const pipesFor = (midi, manual) => {
    const out = new Map();
    let v;
    try { v = voiceKey(getReg(), midi, manual); } catch { return out; }
    for (const r of v.ranks) {
      if (r.virtual || out.has(r.key)) continue;
      out.set(r.key, { stopId: r.stopId, division: r.division, midi: r.midi, noteIndex: r.noteIndex, rank: r.rank, key: r.key });
    }
    return out;
  };
  const inc = (k, payload) => {
    const c = counts.get(k);
    if (c) { c.n++; return; }
    counts.set(k, { n: 1, payload });
    bus.emit('pipeon', payload);
  };
  const dec = (k) => {
    const c = counts.get(k);
    if (!c) return;
    if (--c.n <= 0) { counts.delete(k); bus.emit('pipeoff', c.payload); }
  };
  function noteOn(midi, manual) {
    const key = `${manual}:${midi}`;
    if (held.has(key)) return;
    const p = pipesFor(midi, manual);
    held.set(key, p);
    for (const [k, payload] of p) inc(k, payload);
  }
  function noteOff(midi, manual) {
    const key = `${manual}:${midi}`;
    const p = held.get(key);
    if (!p) return;
    held.delete(key);
    for (const k of p.keys()) dec(k);
  }
  function refresh() {
    for (const [key, old] of held) {
      const [manual, midi] = key.split(':').map(Number);
      const next = pipesFor(midi, manual);
      for (const [k, payload] of next) if (!old.has(k)) inc(k, payload);   // ons first: no flicker
      for (const k of old.keys()) if (!next.has(k)) dec(k);
      held.set(key, next);
    }
  }
  function releaseAll() { for (const key of [...held.keys()]) { const [m, mi] = key.split(':').map(Number); noteOff(mi, m); } }
  return { noteOn, noteOff, refresh, releaseAll, sounding: () => counts.size, heldKeys: () => held.size };
}

// ---------------------------------------------------------------------------
// Computer keyboard (event.code -> semitones above the base C)
// ---------------------------------------------------------------------------
export const KEY_NOTE_OFFSETS = {
  KeyA: 0, KeyS: 2, KeyD: 4, KeyF: 5, KeyG: 7, KeyH: 9, KeyJ: 11,
  KeyK: 12, KeyL: 14, Semicolon: 16, Quote: 17,
  KeyW: 1, KeyE: 3, KeyT: 6, KeyY: 8, KeyU: 10, KeyO: 13, KeyP: 15,
};
export const KEY_OCTAVE_DOWN = 'KeyZ'; // "Y" on a German keyboard
export const KEY_OCTAVE_UP = 'KeyX';
export const KEY_MANUAL_CODES = ['F1', 'F2', 'F3', 'F4', 'F5']; // Choir, Great, Swell, Solo, Pedal
export const KEY_DIGIT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
const NUMPAD_CODES = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'Numpad0'];
export const KEYBOARD_BASE = 60;
export const PEDAL_KEYBOARD_BASE = 48;

/** divisional piston bound to Shift+digit n (1..10) for a manual */
export function divisionalPistonFor(manual, n) {
  if (n < 1 || n > 10) return null;
  switch (manual) {
    case 0: return n <= 5 ? `choir-piston-${n}` : `orchestral-piston-${n - 5}`;
    case 1: return `great-piston-${n}`;
    case 2: return `swell-piston-${n}`;
    case 3: return n <= 5 ? `solo-piston-${n}` : ['bombard-piston-tuba', 'bombard-piston-orchestral-trumpet', 'bombard-piston-full-enclosed', 'bombard-piston-tuba-mirabilis', 'bombard-piston-full-tubas'][n - 6];
    case 4: return `pedal-toe-piston-${n}`;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Camera presets
// ---------------------------------------------------------------------------
// Facade (layout.js): oak base storey y 0–5.2, three arches with small pipes at
// y ≈ 5.5–10 (x = −5.6, 0, +5.6), groups of 32′/16′ pipes between and outside
// them up to y ≈ 18–19, open-topped chamber behind (z −5…0), console at z ≈ 2.3.
// `fit` (optional): [width, height] in metres that must stay in frame around the
// target; on narrow / portrait screens the camera backs off along its view line.
// `desc`: German one-liner for the help box and the button tooltip.
export const CAMERA_PRESETS = [
  { id: 'totale', label: 'Totale', pos: [0, 7, 36], target: [0, 9.5, 0], fit: [23, 23],
    desc: 'die ganze Orgel mit allen Pfeifenspitzen und dem Spieltisch' },
  { id: 'prospekt', label: 'Prospekt', pos: [0, 9, 20], target: [0, 11.8, 0],
    desc: 'Mittelbogen mit den flankierenden 32′-Pfeifen' },
  { id: 'pfeifenwerk', label: 'Pfeifenwerk', pos: [0, 24, 16], target: [0, 9, -2.5],
    desc: 'von schräg oben in die offene Orgelkammer hinter dem Prospekt' },
  { id: 'spieltisch', label: 'Spieltisch', pos: [0, 2.6, 4.6], target: [0, 1.0, 2.0],
    desc: 'die vier Manuale, Pedal und Registerstaffeln' },
  { id: 'staffel-links', label: 'Staffel links', pos: [0.3, 1.38, 3.3], target: [-0.76, 1.24, 2.24],
    desc: 'Registerstaffel links neben den Manualen' },
  { id: 'staffel-rechts', label: 'Staffel rechts', pos: [-0.3, 1.38, 3.3], target: [0.76, 1.24, 2.24],
    desc: 'Registerstaffel rechts neben den Manualen' },
  { id: 'unten', label: 'Von unten', pos: [-7, 1.2, 5], target: [-7.5, 12, 0],
    desc: 'vom Emporenboden an den großen Pedalpfeifen hinauf' },
  { id: 'chor', label: 'Chor', pos: [16, -1, 20], target: [0, 7, 0],
    desc: 'schräg von den Chorrängen aus' },
];

/** Camera position for a preset, backed off along the view line if `fit` would not be in frame. */
// back-off limit: beyond ≈ 50 m the scene fog (60 m) and the far hall wall take over
export const FIT_MAX_DISTANCE = 52;
export function presetPosition(p, fovDeg, aspect, maxDistance = FIT_MAX_DISTANCE) {
  const [px, py, pz] = p.pos, [tx, ty, tz] = p.target;
  if (!p.fit || !(fovDeg > 0) || !(aspect > 0)) return [px, py, pz];
  const dx = px - tx, dy = py - ty, dz = pz - tz;
  const d = Math.hypot(dx, dy, dz);
  const tv = Math.tan((fovDeg * Math.PI) / 360);
  const need = Math.max(p.fit[1] / 2 / tv, p.fit[0] / 2 / (tv * aspect));
  const k = Math.min(Math.max(need, d), maxDistance) / d;
  if (k <= 1) return [px, py, pz];
  return [tx + dx * k, ty + dy * k, tz + dz * k];
}
export const CAMERA_MOVE_SECONDS = 1.2;
/** below this viewport width the register panel starts collapsed (matches the CSS breakpoint) */
export const NARROW_PX = 900;
export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ---------------------------------------------------------------------------
// Note book: reference-counted note state per input source (pure)
// ---------------------------------------------------------------------------
export function createNoteBook(bus) {
  const sources = new Map();
  const counts = new Map();
  const keyOf = (midi, manual) => `${manual}:${midi}`;
  function press(source, midi, manual) {
    let held = sources.get(source);
    if (!held) sources.set(source, (held = new Map()));
    const key = keyOf(midi, manual);
    if (held.has(key)) return false;
    held.set(key, { midi, manual });
    const c = (counts.get(key) || 0) + 1;
    counts.set(key, c);
    if (c === 1) bus.emit('noteon', { midi, manual });
    return true;
  }
  function release(source, midi, manual) {
    const held = sources.get(source);
    const key = keyOf(midi, manual);
    if (!held || !held.has(key)) return false;
    held.delete(key);
    const c = (counts.get(key) || 1) - 1;
    if (c <= 0) { counts.delete(key); bus.emit('noteoff', { midi, manual }); } else counts.set(key, c);
    return true;
  }
  function releaseSource(source) {
    const held = sources.get(source);
    if (!held) return;
    for (const { midi, manual } of [...held.values()]) release(source, midi, manual);
  }
  function releaseAll(filter) { for (const s of [...sources.keys()]) if (!filter || filter(s)) releaseSource(s); }
  return {
    press, release, releaseSource, releaseAll,
    isHeld: (midi, manual) => counts.has(keyOf(midi, manual)),
    heldCount: () => counts.size,
    heldBy: (source) => [...(sources.get(source)?.values() || [])],
  };
}

// ---------------------------------------------------------------------------
// Demo: opening of J. S. Bach, Toccata d-Moll BWV 565 (public domain),
// freely arranged for Great (1), Swell (2) and pedal (4) on real stops.
// ---------------------------------------------------------------------------
export const DEMO_REGISTRATION = snap(
  [...GREAT[6], ...SWELL[7], ...ids('pedal', ['double-open-wood', 'open-wood-i', 'open-diapason-i', 'violone', 'octave-wood', 'principal', 'super-octave', 'mixture', 'trombone', 'bombard'])],
  ['swell-to-great', 'great-to-pedal', 'swell-to-pedal']);
/** piston presses during the demo (fixed pistons / reversibles, so the result is deterministic) */
export const DEMO_PISTONS = ['reversible-solo-to-great', 'bombard-piston-full-tubas', 'reversible-pedal-ophicleide'];

/** Returns [{ t, dur, midi, manual } | { t, dur: 0, piston }] sorted by t. */
export function buildDemoScore() {
  const ev = [];
  let t = 0.5;
  const add = (time, dur, midi, manual) => ev.push({ t: time, dur, midi, manual });
  const oct = (midi, step, hold = step * 0.9) => { add(t, hold, midi, MANUAL_GREAT); add(t, hold, midi - 12, MANUAL_SWELL); t += step; };
  const rest = (d) => { t += d; };
  oct(81, 0.11); oct(79, 0.11); oct(81, 1.55, 1.35); rest(0.3);
  for (const m of [79, 77, 76, 74, 73]) oct(m, 0.13);
  oct(74, 1.7, 1.45); rest(0.45);
  oct(69, 0.11); oct(67, 0.11); oct(69, 1.35, 1.15); rest(0.3);
  for (const m of [64, 65, 61]) oct(m, 0.17);
  oct(62, 1.6, 1.35); rest(0.45);
  oct(57, 0.12); oct(55, 0.12); oct(57, 1.35, 1.15); rest(0.3);
  for (const m of [55, 53, 52, 50, 49]) oct(m, 0.14);
  oct(50, 1.8, 1.5); rest(0.5);
  const pedalStart = t;
  add(pedalStart, 6.3, 38, MANUAL_PEDAL);
  const chordEnd = pedalStart + 4.5;
  const pile = [61, 64, 67, 70, 73, 76];
  const pileLow = [49, 52, 55, 58];
  pile.forEach((m, i) => add(pedalStart + 0.9 + i * 0.3, chordEnd - (pedalStart + 0.9 + i * 0.3) - 0.03, m, MANUAL_GREAT));
  pileLow.forEach((m, i) => add(pedalStart + 0.9 + i * 0.3, chordEnd - (pedalStart + 0.9 + i * 0.3) - 0.03, m, MANUAL_SWELL));
  for (const m of [62, 66, 69, 74]) add(chordEnd, 1.75, m, MANUAL_GREAT);
  for (const m of [50, 57]) add(chordEnd, 1.75, m, MANUAL_SWELL);
  t = pedalStart + 6.3 + 0.55;
  const scale = [73, 74, 76, 77, 79, 81, 82];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) oct(scale[i + k], 0.09);
  for (const m of [82, 81, 79, 77, 76, 74, 73]) oct(m, 0.1);
  oct(74, 1.1, 0.95); rest(0.3);
  add(t, 1.4, 45, MANUAL_PEDAL);
  for (const m of [61, 64, 67, 69]) add(t, 1.4, m, MANUAL_GREAT);
  for (const m of [45, 52, 57]) add(t, 1.4, m, MANUAL_SWELL);
  t += 1.5;
  // final chord on full organ: Tubas via Solo to Great, Pedal Ophicleide (pistons)
  for (const id of DEMO_PISTONS) ev.push({ t: t - 0.05, dur: 0, piston: id });
  add(t, 3.4, 38, MANUAL_PEDAL);
  for (const m of [62, 65, 69, 74]) add(t, 3.4, m, MANUAL_GREAT);
  for (const m of [50, 53, 57]) add(t, 3.4, m, MANUAL_SWELL);
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

/** Time-ordered timeline: at equal times note-offs, then pistons, then note-ons. */
export function scoreToTimeline(score) {
  const tl = [];
  for (const e of score) {
    if (e.piston) { tl.push({ time: e.t, piston: e.piston, ord: 1 }); continue; }
    tl.push({ time: e.t, on: true, midi: e.midi, manual: e.manual, ord: 2 });
    tl.push({ time: e.t + e.dur, on: false, midi: e.midi, manual: e.manual, ord: 0 });
  }
  tl.sort((a, b) => a.time - b.time || a.ord - b.ord);
  return tl;
}

/** Built-in pieces for the demo menu. */
export const DEMO_PIECES = [
  { id: 'bwv565', title: 'Toccata d-Moll BWV 565', subtitle: 'J. S. Bach, Anfang (gemeinfrei) · Plenum mit Tubas', build: () => buildDemoScore(), registration: DEMO_REGISTRATION },
];

/**
 * Demo auto-player (pure; time is passed in, in seconds).
 *   capture() -> registration snapshot;  restore(snapshot);  applyRegistration(snapshot);  pressPiston(id)
 * start(piece?) plays a piece { id, title, score, registration, keepRegistration, keepOnUserInput };
 * without an argument the default score / registration given here.
 * keepRegistration: the current registration is neither changed nor restored (MIDI files).
 */
export function createDemoPlayer({ book, capture, restore, applyRegistration, pressPiston, onState, score = buildDemoScore(), registration = DEMO_REGISTRATION, source = 'demo' }) {
  const defaultPiece = { id: 'bwv565', title: DEMO_PIECES[0].title, score, registration };
  let piece = defaultPiece;
  let timeline = scoreToTimeline(score);
  let duration = timeline.length ? timeline[timeline.length - 1].time : 0;
  let playing = false;
  let startTime = null;
  let elapsed = 0;
  let index = 0;
  let saved = null;
  function load(p) {
    piece = p || defaultPiece;
    timeline = piece.timeline || scoreToTimeline(piece.score || []);
    duration = timeline.length ? timeline[timeline.length - 1].time : 0;
  }
  function start(p) {
    if (playing) stop();
    load(p);
    playing = true; startTime = null; index = 0; elapsed = 0;
    saved = !piece.keepRegistration && capture ? capture() : null;
    if (!piece.keepRegistration && applyRegistration && piece.registration) applyRegistration(piece.registration);
    if (onState) onState(true, piece);
  }
  function stop() {
    if (!playing) return;
    playing = false;
    book.releaseSource(source);
    if (restore && saved) restore(saved);
    saved = null;
    if (onState) onState(false, piece);
  }
  function update(now) {
    if (!playing) return;
    if (startTime === null) startTime = now;
    const t = now - startTime;
    elapsed = t;
    while (playing && index < timeline.length && timeline[index].time <= t) {
      const e = timeline[index++];
      if (e.piston) { if (pressPiston) pressPiston(e.piston); } else if (e.on) book.press(source, e.midi, e.manual);
      else book.release(source, e.midi, e.manual);
    }
    if (playing && index >= timeline.length && t > duration + 0.4) stop();
  }
  return {
    start, stop, update,
    toggle: (p) => (playing ? stop() : start(p)),
    isPlaying: () => playing,
    piece: () => piece,
    stopsOnUserInput: () => playing && !piece.keepOnUserInput,
    progress: () => ({ elapsed: Math.min(elapsed, duration), duration, fraction: duration ? Math.min(1, elapsed / duration) : 0 }),
    get duration() { return duration; },
    get timeline() { return timeline; },
  };
}

/** A parsed + mapped MIDI file as a demo piece (plays on the current registration). */
export function midiPiece(name, mapped) {
  return { id: 'midi-file', title: name, score: mapped.score, registration: null, keepRegistration: true, keepOnUserInput: true, notices: mapped.notices || [] };
}

// ---------------------------------------------------------------------------
// Search (pure)
// ---------------------------------------------------------------------------
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`´]/g, "'").replace(/′/g, '');
const SEARCH_INDEX = [
  ...STOPS.map((s) => ({
    type: 'stop', id: s.id, number: s.number, order: 0,
    label: `${s.number} · ${stopLabel(s)} · ${DIV_LABEL[s.division]}`,
    words: fold([s.name, s.pitch, pitchLabel(s), DIV_ALIASES[s.division], FAMILY_DE[s.family] || '', s.derived ? s.derived.kind + ' abgeleitet' : '', s.celeste ? 'schwebung celeste' : ''].join(' ')).split(/[\s,()·/-]+/).filter(Boolean)
      .concat(s.pitch ? [fold(s.pitch)] : []),
    name: fold(s.name),
  })),
  ...COUPLERS.map((c) => ({ type: 'coupler', id: c.id, order: 1, label: `Koppel ${c.number} · ${c.name}`, words: fold(`${c.name} koppel coupler ${c.number} ${c.kind}`).split(/[\s,()·/-]+/).filter(Boolean), name: fold(c.name) })),
  ...ACCESSORIES.map((a) => ({
    type: a.kind === 'tremulant' ? 'tremulant' : a.kind === 'swell-pedal' ? 'swell' : 'piston', id: a.id, order: 2,
    label: accessoryLabel(a), words: fold(`${accessoryLabel(a)} ${a.name} ${a.kind} ${a.division ? DIV_ALIASES[a.division] : ''} kolben`).split(/[\s,()·/-]+/).filter(Boolean), name: fold(accessoryLabel(a)),
  })),
];

/** Returns up to `limit` hits [{ type, id, label }] for a query (name, pitch, division, number). */
export function searchControls(query, limit = 8) {
  const q = fold(query || '').trim();
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const n = +q;
    const exact = STOP_BY_NUMBER.get(n);
    const rest = SEARCH_INDEX.filter((e) => e.type === 'stop' && e.number !== n && String(e.number).startsWith(q));
    return [...(exact ? [SEARCH_INDEX.find((e) => e.id === exact.id)] : []), ...rest].slice(0, limit).map(({ type, id, label }) => ({ type, id, label }));
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const e of SEARCH_INDEX) {
    let score = 0;
    let ok = true;
    for (const tk of tokens) {
      let best = 0;
      if (e.name.startsWith(tk)) best = 4;
      for (const w of e.words) {
        if (w === tk) best = Math.max(best, 3);
        else if (w.startsWith(tk)) best = Math.max(best, 2);
      }
      if (!best && tk.length >= 3 && e.name.includes(tk)) best = 1;
      if (!best) { ok = false; break; }
      score += best;
    }
    if (ok) hits.push({ e, score });
  }
  hits.sort((a, b) => b.score - a.score || a.e.order - b.e.order || (a.e.number || 0) - (b.e.number || 0));
  return hits.slice(0, limit).map(({ e }) => ({ type: e.type, id: e.id, label: e.label }));
}

// ---------------------------------------------------------------------------
// Panel layout (pure): every stop, coupler and accessory has exactly one home
// ---------------------------------------------------------------------------
const accOf = (pred) => ACCESSORIES.filter(pred).map((a) => ({ kind: a.kind === 'tremulant' ? 'tremulant' : a.kind === 'swell-pedal' ? 'swell' : 'piston', id: a.id }));
export const PANEL_LAYOUT = (() => {
  const tabs = [];
  const divTab = (div) => {
    const groups = [{ label: 'Register', items: stopsOfDivision(div).map((s) => ({ kind: 'stop', id: s.id })) }];
    const extra = accOf((a) => (a.kind === 'tremulant' || a.kind === 'swell-pedal') && a.division === div);
    if (extra.length) groups.push({ label: 'Tremulant & Schweller', items: extra });
    const pist = accOf((a) => ((a.kind === 'piston' || (a.kind === 'toe-piston' && !a.duplicates)) && a.division === div)
      || (a.kind === 'cancel' && ((a.division === div) || (a.manual !== undefined && MANUAL_LABELS[a.manual].toLowerCase() === div)))
      || (div === 'pedal' && a.id === 'reversible-pedal-ophicleide'));
    if (pist.length) groups.push({ label: div === 'pedal' ? 'Fußtritte & Kolben' : 'Kolben', items: pist });
    tabs.push({ id: div, label: DIV_LABEL[div], title: DIV_DE[div], groups });
  };
  for (const d of ['pedal', 'choir', 'orchestral', 'great', 'swell', 'solo', 'bombard']) divTab(d);
  const cg = [];
  for (const [man, label] of [[4, 'zum Pedal'], [0, 'zum Choir / Orchestral'], [1, 'zum Great'], [2, 'zum Swell'], [3, 'zum Solo / Bombard']]) {
    cg.push({ label: `Koppeln ${label}`, items: COUPLERS.filter((c) => c.to === man).map((c) => ({ kind: 'coupler', id: c.id })) });
  }
  cg.push({ label: 'Wechselkolben', items: accOf((a) => (a.kind === 'reversible-piston' || a.kind === 'reversible-toe-piston') && a.id !== 'reversible-pedal-ophicleide') });
  tabs.push({ id: 'koppeln', label: 'Koppeln', title: 'Koppeln und Wechselkolben', groups: cg });
  tabs.push({
    id: 'spielhilfen', label: 'Spielhilfen', title: 'Generalkolben, Setzer, Sequenzer, Schwelltritte',
    groups: [
      { label: 'Generalkolben', items: accOf((a) => a.kind === 'general-piston') },
      { label: 'General-Fußtritte', items: accOf((a) => a.kind === 'toe-piston' && a.duplicates) },
      { label: 'Setzer & Sequenzer', items: accOf((a) => ['setter', 'general-cancel', 'combination', 'sequencer'].includes(a.kind) || (a.kind === 'rocker-tablet' && a.action)) },
      { label: 'Umschalter', items: accOf((a) => (a.kind === 'rocker-tablet' && !a.action) || a.kind === 'ventil') },
      { label: 'Schwelltritte', items: SWELL_IDS.map((id) => ({ kind: 'swell', id })), duplicate: true },
    ],
  });
  return tabs;
})();

// ---------------------------------------------------------------------------
// Helmholtz note names (German)
// ---------------------------------------------------------------------------
const NOTE_NAMES = ['c', 'cis', 'd', 'dis', 'e', 'f', 'fis', 'g', 'gis', 'a', 'b', 'h'];
export function noteName(midi) {
  const n = NOTE_NAMES[((midi % 12) + 12) % 12];
  const o = Math.floor(midi / 12) - 4; // 48 -> c (o = 0)
  if (o < 0) return n[0].toUpperCase() + n.slice(1) + (o < -1 ? '₁' : '');
  return n + ['', '′', '″', '‴', '⁗', '⁵'][o];
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const CSS = `
#ui > .rah-root { position: absolute; inset: 0; pointer-events: none; font-family: 'Cormorant Garamond', 'EB Garamond', Georgia, 'Times New Roman', serif; color: #f0e6d2; -webkit-user-select: none; user-select: none; }
.rah-root * { box-sizing: border-box; }
.rah-root button { font: inherit; color: inherit; cursor: pointer; }
.rah-root button:focus-visible, .rah-root input:focus-visible { outline: 2px solid #f3d48c; outline-offset: 1px; }
.rah-glass { pointer-events: auto; background: rgba(14, 9, 7, 0.8); border: 1px solid rgba(217, 164, 65, 0.32); border-radius: 6px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
/* Top-left column: title (2 fixed-height single lines), room for #case-toggle
   (index.html, fixed at top 72px / 56px narrow), then the sound hint.
   Wide:   title 16 + 28 + 4 + 16 = 64 px, toggle 72–104, hint from 112.
   Narrow: title 10 + 22 + 3 + 14 = 49 px, toggle 56–84,  hint from 92.
   The column never reaches under the panel (right 16, 420 wide). */
.rah-tl { position: absolute; left: 22px; top: 16px; display: flex; flex-direction: column; align-items: flex-start; max-width: calc(100vw - 474px); }
.rah-title { max-width: 100%; text-shadow: 0 1px 10px rgba(0, 0, 0, 0.9); }
.rah-title h1 { margin: 0; font-size: 23px; line-height: 28px; font-weight: 400; letter-spacing: 0.07em; color: #f3e3bd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rah-title h1 .rah-dot { color: #d9a441; }
.rah-title p { margin: 4px 0 0; font-size: 12.5px; line-height: 16px; letter-spacing: 0.08em; color: rgba(240, 230, 210, 0.7); font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rah-title p.rah-sub-short { display: none; }
@media (max-width: 1499px) { .rah-title p.rah-sub-long { display: none; } .rah-title p.rah-sub-short { display: block; } }
.rah-hint { position: relative; margin-top: 48px; max-width: 100%; pointer-events: auto; padding: 8px 18px; border-radius: 999px; background: rgba(14, 9, 7, 0.8); border: 1px solid #d9a441; color: #f3d48c; font-size: 14px; line-height: 18px; letter-spacing: 0.06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: rah-pulse 2.2s ease-in-out infinite; transition: opacity 0.5s; }
.rah-hint.rah-gone { opacity: 0; pointer-events: none; animation: none; }
.rah-hint.rah-off { border-color: rgba(240, 230, 210, 0.3); color: rgba(240, 230, 210, 0.6); animation: none; cursor: default; }
@keyframes rah-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(217, 164, 65, 0.45); } 50% { box-shadow: 0 0 0 9px rgba(217, 164, 65, 0); } }

.rah-panel { position: absolute; right: 16px; top: 16px; width: 420px; max-width: calc(100vw - 32px); max-height: calc(100% - 96px); display: flex; flex-direction: column; overflow: hidden; }
.rah-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 9px 14px; background: none; border: 0; text-align: left; }
.rah-panel-head .rah-h { font-size: 15px; letter-spacing: 0.2em; text-transform: uppercase; color: #d9a441; }
.rah-count { font-size: 12px; font-style: italic; color: rgba(240, 230, 210, 0.7); letter-spacing: 0.02em; text-transform: none; }
.rah-count b { font-style: normal; font-weight: 400; color: #f3d48c; }
.rah-chev { display: inline-block; font-size: 11px; color: #d9a441; transition: transform 0.25s; }
.rah-panel.rah-collapsed .rah-chev { transform: rotate(-90deg); }
.rah-panel.rah-collapsed { width: auto; }
.rah-panel.rah-collapsed .rah-panel-body { display: none; }
.rah-panel-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; border-top: 1px solid rgba(217, 164, 65, 0.18); }
@media (max-height: 620px) { .rah-panel-body { overflow-y: auto; } .rah-tabpanels { overflow: visible; flex: none; } }
.rah-top { padding: 8px 12px 6px; display: flex; flex-direction: column; gap: 6px; }
.rah-row { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.rah-search { position: relative; }
.rah-search input { width: 100%; padding: 6px 10px; font: inherit; font-size: 14px; color: #f0e6d2; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(217, 164, 65, 0.35); border-radius: 4px; -webkit-user-select: text; user-select: text; }
.rah-search input::placeholder { color: rgba(240, 230, 210, 0.45); font-style: italic; }
.rah-results { list-style: none; margin: 3px 0 0; padding: 3px; max-height: 220px; overflow-y: auto; background: rgba(10, 6, 4, 0.96); border: 1px solid rgba(217, 164, 65, 0.3); border-radius: 4px; }
.rah-results[hidden] { display: none; }
.rah-results li { padding: 4px 8px; font-size: 13px; border-radius: 3px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; }
.rah-results li[aria-selected="true"], .rah-results li:hover { background: rgba(217, 164, 65, 0.22); }
.rah-results li .rah-on { color: #f3d48c; }
.rah-manuals { display: flex; gap: 3px; flex-wrap: wrap; align-items: center; font-size: 12px; color: rgba(240, 230, 210, 0.7); }
.rah-man { padding: 2px 7px; font-size: 12px; border-radius: 3px; background: rgba(40, 26, 16, 0.55); border: 1px solid rgba(217, 164, 65, 0.3); }
.rah-man[aria-pressed="true"] { background: #d9a441; color: #1a0f08; border-color: #d9a441; }
.rah-man kbd { font: 9px ui-monospace, Menlo, Consolas, monospace; opacity: 0.75; margin-right: 3px; }
.rah-status { min-height: 16px; font-size: 12px; font-style: italic; color: #f3d48c; padding: 0 12px; }
.rah-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px 8px 0; border-bottom: 1px solid rgba(217, 164, 65, 0.25); }
.rah-tab { padding: 4px 8px; font-size: 13px; letter-spacing: 0.04em; background: none; border: 1px solid transparent; border-bottom: 0; border-radius: 4px 4px 0 0; color: rgba(240, 230, 210, 0.7); }
.rah-tab[aria-selected="true"] { color: #f3d48c; border-color: rgba(217, 164, 65, 0.35); background: rgba(217, 164, 65, 0.1); }
.rah-tab .rah-badge { font-size: 10px; color: #d9a441; margin-left: 3px; }
.rah-tabpanels { overflow-y: auto; min-height: 0; flex: 1 1 auto; padding: 4px 10px 10px; }
.rah-tabpanel[hidden] { display: none; }
.rah-group { margin-top: 8px; }
.rah-group-h { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(217, 164, 65, 0.85); margin: 0 0 4px 2px; }
.rah-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 4px; }
.rah-ctl { position: relative; display: grid; grid-template-columns: 16px 1fr; grid-template-rows: auto auto; column-gap: 6px; align-items: center; min-height: 36px; padding: 3px 6px 3px 5px; text-align: left; background: rgba(40, 26, 16, 0.5); border: 1px solid rgba(217, 164, 65, 0.22); border-radius: 4px; transition: background 0.15s, border-color 0.15s; }
.rah-ctl:hover { border-color: rgba(217, 164, 65, 0.7); }
.rah-ctl .rah-k { grid-row: 1 / span 2; width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #4a3324, #1c120c 72%); border: 1px solid rgba(217, 164, 65, 0.45); box-shadow: inset 0 -2px 3px rgba(0, 0, 0, 0.6); }
.rah-ctl .rah-n { font-size: 12.5px; line-height: 1.12; color: rgba(240, 230, 210, 0.85); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rah-ctl .rah-p { font-size: 11px; line-height: 1.1; color: rgba(240, 230, 210, 0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rah-ctl .rah-p i { font-style: normal; color: #c9a86a; }
.rah-ctl.rah-reed .rah-n { color: #e48a78; }
.rah-ctl[aria-pressed="true"] { background: rgba(217, 164, 65, 0.2); border-color: #d9a441; }
.rah-ctl[aria-pressed="true"] .rah-k { background: radial-gradient(circle at 35% 30%, #fffaf0, #e6d3a8 62%, #b89a5e); border-color: #d9a441; box-shadow: 0 0 8px rgba(217, 164, 65, 0.7); }
.rah-ctl[aria-pressed="true"] .rah-n { color: #f8e7bf; }
.rah-ctl.rah-reed[aria-pressed="true"] .rah-n { color: #ff9f8a; }
.rah-ctl.rah-reed[aria-pressed="true"] .rah-k { background: radial-gradient(circle at 35% 30%, #fff0ea, #e6aa98 62%, #a85a48); }
.rah-ctl.rah-piston .rah-k { border-radius: 3px; }
.rah-ctl.rah-flash { animation: rah-flash 0.6s ease-out; }
@keyframes rah-flash { 0% { box-shadow: 0 0 0 3px rgba(243, 212, 140, 0.9); } 100% { box-shadow: 0 0 0 0 rgba(243, 212, 140, 0); } }
.rah-panel.rah-armed .rah-ctl.rah-piston[data-adjustable="1"] { border-color: #e48a78; }
.rah-slider { display: grid; grid-template-columns: minmax(80px, 38%) 1fr 40px; align-items: center; gap: 8px; margin-top: 6px; font-size: 13px; letter-spacing: 0.04em; color: rgba(240, 230, 210, 0.82); }
.rah-slider output { font-size: 11px; color: rgba(240, 230, 210, 0.6); text-align: right; }
.rah-slider input { -webkit-appearance: none; appearance: none; width: 100%; height: 18px; margin: 0; background: transparent; cursor: pointer; }
.rah-slider input::-webkit-slider-runnable-track { height: 2px; background: linear-gradient(90deg, #d9a441, rgba(217, 164, 65, 0.25)); }
.rah-slider input::-moz-range-track { height: 2px; background: linear-gradient(90deg, #d9a441, rgba(217, 164, 65, 0.25)); }
.rah-slider input::-webkit-slider-thumb { -webkit-appearance: none; width: 13px; height: 13px; margin-top: -6px; border-radius: 50%; background: #f3e3bd; border: 1px solid #d9a441; }
.rah-slider input::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #f3e3bd; border: 1px solid #d9a441; }
.rah-foot { padding: 6px 12px 10px; border-top: 1px solid rgba(217, 164, 65, 0.18); }
.rah-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12px; color: rgba(240, 230, 210, 0.6); font-style: italic; }
.rah-meta b { font-weight: 400; font-style: normal; color: #f3d48c; }
.rah-btn { padding: 5px 11px; background: rgba(40, 26, 16, 0.55); border: 1px solid rgba(217, 164, 65, 0.35); border-radius: 4px; font-size: 13.5px; letter-spacing: 0.05em; color: #f0e6d2; white-space: nowrap; transition: background 0.2s, border-color 0.2s, color 0.2s; }
.rah-btn:hover { border-color: #d9a441; color: #f3d48c; }
.rah-btn.rah-active, .rah-btn[aria-pressed="true"] { background: #d9a441; border-color: #d9a441; color: #1a0f08; }
.rah-btn.rah-small { padding: 3px 9px; font-size: 12px; }
/* Bottom view bar: always ONE row; scrolls horizontally when it does not fit
   (shrink-to-fit, so flex-start never hides the first buttons). */
.rah-bar { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; flex-wrap: nowrap; align-items: center; justify-content: flex-start; gap: 6px; padding: 8px 10px; max-width: calc(100vw - 32px); overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; scrollbar-color: rgba(217, 164, 65, 0.4) transparent; }
.rah-bar > * { flex: none; }
.rah-bar .rah-btn:focus-visible { outline-offset: -3px; }
@media (max-width: 1279px) { .rah-bar-label, .rah-sep { display: none; } }
@media (max-width: 1099px) { .rah-bar { gap: 5px; } .rah-bar .rah-btn { padding: 5px 8px; } }
.rah-bar-label { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(217, 164, 65, 0.85); padding: 0 4px; }
.rah-sep { width: 1px; align-self: stretch; margin: 2px 4px; background: rgba(217, 164, 65, 0.25); }
.rah-help { position: absolute; left: 50%; bottom: 76px; transform: translateX(-50%); width: 560px; max-width: calc(100vw - 24px); max-height: calc(100% - 170px); overflow-y: auto; padding: 14px 18px 12px; font-size: 14px; line-height: 1.45; }
.rah-help[hidden] { display: none; }
.rah-help h2 { margin: 0 0 6px; font-size: 14px; font-weight: 400; letter-spacing: 0.2em; text-transform: uppercase; color: #d9a441; }
.rah-help h3 { margin: 12px 0 4px; font-size: 12px; font-weight: 400; letter-spacing: 0.16em; text-transform: uppercase; color: #d9a441; }
.rah-help dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; }
.rah-help dt { color: #f3d48c; white-space: nowrap; }
.rah-help dd { margin: 0; color: rgba(240, 230, 210, 0.85); }
.rah-help kbd { display: inline-block; min-width: 17px; padding: 0 4px; margin: 0 1px; border-radius: 3px; border: 1px solid rgba(217, 164, 65, 0.4); background: #120b08; font: 11px/16px ui-monospace, Menlo, Consolas, monospace; text-align: center; color: #f0e6d2; }
.rah-help p { margin: 9px 0 0; font-size: 12.5px; font-style: italic; color: rgba(240, 230, 210, 0.6); }
.rah-help a { color: #f3d48c; text-decoration: underline; text-decoration-color: rgba(217, 164, 65, 0.5); text-underline-offset: 2px; }
.rah-help a:hover { text-decoration-color: #f3d48c; }
.rah-help .rah-about { margin-top: 14px; padding-top: 4px; border-top: 1px solid rgba(217, 164, 65, 0.2); }
.rah-help .rah-about dd { font-size: 13px; }
.rah-demo-menu { position: absolute; left: 50%; bottom: 76px; transform: translateX(-50%); width: 380px; max-width: calc(100vw - 24px); padding: 8px 6px 6px; z-index: 3; }
.rah-demo-menu[hidden] { display: none; }
.rah-mh { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(217, 164, 65, 0.85); padding: 0 8px 4px; }
.rah-mi { display: flex; flex-direction: column; gap: 1px; padding: 6px 10px; border-radius: 4px; cursor: pointer; outline: none; }
.rah-mi:focus, .rah-mi:hover { background: rgba(217, 164, 65, 0.22); }
.rah-mi:focus-visible { box-shadow: inset 0 0 0 2px #f3d48c; }
.rah-mi-t { font-size: 14.5px; color: #f3e3bd; }
.rah-mi-s { font-size: 12px; font-style: italic; color: rgba(240, 230, 210, 0.65); }
.rah-msep { height: 1px; margin: 5px 6px; background: rgba(217, 164, 65, 0.25); }
.rah-mnote { margin: 4px 10px 2px; font-size: 11.5px; font-style: italic; color: rgba(240, 230, 210, 0.55); }
.rah-now { position: absolute; left: 50%; bottom: 76px; transform: translateX(-50%); width: 380px; max-width: calc(100vw - 24px); padding: 8px 12px 9px; display: flex; flex-direction: column; gap: 5px; font-size: 13px; pointer-events: none; }
.rah-now[hidden] { display: none; }
.rah-now-h { display: flex; justify-content: space-between; gap: 10px; }
.rah-now-t { font-weight: 400; color: #f3d48c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rah-now-time { flex: none; font-variant-numeric: tabular-nums; color: rgba(240, 230, 210, 0.75); }
.rah-now-bar { display: block; height: 3px; border-radius: 2px; background: rgba(217, 164, 65, 0.2); overflow: hidden; }
.rah-now-bar[hidden] { display: none; }
.rah-now-fill { display: block; height: 100%; width: 0; background: #d9a441; }
.rah-now-note { font-size: 11.5px; font-style: italic; color: rgba(240, 230, 210, 0.6); }
.rah-now.rah-error { border-color: #e48a78; }
.rah-now.rah-error .rah-now-t { color: #ff9f8a; }
.rah-drop { position: absolute; inset: 0; z-index: 20; pointer-events: none; display: flex; align-items: center; justify-content: center; background: rgba(10, 6, 4, 0.55); border: 3px dashed rgba(243, 212, 140, 0.8); }
.rah-drop[hidden] { display: none; }
.rah-drop-box { display: flex; flex-direction: column; gap: 6px; align-items: center; padding: 18px 26px; border-radius: 8px; background: rgba(14, 9, 7, 0.92); border: 1px solid #d9a441; text-align: center; }
.rah-drop-box b { font-weight: 400; font-size: 20px; letter-spacing: 0.08em; color: #f3d48c; }
.rah-drop-box span { font-size: 13.5px; font-style: italic; color: rgba(240, 230, 210, 0.8); }
.rah-demo-btn { max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
.rah-tip { position: fixed; z-index: 10; pointer-events: none; max-width: 300px; padding: 5px 9px; font-size: 13px; line-height: 1.3; color: #f0e6d2; background: rgba(10, 6, 4, 0.92); border: 1px solid rgba(217, 164, 65, 0.55); border-radius: 4px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6); white-space: pre-line; }
.rah-tip[hidden] { display: none; }
.rah-tip b { font-weight: 400; color: #f3d48c; }
.rah-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* Narrow screens (< 900 px): panel starts collapsed (JS) and sits top-right as a
   compact head (≈150 × 34 px, title keeps 200 px clear); title column on the left avoids it; the bar is a
   single scrolling row at the bottom (≈ 44 px + optional scrollbar); an
   expanded panel ends 80 px above the bottom, i.e. above the bar.
   600–899: expanded panel 360 px wide at the right, title column shrinks beside it.
   < 600:   expanded panel full width below the title / toggle / hint stack (top 130). */
@media (max-width: 899px) {
  .rah-tl { left: 12px; top: 10px; max-width: calc(100vw - 24px); }
  .rah-title { max-width: min(100%, calc(100vw - 200px)); }
  .rah-title h1 { font-size: 17px; line-height: 22px; letter-spacing: 0.04em; }
  .rah-title p { margin-top: 3px; font-size: 11px; line-height: 14px; letter-spacing: 0.03em; }
  .rah-hint { margin-top: 43px; padding: 6px 12px; font-size: 12.5px; line-height: 16px; letter-spacing: 0.03em; white-space: normal; text-wrap: balance; border-radius: 15px; text-align: left; }
  .rah-panel { top: 10px; right: 10px; width: min(360px, calc(100vw - 20px)); max-width: none; max-height: calc(100% - 90px); }
  .rah-panel.rah-collapsed { width: auto; }
  .rah-panel-head { padding: 7px 12px; }
  .rah-panel-head .rah-h { font-size: 14px; letter-spacing: 0.14em; }
  .rah-panel.rah-collapsed .rah-count, .rah-panel.rah-collapsed .rah-panel-head br { display: none; }
  .rah-panel-body { overflow-y: auto; }
  .rah-tabpanels { overflow: visible; flex: none; }
  .rah-root:has(> .rah-panel:not(.rah-collapsed)) .rah-tl { max-width: calc(100vw - 394px); }
  .rah-grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
  .rah-bar { left: 8px; right: 8px; bottom: 8px; transform: none; width: fit-content; max-width: none; margin: 0 auto; gap: 5px; padding: 6px; }
  .rah-bar .rah-btn { padding: 6px 9px; font-size: 13px; }
  .rah-help { bottom: 60px; max-height: calc(100% - 160px); }
  .rah-demo-menu, .rah-now { bottom: 60px; }
}
@media (min-width: 600px) and (max-width: 699px) {
  .rah-root:has(> .rah-panel:not(.rah-collapsed)) .rah-h1-suffix { display: none; }
}
@media (max-width: 599px) {
  .rah-hint { white-space: nowrap; }
  .rah-panel:not(.rah-collapsed) { left: 8px; right: 8px; top: 130px; width: auto; max-height: calc(100% - 210px); }
  .rah-root:has(> .rah-panel:not(.rah-collapsed)) .rah-tl { max-width: calc(100vw - 24px); }
  .rah-root:has(> .rah-panel:not(.rah-collapsed)) .rah-title { max-width: 100%; }
}
@media (max-width: 479px) { .rah-h1-suffix { display: none; } .rah-title h1 { font-size: 15px; } }
@media (prefers-reduced-motion: reduce) { .rah-hint, .rah-ctl.rah-flash { animation: none; } }
`;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

const K = (s) => s.split(' ').map((k) => `<kbd>${k}</kbd>`).join('');
const HELP_HTML_CONTROLS = `
<h2>Bedienung</h2>
<h3>Maus / Finger</h3>
<dl>
  <dt>Tasten</dt><dd>Tasten und Pedale am Spieltisch anklicken; mit gedrückter Taste darüber ziehen ergibt ein Glissando.</dd>
  <dt>Registerzüge</dt><dd>Registerzüge, Koppeln und Tremulanten anklicken zieht oder stößt sie ab; Kolben anklicken drückt sie.</dd>
  <dt>Schwelltritte</dt><dd>Senkrecht ziehen oder Mausrad über dem Tritt: öffnet / schließt den Schwellkasten.</dd>
  <dt>Ansicht</dt><dd>Im freien Raum ziehen dreht die Kamera, Mausrad zoomt, Rechtsklick verschiebt. Über einem Bedienelement erscheint ein Hinweis.</dd>
  <dt>Ansichten</dt><dd>Leiste unten (auf schmalen Bildschirmen seitlich wischen): ${CAMERA_PRESETS.map((p) => `<b>${p.label}</b> – ${p.desc}`).join('; ')}.</dd>
  <dt>Gehäuse</dt><dd>„Gehäuse ausblenden“ (oben links) blendet das Gehäuse aus und gibt den Blick auf das innere Pfeifenwerk frei; am besten zusammen mit der Ansicht <b>Pfeifenwerk</b>.</dd>
</dl>
<h3>Tastatur – Spielen</h3>
<dl>
  <dt>Töne</dt><dd>weiße Tasten ${K('A S D F G H J K L Ö Ä')}, Halbtöne ${K('W E T Z U O P')} (ab c′, Pedal ab c).</dd>
  <dt>Manual</dt><dd>${K('F1')} Choir · ${K('F2')} Great · ${K('F3')} Swell · ${K('F4')} Solo · ${K('F5')} Pedal – bestimmt, was die Computertastatur und MIDI-Kanal 1 spielen.</dd>
  <dt>Oktave</dt><dd>${K('Y')} tiefer, ${K('X')} höher.</dd>
</dl>
<h3>Tastatur – Registrieren</h3>
<dl>
  <dt>Generalkolben</dt><dd>${K('1')} … ${K('9')} ${K('0')} = General 1–10 (auch Ziffernblock).</dd>
  <dt>Divisionalkolben</dt><dd>${K('⇧')} + ${K('1')} … ${K('0')} für das gewählte Manual (Choir: 1–5 Choir, 6–0 Orchestral; Solo: 1–5 Solo, 6–0 feste Bombard-Kolben; Pedal: Fußtritte 1–10).</dd>
  <dt>Auslöser</dt><dd>${K('Esc')} oder ${K('Entf')} = Generalauslöser (Esc schließt zuerst diese Hilfe bzw. das Demo-Menü, beendet eine laufende Wiedergabe oder verlässt die Suche).</dd>
  <dt>Sequenzer</dt><dd>${K('+')} vor, ${K('-')} zurück durch die Generalkombinationen.</dd>
  <dt>Setzer</dt><dd>${K('*')} oder ${K('Einfg')} schaltet den Setzer; danach einen Kolben drücken speichert die aktuelle Registrierung (bleibt im Browser gespeichert).</dd>
  <dt>Schweller</dt><dd>${K('Bild↑')} / ${K('Bild↓')} öffnet / schließt den Schwellkasten des gewählten Manuals um 10 % (mit ${K('⇧')} ganz). Great und Pedal steuern den Swell-Kasten.</dd>
  <dt>Suche</dt><dd>${K('/')} (US-Tastatur bzw. Ziffernblock) oder ${K('Strg')}+${K('K')}: „Register suchen…“ nach Name, Fußtonlage, Werk oder Nummer 1–147. ${K('Enter')} schaltet den ersten Treffer, ${K('↓')} ${K('↑')} wählen, Nummer + ${K('Enter')} schaltet dieses Register. Beim Tippen erklingen keine Töne.</dd>
  <dt>Hilfe</dt><dd>${K('?')} öffnet / schließt diese Hilfe.</dd>
</dl>
<h3>Registertafel</h3>
<dl>
  <dt>Navigation</dt><dd>${K('Tab')} springt zwischen den Gruppen, Pfeiltasten bewegen sich innerhalb einer Gruppe, ${K('Leertaste')} / ${K('Enter')} schalten. In der Reiterleiste wechseln ${K('←')} ${K('→')} das Werk.</dd>
  <dt>Kennzeichen</dt><dd>Zungenregister rot; „↗ aus Nr. n“ = Transmission oder Extension aus Register n (keine eigenen Pfeifen bzw. nur die Zusatzoktave).</dd>
  <dt>MIDI</dt><dd>Kanal 1 spielt das gewählte Manual, Kanal 2–5 Choir, Great, Swell, Solo, Kanal 6 das Pedal.</dd>
</dl>
<h3>Demo &amp; MIDI-Dateien</h3>
<dl>
  <dt>Demo-Menü</dt><dd>„▶ Demo“ (Leiste unten) öffnet das Menü; mit der Tastatur ${K('Enter')} / ${K('Leertaste')} öffnen, ${K('↓')} ${K('↑')} wählen, ${K('Enter')} startet, ${K('Esc')} schließt. Während der Wiedergabe zeigt der Knopf „■ Stopp“ und den Titel; Klick darauf oder ${K('Esc')} beendet sie. Fortschritt und Dauer stehen darüber.</dd>
  <dt>BWV 565</dt><dd>Anfang von J. S. Bachs Toccata d-Moll BWV 565 im Plenum; der Schlussakkord mit Tubas über Kolben. Die Registrierung wird danach wiederhergestellt; jede eigene Taste beendet die Demo.</dd>
  <dt>Eigene MIDI-Datei</dt><dd>„Eigene MIDI-Datei laden…“ im Menü oder eine .mid/.midi-Datei einfach auf die Seite ziehen. Die Datei wird nur im Browser gelesen – sie bleibt auf deinem Gerät und wird weder hochgeladen noch gespeichert. Sie spielt mit der <b>aktuellen</b> Registrierung: Register dürfen währenddessen gezogen und eigene Töne gespielt werden, nur „■ Stopp“ oder ${K('Esc')} beendet sie.</dd>
  <dt>Zuordnung</dt><dd>Mehrere MIDI-Kanäle bzw. Spuren: 1. → Great, 2. → Swell, 3. → Choir, 4. → Solo (weitere → Great); ab drei Stimmen geht eine tiefe Basstimme ins Pedal. Sonst übernimmt das Pedal die tiefste Stimme unter c (MIDI 48). Kanal 10 (Schlagzeug) wird ignoriert; Töne außerhalb des Umfangs werden oktaviert (Manuale C–c′′′′, Pedal C–g′).</dd>
  <dt>Grenzen</dt><dd>Standard-MIDI-Dateien Format 0 und 1 (bis 4 MB); höchstens ${MIDI_MAX_POLYPHONY} gleichzeitige Töne (überzählige Mittelstimmen werden gekürzt), höchstens ${MIDI_MAX_SECONDS / 60} Minuten Wiedergabe. Tempowechsel werden berücksichtigt, Anschlagstärke, Pedal-, Programm- und Controller-Befehle nicht.</dd>
</dl>
<p>Tastenbelegung nach Position (deutsches Layout abgebildet). Kombinationen gelten pro Speicherebene (1–64).</p>
`;

const SOURCE_LABELS = [
  [/mander-organs\.com\/wp-content/, 'Mander-Spezifikation 2004 (PDF)'],
  [/mander-organs\.com/, 'Mander Organs, Projektseite'],
  [/wikipedia\.org/, 'Wikipedia'],
  [/npor\.org\.uk/, 'National Pipe Organ Register'],
  [/pipeorgandatabase\.org/, 'OHS Pipe Organ Database'],
  [/royalalberthall\.com/, 'Royal Albert Hall, Geschichte'],
];
const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const sourceLink = (url) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc((SOURCE_LABELS.find(([re]) => re.test(url)) || [null, new URL(url).hostname])[1])}</a>`;
const de = (n) => n.toLocaleString('de-DE');

/** "Über dieses Modell": what is sourced and what is assumed (numbers from stoplist META). */
export function aboutHtml() {
  const c = META.counts;
  const alt = META.totalPipesAlt;
  const clarion = stopById('pedal-clarion');
  const celestes = STOPS.filter((s) => s.rankStart && s.rankStart.some((n) => n > 0));
  const [primary, ...more] = META.sources;
  const clarionDd = clarion && clarion.pitchConflict
    ? `Pedal ${clarion.name}: Wikipedia/NPOR und OHS nennen ${clarion.pitchConflict[0]}′, die Mander-Spezifikation ${clarion.pitchConflict[1]}′; verwendet wird ${pitchLabel(clarion)}.`
    : '';
  return `
<section class="rah-about" aria-label="Über dieses Modell">
<h3>Über dieses Modell</h3>
<dl>
  <dt>Quelle</dt><dd>Disposition nach der ${sourceLink(primary)}, abgeglichen mit ${more.map(sourceLink).join(', ')}.</dd>
  <dt>Register</dt><dd>${c.numberedStops} Registerzüge: ${c.speakingStops} klingende, ${c.derivedStops} abgeleitete (${c.extensions} Extensionen, ${c.transmissions} Transmissionen), ${c.percussionStops} Schlagwerke; dazu ${c.couplers} Koppeln und ${c.tremulants} Tremulanten (belegt).</dd>
  <dt>Pfeifen</dt><dd>${de(META.totalPipes)} Pfeifen laut Royal Albert Hall (Mander/OHS nennen ${de(alt.value)} klingende). Die Pfeifenzahl je Register ist nicht veröffentlicht, sondern errechnet (61 bzw. 32 Töne × Chöre, Extensionen nur die Zusatzoktave)${celestes.length ? `; dass die zweite Reihe von ${celestes.map((s) => s.name).join(' und ')} erst ab c beginnt, ist angenommen` : ''}.</dd>
  ${clarionDd ? `<dt>Quellenkonflikt</dt><dd>${clarionDd}</dd>` : ''}
  <dt>Klang</dt><dd>Synthetisch erzeugt (additive Wellenformen, künstlicher Hall) – keine Aufnahmen der echten Orgel; Lautstärken der Register sind geschätzt.</dd>
  <dt>Aufbau</dt><dd>Prospekt nach Fotografien nachgebildet; Innenaufbau, Windladen und Pfeifenaufstellung sind plausibel angenommen, nicht nach Bauplänen.</dd>
</dl>
</section>`;
}
export const helpHtml = () => HELP_HTML_CONTROLS + aboutHtml();

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export function initInteraction(ctx) {
  const { THREE, camera, renderer, controls, bus } = ctx;
  const pickables = ctx.pickables || (ctx.pickables = []);
  const updaters = ctx.updaters || (ctx.updaters = []);
  const dom = renderer.domElement;
  const hasDOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

  const audio = createOrganAudio();
  const book = createNoteBook(bus);
  const reg = { stops: new Set(), couplers: new Set(), tremulants: new Set() };
  const swell = new Map(SWELL_IDS.map((id) => [id, DEFAULT_SWELL]));
  const ui = { controls: new Map(), tabs: new Map() };
  const perfNow = () => (globalThis.performance ? performance.now() : Date.now()) / 1000;
  let activeManual = MANUAL_GREAT;

  // ---- pipe tracker + batching ------------------------------------------
  const tracker = createPipeTracker(bus, () => reg);
  let batchDepth = 0;
  let pipesDirty = false;
  const touchPipes = () => { if (batchDepth) pipesDirty = true; else tracker.refresh(); };
  function batch(fn) {
    batchDepth++;
    try { return fn(); } finally {
      if (--batchDepth === 0 && pipesDirty) { pipesDirty = false; tracker.refresh(); }
    }
  }

  // ---- bus: one code path for every input ---------------------------------
  const safe = (fn) => (p) => { try { fn(p || {}); } catch (err) { console.warn('[Orgel]', err); } };
  bus.on('noteon', safe(({ midi, manual }) => { audio.noteOn(midi, manual); tracker.noteOn(midi, manual); }));
  bus.on('noteoff', safe(({ midi, manual }) => { audio.noteOff(midi, manual); tracker.noteOff(midi, manual); }));
  bus.on('stop', safe(({ id, on }) => { audio.setStop(id, on); syncControl('stop', id, on); touchPipes(); }));
  bus.on('coupler', safe(({ id, on }) => { audio.setCoupler(id, on); syncControl('coupler', id, on); touchPipes(); }));
  bus.on('tremulant', safe(({ id, on }) => { audio.setTremulant(id, on); syncControl('tremulant', id, on); }));
  bus.on('swell', safe(({ id, value }) => { audio.setSwell(id, value); syncControl('swell', id, value); }));
  bus.on('piston', safe(({ id, on }) => { flashControl('piston', id); if (on !== undefined) syncControl('piston', id, on); }));

  function setStop(id, on) {
    if (!STOP_SET.has(id)) return false;
    on = !!on;
    if (reg.stops.has(id) === on) return false;
    if (on) reg.stops.add(id); else reg.stops.delete(id);
    bus.emit('stop', { id, on });
    return true;
  }
  function setCoupler(id, on) {
    if (!COUPLER_BY_ID.has(id)) return false;
    on = !!on;
    if (reg.couplers.has(id) === on) return false;
    if (on) reg.couplers.add(id); else reg.couplers.delete(id);
    bus.emit('coupler', { id, on });
    return true;
  }
  function setTremulant(id, on) {
    if (!TREMULANT_IDS.includes(id)) return false;
    on = !!on;
    if (reg.tremulants.has(id) === on) return false;
    if (on) reg.tremulants.add(id); else reg.tremulants.delete(id);
    bus.emit('tremulant', { id, on });
    return true;
  }
  function setSwell(id, value) {
    if (!swell.has(id)) return false;
    const v = Math.round(Math.min(1, Math.max(0, +value || 0)) * 1000) / 1000;
    if (swell.get(id) === v) return false;
    swell.set(id, v);
    bus.emit('swell', { id, value: v });
    return true;
  }
  const toggleStop = (id) => setStop(id, !reg.stops.has(id));
  const toggleCoupler = (id) => setCoupler(id, !reg.couplers.has(id));
  const toggleTremulant = (id) => setTremulant(id, !reg.tremulants.has(id));

  function snapshot() { return { stops: [...reg.stops], couplers: [...reg.couplers], tremulants: [...reg.tremulants] }; }
  function applyScoped(scope, s) {
    batch(() => {
      const st = new Set(s.stops || []), cp = new Set(s.couplers || []), tr = new Set(s.tremulants || []);
      for (const id of scope.stops) setStop(id, st.has(id));
      for (const id of scope.couplers) setCoupler(id, cp.has(id));
      for (const id of scope.tremulants) setTremulant(id, tr.has(id));
    });
  }
  const applySnapshot = (s) => applyScoped(ALL_SCOPE, s);

  // ---- combination system -------------------------------------------------
  let storage = null;
  try { storage = globalThis.localStorage || null; } catch { storage = null; }
  const combos = createCombinationSystem({
    getState: () => reg,
    apply: applyScoped,
    setStop, setCoupler,
    storage,
    onChange: (info) => {
      if (info.message) status(info.message);
      if (info.kind === 'setter') { ui.panel?.classList.toggle('rah-armed', info.armed); syncControl('piston', 'setter', info.armed); }
      if (info.kind === 'level') updateLevel();
    },
  });

  function pressPiston(id) {
    if (!ACC_BY_ID.has(id) || !PISTON_IDS.includes(id)) return false;
    // the press itself first, then the registration changes it causes
    const payload = { id };
    if (id === 'setter') payload.on = !combos.isArmed();
    else if (TOGGLE_ACCESSORIES.has(id)) payload.on = !combos.isToggleOn(id);
    bus.emit('piston', payload);
    let res;
    batch(() => { res = combos.press(id); });
    if (res && res.action === 'recall') status(`${accessoryLabel(id)}`);
    if (res && res.action === 'cancel') status(accessoryLabel(id));
    tuttiSaved = null; syncTutti();
    return !!(res && res.ok);
  }

  // Tutti: reversible full organ
  let tuttiSaved = null;
  function tutti() {
    if (tuttiSaved) { const s = tuttiSaved; tuttiSaved = null; applySnapshot(s); status('Tutti aus'); }
    else { const s = snapshot(); applySnapshot(TUTTI_REGISTRATION); tuttiSaved = s; status('Tutti'); }
    syncTutti();
  }
  function allOff() { pressPiston('general-cancel'); }
  function syncTutti() { if (ui.tuttiBtn) ui.tuttiBtn.setAttribute('aria-pressed', tuttiSaved ? 'true' : 'false'); }

  // ---- demo ---------------------------------------------------------------
  const demo = createDemoPlayer({
    book,
    capture: snapshot,
    restore: (s) => { applySnapshot(s); },
    applyRegistration: (s) => applySnapshot(s),
    pressPiston,
    onState: (playing, piece) => {
      if (ui.demoBtn) {
        ui.demoBtn.classList.toggle('rah-active', playing);
        ui.demoBtn.textContent = playing ? `■ Stopp · ${piece.title}` : '▶ Demo';
        ui.demoBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
        ui.demoBtn.setAttribute('aria-haspopup', playing ? 'false' : 'menu');
        ui.demoBtn.title = playing ? `Wiedergabe beenden: ${piece.title}` : 'Demo-Stück wählen oder eigene MIDI-Datei spielen';
      }
      if (playing) showNow(piece); else hideNow();
    },
  });
  updaters.push(() => { demo.update(perfNow()); updateNow(); });

  function playPiece(p) {
    audio.unlock();
    closeDemoMenu(false);
    releaseUserNotes();
    if (p.notices && p.notices.length) status(p.notices.join(' '));
    demo.start(p);
  }
  function playBuiltIn(id) {
    const def = DEMO_PIECES.find((x) => x.id === id) || DEMO_PIECES[0];
    playPiece({ id: def.id, title: def.title, score: def.build(), registration: def.registration });
  }
  /** bytes -> play; returns { ok, error? }. Never throws. */
  function playMidiBytes(name, bytes) {
    const parsed = parseMidiFile(bytes);
    const mapped = midiToScore(parsed);
    if (!mapped.ok) { showError(mapped.error); return mapped; }
    const title = String(name || 'MIDI-Datei').replace(/\.(mid|midi|smf|kar)$/i, '') || 'MIDI-Datei';
    playPiece(midiPiece(title, mapped));
    return mapped;
  }
  async function playMidiFile(file) {
    if (!file) return;
    if (!/\.(mid|midi|smf|kar)$/i.test(file.name || '') && !/midi/.test(file.type || '')) { showError('Bitte eine MIDI-Datei (.mid oder .midi) wählen.'); return; }
    if (file.size > MIDI_MAX_BYTES) { showError('Die Datei ist zu groß (höchstens 4 MB).'); return; }
    let buf;
    try {
      buf = file.arrayBuffer ? await file.arrayBuffer() : await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); });
    } catch { showError('Die Datei konnte nicht gelesen werden.'); return; }
    playMidiBytes(file.name, buf);
  }

  // now-playing box (title, time, progress) and file errors
  let nowShown = -1;
  let errTimer = null;
  function showNow(piece) {
    if (!ui.now) return;
    clearTimeout(errTimer);
    ui.now.hidden = false;
    ui.now.classList.remove('rah-error');
    ui.nowTitle.textContent = piece.title;
    ui.nowNote.textContent = piece.keepRegistration ? 'Spielt mit deiner Registrierung – Register dürfen gezogen werden. Die Datei bleibt auf deinem Gerät.' : 'Registrierung wird danach wiederhergestellt; eine eigene Taste beendet die Demo.';
    if (piece.notices && piece.notices.length) ui.nowNote.textContent += ' ' + piece.notices.join(' ');
    ui.nowBar.hidden = false;
    nowShown = -1;
    updateNow();
  }
  function hideNow() { if (ui.now && !ui.now.classList.contains('rah-error')) ui.now.hidden = true; }
  function updateNow() {
    if (!ui.now || ui.now.hidden || !demo.isPlaying()) return;
    const p = demo.progress();
    const sec = Math.floor(p.elapsed);
    if (sec === nowShown && ui.nowFill.style.width) { ui.nowFill.style.width = `${(p.fraction * 100).toFixed(1)}%`; return; }
    nowShown = sec;
    ui.nowTime.textContent = `${formatTime(p.elapsed)} / ${formatTime(p.duration)}`;
    ui.nowFill.style.width = `${(p.fraction * 100).toFixed(1)}%`;
    ui.nowBar.setAttribute('aria-valuenow', String(Math.round(p.fraction * 100)));
    ui.nowBar.setAttribute('aria-valuetext', `${formatTime(p.elapsed)} von ${formatTime(p.duration)}`);
  }
  function showError(msg) {
    status(msg);
    if (!ui.now) return;
    ui.now.hidden = false;
    ui.now.classList.add('rah-error');
    ui.nowTitle.textContent = 'MIDI-Datei nicht abspielbar';
    ui.nowTime.textContent = '';
    ui.nowNote.textContent = msg;
    ui.nowBar.hidden = true;
    clearTimeout(errTimer);
    errTimer = setTimeout(() => { ui.now.classList.remove('rah-error'); if (!demo.isPlaying()) ui.now.hidden = true; }, 7000);
  }

  // demo menu (built in UI; state here so the keyboard handler can close it)
  let menuOpen = false;
  let menuIndex = 0;
  const menuItems = () => ui.menuItems || [];
  function focusMenuItem(i) {
    const items = menuItems();
    if (!items.length) return;
    menuIndex = (i + items.length) % items.length;
    items.forEach((it, k) => it.setAttribute('tabindex', k === menuIndex ? '0' : '-1'));
    items[menuIndex].focus();
  }
  function openDemoMenu(at = 0) {
    if (!ui.menu) return;
    menuOpen = true;
    ui.menu.hidden = false;
    ui.demoBtn.setAttribute('aria-expanded', 'true');
    focusMenuItem(at);
  }
  function closeDemoMenu(refocus = true) {
    if (!ui.menu || !menuOpen) return;
    menuOpen = false;
    ui.menu.hidden = true;
    ui.demoBtn.setAttribute('aria-expanded', 'false');
    if (refocus) ui.demoBtn.focus();
  }
  function activateMenuItem(i) {
    const it = menuItems()[i];
    if (!it) return;
    const action = it.getAttribute('data-action');
    if (action === 'file') { closeDemoMenu(true); ui.fileInput?.click(); return; }
    playBuiltIn(it.getAttribute('data-piece'));
  }

  function userPress(source, midi, manual) {
    if (demo.stopsOnUserInput()) demo.stop(); // MIDI-file playback keeps running
    book.press(source, midi, manual);
  }
  const userRelease = (source, midi, manual) => book.release(source, midi, manual);
  const releaseUserNotes = () => book.releaseAll((s) => s !== 'demo');

  // ---- camera presets -----------------------------------------------------
  let camAnim = null;
  function goToPreset(id) {
    const p = CAMERA_PRESETS.find((x) => x.id === id);
    if (!p || !THREE) return;
    const pos = presetPosition(p, camera.fov, camera.aspect, Math.min(controls.maxDistance || 70, FIT_MAX_DISTANCE));
    camAnim = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: new THREE.Vector3(...pos), toTarget: new THREE.Vector3(...p.target) };
  }
  updaters.push((time, dt) => {
    if (!camAnim) return;
    camAnim.t = Math.min(1, camAnim.t + (dt || 0.016) / CAMERA_MOVE_SECONDS);
    const k = easeInOut(camAnim.t);
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
    controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, k);
    if (camAnim.t >= 1) camAnim = null;
  });

  // ---- picking --------------------------------------------------------------
  const raycaster = THREE ? new THREE.Raycaster() : null;
  const ndc = THREE ? new THREE.Vector2() : null;
  const pointers = new Map();
  let controlsWereEnabled = true;
  let hover = null;
  let lastHover = null;

  function classify(ud) {
    if (!ud || typeof ud !== 'object') return null;
    switch (ud.type) {
      case 'key':
        if (!Number.isFinite(ud.midi)) return null;
        return { type: 'key', midi: ud.midi, manual: Number.isInteger(ud.manual) ? ud.manual : MANUAL_GREAT };
      case 'stop': return STOP_SET.has(ud.id) ? { type: 'stop', id: ud.id } : null;
      case 'coupler': return COUPLER_BY_ID.has(ud.id) ? { type: 'coupler', id: ud.id } : null;
      case 'tremulant': return TREMULANT_IDS.includes(ud.id) ? { type: 'tremulant', id: ud.id } : null;
      case 'piston': return PISTON_IDS.includes(ud.id) ? { type: 'piston', id: ud.id } : null;
      case 'swell': return swell.has(ud.id) ? { type: 'swell', id: ud.id } : null;
      default: return null;
    }
  }

  function pick(clientX, clientY) {
    if (!pickables.length || !raycaster || !dom.getBoundingClientRect) return null;
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    let hits;
    try { raycaster.setFromCamera(ndc, camera); hits = raycaster.intersectObjects(pickables, false); } catch { return null; }
    for (const h of hits || []) {
      if (!h || !h.object || h.object.visible === false) continue;
      const c = classify(h.object.userData);
      if (c) return c;
    }
    return null;
  }

  function activate(hit) {
    switch (hit.type) {
      case 'stop': toggleStop(hit.id); break;
      case 'coupler': toggleCoupler(hit.id); break;
      case 'tremulant': toggleTremulant(hit.id); break;
      case 'piston': pressPiston(hit.id); break;
      default: break;
    }
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) { camAnim = null; return; }
    const hit = pick(e.clientX, e.clientY);
    if (!hit) { camAnim = null; return; }
    // capture phase: runs before OrbitControls' own pointerdown handler
    if (pointers.size === 0) controlsWereEnabled = controls.enabled;
    controls.enabled = false;
    const source = `ptr${e.pointerId}`;
    const state = { source, key: null, gliss: hit.type === 'key', swell: null };
    pointers.set(e.pointerId, state);
    try { dom.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    audio.unlock();
    if (hit.type === 'key') {
      state.key = { midi: hit.midi, manual: hit.manual };
      userPress(source, hit.midi, hit.manual);
    } else if (hit.type === 'swell') {
      state.swell = { id: hit.id, y: e.clientY, v: swell.get(hit.id) };
    } else {
      activate(hit);
    }
    showTip(hit, e.clientX, e.clientY);
    if (e.preventDefault) e.preventDefault();
  }

  function onPointerMove(e) {
    const state = pointers.get(e.pointerId);
    if (!state) {
      if (e.pointerType !== 'touch' && !e.buttons) hover = { x: e.clientX, y: e.clientY };
      return;
    }
    if (state.swell) {
      setSwell(state.swell.id, state.swell.v + (state.swell.y - e.clientY) / 160);
      showTip({ type: 'swell', id: state.swell.id }, e.clientX, e.clientY);
      return;
    }
    const hit = pick(e.clientX, e.clientY);
    const next = hit && hit.type === 'key' ? hit : null;
    const cur = state.key;
    if (cur && next && cur.midi === next.midi && cur.manual === next.manual) return;
    if (cur) userRelease(state.source, cur.midi, cur.manual);
    state.key = null;
    if (next && state.gliss) {
      state.key = { midi: next.midi, manual: next.manual };
      userPress(state.source, next.midi, next.manual);
    }
  }

  function endPointer(e) {
    const state = pointers.get(e.pointerId);
    if (!state) return;
    pointers.delete(e.pointerId);
    book.releaseSource(state.source);
    try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size === 0) controls.enabled = controlsWereEnabled;
  }

  function onWheel(e) {
    const hit = pick(e.clientX, e.clientY);
    if (hit && hit.type === 'swell') {
      if (e.preventDefault) e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      setSwell(hit.id, swell.get(hit.id) - Math.sign(e.deltaY || 0) * 0.05);
      showTip(hit, e.clientX, e.clientY);
      return;
    }
    camAnim = null;
  }

  dom.addEventListener('pointerdown', onPointerDown, { capture: true });
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', endPointer);
  dom.addEventListener('pointercancel', endPointer);
  dom.addEventListener('lostpointercapture', endPointer);
  dom.addEventListener('pointerleave', () => { hover = null; lastHover = null; hideTip(); if (!pointers.size && dom.style) dom.style.cursor = ''; });
  dom.addEventListener('wheel', onWheel, { capture: true, passive: false });

  updaters.push(() => {
    if (!hover || pointers.size) return;
    const { x, y } = hover;
    hover = null;
    const hit = pick(x, y);
    if (dom.style) dom.style.cursor = hit ? (hit.type === 'swell' ? 'ns-resize' : 'pointer') : '';
    lastHover = hit ? { hit, x, y } : null;
    if (hit) showTip(hit, x, y); else hideTip();
  });

  // ---- tooltip --------------------------------------------------------------
  function describe(hit) {
    switch (hit.type) {
      case 'key': return `<b>${MANUAL_LABELS[hit.manual] ?? ''}</b> · Taste ${noteName(hit.midi)} (MIDI ${hit.midi})`;
      case 'stop': {
        const s = stopById(hit.id);
        const d = derivedInfo(s);
        return `<b>Nr. ${s.number} ${s.name}</b> ${pitchLabel(s)}\n${DIV_DE[s.division]} · ${pitchSpoken(s)}${s.family === 'reed' ? ' · Zunge' : ''}\n${reg.stops.has(s.id) ? 'gezogen' : 'abgestoßen'}${d ? '\n' + d.text : ''}`;
      }
      case 'coupler': { const c = COUPLER_BY_ID.get(hit.id); return `<b>Koppel ${c.number}</b> ${c.name}\n${reg.couplers.has(c.id) ? 'eingeschaltet' : 'ausgeschaltet'}`; }
      case 'tremulant': return `<b>${accessoryLabel(hit.id)}</b>\n${reg.tremulants.has(hit.id) ? 'ein' : 'aus'}`;
      case 'piston': {
        const t = TOGGLE_ACCESSORIES.has(hit.id) ? `\n${combos.isToggleOn(hit.id) ? 'ein' : 'aus'}` : hit.id === 'setter' ? `\n${combos.isArmed() ? 'aktiv' : 'aus'}` : hit.id === 'combination-system' ? `\nEbene ${combos.getLevel()} von ${MEMORY_LEVELS}` : '';
        return `<b>${accessoryLabel(hit.id)}</b>\n${accessoryHint(hit.id)}${combos.isArmed() && ACC_BY_ID.get(hit.id).adjustable ? '\nSetzer aktiv: Klick speichert' : ''}${t}`;
      }
      case 'swell': return `<b>${accessoryLabel(hit.id)}</b>\n${Math.round(swell.get(hit.id) * 100)} % offen · ziehen oder Mausrad`;
      default: return '';
    }
  }
  function showTip(hit, x, y) {
    if (!ui.tip) return;
    ui.tip.innerHTML = describe(hit);
    ui.tip.hidden = false;
    const w = window.innerWidth || 1000, h = window.innerHeight || 800;
    const r = ui.tip.getBoundingClientRect ? ui.tip.getBoundingClientRect() : { width: 200, height: 40 };
    ui.tip.style.left = `${Math.max(4, Math.min(w - r.width - 4, x + 14))}px`;
    ui.tip.style.top = `${Math.max(4, Math.min(h - r.height - 4, y + 16))}px`;
  }
  function hideTip() { if (ui.tip) ui.tip.hidden = true; }

  // ---- computer keyboard --------------------------------------------------
  let octave = 0;
  const codeNotes = new Map(); // event.code -> { midi, manual }
  const baseFor = (manual) => (manual === MANUAL_PEDAL ? PEDAL_KEYBOARD_BASE : KEYBOARD_BASE) + 12 * octave;
  const releaseKbd = () => { for (const { midi, manual } of codeNotes.values()) userRelease('kbd', midi, manual); codeNotes.clear(); };

  function setOctave(o) {
    o = Math.max(-2, Math.min(2, o));
    if (o === octave) return;
    releaseKbd();
    octave = o;
    if (ui.octave) ui.octave.textContent = noteName(baseFor(activeManual));
  }
  function setActiveManual(m) {
    if (!Number.isInteger(m) || m < 0 || m > 4) return;
    if (m !== activeManual) releaseKbd();
    activeManual = m;
    for (const [i, b] of (ui.manualBtns || []).entries()) b.setAttribute('aria-pressed', i === m ? 'true' : 'false');
    if (ui.octave) ui.octave.textContent = noteName(baseFor(activeManual));
    status(`Tastatur spielt ${MANUAL_LABELS[m]}`);
  }

  function isTyping(target) {
    if (!target || !target.tagName) return false;
    if (target.isContentEditable) return true;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
    return target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(target.type);
  }
  const isRange = (t) => t && t.tagName === 'INPUT' && t.type === 'range';

  function nudgeSwell(dir, full) {
    const id = SWELL_BOX_OF_MANUAL[activeManual];
    setSwell(id, full ? (dir > 0 ? 1 : 0) : swell.get(id) + dir * 0.1);
    status(`${accessoryLabel(id)}: ${Math.round(swell.get(id) * 100)} %`);
  }

  function onKeyDown(e) {
    const code = e.code || '';
    const key = e.key || '';
    const target = e.target;
    // search shortcut works everywhere except while typing elsewhere
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'k' || key === 'K' || code === 'KeyK')) {
      e.preventDefault(); focusSearch(); return;
    }
    if (isTyping(target)) return; // the search field handles its own keys; no notes while typing
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if ((key === '/' && !code.startsWith('Digit')) || code === 'NumpadDivide') { e.preventDefault(); focusSearch(); return; }
    if (key === '?') { e.preventDefault(); toggleHelp(); return; }
    const mi = KEY_MANUAL_CODES.indexOf(code);
    if (mi >= 0) { e.preventDefault(); if (!e.repeat) setActiveManual(mi); return; }
    if (key === 'Escape') {
      if (ui.help && !ui.help.hidden) { toggleHelp(false); e.preventDefault(); return; }
      if (menuOpen) { closeDemoMenu(); e.preventDefault(); return; }
      if (demo.isPlaying()) { demo.stop(); e.preventDefault(); return; }
      e.preventDefault(); if (!e.repeat) pressPiston('general-cancel'); return;
    }
    if (key === 'Delete' || code === 'Delete') { e.preventDefault(); if (!e.repeat) pressPiston('general-cancel'); return; }
    if (key === 'Insert' || (key === '*' && !code.startsWith('Digit')) || code === 'NumpadMultiply') { e.preventDefault(); if (!e.repeat) pressPiston('setter'); return; }
    if (key === '+' || code === 'NumpadAdd') { e.preventDefault(); if (!e.repeat) pressPiston('sequencer-advance-great'); return; }
    if (key === '-' || code === 'NumpadSubtract') { e.preventDefault(); if (!e.repeat) pressPiston('sequencer-back-swell'); return; }
    if ((key === 'PageUp' || key === 'PageDown') && !isRange(target)) { e.preventDefault(); nudgeSwell(key === 'PageUp' ? 1 : -1, e.shiftKey); return; }
    let di = KEY_DIGIT_CODES.indexOf(code);
    if (di < 0) di = NUMPAD_CODES.indexOf(code);
    if (di >= 0) {
      e.preventDefault();
      if (e.repeat) return;
      audio.unlock();
      const id = e.shiftKey ? divisionalPistonFor(activeManual, di + 1) : `general-piston-${di + 1}`;
      if (id) pressPiston(id);
      return;
    }
    const known = code in KEY_NOTE_OFFSETS || code === KEY_OCTAVE_DOWN || code === KEY_OCTAVE_UP;
    if (!known) return;
    e.preventDefault();
    if (e.repeat) return;
    audio.unlock();
    if (code in KEY_NOTE_OFFSETS) {
      if (codeNotes.has(code)) return;
      const midi = baseFor(activeManual) + KEY_NOTE_OFFSETS[code];
      const max = activeManual === MANUAL_PEDAL ? PEDAL_MAX : MANUAL_MAX;
      if (midi < MANUAL_MIN || midi > max) return;
      codeNotes.set(code, { midi, manual: activeManual });
      userPress('kbd', midi, activeManual);
    } else if (code === KEY_OCTAVE_DOWN) setOctave(octave - 1);
    else setOctave(octave + 1);
  }
  function onKeyUp(e) {
    const n = codeNotes.get(e.code);
    if (!n) return;
    codeNotes.delete(e.code);
    userRelease('kbd', n.midi, n.manual);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function panic() {
    codeNotes.clear();
    releaseUserNotes();
    if (pointers.size) { pointers.clear(); controls.enabled = controlsWereEnabled; }
  }
  window.addEventListener('blur', panic);
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      demo.stop(); panic(); audio.allNotesOff();
    });
  }
  const gestureUnlock = () => audio.unlock();
  window.addEventListener('pointerdown', gestureUnlock, { capture: true });
  window.addEventListener('pointerup', gestureUnlock, { capture: true });
  window.addEventListener('touchend', gestureUnlock, { capture: true, passive: true });

  // ---- Web MIDI (optional) ------------------------------------------------
  let midiAccess = null;
  function onMidiMessage(msg) {
    const d = msg.data;
    if (!d || d.length < 2) return;
    const cmd = d[0] & 0xf0;
    const ch = d[0] & 0x0f;
    const manual = ch === 0 ? activeManual : ch <= 4 ? ch - 1 : ch === 5 ? MANUAL_PEDAL : activeManual;
    const note = d[1];
    const vel = d.length > 2 ? d[2] : 0;
    const max = manual === MANUAL_PEDAL ? PEDAL_MAX : MANUAL_MAX;
    if (cmd === 0x90 && vel > 0) { if (note >= MANUAL_MIN && note <= max) userPress('midi', note, manual); }
    else if (cmd === 0x80 || cmd === 0x90) {
      for (let m = 0; m <= 4; m++) userRelease('midi', note, m);
    }
  }
  function hookMidiInputs() {
    if (!midiAccess) return;
    let count = 0;
    try { midiAccess.inputs.forEach((input) => { input.onmidimessage = onMidiMessage; count++; }); } catch { /* ignore */ }
    if (ui.midiBtn) {
      ui.midiBtn.textContent = count ? `MIDI · ${count}` : 'MIDI · kein Gerät';
      ui.midiBtn.classList.toggle('rah-active', count > 0);
    }
  }
  async function connectMidi() {
    if (midiAccess || typeof navigator === 'undefined' || !navigator.requestMIDIAccess) return;
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.onstatechange = () => { book.releaseSource('midi'); hookMidiInputs(); };
      hookMidiInputs();
    } catch {
      midiAccess = null;
      if (ui.midiBtn) ui.midiBtn.textContent = 'MIDI nicht erlaubt';
    }
  }
  (async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) return;
      const st = await navigator.permissions?.query({ name: 'midi' });
      if (st && st.state === 'granted') connectMidi();
    } catch { /* fail silently */ }
  })();

  // ---- UI overlay -----------------------------------------------------------
  let statusTimer = null;
  function status(msg) {
    if (!ui.status) return;
    ui.status.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { if (ui.status) ui.status.textContent = ''; }, 3200);
  }
  function syncControl(kind, id, value) {
    const list = ui.controls.get(`${kind}:${id}`);
    if (list) {
      for (const node of list) {
        if (kind === 'swell') {
          const v = Math.round(value * 100);
          if (+node.input.value !== v) node.input.value = String(v);
          node.input.setAttribute('aria-valuetext', `${v} % offen`);
          node.out.textContent = `${v} %`;
        } else node.setAttribute('aria-pressed', value ? 'true' : 'false');
      }
    }
    if (kind === 'stop' || kind === 'coupler') countersDirty = true;
  }
  function flashControl(kind, id) {
    const list = ui.controls.get(`${kind}:${id}`);
    if (!list) return;
    for (const node of list) { node.classList.remove('rah-flash'); void node.offsetWidth; node.classList.add('rah-flash'); }
  }
  let countersDirty = true;
  let lastSounding = -1;
  function updateCounters() {
    if (!ui.count) return;
    const n = reg.stops.size;
    const p = tracker.sounding();
    if (!countersDirty && p === lastSounding) return;
    countersDirty = false; lastSounding = p;
    ui.count.innerHTML = `<b>${n}</b> von ${STOPS.length} Registern gezogen · <b>${p.toLocaleString('de-DE')}</b> Pfeifen klingen`;
    for (const [div, badge] of ui.tabs) {
      const c = div === 'koppeln' ? reg.couplers.size : STOPS.filter((s) => s.division === div && reg.stops.has(s.id)).length;
      badge.textContent = c ? String(c) : '';
    }
  }
  updaters.push(updateCounters);
  function updateLevel() {
    const list = ui.controls.get('piston:combination-system');
    if (list) for (const node of list) { const p = node.querySelector('.rah-p'); if (p) p.textContent = `Ebene ${combos.getLevel()} / ${MEMORY_LEVELS}`; }
  }

  function toggleHelp(force) {
    if (!ui.help) return;
    ui.help.hidden = force === undefined ? !ui.help.hidden : !force;
    if (ui.helpBtn) { ui.helpBtn.classList.toggle('rah-active', !ui.help.hidden); ui.helpBtn.setAttribute('aria-expanded', ui.help.hidden ? 'false' : 'true'); }
  }
  function focusSearch() {
    if (!ui.search) return;
    if (ui.panel && ui.panel.classList.contains('rah-collapsed')) setCollapsed(false);
    ui.search.focus();
    if (ui.search.select) ui.search.select();
  }
  function setCollapsed(c) {
    if (!ui.panel) return;
    ui.panel.classList.toggle('rah-collapsed', c);
    ui.panelHead.setAttribute('aria-expanded', c ? 'false' : 'true');
  }
  function selectTab(id, focus = false) {
    if (!ui.tabEls) return;
    for (const { tab, panel, id: tid } of ui.tabEls) {
      const on = tid === id;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
      if (on && focus) tab.focus();
    }
    try { localStorage.setItem('rah-orgel-tab', id); } catch { /* ignore */ }
  }
  function revealControl(kind, id) {
    const tab = PANEL_LAYOUT.find((t) => t.groups.some((g) => !g.duplicate && g.items.some((i) => i.kind === kind && i.id === id)));
    if (tab) selectTab(tab.id);
    const node = (ui.controls.get(`${kind}:${id}`) || [])[0];
    if (node) {
      try { node.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
      node.classList.remove('rah-flash'); void node.offsetWidth; node.classList.add('rah-flash');
    }
  }
  function operate(hit) {
    audio.unlock();
    switch (hit.type) {
      case 'stop': toggleStop(hit.id); status(`${stopLabel(stopById(hit.id))}: ${reg.stops.has(hit.id) ? 'gezogen' : 'abgestoßen'}`); break;
      case 'coupler': toggleCoupler(hit.id); status(`${COUPLER_BY_ID.get(hit.id).name}: ${reg.couplers.has(hit.id) ? 'ein' : 'aus'}`); break;
      case 'tremulant': toggleTremulant(hit.id); status(`${accessoryLabel(hit.id)}: ${reg.tremulants.has(hit.id) ? 'ein' : 'aus'}`); break;
      case 'piston': pressPiston(hit.id); break;
      case 'swell': { const v = swell.get(hit.id) >= 0.5 ? 0 : 1; setSwell(hit.id, v); break; }
      default: break;
    }
  }

  function makeControl(item) {
    const reg_ = (node) => { const k = `${item.kind}:${item.id}`; if (!ui.controls.has(k)) ui.controls.set(k, []); ui.controls.get(k).push(node); };
    if (item.kind === 'swell') {
      const label = accessoryLabel(item.id);
      const v = Math.round(swell.get(item.id) * 100);
      const input = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(v), 'aria-label': label, 'aria-valuetext': `${v} % offen` });
      const out = el('output', { text: `${v} %` });
      input.addEventListener('input', () => setSwell(item.id, input.value / 100));
      const wrap = el('label', { class: 'rah-slider', title: `${label}: 0 % = geschlossen (≈ −22 dB, dunkler), 100 % = offen` }, [el('span', { text: label.replace('Schwelltritt ', '') }), input, out]);
      reg_({ input, out });
      return wrap;
    }
    let name = '', sub = '', title = '', cls = 'rah-ctl', pressed = null, extra = {};
    if (item.kind === 'stop') {
      const s = stopById(item.id);
      const d = derivedInfo(s);
      name = s.name;
      sub = `${pitchLabel(s) || (s.percussion ? 'Schlagwerk' : '')}<i> · ${s.number}</i>${d ? ` <i>${d.short}</i>` : ''}`;
      title = `Nr. ${s.number} ${s.name} ${pitchLabel(s)} – ${DIV_DE[s.division]}${s.family === 'reed' ? ' – Zungenregister' : ''}${d ? '\n' + d.text : ''}${s.note ? '\n' + s.note : ''}`;
      if (s.family === 'reed') cls += ' rah-reed';
      pressed = reg.stops.has(s.id);
    } else if (item.kind === 'coupler') {
      const c = COUPLER_BY_ID.get(item.id);
      name = c.name;
      sub = `<i>Koppel ${c.number}</i>${c.filter ? ' · Teil' : ''}`;
      title = `Koppel ${c.number}: ${c.name}${c.note ? '\n' + c.note : ''}`;
      pressed = reg.couplers.has(c.id);
    } else if (item.kind === 'tremulant') {
      name = accessoryLabel(item.id);
      sub = `<i>${ACC_BY_ID.get(item.id).number}</i>`;
      title = `${name}: wirkt auf das ${DIV_DE[ACC_BY_ID.get(item.id).division]}`;
      pressed = reg.tremulants.has(item.id);
    } else {
      const a = ACC_BY_ID.get(item.id);
      name = accessoryLabel(a);
      sub = accessoryHint(a).split(':')[0];
      if (a.id === 'combination-system') sub = `Ebene ${combos.getLevel()} / ${MEMORY_LEVELS}`;
      title = `${name} – ${accessoryHint(a)}${a.note ? '\n' + a.note : ''}`;
      cls += ' rah-piston';
      extra = { 'data-adjustable': a.adjustable ? '1' : '0' };
      if (a.id === 'setter') pressed = combos.isArmed();
      else if (TOGGLE_ACCESSORIES.has(a.id)) pressed = combos.isToggleOn(a.id);
    }
    const btn = el('button', {
      class: cls, type: 'button', title, tabindex: '-1', 'data-rove': '1',
      'aria-pressed': pressed === null ? undefined : (pressed ? 'true' : 'false'), ...extra,
    }, [el('span', { class: 'rah-k', 'aria-hidden': 'true' }), el('span', { class: 'rah-n', text: name }), el('span', { class: 'rah-p', html: sub })]);
    btn.setAttribute('aria-label', title.split('\n')[0]);
    btn.addEventListener('click', () => operate({ type: item.kind, id: item.id }));
    reg_(btn);
    return btn;
  }

  function rove(group) {
    const items = () => [...group.querySelectorAll('[data-rove]')];
    const first = items()[0];
    if (first) first.tabIndex = 0;
    group.addEventListener('focusin', (e) => {
      if (!e.target.hasAttribute || !e.target.hasAttribute('data-rove')) return;
      for (const it of items()) it.tabIndex = it === e.target ? 0 : -1;
    });
    group.addEventListener('keydown', (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      let cols = 1;
      const top = list[0].offsetTop;
      while (cols < list.length && list[cols].offsetTop === top) cols++;
      let j = i;
      switch (e.key) {
        case 'ArrowRight': j = i + 1; break;
        case 'ArrowLeft': j = i - 1; break;
        case 'ArrowDown': j = i + cols; break;
        case 'ArrowUp': j = i - cols; break;
        case 'Home': j = 0; break;
        case 'End': j = list.length - 1; break;
        default: return;
      }
      e.preventDefault();
      j = Math.max(0, Math.min(list.length - 1, j));
      list[j].focus();
    });
  }

  function buildSearch() {
    const wrap = el('div', { class: 'rah-search' });
    const input = el('input', {
      type: 'search', placeholder: 'Register suchen…  ( / oder Strg+K )', 'aria-label': 'Register suchen',
      role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'rah-results', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false',
    });
    const list = el('ul', { class: 'rah-results', id: 'rah-results', role: 'listbox', 'aria-label': 'Suchergebnisse' });
    list.hidden = true;
    let hits = [];
    let sel = 0;
    const isOn = (h) => (h.type === 'stop' ? reg.stops.has(h.id) : h.type === 'coupler' ? reg.couplers.has(h.id) : h.type === 'tremulant' ? reg.tremulants.has(h.id) : false);
    const render = () => {
      list.textContent = '';
      hits.forEach((h, i) => {
        const li = el('li', { role: 'option', id: `rah-hit-${i}`, 'aria-selected': i === sel ? 'true' : 'false' }, [
          el('span', { text: h.label }), el('span', { class: 'rah-on', text: h.type === 'piston' ? 'Kolben' : h.type === 'swell' ? 'Schweller' : isOn(h) ? 'ein' : '' }),
        ]);
        li.addEventListener('pointerdown', (e) => { e.preventDefault(); run(h); });
        list.append(li);
      });
      list.hidden = !hits.length;
      input.setAttribute('aria-expanded', hits.length ? 'true' : 'false');
      if (hits.length) input.setAttribute('aria-activedescendant', `rah-hit-${sel}`); else input.removeAttribute('aria-activedescendant');
    };
    const run = (h) => {
      if (!h) return;
      operate(h);
      revealControl(h.type, h.id);
      render();
    };
    input.addEventListener('input', () => { hits = searchControls(input.value, 10); sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { e.preventDefault(); if (hits.length) { sel = (sel + 1) % hits.length; render(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (hits.length) { sel = (sel - 1 + hits.length) % hits.length; render(); } }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value.trim();
        if (/^\d+$/.test(v)) {
          const s = STOP_BY_NUMBER.get(+v);
          if (s) { run({ type: 'stop', id: s.id }); input.select(); } else status(`Kein Register Nr. ${v}`);
        } else run(hits[sel]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (input.value) { input.value = ''; hits = []; render(); } else input.blur();
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 120));
    input.addEventListener('focus', () => { if (hits.length) render(); });
    wrap.append(input, list);
    ui.search = input;
    return wrap;
  }

  function buildUI() {
    if (!hasDOM) return;
    const host = document.getElementById('ui');
    if (!host) return;
    if (!document.getElementById('rah-style')) document.head.append(el('style', { id: 'rah-style', text: CSS }));
    const narrow = (window.innerWidth || 1200) < NARROW_PX;
    const root = el('div', { class: 'rah-root' });
    const c = META.counts;
    const de = (n) => n.toLocaleString('de-DE');

    const subLong = `Willis 1871 · Harrison 1924/33 · Mander 2004 · ${c.numberedStops} Register (${c.speakingStops} klingende, ${c.derivedStops} Transmissionen/Extensionen, ${c.percussionStops} Schlagwerke) · ${c.couplers} Koppeln · ${de(META.totalPipes)} Pfeifen`;
    const subShort = `${c.numberedStops} Register · ${de(META.totalPipes)} Pfeifen · Willis 1871 · Harrison 1924/33 · Mander 2004`;
    const tl = el('div', { class: 'rah-tl' });
    tl.append(el('div', { class: 'rah-title', title: subLong }, [
      el('h1', { html: 'Royal Albert Hall<span class="rah-h1-suffix"> <span class="rah-dot">·</span> Die Orgel</span>' }),
      el('p', { class: 'rah-sub-long', text: subLong }),
      el('p', { class: 'rah-sub-short', text: subShort, 'aria-hidden': 'true' }),
    ]));

    const hint = el('button', { class: 'rah-hint', type: 'button', text: '♪ Klang aktivieren – klicken oder Taste drücken' });
    hint.addEventListener('click', () => audio.unlock());
    tl.append(hint);
    root.append(tl);
    const refreshHint = () => {
      const s = audio.state();
      if (s === 'unavailable') {
        hint.textContent = 'Kein Klang – Web Audio ist in diesem Browser nicht verfügbar';
        hint.classList.add('rah-off');
        setTimeout(() => hint.classList.add('rah-gone'), 6000);
      } else hint.classList.toggle('rah-gone', s === 'running');
    };
    audio.onStateChange(refreshHint);
    refreshHint();

    // ---- panel
    const panel = el('section', { class: 'rah-panel rah-glass' + (narrow ? ' rah-collapsed' : ''), 'aria-label': 'Register' });
    ui.panel = panel;
    ui.count = el('span', { class: 'rah-count', 'aria-live': 'off' });
    const head = el('button', { class: 'rah-panel-head', type: 'button', 'aria-expanded': narrow ? 'false' : 'true', title: 'Registertafel ein- oder ausklappen' }, [
      el('span', {}, [el('span', { class: 'rah-h', text: 'Register ' }), el('br'), ui.count]),
      el('span', { class: 'rah-chev', text: '▼', 'aria-hidden': 'true' }),
    ]);
    ui.panelHead = head;
    head.addEventListener('click', () => setCollapsed(!panel.classList.contains('rah-collapsed')));
    const body = el('div', { class: 'rah-panel-body' });

    const top = el('div', { class: 'rah-top' });
    top.append(buildSearch());
    const row = el('div', { class: 'rah-row', role: 'group', 'aria-label': 'Schnellzugriff' });
    ui.tuttiBtn = el('button', { class: 'rah-btn rah-small', type: 'button', 'aria-pressed': 'false', text: 'Tutti', title: 'Volles Werk ein / zurück zur vorigen Registrierung' });
    ui.tuttiBtn.addEventListener('click', () => { audio.unlock(); tutti(); });
    const offBtn = el('button', { class: 'rah-btn rah-small', type: 'button', text: 'Alles ab', title: 'Generalauslöser (Esc / Entf)' });
    offBtn.addEventListener('click', () => allOff());
    const setterBtn = el('button', { class: 'rah-btn rah-small', type: 'button', 'aria-pressed': 'false', text: 'Setzer', title: 'Setzer (* / Einfg): danach Kolben drücken zum Speichern' });
    setterBtn.addEventListener('click', () => pressPiston('setter'));
    (ui.controls.get('piston:setter') || ui.controls.set('piston:setter', []).get('piston:setter')).push(setterBtn);
    row.append(ui.tuttiBtn, offBtn, setterBtn);
    top.append(row);
    const man = el('div', { class: 'rah-manuals', role: 'group', 'aria-label': 'Manual der Computertastatur' }, [el('span', { text: 'Tastatur:' })]);
    ui.manualBtns = MANUAL_LABELS.map((label, i) => {
      const b = el('button', { class: 'rah-man', type: 'button', 'aria-pressed': i === activeManual ? 'true' : 'false', title: `${label} spielen (F${i + 1})` }, [el('kbd', { text: `F${i + 1}` }), label]);
      b.addEventListener('click', () => setActiveManual(i));
      man.append(b);
      return b;
    });
    ui.octave = el('b', { text: noteName(baseFor(activeManual)) });
    man.append(el('span', {}, [' ab ', ui.octave]));
    top.append(man);
    body.append(top);
    ui.status = el('div', { class: 'rah-status', role: 'status', 'aria-live': 'polite' });
    body.append(ui.status);

    // tabs
    const tablist = el('div', { class: 'rah-tabs', role: 'tablist', 'aria-label': 'Werke' });
    const panels = el('div', { class: 'rah-tabpanels' });
    ui.tabEls = [];
    for (const t of PANEL_LAYOUT) {
      const badge = el('span', { class: 'rah-badge' });
      const tab = el('button', { class: 'rah-tab', type: 'button', role: 'tab', id: `rah-tab-${t.id}`, 'aria-controls': `rah-tp-${t.id}`, 'aria-selected': 'false', tabindex: '-1', title: t.title }, [t.label, badge]);
      if (t.id !== 'spielhilfen') ui.tabs.set(t.id, badge);
      const tp = el('div', { class: 'rah-tabpanel', role: 'tabpanel', id: `rah-tp-${t.id}`, 'aria-labelledby': `rah-tab-${t.id}` });
      tp.hidden = true;
      for (const g of t.groups) {
        const gid = `rah-g-${t.id}-${g.label.replace(/[^a-z]/gi, '')}`;
        const sec = el('div', { class: 'rah-group' }, [el('div', { class: 'rah-group-h', id: gid, text: g.label })]);
        const sliders = g.items.filter((i) => i.kind === 'swell');
        const btns = g.items.filter((i) => i.kind !== 'swell');
        if (btns.length) {
          const grid = el('div', { class: 'rah-grid', role: 'group', 'aria-labelledby': gid });
          for (const it of btns) grid.append(makeControl(it));
          rove(grid);
          sec.append(grid);
        }
        for (const it of sliders) sec.append(makeControl(it));
        if (t.id === 'spielhilfen' && g.label === 'Setzer & Sequenzer') {
          const reset = el('button', { class: 'rah-btn rah-small', type: 'button', text: 'Werkseinstellung dieser Ebene', style: 'margin-top:6px' });
          reset.addEventListener('click', () => combos.resetLevel());
          sec.append(reset);
        }
        tp.append(sec);
      }
      tab.addEventListener('click', () => selectTab(t.id));
      tab.addEventListener('keydown', (e) => {
        const idx = ui.tabEls.findIndex((x) => x.id === t.id);
        let j = null;
        if (e.key === 'ArrowRight') j = (idx + 1) % ui.tabEls.length;
        else if (e.key === 'ArrowLeft') j = (idx - 1 + ui.tabEls.length) % ui.tabEls.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = ui.tabEls.length - 1;
        if (j === null) return;
        e.preventDefault();
        selectTab(ui.tabEls[j].id, true);
      });
      tablist.append(tab);
      panels.append(tp);
      ui.tabEls.push({ id: t.id, tab, panel: tp });
    }
    body.append(tablist, panels);
    let startTab = 'great';
    try { const s = localStorage.getItem('rah-orgel-tab'); if (s && PANEL_LAYOUT.some((t) => t.id === s)) startTab = s; } catch { /* ignore */ }
    selectTab(startTab);

    // footer: volume / hall / midi
    const foot = el('div', { class: 'rah-foot' });
    const slider = (label, value, onInput) => {
      const input = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(value * 100)), 'aria-label': label });
      const out = el('output', { text: `${Math.round(value * 100)} %` });
      input.addEventListener('input', () => { onInput(input.value / 100); out.textContent = `${input.value} %`; });
      return el('label', { class: 'rah-slider' }, [el('span', { text: label }), input, out]);
    };
    foot.append(slider('Lautstärke', audio.getVolume(), (v) => audio.setVolume(v)));
    foot.append(slider('Hall', audio.getReverb(), (v) => audio.setReverb(v)));
    const meta = el('div', { class: 'rah-meta' }, [el('span', { text: 'Schwelltritte: Reiter Spielhilfen oder Bild↑/↓' })]);
    if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
      ui.midiBtn = el('button', { class: 'rah-btn rah-small', type: 'button', text: 'MIDI verbinden', title: 'MIDI-Keyboard verbinden' });
      ui.midiBtn.addEventListener('click', () => connectMidi());
      meta.append(ui.midiBtn);
    }
    foot.append(meta);
    body.append(foot);
    panel.append(head, body);
    root.append(panel);
    // crossing into the narrow layout collapses the panel once (it would cover the view)
    let wasNarrow = narrow;
    window.addEventListener?.('resize', () => {
      const n = (window.innerWidth || 1200) < NARROW_PX;
      if (n && !wasNarrow) setCollapsed(true);
      wasNarrow = n;
    });

    // help
    const help = el('section', { class: 'rah-help rah-glass', id: 'rah-help', html: helpHtml(), 'aria-label': 'Hilfe' });
    help.hidden = true;
    ui.help = help;
    root.append(help);

    // bottom bar
    const bar = el('nav', { class: 'rah-bar rah-glass', 'aria-label': 'Ansichten und Demo' });
    bar.append(el('span', { class: 'rah-bar-label', text: 'Ansicht' }));
    for (const p of CAMERA_PRESETS) {
      const b = el('button', { class: 'rah-btn', type: 'button', text: p.label, title: p.desc ? `${p.label}: ${p.desc}` : p.label });
      b.addEventListener('click', () => goToPreset(p.id));
      bar.append(b);
    }
    bar.append(el('span', { class: 'rah-sep' }));
    ui.demoBtn = el('button', { class: 'rah-btn rah-demo-btn', type: 'button', text: '▶ Demo', 'aria-pressed': 'false', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'rah-demo-menu', title: 'Demo-Stück wählen oder eigene MIDI-Datei spielen' });
    let kbdAt = -1e9; // a handled Enter/Space keydown suppresses the browser's synthetic click
    const demoBtnAction = (at) => {
      audio.unlock();
      if (demo.isPlaying()) { demo.stop(); return; }
      if (menuOpen) closeDemoMenu(); else openDemoMenu(at);
    };
    ui.demoBtn.addEventListener('click', () => { if (perfNow() - kbdAt < 0.6) return; demoBtnAction(0); });
    ui.demoBtn.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') { e.preventDefault(); e.stopPropagation(); if (e.repeat) return; kbdAt = perfNow(); demoBtnAction(0); }
      else if ((k === 'ArrowDown' || k === 'ArrowUp') && !demo.isPlaying()) { e.preventDefault(); e.stopPropagation(); openDemoMenu(k === 'ArrowUp' ? -1 : 0); }
    });
    ui.demoBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Spacebar') e.preventDefault(); });
    bar.append(ui.demoBtn);

    // demo menu (outside the bar, which scrolls and would clip it)
    const menu = el('div', { class: 'rah-demo-menu rah-glass', id: 'rah-demo-menu', role: 'menu', 'aria-label': 'Demo wählen' });
    menu.hidden = true;
    ui.menuItems = [];
    const item = (attrs, title, sub) => {
      const it = el('div', { class: 'rah-mi', role: 'menuitem', tabindex: '-1', ...attrs }, [el('span', { class: 'rah-mi-t', text: title }), sub ? el('span', { class: 'rah-mi-s', text: sub }) : null]);
      const idx = ui.menuItems.length;
      it.addEventListener('click', () => activateMenuItem(idx));
      it.addEventListener('pointermove', () => { if (menuIndex !== idx) focusMenuItem(idx); });
      ui.menuItems.push(it);
      return it;
    };
    menu.append(el('div', { class: 'rah-mh', text: 'Demo-Stücke' }));
    for (const p of DEMO_PIECES) menu.append(item({ 'data-piece': p.id }, `▶ ${p.title}`, p.subtitle));
    menu.append(el('div', { class: 'rah-msep', role: 'separator' }));
    menu.append(item({ 'data-action': 'file' }, 'Eigene MIDI-Datei laden…', `.mid / .midi, auch per Ziehen & Ablegen · spielt mit deiner Registrierung · max. ${MIDI_MAX_SECONDS / 60} Minuten`));
    menu.append(el('p', { class: 'rah-mnote', text: 'Die Datei bleibt auf deinem Gerät – nichts wird hochgeladen oder gespeichert.' }));
    menu.addEventListener('keydown', (e) => {
      const k = e.key;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (k === 'ArrowDown') { stop(); focusMenuItem(menuIndex + 1); }
      else if (k === 'ArrowUp') { stop(); focusMenuItem(menuIndex - 1); }
      else if (k === 'Home') { stop(); focusMenuItem(0); }
      else if (k === 'End') { stop(); focusMenuItem(-1); }
      else if (k === 'Enter' || k === ' ' || k === 'Spacebar') { stop(); if (!e.repeat) activateMenuItem(menuIndex); }
      else if (k === 'Escape') { stop(); closeDemoMenu(); }
      else if (k === 'Tab') closeDemoMenu(false);
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation(); // no notes / pistons while the menu has focus
    });
    ui.menu = menu;
    root.append(menu);
    window.addEventListener('pointerdown', (e) => {
      if (!menuOpen) return;
      const t = e.target;
      if (menu.contains?.(t) || ui.demoBtn.contains?.(t)) return;
      closeDemoMenu(false);
    }, { capture: true });

    // hidden file input
    const fileInput = el('input', { type: 'file', accept: '.mid,.midi,audio/midi,audio/x-midi', class: 'rah-sr', tabindex: '-1', 'aria-hidden': 'true' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      playMidiFile(f);
    });
    ui.fileInput = fileInput;
    root.append(fileInput);

    // now playing
    ui.nowTitle = el('b', { class: 'rah-now-t' });
    ui.nowTime = el('span', { class: 'rah-now-time' });
    ui.nowFill = el('span', { class: 'rah-now-fill' });
    ui.nowBar = el('span', { class: 'rah-now-bar', role: 'progressbar', 'aria-label': 'Fortschritt', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, [ui.nowFill]);
    ui.nowNote = el('span', { class: 'rah-now-note' });
    ui.now = el('div', { class: 'rah-now rah-glass', role: 'status', 'aria-live': 'polite' }, [el('span', { class: 'rah-now-h' }, [ui.nowTitle, ui.nowTime]), ui.nowBar, ui.nowNote]);
    ui.now.hidden = true;
    root.append(ui.now);

    // drag & drop of a MIDI file anywhere on the page
    ui.drop = el('div', { class: 'rah-drop', 'aria-hidden': 'true' }, [el('div', { class: 'rah-drop-box' }, [el('b', { text: 'MIDI-Datei hier ablegen' }), el('span', { text: 'Sie wird auf der Orgel gespielt und bleibt auf deinem Gerät.' })])]);
    ui.drop.hidden = true;
    root.append(ui.drop);
    let dragDepth = 0;
    const hasFiles = (e) => { const ty = e.dataTransfer && e.dataTransfer.types; return !!ty && [...ty].includes('Files'); };
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; ui.drop.hidden = false; });
    window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; ui.drop.hidden = false; });
    window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ui.drop.hidden = true; });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0; ui.drop.hidden = true;
      playMidiFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    ui.helpBtn = el('button', { class: 'rah-btn', type: 'button', text: 'Hilfe', 'aria-expanded': 'false', 'aria-controls': 'rah-help', title: 'Hilfe (?)' });
    ui.helpBtn.addEventListener('click', () => toggleHelp());
    bar.append(ui.helpBtn);
    root.append(bar);

    ui.tip = el('div', { class: 'rah-tip', role: 'tooltip' });
    ui.tip.hidden = true;
    root.append(ui.tip);

    host.append(root);
    ui.root = root;
  }

  try { buildUI(); } catch (err) { console.warn('[Orgel] UI konnte nicht aufgebaut werden:', err); }

  // initial state (emitted so console, pipes and panel follow)
  for (const id of SWELL_IDS) bus.emit('swell', { id, value: swell.get(id) });
  applySnapshot(DEFAULT_REGISTRATION);
  countersDirty = true;

  return {
    audio, book, demo, combos, tracker,
    setStop, toggleStop, setCoupler, toggleCoupler, setTremulant, toggleTremulant, setSwell, pressPiston,
    setActiveManual, getActiveManual: () => activeManual,
    tutti, allOff, snapshot, applySnapshot, batch,
    stops: () => STOP_IDS.filter((id) => reg.stops.has(id)),
    couplers: () => COUPLERS.map((c) => c.id).filter((id) => reg.couplers.has(id)),
    tremulants: () => TREMULANT_IDS.filter((id) => reg.tremulants.has(id)),
    swell: (id) => swell.get(id),
    goToPreset,
    playBuiltIn, playMidiBytes, playMidiFile, openDemoMenu, closeDemoMenu, isDemoMenuOpen: () => menuOpen,
    allNotesOff() { demo.stop(); panic(); audio.allNotesOff(); tracker.releaseAll(); },
  };
}
