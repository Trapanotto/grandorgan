// =============================================================================
// technik.js — the TECHNICAL SYSTEMS of the Royal Albert Hall grand organ
// (wind supply, electro-pneumatic action, swell mechanics) for the
// "Technik-Modus". ES module, three.js r170, no build step.
//
//   buildTechnik(ctx) -> THREE.Group 'technik' (not added to the scene, hidden)
//     children: 'wind' (blue), 'elektrik' (amber), 'mechanik' (red)
//     group.userData.api: setActive, isActive, isAnimating, systems,
//       setSystemVisible, stations, stats, facts, dispose, debug
//
// RESEARCH (what is SOURCED vs ASSUMED — see TECHNIK_FACTS for the UI texts)
//  SOURCED
//   * Mander project page [MP]: before the 2002-04 restoration "additional
//     blowers (bringing the total to seven)" had been added to little avail;
//     Mander relocated one blower to the Swell chamber so that a shop could be
//     built in the base of the organ; winding "extensively remodelled with
//     re-leathered bellows and all new trunking", main trunk of "considerably
//     more generous dimensions"; "new soundboards were provided throughout,
//     only the original chests being retained"; "new key and stop actions ...
//     together with an up-to-date capture system"; key action converted to
//     electro-pneumatic by Harrison & Harrison (1924/1933); Great reeds
//     restored to their 1924 pressures (in the 1970s the Great and Pedal 25"
//     and 15" reeds had been reduced to 19" and 13").
//   * Paul Hale, audience guide [H]: the organ "always struggled for breath
//     owing to the restricted size of the main wind-trunk from the blowers";
//     heat split the 19th-century soundboards and trunks; "new wind system and
//     new soundboards"; Tuba Mirabilis on 30-inch wind; Orchestral Trumpets on
//     25-inch wind.
//   * Mander specification [M]: 3 tremulants (Orchestral VI, Swell XVII,
//     Solo XX); 64-level capture system, generals/divisionals separately
//     switchable, floppy-disk storage; "Ventil switches to non-slider chests".
//   * Enclosed: Swell, Orchestral, Solo (+7 Bombard stops); the 3 Tubas are
//     unenclosed ([M], OHS database [O]).
//   * 1871: wind from two steam engines by Penn & Son (Grace's Guide [G]).
//  ASSUMED (typical Harrison & Harrison / Mander practice; nothing published)
//   * number/arrangement/power of today's blowers: here 4 in a blower room
//     under the organ gallery (2 low pressure, 1 medium, 1 high pressure);
//   * one static reservoir + one regulator per department / pressure group
//     (double-rise bellows with weights), concussion bellows on the trunks;
//   * pressures other than Tubas / Orchestral Trumpets / Great reeds;
//   * slider soundboards with electro-pneumatic pallet action (note magnet ->
//     pneumatic motor -> pull-down -> pallet); slider solenoids at the chest
//     ends; Pedal extension ranks on non-slider (unit) chests with individual
//     note valves and a stop ventil (consistent with [M] "ventil switches");
//     Pedal transmissions from manual chests shown through the manual channel;
//   * solid-state relay/capture rack in the base storey, cable trunk under the
//     gallery floor to the console; electric swell motors with position
//     feedback driving shutter shafts by trace rods; swell pedals with
//     potentiometer contacts; bellows tremulants (beat valve) ~5.5 Hz;
//   * all trunk routes (chosen to run in the free gaps of the pipes.js layout).
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STOPS, DIVISIONS, ACCESSORIES, stopById, resolveSource } from './stoplist.js';
import { chestsFor, buildInventory } from './pipes.js';

export const TECHNIK_FACTS = {
  sourced: [
    'Vor der Restaurierung 2002–2004 gab es insgesamt sieben Gebläse; Mander verlegte eines davon in die Schwellwerkskammer, damit im Unterbau der Orgel ein Laden eingerichtet werden konnte (Mander).',
    'Die Windversorgung wurde komplett neu gestaltet: Bälge neu beledert, alle Windkanäle neu und der Hauptkanal deutlich größer als der ursprüngliche (Mander, Paul Hale).',
    'Früher litt die Orgel an Windnot, weil der Hauptwindkanal von den Gebläsen zu eng war; die Hitze im Saal hatte Laden und Kanäle aus dem 19. Jh. gesprengt (Paul Hale).',
    'Mander lieferte überall neue Windladen („soundboards“); nur die alten Ladengestelle blieben erhalten (Mander).',
    'Tuba Mirabilis auf 30 Zoll Winddruck (ca. 760 mm WS), die Orchestral Trumpets auf 25 Zoll (Paul Hale).',
    'Die Great-Zungen wurden wieder auf ihren Druck von 1924 gebracht; in den 1970er Jahren waren die 25″- und 15″-Zungen von Great und Pedal auf 19″ bzw. 13″ reduziert worden (Mander).',
    'Die Traktur ist seit Harrison & Harrison (1924/1933) elektropneumatisch; 2004 kamen neue Ton- und Registertrakturen und eine moderne Setzeranlage hinzu (Mander).',
    'Setzer: 64 Speicherebenen, Generals und Divisionals getrennt schaltbar, Diskettenspeicher; „Ventil-Schalter für die Nicht-Schleifladen“ (Mander-Disposition).',
    'Drei Tremulanten: Orchestral, Swell und Solo (Mander-Disposition).',
    'Schwellkästen: Swell, Orchestral und Solo (mit sieben Bombard-Registern); die drei Tuben stehen frei (Mander, OHS-Datenbank).',
    '1871 lieferten zwei Dampfmaschinen von Penn & Son den Wind (Grace’s Guide).',
  ],
  assumed: [
    'Anzahl, Leistung und Aufstellung der heutigen Gebläse sind nicht veröffentlicht; dargestellt sind 4 Gebläse (2 Niederdruck, 1 Mitteldruck, 1 Hochdruck) in einem Gebläseraum unter der Orgelempore.',
    'Ein Magazinbalg und je ein Regulator (Doppelfaltenbalg mit Gewichten) pro Werk bzw. Druckgruppe, Stoßbälge an den Kanälen.',
    'Winddrücke außer Tuben, Orchestral Trumpets und Great-Zungen sind typische Werte (z. B. Choir ca. 90 mm, Great-Labiale ca. 110 mm, Swell ca. 150 mm, Solo ca. 200 mm WS).',
    'Schleifladen mit elektropneumatischen Spielventilen: Tonmagnet → pneumatischer Bälgchenmotor → Abzugsdraht → Spielventil (typische Harrison-&-Harrison-Praxis).',
    'Schleifen werden von Schleifenzugmagneten (Solenoiden) am Ladenende bewegt.',
    'Die Pedal-Extensionsreihen stehen auf Einzeltonladen (Kegel-/Taschenventile) mit Registerventil; Transmissionen aus Manualladen sind vereinfacht über den Tonkanal gezeigt.',
    'Festkörper-Relais und Setzerrechner im Unterbau; Kabelkanal unter dem Emporenboden zum Spieltisch.',
    'Elektrische Schwellmotoren mit Positionsrückmeldung, Zugstangen und Jalousiewellen; Schwelltritte mit Potentiometer-Kontakten.',
    'Balgtremulanten mit Schlagventil am Werkskanal, ca. 5,5 Hz.',
    'Die Kanalführung ist für die Darstellung in den freien Lücken des Modells gewählt.',
  ],
  sources: [
    'https://mander-organs.com/the-grand-organ-royal-albert-hall/',
    'https://mander-organs.com/wp-content/uploads/2017/02/roy_alb_hall_spec.pdf',
    'https://paulhale.org/wp-content/uploads/2021/05/rahorgan.pdf',
    'https://en.wikipedia.org/wiki/Royal_Albert_Hall_Organ',
    'https://pipeorgandatabase.org/instruments/75298',
    'https://www.gracesguide.co.uk/Royal_Albert_Hall',
  ],
};

// ---------------------------------------------------------------------------
// constants (must match pipes.js)
// ---------------------------------------------------------------------------
const CHEST_T = 0.3, RECESS_CLEAR = 0.12;
const DOOR = { x0: -1.5, x1: 1.5, z0: -1.2, y1: 5 };
const FLOOR = -3.6;                 // blower-room floor
const Y_AX = FLOOR + 0.15 + 0.56;   // blower shaft height
const COMPASS = Object.fromEntries(DIVISIONS.map((d) => [d.id, d.compass]));
const parity = (n) => ((n % 2) + 2) % 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const COLORS = {
  wind: '#3d8bff', elektrik: '#ffb020', mechanik: '#ff4a3d',
  trunk: 0x3473d6, metal: 0x2c5fb4, leather: 0x1f3f78, board: 0x4f8ff0, weight: 0x22324e, rotor: 0xa8d0ff, flow: 0x9fe0ff,
  body: 0xd99a1e, cable: 0x9a6512, magnet: 0xffc23a, motor: 0xe0881c, pallet: 0xffe08a, slider: 0xf4c35a, plunger: 0xfff0b0, led: 0xffcf4a, exemplar: 0xe8c78a,
  mech: 0xc8352b, rod: 0xff6a5a, pointer: 0xffd8d0,
};

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
const KEEP = new Set(['position', 'normal', 'aFlow', 'aCh']);
const UPV = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function norm(g) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  for (const k of Object.keys(n.attributes)) if (!KEEP.has(k)) n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}
function boxG(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(Math.max(1e-4, Math.abs(x1 - x0)), Math.max(1e-4, Math.abs(y1 - y0)), Math.max(1e-4, Math.abs(z1 - z0)));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
// cylinder from a (radius ra) to b (radius rb)
function cylG(a, b, ra, rb = ra, seg = 8, open = false) {
  const d = _p.subVectors(b, a);
  const L = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, Math.max(L, 1e-4), seg, 1, open);
  _q.setFromUnitVectors(UPV, d.normalize());
  g.applyQuaternion(_q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function sphG(c, r, seg = 8) { const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)); g.translate(c.x, c.y, c.z); return g; }
// lathe around the x axis (profile [[r, x], ...]) at (x, y, z)
function latheX(profile, x, y, z, seg = 20) {
  const g = new THREE.LatheGeometry(profile.map(([r, t]) => new THREE.Vector2(r, t)), seg);
  g.rotateZ(-Math.PI / 2);          // lathe axis +y -> +x
  g.translate(x, y, z);
  return g;
}

// static geometry collector (merged into one mesh per material)
class Bag {
  constructor(name) { this.name = name; this.geos = []; this.boxes = []; }
  add(g, tag, flags = {}) {
    g = norm(g);
    g.computeBoundingBox();
    this.boxes.push({ box: g.boundingBox.clone(), tag: tag || this.name, ...flags });
    this.geos.push(g);
    return g;
  }
  build(mat) {
    if (!this.geos.length) return null;
    const g = mergeGeometries(this.geos, false);
    for (const x of this.geos) x.dispose();
    this.geos = [];
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = this.name;
    m.castShadow = false; m.receiveShadow = false;
    m.matrixAutoUpdate = false;
    return m;
  }
}
// per-vertex flow coordinate (distance along the trunk) and channel
function flowify(g, ch, s0 = 0, axis = -1, a0 = 0, sign = 1) {
  const pos = g.attributes.position, n = pos.count;
  const f = new Float32Array(n), c = new Float32Array(n).fill(ch);
  for (let i = 0; i < n; i++) f[i] = axis < 0 ? s0 : s0 + (pos.getComponent(i, axis) - a0) * sign;
  g.setAttribute('aFlow', new THREE.BufferAttribute(f, 1));
  g.setAttribute('aCh', new THREE.BufferAttribute(c, 1));
  return g;
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------
function stdMat(color, { ei = 0.22, rough = 0.55, metal = 0.12, hi = false, name } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: ei, roughness: rough, metalness: metal });
  m.name = name || 'technik';
  if (hi) {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance += max( vColor.rgb - vec3( 1.0 ), vec3( 0.0 ) ) * 0.6;\n#endif');
    };
    m.customProgramCacheKey = () => 'technikHi';
  }
  return m;
}
function flowMat(color, U) {
  const m = stdMat(color, { ei: 0.16, rough: 0.6, metal: 0.05, name: 'technikTrunks' });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uFlow = U.uFlow; sh.uniforms.uFlowColor = U.uFlowColor;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlow;\nattribute float aCh;\nuniform float uFlow[ 16 ];\nvarying float vFlow;\nvarying float vFlowI;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFlow = aFlow;\n\tvFlowI = uFlow[ int( clamp( aCh, 0.0, 15.0 ) + 0.5 ) ];');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uFlowColor;\nvarying float vFlow;\nvarying float vFlowI;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\tfloat fp = fract( vFlow * 1.25 - uTime * 1.8 );\n' +
        '\ttotalEmissiveRadiance += uFlowColor * vFlowI * smoothstep( 0.5, 0.9, fp ) * ( 1.0 - smoothstep( 0.9, 1.0, fp ) ) * 1.8;');
  };
  m.customProgramCacheKey = () => 'technikFlow';
  return m;
}

// instanced mesh with optional per-instance colour (for highlights)
function instMesh(geo, mat, n, name, colors = false) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  m.count = n;
  m.name = name;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = false; m.receiveShadow = false;
  if (colors) {
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  return m;
}
const setTRS = (mesh, i, x, y, z, sx, sy, sz) => {
  const a = mesh.instanceMatrix.array, o = i * 16;
  a[o] = sx; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
};
// unit box rotated about the x axis by `ang`, local y scaled sy (length), offset along local y by `oy`
const setRotX = (mesh, i, px, py, pz, ang, sx, sy, sz, oy = 0, oz = 0) => {
  const c = Math.cos(ang), s = Math.sin(ang), a = mesh.instanceMatrix.array, o = i * 16;
  a[o] = sx; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy * c; a[o + 6] = sy * s; a[o + 7] = 0;
  a[o + 8] = 0; a[o + 9] = -sz * s; a[o + 10] = sz * c; a[o + 11] = 0;
  a[o + 12] = px; a[o + 13] = py + oy * c - oz * s; a[o + 14] = pz + oy * s + oz * c; a[o + 15] = 1;
};
const setRotZ = (mesh, i, px, py, pz, ang, sx, sy, sz, oy = 0) => {
  const c = Math.cos(ang), s = Math.sin(ang), a = mesh.instanceMatrix.array, o = i * 16;
  a[o] = sx * c; a[o + 1] = sx * s; a[o + 2] = 0; a[o + 3] = 0;
  a[o + 4] = -sy * s; a[o + 5] = sy * c; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = sz; a[o + 11] = 0;
  a[o + 12] = px - oy * s; a[o + 13] = py + oy * c; a[o + 14] = pz; a[o + 15] = 1;
};

// unit geometries for instances
function unitBox() { return new THREE.BoxGeometry(1, 1, 1); }
function unitArm() { return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); }   // y 0..1
function magnetUnit() {           // hangs from y = 0 down to -1; size 1
  return mergeGeometries([
    norm(new THREE.BoxGeometry(1, 0.14, 0.8).translate(0, -0.07, 0)),
    norm(new THREE.CylinderGeometry(0.34, 0.34, 0.62, 8).translate(0, -0.47, 0)),
    norm(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 6).translate(0, -0.82, 0)),
    norm(new THREE.BoxGeometry(0.9, 0.08, 0.6).translate(0, -0.92, 0)),
  ]);
}
function motorUnit() {            // pneumatic motor: two boards and leather, centred, size 1
  return mergeGeometries([
    norm(new THREE.BoxGeometry(1, 0.18, 1).translate(0, 0.41, 0)),
    norm(new THREE.BoxGeometry(0.86, 0.66, 0.86)),
    norm(new THREE.BoxGeometry(1, 0.18, 1).translate(0, -0.41, 0)),
  ]);
}
function plungerUnit() { return norm(new THREE.CylinderGeometry(1, 1, 1, 6).rotateZ(Math.PI / 2)); }   // axis x, length 1
function rotorUnit() {            // coupling disc with spokes / cooling fan, axis x
  const parts = [norm(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16).rotateZ(Math.PI / 2)),
    norm(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8).rotateZ(Math.PI / 2))];
  for (let k = 0; k < 6; k++) {
    const g = new THREE.BoxGeometry(0.03, 0.2, 0.055).translate(0.04, 0.17, 0);
    g.rotateX((k / 6) * Math.PI * 2);
    parts.push(norm(g));
  }
  return mergeGeometries(parts);
}
function tremArmUnit() {          // lever along +x with a weight at the end
  return mergeGeometries([norm(new THREE.BoxGeometry(1, 0.06, 0.06).translate(0.5, 0, 0)),
    norm(new THREE.BoxGeometry(0.16, 0.28, 0.28).translate(0.92, 0, 0))]);
}
function pointerUnit() { return mergeGeometries([norm(new THREE.BoxGeometry(0.12, 1, 0.12).translate(0, 0.5, 0)), norm(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 10).rotateX(Math.PI / 2))]); }

// spiral fan casing (volute) around the x axis; outlet tangential towards -z, upwards
function voluteGeo(cx, cy, cz, R0, R1, width) {
  const sh = new THREE.Shape();
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2 * 0.97;
    const r = R0 + (R1 - R0) * (i / N);
    if (i === 0) sh.moveTo(r * Math.cos(th), r * Math.sin(th)); else sh.lineTo(r * Math.cos(th), r * Math.sin(th));
  }
  sh.lineTo(R1, 0.12);
  sh.lineTo(R0 - 0.04, 0.12);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -width / 2);
  g.rotateY(Math.PI / 2);        // local z -> world x, local u -> world -z
  g.translate(cx, cy, cz);
  return g;
}

// ===========================================================================
// MODEL: chests, channels, unit pipes, stop controls (from pipes.js data)
// ===========================================================================
function chestOutline(c) {
  const ex = (c.exclude || []).map((e) => ({ x0: Math.max(c.x0, e.x0), x1: Math.min(c.x1, e.x1), z0: e.z0 })).filter((e) => e.x1 > e.x0);
  const xs = [...new Set([c.x0, c.x1, ...ex.flatMap((e) => [e.x0, e.x1])])].sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2;
    let zf = c.z1;
    for (const e of ex) if (xm > e.x0 && xm < e.x1) zf = Math.min(zf, e.z0);
    if (out.length && Math.abs(out[out.length - 1][2] - zf) < 1e-9) out[out.length - 1][1] = xs[i + 1];
    else out.push([xs[i], xs[i + 1], zf]);
  }
  return out;
}

function buildModel(LAYOUT, papi) {
  const CH = chestsFor(LAYOUT);
  const recesses = CH.recesses || [];
  let INV = papi && Array.isArray(papi.pipes) && papi.pipes.length ? papi.pipes : null;
  const positional = !!INV;
  if (!INV) {
    INV = buildInventory();
    for (const p of INV) { const c = CH.find((ch) => ch.select(p)); p.chest = c ? c.id : null; }
  }
  const unitRanks = new Set(STOPS.filter((s) => s.derived && s.derived.kind === 'extension').map((s) => resolveSource(s)?.stop.id).filter(Boolean));
  const chests = CH.map((def, ci) => {
    const outline = chestOutline(def);
    const zFront = Math.min(...outline.map((o) => o[2]));
    return { ci, def, id: def.id, division: def.division, x0: def.x0, x1: def.x1, z0: def.z0, z1: def.z1, y: def.y, yb: def.y - CHEST_T,
      zFront, outline, pipes: [], chan: new Map(), units: [], ranks: new Map(), raised: def.y - CHEST_T > 1 };
  });
  const byId = new Map(chests.map((c) => [c.id, c]));
  const home = new Map();
  for (const p of INV) if (!p.facade && p.chest && byId.has(p.chest)) {
    const k = p.rankKey + '|' + parity(p.noteIndex);
    if (!home.has(k)) home.set(k, p.chest);
    if (!home.has(p.rankKey)) home.set(p.rankKey, p.chest);
  }
  const pipeChest = new Int16Array(INV.length).fill(-1);
  INV.forEach((p, i) => {
    const cid = p.facade ? (home.get(p.rankKey + '|' + parity(p.noteIndex)) || home.get(p.rankKey)) : p.chest;
    const c = byId.get(cid);
    if (!c) return;
    pipeChest[i] = c.ci;
    c.pipes.push(i);
    const unit = unitRanks.has(p.rankKey);
    let R = c.ranks.get(p.rankKey);
    if (!R) { R = { rankKey: p.rankKey, unit, sz: 0, n: 0 }; c.ranks.set(p.rankKey, R); }
    if (positional && !p.facade) { R.sz += p.z; R.n++; }
    if (unit) c.units.push(i);
    else {
      let ch = c.chan.get(p.noteIndex);
      if (!ch) { ch = { idx: p.noteIndex, sx: 0, n: 0 }; c.chan.set(p.noteIndex, ch); }
      if (positional && !p.facade) { ch.sx += p.x; ch.n++; }
    }
  });
  // rank ranges and note lookup (as pipes.js)
  const rankRange = new Map(), byNote = new Map();
  INV.forEach((p, i) => {
    const r = rankRange.get(p.rankKey);
    if (!r) rankRange.set(p.rankKey, [p.noteIndex, p.noteIndex]); else { r[0] = Math.min(r[0], p.noteIndex); r[1] = Math.max(r[1], p.noteIndex); }
    const k = p.rankKey + '@' + p.noteIndex;
    if (!byNote.has(k)) byNote.set(k, []);
    byNote.get(k).push(i);
  });
  return { CH, chests, byId, INV, positional, unitRanks, pipeChest, rankRange, byNote, recesses };
}

// pipes.js frame posts under raised chests (re-derived so that the action layer
// can stay clear of them) and other woodwork volumes; also the pipe boxes.
function obstacleBoxes(model) {
  const { CH, INV, recesses } = model;
  const out = [];
  const add = (x0, x1, y0, y1, z0, z1, tag) => out.push({ b: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], tag });
  const interior = INV.filter((p) => !p.facade && Number.isFinite(p.x) && Number.isFinite(p.top));
  for (const p of INV) if (Number.isFinite(p.x) && Number.isFinite(p.top)) add(p.x - p.a, p.x + p.a, p.y0, p.top, p.z - p.b, p.z + p.b, 'pipe');
  const pipeBoxes = interior.map((p) => [p.x - p.a, p.y0, p.z - p.b, p.x + p.a, p.top, p.z + p.b]);
  const free = (x0, y0, z0, x1, y1, z1) => !pipeBoxes.some((b) => b[0] < x1 && b[3] > x0 && b[1] < y1 && b[4] > y0 && b[2] < z1 && b[5] > z0);
  const forbidden = (x0, y0, z0, x1, y1, z1) =>
    recesses.some((r) => x0 < r.x1 + 0.02 && x1 > r.x0 - 0.02 && y0 < r.y1 && y1 > r.y0 && z1 > r.z0 - 0.05 && z0 < r.z1) ||
    (x0 < DOOR.x1 && x1 > DOOR.x0 && z1 > DOOR.z0 && y0 < DOOR.y1);
  for (const c of CH) {
    const yb = c.y - CHEST_T;
    const pieces = chestOutline(c);
    for (const [xa, xb, zf] of pieces) add(xa, xb, yb, c.y, c.z0, zf, 'chest');
    const frontAt = (x) => { for (const [xa, xb, zf] of pieces) if (x >= xa - 1e-9 && x <= xb + 1e-9) return zf; return c.z1; };
    if (yb > 1) {
      for (const px of [c.x0 + 0.06, (c.x0 + c.x1) / 2, c.x1 - 0.06]) for (const front of [false, true]) {
        let ybot = 0.3;
        let pz = front ? frontAt(px) - 0.06 : c.z0 + 0.06;
        for (const r of recesses) if (front && px + 0.05 > r.x0 - 0.02 && px - 0.05 < r.x1 + 0.02 && yb > r.y0) pz = Math.min(pz, r.z0 - RECESS_CLEAR - 0.06);
        if (pz - 0.05 < c.z0) continue;
        for (const o of CH) if (o !== c && o.y < yb && px > o.x0 && px < o.x1 && pz > o.z0 && pz < o.z1) ybot = Math.max(ybot, o.y);
        if (free(px - 0.05, ybot, pz - 0.05, px + 0.05, yb, pz + 0.05) && !forbidden(px - 0.05, ybot, pz - 0.05, px + 0.05, yb, pz + 0.05)) add(px - 0.05, px + 0.05, ybot, yb, pz - 0.05, pz + 0.05, 'post');
      }
      for (const xa of [c.x0, c.x1]) if (Math.abs(Math.abs(xa) - 9.7) < 1e-6) add(xa, Math.sign(xa) * 9.98, yb - 0.45, yb, c.z0, c.z1, 'bearer');
    }
    if (c.box) {
      const T = 0.08, y1 = c.box.y1;
      add(c.x0 - T, c.x1 + T, yb, y1, c.z0 - T, c.z0, 'boxwall');
      add(c.x0 - T, c.x0, yb, y1, c.z0 - T, c.z1 + 0.2, 'boxwall');
      add(c.x1, c.x1 + T, yb, y1, c.z0 - T, c.z1 + 0.2, 'boxwall');
      add(c.x0 - T, c.x1 + T, y1 - 0.08, y1, c.z1 + 0.06, c.z1 + 0.2, 'boxwall');
      const zs = c.z1 + 0.13;
      add(c.x0, c.x1, c.y + 0.02 - 0.03, y1 - 0.08 + 0.03, zs - 0.125, zs + 0.125, 'shutterSweep');
    }
  }
  for (const sx of [-1, 1]) add(sx * 6.54 - 0.025, sx * 6.54 + 0.025, 0.3, 15.1, -2.745, -2.355, 'ladder');
  add(-6.4, 6.4, 15.02, 15.07, -4.8, -2.47, 'walkway');
  add(-6.4, 6.4, 5.2, 5.25, -2.74, -2.38, 'walkway');
  for (const r of recesses) add(r.x0, r.x1, r.y0, r.y1, r.z0 - 0.02, r.z1, 'recess');
  return out;
}

// ===========================================================================
// BUILD
// ===========================================================================
export function buildTechnik(ctx) {
  const LAYOUT = ctx.LAYOUT;
  const bus = ctx.bus;
  const papi = ctx.groups?.pipes?.userData?.api || null;
  const M = buildModel(LAYOUT, papi);
  const { chests, INV } = M;
  const OBST = obstacleBoxes(M);

  const group = new THREE.Group();
  group.name = 'technik';
  group.visible = false;
  const G = { wind: new THREE.Group(), elektrik: new THREE.Group(), mechanik: new THREE.Group() };
  for (const [k, g] of Object.entries(G)) { g.name = k; group.add(g); }

  // ---------------- shared uniforms / materials ----------------
  const U = { uTime: { value: 0 }, uFlow: { value: new Float32Array(16) }, uFlowColor: { value: new THREE.Color(COLORS.flow) } };
  const MAT = {
    trunk: flowMat(COLORS.trunk, U),
    metal: stdMat(COLORS.metal, { ei: 0.2, rough: 0.4, metal: 0.55, name: 'technikBlowers' }),
    leather: stdMat(COLORS.leather, { ei: 0.25, rough: 0.85, metal: 0, name: 'technikRibs' }),
    board: stdMat(COLORS.board, { ei: 0.22, rough: 0.6, metal: 0, name: 'technikBoards' }),
    weight: stdMat(COLORS.weight, { ei: 0.15, rough: 0.5, metal: 0.6, name: 'technikWeights' }),
    rotor: stdMat(COLORS.rotor, { ei: 0.35, rough: 0.35, metal: 0.6, name: 'technikRotors' }),
    body: stdMat(COLORS.body, { ei: 0.22, rough: 0.5, metal: 0.2, name: 'technikActionBody' }),
    cable: stdMat(COLORS.cable, { ei: 0.25, rough: 0.6, metal: 0.1, name: 'technikCables' }),
    exemplar: stdMat(COLORS.exemplar, { ei: 0.16, rough: 0.6, metal: 0, name: 'technikExemplar' }),
    magnet: stdMat(COLORS.magnet, { ei: 0.28, rough: 0.4, metal: 0.4, hi: true, name: 'technikMagnets' }),
    motor: stdMat(COLORS.motor, { ei: 0.22, rough: 0.7, metal: 0, hi: true, name: 'technikMotors' }),
    pallet: stdMat(COLORS.pallet, { ei: 0.25, rough: 0.6, metal: 0, hi: true, name: 'technikPallets' }),
    slider: stdMat(COLORS.slider, { ei: 0.25, rough: 0.6, metal: 0, hi: true, name: 'technikSliders' }),
    plunger: stdMat(COLORS.plunger, { ei: 0.3, rough: 0.3, metal: 0.7, name: 'technikPlungers' }),
    led: stdMat(COLORS.led, { ei: 0.35, rough: 0.3, metal: 0, hi: true, name: 'technikLeds' }),
    mech: stdMat(COLORS.mech, { ei: 0.22, rough: 0.45, metal: 0.4, name: 'technikMech' }),
    rod: stdMat(COLORS.rod, { ei: 0.3, rough: 0.35, metal: 0.6, name: 'technikRods' }),
    pointer: stdMat(COLORS.pointer, { ei: 0.4, rough: 0.3, metal: 0.3, name: 'technikPointers' }),
  };

  const bags = {
    trunk: new Bag('windTrunks'), metal: new Bag('blowerPlant'),
    body: new Bag('actionBodies'), cable: new Bag('cables'), exemplar: new Bag('cutawayChest'),
    mech: new Bag('swellMechanics'),
  };
  // flow channels: 0 LP main, 1 MP main, 2 HP main, 3.. regulators, 15 = none
  const NOFLOW = 15;
  const staticWind = (g, tag, flags) => bags.trunk.add(flowify(norm(g), NOFLOW), tag, flags);

  // orthogonal trunk along points with cross-section sizes [sx, sy, sz]
  // (the component along a segment is ignored); flanges every ~1.6 m.
  function trunk(pts, size, ch, tag, { s0 = 0, endExt = [0, 0], flange = true, flags } = {}) {
    let s = s0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = V(...pts[i]), b = V(...pts[i + 1]);
      const d = b.clone().sub(a);
      const ax = Math.abs(d.x) > Math.abs(d.y) ? (Math.abs(d.x) > Math.abs(d.z) ? 0 : 2) : (Math.abs(d.y) > Math.abs(d.z) ? 1 : 2);
      const L = Math.abs(d.getComponent(ax));
      if (L < 1e-6) continue;
      const sign = Math.sign(d.getComponent(ax));
      const lo = [a.x, a.y, a.z], hi = [a.x, a.y, a.z];
      for (let k = 0; k < 3; k++) { lo[k] -= size[k] / 2; hi[k] += size[k] / 2; }
      const extA = i === 0 ? endExt[0] : size[ax] / 2, extB = i === pts.length - 2 ? endExt[1] : size[ax] / 2;
      const ca = a.getComponent(ax), cb = b.getComponent(ax);
      lo[ax] = Math.min(ca - sign * extA, cb + sign * extB);
      hi[ax] = Math.max(ca - sign * extA, cb + sign * extB);
      const g = norm(boxG(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]));
      bags.trunk.add(flowify(g, ch, s, ax, ca, sign), tag, flags);
      if (flange) {
        const nF = Math.floor(L / 1.6);
        for (let f = 1; f <= nF; f++) {
          const t = ca + sign * f * (L / (nF + 1));
          const fl = [lo[0] - 0.015, hi[0] + 0.015, lo[1] - 0.015, hi[1] + 0.015, lo[2] - 0.015, hi[2] + 0.015];
          fl[ax * 2] = t - 0.02; fl[ax * 2 + 1] = t + 0.02;
          bags.trunk.add(flowify(norm(boxG(...fl)), ch, s + Math.abs(t - ca)), tag, flags);
        }
      }
      s += L;
    }
    return s;
  }
  // round (metal) high-pressure pipe
  function pipeRun(pts, r, ch, tag, { flags } = {}) {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = V(...pts[i]), b = V(...pts[i + 1]);
      const d = b.clone().sub(a), L = d.length();
      if (L < 1e-6) continue;
      const ax = Math.abs(d.x) > Math.abs(d.y) ? (Math.abs(d.x) > Math.abs(d.z) ? 0 : 2) : (Math.abs(d.y) > Math.abs(d.z) ? 1 : 2);
      bags.trunk.add(flowify(norm(cylG(a, b, r, r, 10, true)), ch, s, ax, a.getComponent(ax), Math.sign(d.getComponent(ax))), tag, flags);
      if (i > 0) bags.trunk.add(flowify(norm(sphG(a, r * 1.08, 10)), ch, s), tag, flags);
      s += L;
    }
    return s;
  }
  function cable(pts, r = 0.022, tag = 'cable', flags) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = V(...pts[i]), b = V(...pts[i + 1]);
      if (a.distanceTo(b) < 1e-6) continue;
      bags.cable.add(cylG(a, b, r, r, 6, true), tag, flags);
      if (i > 0) bags.cable.add(sphG(a, r, 6), tag, flags);
    }
  }

  // =========================================================================
  // 1. WIND
  // =========================================================================
  const tremDiv = { orchestral: 'orchestral-tremulant', swell: 'swell-tremulant', solo: 'solo-tremulant' };
  // regulator definitions (x0,x1,z0,z1 footprint, y0 base, kh kasten height, h bellows height)
  const REGS = [
    { id: 'pedal', label: 'Pedal', x0: -8.7, x1: -7.0, z0: -2.6, z1: -1.3, y0: FLOOR, kh: 0.45, h: 0.9, src: 'lp', chests: ['pedal-C', 'pedal-Cs', 'pedal-flue-C', 'pedal-flue-Cs'] },
    { id: 'orchestral', label: 'Orchestral', x0: -6.0, x1: -4.6, z0: -2.6, z1: -1.5, y0: FLOOR, kh: 0.45, h: 0.8, src: 'lp', chests: ['orchestral'], trem: 'orchestral-tremulant' },
    { id: 'solo', label: 'Solo/Bombard', x0: -2.8, x1: -1.2, z0: -2.6, z1: -1.5, y0: FLOOR, kh: 0.45, h: 0.8, src: 'mp', chests: ['solo'], trem: 'solo-tremulant' },
    { id: 'tubas', label: 'Tuben (30″)', x0: 1.6, x1: 3.0, z0: -2.6, z1: -1.6, y0: FLOOR, kh: 0.45, h: 0.7, src: 'hp', chests: ['tubas-C', 'tubas-Cs'], hp: true },
    { id: 'greatReeds', label: 'Great-Zungen (25″)', x0: 3.6, x1: 5.0, z0: -2.6, z1: -1.6, y0: FLOOR, kh: 0.45, h: 0.7, src: 'hp', chests: ['great'], hp: true },
    { id: 'swell', label: 'Swell', x0: 6.6, x1: 8.4, z0: -4.8, z1: -3.6, y0: FLOOR, kh: 0.45, h: 0.9, src: 'mp', chests: ['swell'], trem: 'swell-tremulant' },
    { id: 'choir', label: 'Choir', x0: 2.6, x1: 4.4, z0: -2.25, z1: -1.65, y0: 0.03, kh: 0.3, h: 0.42, src: 'lp', chests: ['choir'] },
    { id: 'greatC', label: 'Great (C-Seite)', x0: -4.3, x1: -2.3, z0: -2.3, z1: -1.5, y0: 4.05, kh: 0.37, h: 0.5, src: 'lp', chests: ['great'] },
    { id: 'greatCs', label: 'Great (Cis-Seite)', x0: 2.3, x1: 4.3, z0: -2.3, z1: -1.5, y0: 4.05, kh: 0.37, h: 0.5, src: 'lp', chests: ['great'] },
  ];
  const MAIN = { id: 'main', label: 'Magazinbalg', x0: -3.4, x1: 1.0, z0: -4.8, z1: -3.3, y0: FLOOR, kh: 0.45, h: 0.9, src: 'lp', main: true };
  const ALLREG = [MAIN, ...REGS];
  ALLREG.forEach((r, i) => { r.ch = r.main ? 0 : 2 + i; r.yB = r.y0 + r.kh; r.stroke = r.h * 0.42; r.cur = 0; r.tgt = 0; r.demand = 0; r.cap = 0; r.ri = i; });
  const regById = new Map(ALLREG.map((r) => [r.id, r]));

  // pipe -> regulator
  const isGreatReed = (p) => p.division === 'great' && (p.shape === 'reedCone' || p.shape === 'reedCyl');
  const pipeReg = new Int16Array(INV.length).fill(-1);
  const pipeW = new Float32Array(INV.length);
  INV.forEach((p, i) => {
    const ci = M.pipeChest[i];
    if (ci < 0) return;
    const cid = chests[ci].id;
    let r;
    if (cid === 'great') r = isGreatReed(p) ? 'greatReeds' : (parity(p.noteIndex) === 0 ? 'greatC' : 'greatCs');
    else r = REGS.find((g) => g.chests.includes(cid))?.id;
    const R = regById.get(r);
    if (!R) return;
    pipeReg[i] = R.ri;
    const reed = p.shape === 'reedCone' || p.shape === 'reedCyl';
    pipeW[i] = clamp(((p.diameter || 0.03) / 0.05) ** 2, 0.04, 30) * (reed ? 1.6 : 1);
    R.cap += pipeW[i];
    if (R.src === 'lp') MAIN.cap += pipeW[i];
  });

  // ---- blower room floor
  bags.metal.add(boxG(-9.3, 9.3, FLOOR - 0.05, FLOOR, -4.9, -0.25), 'blowerRoomFloor');
  // ---- blowers
  const BLOWERS = [
    { id: 'B1', cx: -7.8, cz: -4.0, label: 'Gebläse 1 (Niederdruck)', ch: 0 },
    { id: 'B2', cx: -5.6, cz: -4.0, label: 'Gebläse 2 (Niederdruck)', ch: 0 },
    { id: 'B3', cx: 2.0, cz: -4.0, label: 'Gebläse 3 (Mitteldruck)', ch: 1 },
    { id: 'B4', cx: 4.3, cz: -4.0, label: 'Gebläse 4 (Hochdruck)', ch: 2 },
  ];
  const R0 = 0.36, R1 = 0.52;
  for (const b of BLOWERS) {
    const { cx, cz } = b;
    const B = bags.metal;
    B.add(boxG(cx - 0.85, cx + 0.75, FLOOR, FLOOR + 0.15, cz - 0.5, cz + 0.45), 'blower');
    // motor with cooling fins and end bells
    const prof = [[0.001, -0.31], [0.19, -0.3], [0.23, -0.26]];
    for (let k = 0; k < 7; k++) { const t = -0.22 + k * 0.065; prof.push([0.235, t], [0.262, t + 0.012], [0.262, t + 0.03], [0.235, t + 0.042]); }
    prof.push([0.23, 0.24], [0.17, 0.29], [0.06, 0.3], [0.04, 0.36], [0.001, 0.36]);
    B.add(latheX(prof, cx - 0.47, Y_AX, cz, 24), 'blower');
    B.add(boxG(cx - 0.68, cx - 0.26, FLOOR + 0.15, Y_AX - 0.18, cz - 0.2, cz + 0.2), 'blower');
    B.add(boxG(cx - 0.6, cx - 0.36, Y_AX + 0.2, Y_AX + 0.36, cz + 0.05, cz + 0.22), 'blower');   // terminal box
    // fan casing + inlet bell + outlet
    B.add(voluteGeo(cx + 0.3, Y_AX, cz, R0, R1, 0.38), 'blower');
    B.add(latheX([[0.2, 0], [0.24, 0.06], [0.3, 0.14], [0.3, 0.16]], cx + 0.49, Y_AX, cz, 20), 'blower');
    B.add(boxG(cx - 0.05, cx + 0.65, FLOOR + 0.15, Y_AX - R1 + 0.06, cz - 0.3, cz + 0.3), 'blower');
    b.rotor = V(cx - 0.12, Y_AX, cz);
    b.out = [cx + 0.3, Y_AX + 0.1, cz - (R0 + R1) / 2];
  }
  // blower outlets and main trunks
  const B1 = BLOWERS[0], B2 = BLOWERS[1], B3 = BLOWERS[2], B4 = BLOWERS[3];
  const zO = B1.out[2];
  trunk([[B1.out[0], B1.out[1], zO], [B1.out[0], -1.0, zO], [-3.7, -1.0, zO], [-3.7, -3.35, zO], [-3.4, -3.35, zO]], [0.3, 0.3, 0.2], 0, 'lpCollector');
  trunk([[B2.out[0], B2.out[1], zO], [B2.out[0], -1.0, zO]], [0.3, 0.3, 0.2], 0, 'lpCollector', { endExt: [0, 0.15] });
  // MP: B3 -> Solo + Swell regulators
  trunk([[B3.out[0], B3.out[1], zO], [B3.out[0], -1.1, zO], [6.35, -1.1, zO], [6.35, -3.35, zO], [6.6, -3.35, zO]], [0.3, 0.3, 0.2], 1, 'mpTrunk');
  trunk([[B3.out[0], -1.1, zO], [-2.0, -1.1, zO], [-2.0, -1.1, -2.9], [-2.0, -3.35, -2.9], [-2.0, -3.35, -2.6]], [0.3, 0.3, 0.3], 1, 'mpTrunk', { endExt: [0.15, 0] });
  // HP: B4 -> Tubas + Great-reeds regulators
  trunk([[B4.out[0], B4.out[1], zO], [B4.out[0], -1.6, zO]], [0.22, 0.22, 0.16], 2, 'hpOutlet', { endExt: [0, 0.08] });
  pipeRun([[B4.out[0], -1.6, zO], [B4.out[0], -1.6, -2.95], [2.3, -1.6, -2.95], [2.3, -3.35, -2.95], [2.3, -3.35, -2.6]], 0.08, 2, 'hpMain');
  pipeRun([[4.3, -1.6, -2.95], [4.3, -3.35, -2.95], [4.3, -3.35, -2.6]], 0.08, 2, 'hpMain');
  // LP distribution from the reservoir
  trunk([[0.4, -3.35, -3.3], [0.4, -3.35, -3.0], [0.4, -0.275, -3.0], [6.2, -0.275, -3.0]], [0.3, 0.25, 0.3], 0, 'lpDist');
  trunk([[0.4, -0.275, -3.0], [-7.85, -0.275, -3.0], [-7.85, -3.35, -3.0], [-7.85, -3.35, -2.6]], [0.3, 0.25, 0.3], 0, 'lpDist', { endExt: [0.15, 0] });
  trunk([[-4.95, -0.275, -3.0], [-4.95, -3.35, -3.0], [-4.95, -3.35, -2.6]], [0.3, 0.25, 0.3], regById.get('orchestral').ch, 'lpBranch', { endExt: [0.12, 0] });

  // chest feeds ------------------------------------------------------------
  const feeds = new Map(chests.map((c) => [c.id, 0]));
  const fed = (id) => feeds.set(id, feeds.get(id) + 1);
  const chR = (id) => regById.get(id).ch;
  // pedal: regulator -> distribution under the floor -> 4 chests
  trunk([[-7.85, -3.35, -1.3], [-7.85, -3.35, -0.52], [-7.85, -0.625, -0.52]], [0.25, 0.25, 0.25], chR('pedal'), 'pedalFeed', { endExt: [0.1, 0.12] });
  trunk([[-8.2, -0.625, -0.52], [8.2, -0.625, -0.52]], [0.25, 0.25, 0.25], chR('pedal'), 'pedalFeed');
  for (const [x, id] of [[-8.2, 'pedal-C'], [8.2, 'pedal-Cs'], [-5.4, 'pedal-flue-C'], [5.4, 'pedal-flue-Cs']]) {
    const c = M.byId.get(id);
    trunk([[x, -0.625, -0.52], [x, -0.625, -4.55], [x, c.yb, -4.55]], [0.25, 0.25, 0.25], chR('pedal'), 'pedalFeed', { flags: { feeds: id, touchesChest: true } });
    fed(id);
  }
  // orchestral
  trunk([[-4.6, -3.35, -2.05], [-3.0, -3.35, -2.05], [-3.0, -0.625, -2.05], [-3.0, -0.625, -4.55], [-3.0, 0.3, -4.55]], [0.25, 0.25, 0.25], chR('orchestral'), 'orchestralFeed', { endExt: [0.1, 0], flags: { feeds: 'orchestral', touchesChest: true } });
  fed('orchestral');
  // choir (regulator under its chest)
  trunk([[4.75, -0.275, -3.0], [4.75, -0.275, -2.05], [4.75, 0.18, -2.05], [4.4, 0.18, -2.05]], [0.25, 0.25, 0.25], chR('choir'), 'choirFeed', { endExt: [0.12, 0] });
  trunk([[2.6, 0.18, -2.1], [2.25, 0.18, -2.1], [2.25, 0.95, -2.1]], [0.25, 0.25, 0.25], chR('choir'), 'choirFeed', { flags: { feeds: 'choir', touchesChest: true } });
  fed('choir');
  // great: LP risers in the slots between centre and end chests -> regulators under the Great chest -> chest
  for (const s of [-1, 1]) {
    const rid = s < 0 ? 'greatC' : 'greatCs';
    trunk([[s * 6.2, -0.275, -3.0], [s * 6.2, -0.275, -1.78], [s * 6.5, -0.275, -1.78], [s * 6.5, 4.23, -1.78], [s * 4.3, 4.23, -1.78]], [0.15, 0.3, 0.3], chR(rid), 'greatRiser', { endExt: [0.15, 0] });
    trunk([[s * 2.3, 4.23, -2.2], [s * 2.0, 4.23, -2.2], [s * 2.0, 5.3, -2.2]], [0.25, 0.25, 0.25], chR(rid), 'greatFeed', { flags: { feeds: 'great', touchesChest: true } });
    fed('great');
  }
  // solo: MP regulator -> plenum -> flat trunk behind the centre arch recess -> chest
  trunk([[-1.2, -3.35, -2.05], [-0.6, -3.35, -2.05], [-0.6, -1.0, -2.05], [-0.6, -1.0, -1.3], [-0.6, -0.9, -1.3]], [0.25, 0.25, 0.25], chR('solo'), 'soloFeed');
  staticWind(boxG(-1.0, 1.0, -0.9, -0.45, -1.45, -1.1), 'soloPlenum');
  {
    const ch = chR('solo');
    const add = (g, s0, a0) => bags.trunk.add(flowify(norm(g), ch, s0, 1, a0, 1), 'soloFlatTrunk', { feeds: 'solo', touchesChest: true });
    add(boxG(-1.0, 1.0, -0.45, 4.2, -1.24, -1.14), 0, -0.45);
    add(boxG(-1.0, 1.0, 4.0, 4.2, -1.415, -1.24), 4.45, 4.0);
    add(boxG(-1.0, 1.0, 4.0, M.byId.get('solo').yb, -1.415, -1.335), 4.45, 4.0);
    for (const y of [1.6, 2.8, 6.0, 8.0, 9.9]) bags.trunk.add(flowify(norm(boxG(-1.02, 1.02, y - 0.02, y + 0.02, y < 4 ? -1.255 : -1.418, y < 4 ? -1.125 : -1.33)), ch, y + 0.45), 'soloFlatTrunk');
    fed('solo');
  }
  // swell: MP regulator -> riser in the side gap (x ~ 9.8) -> under the swell chest
  trunk([[8.4, -3.35, -4.67], [9.8, -3.35, -4.67], [9.8, 6.1, -4.67], [4.5, 6.1, -4.67], [4.5, M.byId.get('swell').yb, -4.67]], [0.15, 0.3, 0.22], chR('swell'), 'swellRiser', { endExt: [0.1, 0], flags: { feeds: 'swell', touchesChest: true } });
  fed('swell');
  // tubas: HP 30" pipes up both slots into the chest ends
  pipeRun([[2.3, -3.35, -1.6], [2.3, -3.35, -1.35], [2.3, -1.7, -1.35]], 0.065, chR('tubas'), 'tubaHP');
  for (const s of [-1, 1]) {
    const c = M.byId.get(s < 0 ? 'tubas-C' : 'tubas-Cs');
    const xe = s < 0 ? c.x1 : c.x0;
    pipeRun([[2.3, -1.7, -1.35], [s * 6.5, -1.7, -1.35], [s * 6.5, -1.7, -2.2], [s * 6.5, 11.24, -2.2], [xe, 11.24, -2.2]], 0.065, chR('tubas'), 'tubaHP', { flags: { feeds: c.id, touchesChest: true } });
    fed(c.id);
  }
  // great reeds: HP 25" pipes into the Great chest ends
  pipeRun([[4.3, -3.35, -1.6], [4.3, -3.35, -1.2], [4.3, -1.4, -1.2]], 0.055, chR('greatReeds'), 'greatReedHP');
  for (const s of [-1, 1]) {
    pipeRun([[4.3, -1.4, -1.2], [s * 6.5, -1.4, -1.2], [s * 6.5, -1.4, -2.06], [s * 6.5, 5.45, -2.06], [s * 6.4, 5.45, -2.06]], 0.055, chR('greatReeds'), 'greatReedHP', { flags: { feeds: 'great', touchesChest: true } });
  }

  // ---- regulators / reservoir: static Unterkasten, moving bellows (instanced)
  const nBoards = ALLREG.length * 2, nRibs = ALLREG.length * 16;
  const nWeights = ALLREG.reduce((t, r) => t + (r.hp ? 4 : r.main ? 4 : 2), 0);
  const boardsMesh = instMesh(unitBox(), MAT.board, nBoards, 'reservoirBoards');
  const ribsMesh = instMesh(unitBox(), MAT.leather, nRibs, 'reservoirRibs');
  const weightsMesh = instMesh(unitBox(), MAT.weight, nWeights, 'reservoirWeights');
  {
    let wk = 0;
    for (const r of ALLREG) {
      staticWind(boxG(r.x0, r.x1, r.y0, r.yB, r.z0, r.z1), 'reservoir');
      staticWind(boxG(r.x0 - 0.02, r.x1 + 0.02, r.yB - 0.05, r.yB, r.z0 - 0.02, r.z1 + 0.02), 'reservoir');
      // curtain-valve housing on the kasten
      if (!r.main) staticWind(boxG(r.x0 + 0.1, r.x0 + 0.4, r.yB, r.yB + 0.12, r.z0 + 0.06, r.z0 + 0.22), 'reservoir');
      r.wIdx = wk;
      r.nW = r.hp || r.main ? 4 : 2;
      wk += r.nW;
    }
  }
  const W_R = (r) => r.x1 - r.x0, D_R = (r) => r.z1 - r.z0;
  function writeReg(r, trem = 0) {
    const H = Math.max(0.12, r.h - r.cur * r.stroke + trem);
    const f = H / 2, Lp = (r.h / 4) * 1.08, d = Math.sqrt(Math.max(0, Lp * Lp - (f / 2) * (f / 2)));
    const W = W_R(r), D = D_R(r), cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const bi = r.ri * 2;
    setTRS(boardsMesh, bi, cx, r.yB + f, cz, W + 0.05, 0.04, D + 0.05);
    setTRS(boardsMesh, bi + 1, cx, r.yB + H + 0.025, cz, W + 0.06, 0.05, D + 0.06);
    let k = r.ri * 16;
    const al = Math.atan2(d, f / 2);
    for (let fold = 0; fold < 2; fold++) {
      const yk = r.yB + fold * f;
      for (const [zs, sg] of [[r.z1, 1], [r.z0, -1]]) {
        _e.set(sg * al, 0, 0); _q.setFromEuler(_e); _m.compose(_p.set(cx, yk + f / 4, zs + sg * d / 2), _q, _s.set(W, Lp, 0.012)); ribsMesh.setMatrixAt(k++, _m);
        _e.set(-sg * al, 0, 0); _q.setFromEuler(_e); _m.compose(_p.set(cx, yk + 3 * f / 4, zs + sg * d / 2), _q, _s.set(W, Lp, 0.012)); ribsMesh.setMatrixAt(k++, _m);
      }
      for (const [xs, sg] of [[r.x1, 1], [r.x0, -1]]) {
        _e.set(0, 0, -sg * al); _q.setFromEuler(_e); _m.compose(_p.set(xs + sg * d / 2, yk + f / 4, cz), _q, _s.set(0.012, Lp, D)); ribsMesh.setMatrixAt(k++, _m);
        _e.set(0, 0, sg * al); _q.setFromEuler(_e); _m.compose(_p.set(xs + sg * d / 2, yk + 3 * f / 4, cz), _q, _s.set(0.012, Lp, D)); ribsMesh.setMatrixAt(k++, _m);
      }
    }
    const wy = r.yB + H + 0.05;
    const ww = Math.min(0.32, W * 0.28), wd = Math.min(0.24, D * 0.45), wh = 0.07;
    for (let j = 0; j < r.nW; j++) {
      const col = j % 2, row = j >> 1;
      setTRS(weightsMesh, r.wIdx + j, cx + (col ? 1 : -1) * W * 0.24, wy + wh / 2 + row * wh, cz, ww, wh, wd);
    }
    r.topY = wy + wh * Math.ceil(r.nW / 2);
  }
  for (const r of ALLREG) writeReg(r);

  // ---- rotors (blowers)
  const rotorMesh = instMesh(rotorUnit(), MAT.rotor, BLOWERS.length, 'blowerRotors');
  let rotorAng = 0;
  const writeRotors = () => {
    const c = Math.cos(rotorAng), s = Math.sin(rotorAng);
    BLOWERS.forEach((b, i) => {
      const a = rotorMesh.instanceMatrix.array, o = i * 16;
      a.set([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, b.rotor.x, b.rotor.y, b.rotor.z, 1], o);
    });
    rotorMesh.instanceMatrix.needsUpdate = true;
  };
  writeRotors();

  // ---- tremulants (static body on the department trunk + beating lever)
  const TREMS = [
    { id: 'orchestral-tremulant', div: 'orchestral', reg: 'orchestral', x: 2.6, y: 0.6, z: -4.46, w: 0.36, h: 0.24, d: 0.3 },
    { id: 'swell-tremulant', div: 'swell', reg: 'swell', x: 8.0, y: 6.25, z: -4.705, w: 0.36, h: 0.2, d: 0.13 },
    { id: 'solo-tremulant', div: 'solo', reg: 'solo', x: 0.55, y: 2.4, z: -1.03, w: 0.32, h: 0.2, d: 0.2 },
  ];
  for (const t of TREMS) {
    staticWind(boxG(t.x - t.w / 2, t.x + t.w / 2, t.y, t.y + t.h, t.z - t.d / 2, t.z + t.d / 2), 'tremulant');
    staticWind(boxG(t.x - t.w / 2 + 0.04, t.x + 0.02, t.y + t.h, t.y + t.h + 0.06, t.z - t.d / 2 + 0.03, t.z + t.d / 2 - 0.03), 'tremulant');
    staticWind(boxG(t.x + 0.1, t.x + 0.14, t.y + t.h, t.y + t.h + 0.1, t.z - 0.02, t.z + 0.02), 'tremulant');
    t.pivot = V(t.x + 0.12, t.y + t.h + 0.1, t.z);
    t.on = false; t.amp = 0;
  }
  if (TREMS[2]) staticWind(boxG(0.39, 0.71, 2.44, 2.56, -1.14, -1.13), 'tremulant');
  const tremMesh = instMesh(tremArmUnit(), MAT.board, TREMS.length, 'tremulantLevers');
  let tremPhase = 0;
  const writeTrem = (t, i) => setRotZ(tremMesh, i, t.pivot.x, t.pivot.y, t.pivot.z, -Math.PI + 0.25 * t.amp * Math.sin(tremPhase), 0.3, 0.3, 0.3);
  // custom: lever along -x: use rotation about z by pi (+ beat)
  TREMS.forEach((t, i) => writeTrem(t, i));

  // ---- concussion bellows
  const CONC = [
    { reg: 'greatC', chest: 'great', x: -5.3, y: 4.38, z: -1.78, w: 0.28, d: 0.24 },
    { reg: 'greatCs', chest: 'great', x: 5.3, y: 4.38, z: -1.78, w: 0.28, d: 0.24 },
    { reg: 'choir', chest: 'choir', x: 1.98, y: 0.4, z: -2.1, w: 0.2, d: 0.2, side: true },
    { reg: 'solo', chest: 'solo', x: -0.45, y: 1.65, z: -1.03, w: 0.28, d: 0.2 },
  ];
  for (const c of CONC) {
    staticWind(boxG(c.x - c.w / 2, c.x + c.w / 2, c.y, c.y + 0.05, c.z - c.d / 2, c.z + c.d / 2), 'concussion');
    if (c.side) staticWind(boxG(c.x + c.w / 2, 2.125, c.y + 0.01, c.y + 0.04, c.z - 0.03, c.z + 0.03), 'concussion');
    if (c.reg === 'solo') staticWind(boxG(c.x - 0.03, c.x + 0.03, c.y - 0.1, c.y, -1.14, c.z - 0.06), 'concussion');
    c.amp = 0; c.ph = 0;
  }
  const concMesh = instMesh(unitBox(), MAT.leather, CONC.length, 'concussionLids');
  const writeConc = (c, i) => setRotX(concMesh, i, c.x, c.y + 0.05, c.z - c.d / 2, 0.08 + 0.18 * c.amp * Math.sin(c.ph) * 0.5, c.w, 0.03, c.d, 0.015, c.d / 2);
  CONC.forEach(writeConc);

  // =========================================================================
  // 2. ACTION (elektrik)
  // =========================================================================
  // under-chest action layer per chest
  const MOTOR_END = { 'pedal-Cs': -1, 'tubas-Cs': -1, 'pedal-flue-Cs': -1, swell: -1 };
  const obstHits = (b, tags) => OBST.some((o) => (!tags || tags.includes(o.tag)) && o.b[0] < b[3] && o.b[3] > b[0] && o.b[1] < b[4] && o.b[4] > b[1] && o.b[2] < b[5] && o.b[5] > b[2]);
  for (const c of chests) {
    c.E = MOTOR_END[c.id] ?? 1;
    // free height below the chest (pipes, chests, boxes, recesses below it)
    const fz0 = c.z0 + 0.1, fz1 = c.zFront;
    let top = 0;
    for (const o of OBST) {
      const b = o.b;
      if (b[4] > c.yb + 1e-6 || b[0] >= c.x1 || b[3] <= c.x0 || b[2] >= fz1 || b[5] <= fz0) continue;
      if (o.tag === 'pipe' || o.tag === 'chest' || o.tag === 'boxwall' || o.tag === 'recess' || o.tag === 'walkway' || o.tag === 'shutterSweep') top = Math.max(top, b[4]);
    }
    c.gap = c.yb - top;
    c.hp = clamp(c.gap - 0.012, 0.04, 0.13);
    c.yTop = c.yb - 0.003;
    c.zF = c.zFront - (c.raised ? 0.15 : 0.05);
    c.A1 = c.zF; c.A0 = c.zF - 0.28;
    c.xa = c.E > 0 ? c.x0 + 0.1 : c.x0 + 0.62;
    c.xb = c.E > 0 ? c.x1 - 0.62 : c.x1 - 0.1;
    c.xEnd = c.E > 0 ? c.x1 : c.x0;
  }

  // channel valves + unit valves
  const valves = [];   // {chest, kind, x, z, ...}
  const pipeValve = new Int32Array(INV.length).fill(-1);
  for (const c of chests) {
    const list = [...c.chan.values()].map((ch) => ({ ...ch, mx: ch.n ? ch.sx / ch.n : null }));
    const dirIdx = (ch) => ch.idx;
    list.sort((a, b) => (a.mx !== null && b.mx !== null ? a.mx - b.mx : dirIdx(a) - dirIdx(b)));
    const n = list.length;
    c.pitch = n ? (c.xb - c.xa) / n : 0.1;
    c.chanValve = new Map();
    list.forEach((ch, k) => {
      const v = valves.length;
      valves.push({ chest: c.ci, kind: 0, idx: ch.idx, x: c.xa + (k + 0.5) * c.pitch, z: c.A1 });
      c.chanValve.set(ch.idx, v);
    });
    // unit pipes: rows behind the pallet strip
    const units = c.units.slice().sort((a, b) => (Number.isFinite(INV[a].x) ? INV[a].x : 0) - (Number.isFinite(INV[b].x) ? INV[b].x : 0) || INV[a].noteIndex - INV[b].noteIndex);
    const nu = units.length;
    c.unitRows = nu ? Math.max(1, Math.ceil((nu * 0.045) / (c.xb - c.xa))) : 0;
    const perRow = nu ? Math.ceil(nu / c.unitRows) : 0;
    c.unitPitch = perRow ? (c.xb - c.xa) / perRow : 0.05;
    units.forEach((pi, k) => {
      const row = k % c.unitRows, col = Math.floor(k / c.unitRows);
      const v = valves.length;
      valves.push({ chest: c.ci, kind: 1, pipe: pi, x: c.xa + (col + 0.5) * c.unitPitch, z: c.A0 - 0.05 - row * 0.1 });
      pipeValve[pi] = v;
    });
    for (const pi of c.pipes) if (pipeValve[pi] < 0) pipeValve[pi] = c.chanValve.get(INV[pi].noteIndex) ?? -1;
  }
  const NV = valves.length;
  const nPal = valves.filter((v) => v.kind === 0).length;
  const magMesh = instMesh(magnetUnit(), MAT.magnet, NV, 'noteMagnets', true);
  const motMesh = instMesh(motorUnit(), MAT.motor, NV, 'pneumaticMotors', true);
  const palMesh = instMesh(unitBox(), MAT.pallet, nPal, 'pallets', true);
  const vCount = new Int32Array(NV), vO = new Float32Array(NV), vHi = new Float32Array(NV);
  {
    let pk = 0;
    valves.forEach((v, i) => {
      const c = chests[v.chest];
      const pitch = v.kind ? c.unitPitch : c.pitch;
      v.s = Math.min(0.042, c.hp * 0.42, pitch * 0.6);
      v.mag = i; v.mot = i;
      if (v.kind === 0) {
        v.pal = pk++;
        v.pw = Math.min(0.06, pitch * 0.7);
        v.hy = c.yTop - 0.004; v.hz = c.A0 + 0.03; v.pl = c.A1 - c.A0 - 0.1;
        v.mz = c.A1 - 0.065; v.my = c.yTop - c.hp * 0.62; v.mh = c.hp * 0.26; v.mw = v.pw; v.md = 0.06;
        v.gz = c.A1 - 0.02;
        // pull-down wire from the pallet front down to the motor
        bags.body.add(cylG(V(v.x, v.hy - 0.012, v.hz + v.pl - 0.01), V(v.x, v.my + v.mh / 2, v.mz), 0.0025, 0.0025, 4, true), 'wire', { chest: c.id });
      } else {
        v.pal = -1;
        v.mz = v.z - 0.045; v.my = c.yTop - c.hp * 0.55; v.mh = c.hp * 0.22; v.mw = v.s * 0.9; v.md = 0.035;
        v.gz = v.z;
      }
    });
  }
  function writeValve(i) {
    const v = valves[i], o = vO[i];
    setTRS(magMesh, v.mag, v.x, chests[v.chest].yTop, v.gz, v.s, v.s, v.s);
    const mh = v.mh * (1 + 0.9 * o);
    setTRS(motMesh, v.mot, v.x, v.my - (mh - v.mh) / 2, v.mz, v.mw, mh, v.md);
    if (v.pal >= 0) setRotX(palMesh, v.pal, v.x, v.hy, v.hz, 0.24 * o, v.pw, 0.012, v.pl, -0.006, v.pl / 2);
    const h = vHi[i];
    const r = 1 + 2.4 * h, g = 1 + 1.6 * h, b = 1 + 0.3 * h;
    for (const [mesh, k] of [[magMesh, v.mag], [motMesh, v.mot], [palMesh, v.pal]]) {
      if (k < 0) continue;
      const a = mesh.instanceColor.array;
      a[3 * k] = r; a[3 * k + 1] = g; a[3 * k + 2] = b;
    }
  }
  for (let i = 0; i < NV; i++) writeValve(i);

  // pallet boxes / magnet boards (static), stop actions
  const sliders = [];   // {chest, rankKey, kind: 0 slider / 1 ventil, ...}
  for (const c of chests) {
    const yb = c.yTop, hp = c.hp;
    if (c.chan.size) {
      bags.body.add(boxG(c.xa - 0.03, c.xb + 0.03, yb - hp, yb, c.A1 - 0.004, c.A1 + 0.004), 'palletBox', { chest: c.id });
      bags.body.add(boxG(c.xa - 0.03, c.xb + 0.03, yb - hp * 0.5, yb, c.A0, c.A0 + 0.012), 'palletBox', { chest: c.id });
      for (const x of [c.xa - 0.03, c.xb + 0.03]) bags.body.add(boxG(x - 0.006, x + 0.006, yb - hp, yb, c.A0, c.A1), 'palletBox', { chest: c.id });
    }
    for (let r = 0; r < c.unitRows; r++) {
      const z = c.A0 - 0.05 - r * 0.1;
      bags.body.add(boxG(c.xa - 0.02, c.xb + 0.02, yb - 0.012, yb, z - 0.07, z + 0.03), 'unitBoard', { chest: c.id });
    }
    // stops on this chest, ordered by mean pipe z
    const ranks = [...c.ranks.values()].sort((a, b) => (a.n && b.n ? a.sz / a.n - b.sz / b.n : 0) || (a.rankKey < b.rankKey ? -1 : 1));
    const lo = c.z0 + 0.1, hi = c.zFront - 0.06;
    const pz = (hi - lo) / Math.max(1, ranks.length);
    const r = Math.min(0.022, hp * 0.3);
    ranks.forEach((R, k) => {
      const z = lo + (k + 0.5) * pz;
      const bx = c.xEnd - c.E * (0.28 + (k % 2) * 0.17);
      const y = yb - r - 0.004;
      // solenoid body (static) and link up into the chest
      bags.body.add(cylG(V(bx - 0.07, y, z), V(bx + 0.07, y, z), r, r, 8), R.unit ? 'ventil' : 'sliderMotor', { chest: c.id });
      bags.body.add(boxG(bx - 0.06, bx + 0.06, y - r - 0.003, y - r, z - r * 0.8, z + r * 0.8), 'sliderMotor', { chest: c.id });
      const tipX = bx + c.E * 0.07;
      sliders.push({ chest: c.ci, rankKey: R.rankKey, unit: R.unit, z, y, r, bx, tipX, E: c.E, len: c.x1 - c.x0 - 0.2, cx: (c.x0 + c.x1) / 2,
        sy: c.y - 0.076, w: Math.min(0.028, pz * 0.6), o: 0, tgt: 0 });
      bags.body.add(boxG(tipX + c.E * 0.055 - 0.004, tipX + c.E * 0.055 + 0.004, y, c.yb + 0.03, z - 0.004, z + 0.004), 'sliderLink', { chest: c.id, inChest: true });
    });
  }
  const nSl = sliders.filter((s) => !s.unit).length;
  const slMesh = instMesh(unitBox(), MAT.slider, nSl, 'sliders', true);
  const plMesh = instMesh(plungerUnit(), MAT.plunger, sliders.length, 'stopPlungers');
  {
    let k = 0;
    sliders.forEach((s, i) => { s.pl = i; s.sl = s.unit ? -1 : k++; });
  }
  function writeSlider(s) {
    if (s.sl >= 0) {
      setTRS(slMesh, s.sl, s.cx + s.E * 0.045 * s.o, s.sy, s.z, s.len, 0.012, s.w);
      const a = slMesh.instanceColor.array, h = s.o;
      a[3 * s.sl] = 1 + 0.8 * h; a[3 * s.sl + 1] = 1 + 0.5 * h; a[3 * s.sl + 2] = 1;
    }
    const L = 0.09, x = s.tipX + s.E * (L / 2 - 0.035 + 0.04 * s.o);
    setTRS(plMesh, s.pl, x, s.y, s.z, L, s.r * 0.35, s.r * 0.35);
  }
  sliders.forEach(writeSlider);
  const slidersByRank = new Map();
  for (const s of sliders) { if (!slidersByRank.has(s.rankKey)) slidersByRank.set(s.rankKey, []); slidersByRank.get(s.rankKey).push(s); }

  // ---- cut-away exemplar: Choir chest, C end (pallet box, springs, grid, table, sliders, upperboards)
  const EX = { chest: M.byId.get('choir'), x0: 0, x1: 0 };
  if (EX.chest) {
    const c = EX.chest;
    EX.x0 = c.x0 + 0.04; EX.x1 = c.x0 + 1.5;
    const Bx = bags.exemplar;
    const yb = c.yb, y = c.y;
    const pb0 = yb - 0.36;
    // pallet box: bottom, back wall, end wall, low front wall (cut away above)
    Bx.add(boxG(EX.x0, EX.x1, pb0, pb0 + 0.02, c.A0 - 0.03, c.A1 + 0.03), 'exemplar');
    Bx.add(boxG(EX.x0, EX.x1, pb0, yb - 0.003, c.A0 - 0.03, c.A0 - 0.015), 'exemplar');
    Bx.add(boxG(EX.x0, EX.x0 + 0.015, pb0, yb - 0.003, c.A0 - 0.03, c.A1 + 0.03), 'exemplar');
    Bx.add(boxG(EX.x0, EX.x1, pb0, pb0 + 0.12, c.A1 + 0.015, c.A1 + 0.03), 'exemplar');
    // pallet springs (V springs) for channels in the section
    for (const v of valves) {
      if (v.chest !== c.ci || v.kind || v.x < EX.x0 + 0.03 || v.x > EX.x1 - 0.03) continue;
      const zt = v.hz + v.pl * 0.6;
      Bx.add(cylG(V(v.x, pb0 + 0.02, zt - 0.06), V(v.x, v.hy - 0.012, zt), 0.003, 0.003, 4, true), 'exemplarSpring');
      Bx.add(cylG(V(v.x, pb0 + 0.02, zt - 0.06), V(v.x, pb0 + 0.02, zt + 0.04), 0.003, 0.003, 4, true), 'exemplarSpring');
    }
    // grid (channel bars) inside the chest, table, bearers and stepped upperboards
    const cx = valves.filter((v) => v.chest === c.ci && !v.kind).map((v) => v.x).sort((a, b) => a - b);
    for (let k = 0; k < cx.length - 1; k++) {
      const xm = (cx[k] + cx[k + 1]) / 2;
      if (xm < EX.x0 + 0.02 || xm > EX.x1 - 0.02) continue;
      Bx.add(boxG(xm - 0.008, xm + 0.008, yb + 0.006, y - 0.13, c.z0 + 0.012, c.zFront - 0.012), 'exemplarGrid', { inChest: true });
    }
    Bx.add(boxG(EX.x0, EX.x1, y - 0.13, y - 0.085, c.z0 + 0.012, c.zFront - 0.25), 'exemplarTable', { inChest: true });
    const chSl = sliders.filter((s) => s.chest === c.ci);
    const pz = chSl.length > 1 ? chSl[1].z - chSl[0].z : 0.1;
    chSl.forEach((s, k) => {
      if (k % 2 === 0) return;
      Bx.add(boxG(EX.x0 + 0.3, EX.x1, y - 0.085, y - 0.07, s.z - pz / 2 + 0.003, s.z - s.w / 2 - 0.003), 'exemplarBearer', { inChest: true });
      if (k < chSl.length - 2) Bx.add(boxG(EX.x0 + 0.55, EX.x1, y - 0.068, y - 0.012, s.z - pz / 2 + 0.002, s.z + pz / 2 - 0.002), 'exemplarUpperboard', { inChest: true });
    });
  }

  // ---- console contacts, cable trunk, relay rack, looms
  const RACK = { x0: 1.06, x1: 1.46, y0: 0.05, y1: 2.05, z0: -1.12, z1: -0.58 };
  {
    const B = bags.body;
    B.add(boxG(0.5, 1.0, -0.3, -0.03, 2.4, 2.9), 'consoleJunction');
    B.add(boxG(0.65, 0.85, -0.2, -0.06, -0.86, 2.4), 'cableTrunk');
    B.add(boxG(-8.7, 9.0, -0.09, -0.04, -0.92, -0.8), 'cableTray');
    // rack cabinet
    const { x0, x1, y0, y1, z0, z1 } = RACK;
    for (const [px, pz] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) B.add(boxG(px - 0.02, px + 0.02, y0, y1, pz - 0.02, pz + 0.02), 'relayRack');
    B.add(boxG(x0, x1, y0, y0 + 0.04, z0, z1), 'relayRack');
    B.add(boxG(x0, x1, y1 - 0.04, y1, z0, z1), 'relayRack');
    B.add(boxG(x1 - 0.015, x1, y0, y1, z0, z1), 'relayRack');
    for (let sh = 0; sh < 4; sh++) {
      const ys = y0 + 0.2 + sh * 0.45;
      B.add(boxG(x0, x1, ys - 0.012, ys, z0, z1), 'relayRack');
      for (let k = 0; k < 12; k++) {
        const z = z0 + 0.03 + k * ((z1 - z0 - 0.06) / 11);
        bags.cable.add(boxG(x0 + 0.03, x1 - 0.03, ys, ys + 0.3, z - 0.006, z + 0.006), 'relayCards');
      }
    }
    cable([[0.75, -0.13, -0.86], [1.26, -0.065, -0.86], [1.26, -0.065, -0.86], [1.26, 0.06, -0.86]], 0.03, 'rackRiser');
  }
  const ledMesh = instMesh(unitBox(), MAT.led, 48, 'relayLeds', true);
  const ledHi = new Float32Array(48);
  for (let k = 0; k < 48; k++) {
    const sh = k / 12 | 0, j = k % 12;
    const ys = RACK.y0 + 0.2 + sh * 0.45;
    setTRS(ledMesh, k, RACK.x0 + 0.024, ys + 0.27, RACK.z0 + 0.03 + j * ((RACK.z1 - RACK.z0 - 0.06) / 11), 0.008, 0.016, 0.01);
  }
  const writeLed = (k) => { const a = ledMesh.instanceColor.array, h = ledHi[k]; a[3 * k] = 0.5 + 3 * h; a[3 * k + 1] = 0.5 + 2.2 * h; a[3 * k + 2] = 0.5 + 0.4 * h; };
  for (let k = 0; k < 48; k++) writeLed(k);

  // chest cable entries (from the tray under the gallery floor) + looms along the action layer
  const looms = new Map(chests.map((c) => [c.id, 0]));
  const TRAY_Y = -0.065, TRAY_Z = -0.86;
  function loom(c, pin) {
    const yL = c.yTop - c.hp + 0.012, zL = c.A1 - 0.04;
    const xm = c.xEnd - c.E * 0.365;
    const pts = [pin, [pin[0], yL, pin[2]], [pin[0], yL, zL]];
    const far = c.E > 0 ? c.xa : c.xb;
    pts.push([far, yL, zL]);
    cable(pts, 0.011, 'loom', { chest: c.id });
    if (c.chan.size || c.units.length) {
      // branch to the solenoids at the chest end (under them)
      const zs = sliders.filter((s) => s.chest === c.ci).map((s) => s.z);
      if (zs.length) cable([[xm, yL, zL], [xm, yL, Math.min(...zs)], [xm, yL, Math.max(...zs)]], 0.011, 'loom', { chest: c.id });
      if (c.unitRows) cable([[pin[0], yL, zL], [pin[0], yL, c.A0 - 0.05 - (c.unitRows - 1) * 0.1]], 0.011, 'loom', { chest: c.id });
    }
    looms.set(c.id, looms.get(c.id) + 1);
  }
  for (const c of chests) {
    if (c.raised) continue;
    const xm = c.xEnd - c.E * 0.365;
    const yL = c.yTop - c.hp + 0.012;
    if (TRAY_Z < c.zFront && TRAY_Z > c.z0) {
      cable([[xm, TRAY_Y, TRAY_Z], [xm, yL, TRAY_Z]], 0.02, 'cable');
      loom(c, [xm, yL, TRAY_Z]);
    } else {
      const zi = (c.A1 + c.zFront) / 2;
      cable([[xm, TRAY_Y, TRAY_Z], [xm, TRAY_Y, zi], [xm, yL, zi]], 0.02, 'cable');
      loom(c, [xm, yL, zi]);
    }
  }
  {
    // Great + Tubas: up the slots beside the wind risers
    const great = M.byId.get('great'), tC = M.byId.get('tubas-C'), tCs = M.byId.get('tubas-Cs'), solo = M.byId.get('solo'), swell = M.byId.get('swell');
    const yG = great.yTop - great.hp + 0.012;
    cable([[6.5, TRAY_Y, TRAY_Z], [6.5, TRAY_Y, -1.53], [6.5, yG, -1.53]], 0.022, 'slotCable');
    loom(great, [6.5, yG, -1.53]);
    for (const [s, c] of [[-1, tC], [1, tCs]]) {
      const yT = c.yTop - c.hp + 0.012;
      const xi = c.xEnd - c.E * 0.365;
      const base = s > 0 ? [[6.5, yG, -1.53]] : [[-6.5, TRAY_Y, TRAY_Z], [-6.5, TRAY_Y, -1.53]];
      cable([...base, [s * 6.5, yT, -1.53], [xi, yT, -1.53]], s > 0 ? 0.018 : 0.02, 'slotCable');
      loom(c, [xi, yT, -1.53]);
    }
    // Solo: from the rack up beside the flat trunk, behind the arch recess
    const yS = solo.yb - 0.03;
    cable([[1.26, RACK.y1, -0.85], [1.26, 3.85, -0.85], [1.26, 3.85, -1.19], [1.06, 3.85, -1.19], [1.06, 4.1, -1.19], [1.06, 4.1, -1.375], [1.06, yS, -1.375]], 0.018, 'soloCable');
    loom(solo, [1.06, yS, -1.375]);
    // Swell: along the side riser, on top of the horizontal trunk
    cable([[8.9, TRAY_Y, TRAY_Z], [9.0, TRAY_Y, -4.3], [9.81, TRAY_Y, -4.3], [9.81, 6.284, -4.3], [9.81, 6.284, -4.6], [6.33, 6.284, -4.6]], 0.015, 'swellCable');
    loom(swell, [6.33, swell.yTop - swell.hp + 0.012, -4.6]);
  }

  // =========================================================================
  // 3. MECHANIK: swell engines, shafts, trace rods, shutter linkage, contacts
  // =========================================================================
  const pedalDivision = new Map(ACCESSORIES.filter((a) => a.kind === 'swell-pedal').map((a) => [a.id, a.division]));
  const shutterGroups = (papi && papi.shutters) || [];
  const BOXDEF = {
    swell: { ySh: 15.2, beta: 0, eng: { dx: 0.45, z: -3.0, y: 15.2, base: 15.07 } },
    solo: { ySh: 16.5, beta: 0, eng: { dx: 0.45, z: -1.3, y: 16.55, base: 16.45 } },
    orchestral: { ySh: 6.25, beta: Math.PI, eng: { x: 4.5, z: null, y: 5.95, base: 5.85 } },
  };
  const swellBoxes = [];
  for (const c of chests) {
    const def = c.def.box;
    if (!def) continue;
    const bd = BOXDEF[c.id];
    if (!bd) continue;
    let sg = shutterGroups.find((s) => s.chest === c.id);
    let slats;
    if (sg && sg.slats) slats = sg.slats;
    else {
      const y1 = def.y1, zs = c.z1 + 0.13, W = c.x1 - c.x0, np = Math.ceil(W / 2.2), pw = W / np, ns = Math.floor((y1 - 0.08 - (c.y + 0.02)) / 0.25);
      slats = [];
      for (let k = 0; k < np; k++) for (let j = 0; j < ns; j++) slats.push({ x: c.x0 + (k + 0.5) * pw, y: c.y + 0.02 + (j + 0.5) * 0.25, z: zs, len: pw - 0.07 });
      sg = null;
    }
    const zs = slats[0].z;
    const cols = [...new Set(slats.map((s) => +s.x.toFixed(4)))].sort((a, b) => a - b);
    const len = slats[0].len;
    const colX = cols.map((x) => x - len / 2 - 0.0035);
    const yBot = Math.min(...slats.map((s) => s.y));
    const xLev = bd.eng.x ?? c.x0 + bd.eng.dx;
    const eng = { x: xLev, y: bd.eng.y, z: bd.eng.z ?? zs };
    swellBoxes.push({ chest: c, division: c.division, pedal: def.pedal, sg, slats, zs, cols, colX, yBot, ySh: bd.ySh, beta: bd.beta, eng, xLev, open: sg ? sg.open : 1, tgt: sg ? sg.target : 1, value: 1 });
  }
  // static: shafts, engines, frames
  const MB = bags.mech;
  for (const b of swellBoxes) {
    const c = b.chest;
    const xs0 = c.x0 + 0.01, xs1 = Math.max(c.x1 - 0.01, b.xLev + 0.05);
    MB.add(cylG(V(xs0, b.ySh, b.zs), V(xs1, b.ySh, b.zs), 0.016, 0.016, 8), 'shutterShaft');
    for (const x of [xs0 + 0.02, (xs0 + xs1) / 2, xs1 - 0.02]) MB.add(boxG(x - 0.02, x + 0.02, b.ySh - 0.06, b.ySh - 0.016, b.zs - 0.03, b.zs + 0.03), 'shaftBearing');
    const e = b.eng;
    if (c.id === 'orchestral') {
      MB.add(boxG(e.x - 0.2, e.x + 0.2, e.y - 0.1, e.y + 0.08, e.z - 0.1, e.z + 0.1), 'swellEngine');
      MB.add(cylG(V(e.x - 0.2, e.y, e.z), V(e.x - 0.45, e.y, e.z), 0.06, 0.06, 12), 'swellEngine');
      MB.add(boxG(e.x - 0.25, e.x + 0.25, e.y - 0.13, e.y - 0.1, e.z - 0.11, e.z + 0.11), 'swellEngine');
    } else {
      MB.add(boxG(e.x - 0.15, e.x + 0.15, e.y - 0.1, e.y + 0.1, e.z - 0.1, e.z + 0.1), 'swellEngine');
      MB.add(cylG(V(e.x - 0.15, e.y, e.z), V(e.x - 0.42, e.y, e.z), 0.065, 0.065, 12), 'swellEngine');
      MB.add(boxG(e.x - 0.45, e.x + 0.2, e.y - 0.13 + 0.0, e.y - 0.1, e.z - 0.16, e.z + 0.16), 'swellEngine');
      MB.add(boxG(e.x + 0.15, e.x + 0.2, e.y - 0.05, e.y + 0.05, e.z - 0.05, e.z + 0.05), 'swellEngine');   // position sensor
      if (c.id === 'solo') {
        // beam across the solo box wall heads carrying the engine
        MB.add(boxG(c.x0 - 0.08, e.x + 0.3, 16.4, 16.42, e.z - 0.12, e.z + 0.12), 'frame');
      }
    }
  }
  // instanced cranks (engine crank, shaft lever, per-panel bell cranks, slat arms) and rods
  let nCr = 0, nRod = 0;
  for (const b of swellBoxes) { b.crk0 = nCr; nCr += 2 + b.cols.length + b.slats.length; b.rod0 = nRod; nRod += 1 + b.cols.length; }
  const crankMesh = instMesh(unitArm(), MAT.rod, nCr, 'swellCranks');
  const rodMesh = instMesh(unitBox(), MAT.rod, nRod, 'swellRods');
  const LA = 0.05, LE = 0.12;
  function writeSwellBox(b) {
    const a = clamp(b.open, 0, 1) * 1.2;
    let k = b.crk0;
    const e = b.eng, bt = b.beta;
    setRotX(crankMesh, k++, b.xLev, e.y, e.z, bt + a, 0.025, LE, 0.025);
    setRotX(crankMesh, k++, b.xLev, b.ySh, b.zs, bt + a, 0.025, LE, 0.025);
    const ty = LE * Math.cos(bt + a), tz = LE * Math.sin(bt + a);
    // trace rod between the two crank tips
    const y0 = e.y + ty, y1 = b.ySh + ty, z0 = e.z + tz, z1 = b.zs + tz;
    setTRS(rodMesh, b.rod0, b.xLev + 0.02, (y0 + y1) / 2, (z0 + z1) / 2, 0.012, Math.abs(y1 - y0) + 0.012, Math.abs(z1 - z0) + 0.012);
    const oy = LA * Math.sin(a), oz = -LA * Math.cos(a);
    b.colX.forEach((x, j) => {
      setRotX(crankMesh, k++, x, b.ySh, b.zs, -Math.PI / 2 + a, 0.006, LA, 0.012);
      const top = b.ySh, bot = b.yBot;
      setTRS(rodMesh, b.rod0 + 1 + j, x, (top + bot) / 2 + oy, b.zs + oz, 0.006, top - bot, 0.01);
    });
    for (const s of b.slats) setRotX(crankMesh, k++, s.x - s.len / 2 - 0.0035, s.y, s.z, -Math.PI / 2 + a, 0.005, LA, 0.01);
  }
  swellBoxes.forEach(writeSwellBox);

  // swell pedal contacts (under the console floor, below the shoes)
  const pedals = ACCESSORIES.filter((a) => a.kind === 'swell-pedal');
  const PED_X = [-0.075, 0.04, 0.155];
  const pointerMesh = instMesh(pointerUnit(), MAT.pointer, pedals.length, 'swellPedalPointers');
  const pedalState = pedals.map((p, i) => ({ id: p.id, division: p.division, x: (PED_X[i] ?? (i * 0.115 - 0.075)) + LAYOUT.console.x, value: 1, shown: 1 }));
  const PZ = LAYOUT.console.z - 0.2;
  MB.add(boxG(-0.2 + LAYOUT.console.x, 0.27 + LAYOUT.console.x, -0.3, -0.05, PZ - 0.16, PZ + 0.16), 'swellPedalContacts');
  for (const ps of pedalState) {
    MB.add(cylG(V(ps.x, -0.17, PZ + 0.16), V(ps.x, -0.17, PZ + 0.19), 0.045, 0.045, 14), 'swellPedalContacts');
    MB.add(boxG(ps.x - 0.012, ps.x + 0.012, -0.05, -0.02, PZ - 0.1, PZ + 0.1), 'swellPedalContacts');
  }
  const writePointer = (i) => { const ps = pedalState[i]; setRotZ(pointerMesh, i, ps.x, -0.17, PZ + 0.2, (ps.shown - 0.5) * 2.2, 0.01, 0.038, 0.01); };
  pedalState.forEach((_, i) => writePointer(i));
  cable([[0.27 + LAYOUT.console.x, -0.17, PZ], [0.6, -0.17, PZ], [0.6, -0.17, 2.4]], 0.012, 'pedalCable');

  // =========================================================================
  // assemble meshes
  // =========================================================================
  const add = (sys, m) => { if (m) { m.castShadow = false; G[sys].add(m); } return m; };
  add('wind', bags.trunk.build(MAT.trunk));
  add('wind', bags.metal.build(MAT.metal));
  for (const m of [boardsMesh, ribsMesh, weightsMesh, rotorMesh, tremMesh, concMesh]) add('wind', m);
  add('elektrik', bags.body.build(MAT.body));
  add('elektrik', bags.cable.build(MAT.cable));
  add('elektrik', bags.exemplar.build(MAT.exemplar));
  for (const m of [magMesh, motMesh, palMesh, slMesh, plMesh, ledMesh]) add('elektrik', m);
  add('mechanik', bags.mech.build(MAT.mech));
  for (const m of [crankMesh, rodMesh, pointerMesh]) add('mechanik', m);
  const instMeshes = [];
  group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    instMeshes.push(o);
    o.instanceMatrix.needsUpdate = true;
    if (o.instanceColor) o.instanceColor.needsUpdate = true;
    o.computeBoundingSphere();
    if (o.boundingSphere) o.boundingSphere.radius += 0.3;
  });
  const partBoxes = () => {
    const out = [];
    for (const [sys, list] of [['wind', [bags.trunk, bags.metal]], ['elektrik', [bags.body, bags.cable, bags.exemplar]], ['mechanik', [bags.mech]]]) {
      for (const bg of list) for (const b of bg.boxes) out.push({ system: sys, ...b });
    }
    const bb = new THREE.Box3(), mt = new THREE.Matrix4();
    for (const m of instMeshes) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const sys = m.parent.name;
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mt);
        bb.copy(m.geometry.boundingBox).applyMatrix4(mt);
        out.push({ system: sys, box: bb.clone(), tag: m.name, inChest: m === slMesh, instanced: true });
      }
    }
    return out;
  };

  // =========================================================================
  // EVENTS / STATE
  // =========================================================================
  let active = false;
  let lastEvent = -1e9, clockT = 0, sounding = 0;
  const animValves = new Set(), animSliders = new Set(), animSwell = new Set(), animLeds = new Set(), animConc = new Set(), animPedals = new Set();
  let regsDirty = true;
  const refs = new Map();
  const KEY_RE = /^(.+)#(\d+)@(-?\d+)$/;
  function resolveNote(e) {
    const s = stopById(e.stopId);
    if (!s) return null;
    const rank = Number.isInteger(e.rank) ? e.rank : null;
    if (!s.derived) {
      const m = typeof e.key === 'string' ? KEY_RE.exec(e.key) : null;
      if (m && m[1] === s.id) return { rankKey: s.id, idx: Number(m[3]) - 36, rank: Number(m[2]) };
      const base = Math.min(0, M.rankRange.get(s.id)?.[0] ?? 0);
      if (Number.isFinite(e.noteIndex)) return { rankKey: s.id, idx: Math.round(e.noteIndex) + base, rank };
      if (Number.isFinite(e.midi)) return { rankKey: s.id, idx: Math.round(e.midi) - 36, rank };
      return null;
    }
    const src = resolveSource(s);
    if (!src) return null;
    const n = Number.isFinite(e.noteIndex) ? Math.round(e.noteIndex) : Number.isFinite(e.midi) ? Math.round(e.midi) - 36 : null;
    if (n === null) return null;
    return { rankKey: src.stop.id, idx: n + src.semitones, rank };
  }
  function pipesFor(r) {
    let list = M.byNote.get(r.rankKey + '@' + r.idx);
    if (!list) {
      const rr = M.rankRange.get(r.rankKey);
      if (rr && r.idx < rr[0]) list = [...(M.byNote.get(r.rankKey + '@' + (r.idx + 12)) || []), ...(M.byNote.get(r.rankKey + '@' + (r.idx + 19)) || [])];
      else list = [];
    }
    return r.rank === null || r.rank === undefined ? list : list.filter((p) => INV[p].rank === r.rank);
  }
  const touchAnim = () => { lastEvent = clockT; if (active && ctx.requestRender) ctx.requestRender(0.5); };
  function valveAdd(v, d) {
    const before = vCount[v];
    vCount[v] = Math.max(0, before + d);
    if ((before > 0) !== (vCount[v] > 0)) {
      if (vCount[v] > 0) vHi[v] = 1;
      if (active) animValves.add(v);
    }
  }
  function onPipe(e, on) {
    if (!e) return 0;
    const r = resolveNote(e);
    if (!r || !Number.isFinite(r.idx)) return 0;
    const k = r.rankKey + '#' + (r.rank ?? '*') + '@' + r.idx;
    const c = refs.get(k) || 0;
    if (on) { refs.set(k, c + 1); if (c > 0) return 0; } else { if (!c) return 0; if (c > 1) { refs.set(k, c - 1); return 0; } refs.delete(k); }
    const list = pipesFor(r);
    const seen = new Set();
    for (const p of list) {
      const v = pipeValve[p];
      if (v >= 0 && !seen.has(v)) { seen.add(v); valveAdd(v, on ? 1 : -1); }
      const ri = pipeReg[p];
      if (ri >= 0) {
        const R = ALLREG[ri];
        R.demand = Math.max(0, R.demand + (on ? pipeW[p] : -pipeW[p]));
        if (R.src === 'lp') MAIN.demand = Math.max(0, MAIN.demand + (on ? pipeW[p] : -pipeW[p]));
        if (on) for (let j = 0; j < CONC.length; j++) if (CONC[j].reg === R.id && active) { CONC[j].amp = Math.min(1.5, CONC[j].amp + 0.6); animConc.add(j); }
      }
    }
    sounding = Math.max(0, sounding + (on ? 1 : -1));
    if (!refs.size) { sounding = 0; for (const R of ALLREG) R.demand = 0; }
    regsDirty = true;
    if (active && seen.size) { const led = (seen.values().next().value * 7) % 48; ledHi[led] = Math.max(ledHi[led], 0.6); animLeds.add(led); }
    touchAnim();
    return seen.size;
  }
  function allOff() {
    refs.clear();
    for (let v = 0; v < NV; v++) if (vCount[v]) { vCount[v] = 0; if (active) animValves.add(v); }
    for (const R of ALLREG) R.demand = 0;
    sounding = 0; regsDirty = true; touchAnim();
  }
  const drawn = new Set();
  function onStop(e) {
    if (!e || !e.id) return;
    const s = stopById(e.id);
    if (!s) return;
    if (e.on) drawn.add(e.id); else drawn.delete(e.id);
    const src = resolveSource(s);
    if (!src) return;
    const rk = src.stop.id;
    const on = [...drawn].some((id) => resolveSource(id)?.stop.id === rk) ? 1 : 0;
    for (const sl of slidersByRank.get(rk) || []) if (sl.tgt !== on) { sl.tgt = on; if (active) animSliders.add(sl); }
    if (active) { const k = (s.number || 0) % 48; ledHi[k] = 1; animLeds.add(k); }
    touchAnim();
  }
  function onCoupler(e) {
    if (!active) return;
    let h = 0;
    for (const ch of String(e?.id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    for (let j = 0; j < 12; j++) { const k = (h + j * 5) % 48; ledHi[k] = 1; animLeds.add(k); }
    touchAnim();
  }
  function onSwell(e) {
    if (!e) return;
    const div = pedalDivision.get(e.id) || e.id || e.division;
    let v = Number(e.value);
    if (!Number.isFinite(v)) return;
    if (v > 1) v /= 127;
    v = clamp(v, 0, 1);
    for (const b of swellBoxes) if (b.division === div || b.pedal === e.id) { b.tgt = v; if (active) animSwell.add(b); }
    pedalState.forEach((ps, i) => { if (ps.id === e.id || ps.division === div) { ps.value = v; if (active) animPedals.add(i); } });
    touchAnim();
  }
  function onTrem(e) {
    if (!e) return;
    const t = TREMS.find((x) => x.id === e.id || x.div === e.id);
    if (!t) return;
    t.on = !!e.on;
    regsDirty = true;
    touchAnim();
  }
  const offs = [];
  if (bus && bus.on) {
    offs.push(bus.on('pipeon', (e) => onPipe(e, true)), bus.on('pipeoff', (e) => onPipe(e, false)), bus.on('allnotesoff', allOff),
      bus.on('stop', onStop), bus.on('coupler', onCoupler), bus.on('swell', onSwell), bus.on('tremulant', onTrem));
  }

  // full resync when activated
  function syncAll() {
    for (let v = 0; v < NV; v++) { vO[v] = vCount[v] > 0 ? 1 : 0; vHi[v] = vCount[v] > 0 ? 0.3 : 0; writeValve(v); }
    for (const s of sliders) { s.o = s.tgt; writeSlider(s); }
    for (const b of swellBoxes) { b.open = b.sg && Number.isFinite(b.sg.open) ? b.sg.open : b.tgt; writeSwellBox(b); if (b.open !== b.tgt) animSwell.add(b); }
    pedalState.forEach((ps, i) => { ps.shown = ps.value; writePointer(i); });
    regsDirty = true;
    for (const m of instMeshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  // =========================================================================
  // UPDATER (idle when inactive; work proportional to what changes)
  // =========================================================================
  const flowCur = U.uFlow.value, flowTgt = new Float32Array(16);
  let flowMoving = false;
  let moving = false;
  function update(t, dt) {
    if (!active) { moving = false; return; }
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    clockT = t;
    let changed = false;
    const live = sounding > 0 || clockT - lastEvent < 2;
    if (live) {
      U.uTime.value = t;
      rotorAng += dt * 7;
      writeRotors();
      changed = true;
    }
    // valves
    if (animValves.size) {
      const a = 1 - Math.exp(-dt * 30);
      for (const v of animValves) {
        const tg = vCount[v] > 0 ? 1 : 0;
        vO[v] += (tg - vO[v]) * a;
        if (Math.abs(vO[v] - tg) < 0.004) vO[v] = tg;
        const hT = tg ? 0.3 : 0;
        vHi[v] += (hT - vHi[v]) * (1 - Math.exp(-dt * 5));
        if (Math.abs(vHi[v] - hT) < 0.01) vHi[v] = hT;
        if (vO[v] === tg && vHi[v] === hT) animValves.delete(v);
        writeValve(v);
      }
      magMesh.instanceMatrix.needsUpdate = motMesh.instanceMatrix.needsUpdate = palMesh.instanceMatrix.needsUpdate = true;
      magMesh.instanceColor.needsUpdate = motMesh.instanceColor.needsUpdate = palMesh.instanceColor.needsUpdate = true;
      changed = true;
    }
    if (animSliders.size) {
      for (const s of animSliders) {
        const d = s.tgt - s.o;
        s.o = Math.abs(d) < 1e-3 ? s.tgt : s.o + Math.sign(d) * Math.min(Math.abs(d), dt * 4);
        writeSlider(s);
        if (s.o === s.tgt) animSliders.delete(s);
      }
      slMesh.instanceMatrix.needsUpdate = plMesh.instanceMatrix.needsUpdate = true;
      slMesh.instanceColor.needsUpdate = true;
      changed = true;
    }
    if (animSwell.size) {
      for (const b of animSwell) {
        if (b.sg && Number.isFinite(b.sg.open)) {
          const d = b.tgt - b.sg.open;
          // pipes.js animates the shutters; follow them (and fall back to own easing if it does not)
          b.open = Math.abs(b.sg.open - b.open) > 1e-6 || Math.abs(d) < 1e-3 ? b.sg.open : b.open + Math.sign(b.tgt - b.open) * Math.min(Math.abs(b.tgt - b.open), dt * 1.5);
        } else {
          const d = b.tgt - b.open;
          b.open = Math.abs(d) < 1e-3 ? b.tgt : b.open + Math.sign(d) * Math.min(Math.abs(d), dt * 1.5);
        }
        writeSwellBox(b);
        if (Math.abs(b.open - b.tgt) < 1e-3) { b.open = b.tgt; writeSwellBox(b); animSwell.delete(b); }
      }
      crankMesh.instanceMatrix.needsUpdate = rodMesh.instanceMatrix.needsUpdate = true;
      changed = true;
    }
    if (animPedals.size) {
      for (const i of animPedals) {
        const ps = pedalState[i];
        const d = ps.value - ps.shown;
        ps.shown = Math.abs(d) < 1e-3 ? ps.value : ps.shown + d * (1 - Math.exp(-dt * 12));
        writePointer(i);
        if (ps.shown === ps.value) animPedals.delete(i);
      }
      pointerMesh.instanceMatrix.needsUpdate = true;
      changed = true;
    }
    // tremulants
    const tremOn = TREMS.some((x) => x.on || x.amp > 0.002);
    if (tremOn) {
      tremPhase = (tremPhase + dt * 2 * Math.PI * 5.5) % (2 * Math.PI);
      TREMS.forEach((x, i) => { x.amp += ((x.on ? 1 : 0) - x.amp) * (1 - Math.exp(-dt * 8)); if (!x.on && x.amp < 0.002) x.amp = 0; writeTrem(x, i); });
      tremMesh.instanceMatrix.needsUpdate = true;
      regsDirty = true;
      changed = true;
    }
    // regulators: top board follows demand (sinks fast, recovers smoothly)
    if (regsDirty) {
      let still = true;
      for (const R of ALLREG) {
        const tg = R.cap > 0 ? 1 - Math.exp(-Math.sqrt(R.demand / (0.02 * R.cap))) : 0;
        R.tgt = tg;
        const k = tg > R.cur ? 9 : 2.2;
        R.cur += (tg - R.cur) * (1 - Math.exp(-dt * k));
        const tr = R.trem ? TREMS.find((x) => x.id === R.trem) : null;
        const tw = tr && tr.amp > 0 ? 0.012 * tr.amp * Math.sin(tremPhase) : 0;
        if (Math.abs(R.cur - tg) < 2e-4) R.cur = tg; else still = false;
        if (tw) still = false;
        writeReg(R, tw);
        // flow pulse intensity of this channel
        flowTgt[R.ch] = R.cap > 0 ? clamp(R.demand / (0.004 * R.cap), 0, 1) : 0;
      }
      flowTgt[1] = Math.max(flowTgt[regById.get('solo').ch], flowTgt[regById.get('swell').ch]);
      flowTgt[2] = Math.max(flowTgt[regById.get('tubas').ch], flowTgt[regById.get('greatReeds').ch]);
      boardsMesh.instanceMatrix.needsUpdate = ribsMesh.instanceMatrix.needsUpdate = weightsMesh.instanceMatrix.needsUpdate = true;
      regsDirty = !still;
      flowMoving = true;
      changed = true;
    }
    if (flowMoving) {
      let fm = false;
      const a = 1 - Math.exp(-dt * 4);
      for (let i = 0; i < 16; i++) {
        const d = flowTgt[i] - flowCur[i];
        if (Math.abs(d) > 1e-3) { flowCur[i] += d * a; fm = true; } else flowCur[i] = flowTgt[i];
      }
      flowMoving = fm;
      if (fm) changed = true;
    }
    if (animLeds.size) {
      for (const k of animLeds) { ledHi[k] *= Math.exp(-dt * 5); if (ledHi[k] < 0.01) { ledHi[k] = 0; animLeds.delete(k); } writeLed(k); }
      ledMesh.instanceColor.needsUpdate = true;
      changed = true;
    }
    if (animConc.size) {
      for (const j of animConc) {
        const c = CONC[j];
        c.ph += dt * 2 * Math.PI * 7;
        c.amp *= Math.exp(-dt * 4);
        if (c.amp < 0.01) { c.amp = 0; animConc.delete(j); }
        writeConc(c, j);
      }
      concMesh.instanceMatrix.needsUpdate = true;
      changed = true;
    }
    moving = changed;
    if (changed && ctx.requestRender) ctx.requestRender(0.25);
  }
  if (Array.isArray(ctx.updaters)) ctx.updaters.push(update);

  // =========================================================================
  // STATIONS
  // =========================================================================
  const great = M.byId.get('great');
  const gV = great ? valves[great.chanValve.get(0)] : null;
  const choir = EX.chest;
  const gSl = sliders.find((s) => s.chest === great?.ci);
  const swellBox = swellBoxes.find((b) => b.chest.id === 'swell');
  const regGc = regById.get('greatCs');
  const st = (id, system, title, text, p, pos, target) => ({ id, system, title, text, position: V(...p), view: { pos, target: target || p } });
  const stations = [
    st('spieltisch', 'elektrik', 'Spieltisch-Kontakte', 'Jede Taste, jeder Registerzug und jeder Tritt schließt am Spieltisch einen Kontakt. Die Signale laufen gebündelt in den Anschlusskasten unter dem Spieltisch (Anordnung angenommen).', [0.75, -0.16, 2.65], [2.6, 1.3, 5.4], [0.6, -0.2, 2.3]),
    st('relais', 'elektrik', 'Kabelkanal und Relais', 'Ein Kabelkanal unter dem Emporenboden führt zum Festkörper-Relais mit Setzer (64 Speicherebenen) im Unterbau; dort werden Koppeln und Kombinationen elektronisch geschaltet (Lage angenommen).', [1.26, 1.05, -0.85], [-0.5, 2.3, 1.4], [1.26, 0.9, -0.85]),
    st('tonventil', 'elektrik', 'Tonmagnet und Spielventil', 'Der Tonmagnet öffnet ein kleines Ventil, ein pneumatischer Bälgchenmotor zieht über den Abzugsdraht das Spielventil im Windkasten auf – elektropneumatisch wie seit Harrison & Harrison (Ladenaufbau angenommen). Hier als Schnittmodell der Choir-Lade.',
      choir ? [(EX.x0 + EX.x1) / 2, choir.yb - 0.15, (choir.A0 + choir.A1) / 2] : [-5.6, 0.8, -1.5], choir ? [EX.x1 + 1.3, choir.y + 0.6, 0.6] : [-4, 1.4, 0.6]),
    st('schleife', 'elektrik', 'Schleife und Registerventil', 'Für jedes Register schiebt ein Schleifenmagnet am Ladenende die Schleife unter den Pfeifenstöcken auf; die Pedal-Extensionsreihen stehen auf Einzeltonladen mit Registerventil („ventil switches“ laut Disposition).',
      gSl ? [gSl.bx, gSl.y, gSl.z] : [6.0, 5.27, -1.9], [4.4, 4.7, 0.6]),
    st('pfeife', 'elektrik', 'Pfeife', 'Ist der Kanzellenwind da und die Schleife gezogen, strömt der Wind durch Stock und Pfeifenfuß – die Pfeife spricht.', gV ? [gV.x, great.y + 0.4, -1.9] : [-6, 6, -1.9], gV ? [gV.x + 1.6, great.y + 1.4, 1.4] : [-4, 7, 1.4]),
    st('geblaese', 'wind', 'Gebläse', 'Elektrische Radialgebläse im Gebläseraum unter der Orgelempore erzeugen den Wind; vor 2004 waren es sieben, eines steht heute in der Schwellwerkskammer. Anzahl und Lage hier angenommen.', [-6.7, -2.9, -4.0], [-4.2, -1.4, -0.8]),
    st('magazinbalg', 'wind', 'Magazinbalg', 'Der große Magazinbalg speichert den Niederdruckwind und gleicht Schwankungen aus; Bälge wurden 2004 neu beledert (Größe und Lage angenommen).', [-1.2, -2.6, -4.05], [1.4, -1.2, -0.8]),
    st('regulator', 'wind', 'Regulator', 'Jedes Werk hat einen eigenen Regulator mit Gewichten: bei großem Windverbrauch sinkt die Platte, das Ventil öffnet weiter und hält den Druck konstant (Anordnung angenommen).', [(regGc.x0 + regGc.x1) / 2, regGc.yB + 0.3, (regGc.z0 + regGc.z1) / 2], [1.4, 5.2, 1.6]),
    st('windlade', 'wind', 'Windkanal zur Windlade', 'Neue, deutlich größere Holzkanäle (Mander 2004) führen den Wind über Stoßbälge zu jeder Windlade; die Kanalführung ist hier angenommen.', [6.5, 2.6, -1.78], [3.6, 3.6, 1.8]),
    st('hochdruck', 'wind', 'Hochdruck für die Tuben', 'Ein eigenes Hochdruckgebläse speist die frei stehenden Tuben: Tuba Mirabilis auf 30 Zoll (ca. 760 mm WS), die Orchestral Trumpets auf 25 Zoll (Quelle: Paul Hale); Leitungsführung angenommen.', [6.7, 11.24, -2.2], [3.8, 12.6, 1.6]),
    st('tremulant', 'wind', 'Tremulant', 'Swell, Orchestral und Solo haben je einen Tremulanten; ein Schlagventil lässt den Werkswind mit etwa 5,5 Hz pulsieren (Bauart angenommen).', [8.0, 6.45, -4.7], [6.6, 7.6, -2.6]),
    st('schwelltritt', 'mechanik', 'Schwelltritt-Kontakte', 'Die drei Schwelltritte melden ihre Stellung elektrisch über Potentiometer-Kontakte an das Relais (angenommen).', [LAYOUT.console.x + 0.03, -0.17, PZ + 0.2], [1.3, 0.5, 4.1], [0.05, -0.15, PZ]),
    st('schwellmotor', 'mechanik', 'Schwellmotor', 'Ein elektrischer Schwellmotor mit Positionsrückmeldung dreht über Kurbel und Zugstange die Jalousiewelle (Bauart angenommen).',
      swellBox ? [swellBox.eng.x, swellBox.eng.y, swellBox.eng.z] : [-5.9, 15.15, -3], [-3.4, 16.8, -0.4]),
    st('jalousien', 'mechanik', 'Jalousien', 'Von der Welle laufen Stangen zu jedem Jalousiefeld; kleine Hebel an jeder Lamelle öffnen alle Lamellen des Schwellkastens gleichzeitig.',
      swellBox ? [swellBox.colX[1] ?? -4.2, 10.5, swellBox.zs] : [-4.2, 10.5, -2.62], [-1.6, 11.6, 1.6]),
  ];

  // =========================================================================
  // API
  // =========================================================================
  let draws = 0, tris = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    draws++;
    const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
  });
  const systems = [
    { id: 'wind', label: 'Wind', color: COLORS.wind },
    { id: 'elektrik', label: 'Traktur (Elektrik)', color: COLORS.elektrik },
    { id: 'mechanik', label: 'Mechanik (Schweller)', color: COLORS.mechanik },
  ];
  const api = {
    setActive(on) {
      on = !!on;
      if (on === active) return;
      active = on;
      group.visible = on;
      if (on) { syncAll(); lastEvent = clockT; if (ctx.requestRender) ctx.requestRender(0.5); }
      else { animValves.clear(); animSliders.clear(); animSwell.clear(); animLeds.clear(); animConc.clear(); animPedals.clear(); moving = false; }
    },
    isActive: () => active,
    isAnimating: () => active && (moving || animValves.size > 0 || animSliders.size > 0 || animSwell.size > 0 || animPedals.size > 0 ||
      regsDirty || flowMoving || animLeds.size > 0 || animConc.size > 0 || TREMS.some((x) => x.on || x.amp > 0) || sounding > 0 || clockT - lastEvent < 2),
    systems,
    setSystemVisible(id, on) { if (G[id]) G[id].visible = !!on; if (ctx.requestRender) ctx.requestRender(0); },
    stations,
    stats: { drawCalls: draws, triangles: tris },
    facts: TECHNIK_FACTS,
    dispose() {
      for (const f of offs) if (typeof f === 'function') f();
      const i = ctx.updaters ? ctx.updaters.indexOf(update) : -1;
      if (i >= 0) ctx.updaters.splice(i, 1);
      group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      for (const m of Object.values(MAT)) m.dispose();
      group.removeFromParent();
      active = false;
    },
    // diagnostics (used by tests)
    debug: {
      chests: chests.map((c) => ({ id: c.id, channels: c.chan.size, units: c.units.length, stops: [...c.ranks.keys()], feeds: feeds.get(c.id), looms: looms.get(c.id), hp: c.hp, gap: c.gap })),
      valveOpen: (v) => vO[v], valveCount: (v) => vCount[v], valves, pipeValve, sliders, swellBoxes, regulators: ALLREG, trems: TREMS,
      openValves: () => { let n = 0; for (let v = 0; v < NV; v++) if (vCount[v] > 0) n++; return n; },
      partBoxes, obstacles: OBST, update, onPipe, flow: flowCur,
    },
  };
  group.userData.api = api;
  return group;
}
