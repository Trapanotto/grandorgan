// Organ pipework: all 9,999 pipes of the Royal Albert Hall organ, generated
// from the stop list. The facade pipes (LAYOUT.sections: free-standing big
// Pedal Open Diapason II / Double Open Diapason pipes in 'cluster' sections,
// Great Open Diapason 1 / 2 trebles in a V inside the three 'arch' recesses)
// are individual pipes (proxy meshes, drawn merged per section kind) in plain
// silver metal with flattened, slightly brighter bay-leaf lips; they ARE those
// notes of their ranks. The interior stands on divisional chests (instanced,
// with distance levels of detail) behind the facade, clear of the arch
// recesses. Note glow / registration tint / hover highlight are driven by the
// event bus.
import * as THREE from 'three';
import { STOPS, DIVISIONS, ACCESSORIES, resolveSource, stopById } from './stoplist.js';

const MOUTH_HALF_ANGLE = 0.7;   // rad; mouth width ~ 1/4 of the circumference
const LIP_SHADE = 1.14;         // lips: same metal, slightly brighter (vertex colour)
const GLOW_COLOR = 0xff8a2a;
const GLOW_MAX = 1.6;            // emissive intensity at full glow (stays >= 1 under dim light)
const FADE_IN = 0.08;
const FADE_OUT = 0.3;

// ---------------------------------------------------------------------------
// Small geometry accumulator: quad strips between "rings" (arrays of
// [x, y, z, u, v]); optional matrix baked into the vertices.
// ---------------------------------------------------------------------------
class Builder {
  constructor(colors = false) {
    this.pos = [];
    this.uv = [];
    this.col = colors ? [] : null;
    this.shade = 1;
    this.idx = [];
    this.rings = [];
    this.matrix = null;
    this._v = new THREE.Vector3();
  }

  get count() { return this.pos.length / 3; }

  _push(p) {
    const v = this._v.set(p[0], p[1], p[2]);
    if (this.matrix) v.applyMatrix4(this.matrix);
    this.pos.push(v.x, v.y, v.z);
    this.uv.push(p[3] || 0, p[4] || 0);
    if (this.col) this.col.push(this.shade, this.shade, this.shade);
  }

  // rings: bottom-to-top / outside-to-inside order gives outward / upward faces.
  addStrip(rings, filter = null, flip = false) {
    const starts = [];
    for (const ring of rings) {
      starts.push(this.count);
      this.rings.push([this.count, ring.length]);
      for (const p of ring) this._push(p);
    }
    const n = rings[0].length;
    for (let j = 0; j < rings.length - 1; j++) {
      for (let c = 0; c < n - 1; c++) {
        if (filter && !filter(c)) continue;
        const a = starts[j] + c, b = a + 1, d = starts[j + 1] + c, e = d + 1;
        if (flip) this.idx.push(a, e, b, a, d, e);
        else this.idx.push(a, b, e, a, e, d);
      }
    }
  }

  // Upward-facing fan (ring runs with increasing angle from the back seam).
  addFan(center, ring) {
    const c0 = this.count;
    this._push(center);
    this.rings.push([this.count, ring.length]);
    for (const p of ring) this._push(p);
    for (let c = 0; c < ring.length - 1; c++) this.idx.push(c0, c0 + 1 + c, c0 + 2 + c);
  }

  finish() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // Weld normals of coincident neighbours inside each ring (collapsed mouth
    // columns and the back seam) without smoothing across deliberate creases.
    const P = g.attributes.position, N = g.attributes.normal;
    const same = (i, j) =>
      Math.abs(P.getX(i) - P.getX(j)) + Math.abs(P.getY(i) - P.getY(j)) + Math.abs(P.getZ(i) - P.getZ(j)) < 1e-7;
    const s = new THREE.Vector3();
    const weld = (ids) => {
      s.set(0, 0, 0);
      for (const i of ids) s.x += N.getX(i), s.y += N.getY(i), s.z += N.getZ(i);
      if (s.lengthSq() < 1e-12) return;
      s.normalize();
      for (const i of ids) N.setXYZ(i, s.x, s.y, s.z);
    };
    for (const [start, n] of this.rings) {
      let run = [start];
      for (let c = 1; c < n; c++) {
        const i = start + c;
        if (same(i, i - 1)) run.push(i);
        else { if (run.length > 1) weld(run); run = [i]; }
      }
      if (run.length > 1) weld(run);
      if (n > 2 && same(start, start + n - 1)) weld([start, start + n - 1]);
    }
    for (let i = 0; i < N.count; i++) {
      if (N.getX(i) ** 2 + N.getY(i) ** 2 + N.getZ(i) ** 2 < 1e-12) N.setXYZ(i, 0, 1, 0);
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// One facade flue pipe. Local frame: toe at y = 0, axis = +Y, mouth faces +Z.
// `len` = total height (foot + speaking body). Metal (incl. the slightly
// brighter lips, as vertex colours) goes to the pipe's own geometry
// (returned); the dark mouth slot and the inside of the open top are appended
// to the shared `dark` builder (its .matrix must be set by the caller).
// ---------------------------------------------------------------------------
function buildFluePipe({ r, len, foot, nb }, dark) {
  const w0 = MOUTH_HALF_ANGLE;
  const nf = 6;                 // segments across the mouth interior
  const fi = 0.93;              // interior columns span +-fi * w
  const toeR = Math.max(0.018, 0.2 * r);            // long conical foot down to a slim toe
  const mouthW = 2 * r * Math.sin(w0);
  const cut = 0.26 * mouthW;                        // cut-up (mouth height)
  const leafH = Math.min(2.3 * mouthW, 0.5 * (len - foot - cut));
  const lowH = Math.min(1.1 * r, 0.6 * foot);       // lower lip flattening on the foot
  const recess = 0.14 * r;
  const y0 = foot, y1 = foot + cut;

  // Column descriptors, from the back seam (-PI) round the front to +PI.
  const cols = [];
  for (let i = 0; i < nb; i++) cols.push({ rear: -1, g: i / nb });
  cols.push({ f: -1 });
  for (let i = 0; i <= nf; i++) cols.push({ f: -fi + (2 * fi * i) / nf, inner: true });
  cols.push({ f: 1 });
  for (let i = 1; i <= nb; i++) cols.push({ rear: 1, g: i / nb });
  const frontA = nb, frontB = nb + nf + 2;          // column index range of the mouth sector
  const isFront = (c) => c >= frontA && c < frontB;
  const isInner = (c) => c > frontA && c < frontB - 1;

  const radiusAt = (y) => (y < foot ? toeR + (r - toeR) * (y / foot) : r);
  const leaf = (s) => w0 * (1 - Math.pow(THREE.MathUtils.clamp(s, 0, 1), 1.5)); // pointed (bay-leaf) arch
  const halfAngleAt = (y) => {
    if (y < y0 - 1e-9) return y > y0 - lowH ? leaf((y0 - y) / lowH) : 0;
    if (y <= y1 + 1e-9) return w0;
    return y < y1 + leafH ? leaf((y - y1) / leafH) : 0;
  };
  const vScale = 1 / (2 * Math.PI * r);

  // Ring through the pipe wall at height y. The mouth-sector columns follow
  // the lip outline (angle scaled by w/w0) and are pressed flat onto the chord.
  const ring = (y, rec = false, rho = radiusAt(y), w = halfAngleAt(y)) => cols.map((col) => {
    let th, z;
    if (col.rear) {
      th = col.rear < 0 ? -Math.PI + (Math.PI - w) * col.g : w + (Math.PI - w) * col.g;
      z = rho * Math.cos(th);
    } else {
      th = col.f * w;
      z = rho * Math.cos(w) - (rec && col.inner ? recess : 0);
    }
    return [rho * Math.sin(th), y, z, (th + Math.PI) / (2 * Math.PI), y * vScale];
  });
  const circle = (y, rho) => ring(y, false, rho, 0);

  // ---- metal: foot, lips, body, rim ----
  const metal = new Builder(true);
  const footRings = [ring(0)];
  const nfo = Math.max(1, Math.round((y0 - lowH) / 0.6));  // straight cone, a few rings for lighting
  for (let j = 1; j <= nfo; j++) if (y0 - lowH > 0.02) footRings.push(ring(((y0 - lowH) * j) / nfo));
  const nl = 5;
  for (let j = nl - 1; j >= 0; j--) footRings.push(ring(y0 - (lowH * j) / nl));
  metal.addStrip(footRings);
  metal.addStrip([ring(y0), ring(y0, true)], isFront);              // lower lip ledge
  metal.addStrip([ring(y0, true), ring(y1, true)], (c) => !isInner(c)); // wall + mouth cheeks
  metal.addStrip([ring(y1, true), ring(y1)], isFront);              // upper lip edge
  const nu = 10;
  const bodyRings = [];
  for (let j = 0; j <= nu; j++) bodyRings.push(ring(y1 + (leafH * j) / nu));
  bodyRings.push(ring(len));
  metal.addStrip(bodyRings);
  const rIn = 0.93 * r;
  metal.addStrip([circle(len, r), circle(len, rIn)]);               // rim

  // ---- dark: mouth slot back wall, inside of the open top ----
  dark.addStrip([ring(y0, true), ring(y1, true)], isInner);
  const depth = Math.min(1.5 * r, 0.4);
  dark.addStrip([circle(len, rIn), circle(len - depth, rIn)]);      // inward-facing wall
  dark.addFan([0, len - depth, 0, 0.5, 0.5], circle(len - depth, rIn));

  // ---- lips: the same metal, burnished a little brighter, laid just proud of the flats ----
  metal.shade = LIP_SHADE;
  const eps = 0.002 + 0.006 * r;
  const m = 6;
  const lipRow = (y, inset) => {
    const w = halfAngleAt(y), rho = radiusAt(y), row = [];
    for (let k = 0; k <= m; k++) {
      const th = -w * inset + (2 * w * inset * k) / m;
      row.push([rho * Math.sin(th), y, rho * Math.cos(w) + eps, k / m, y * vScale]);
    }
    return row;
  };
  const upper = [];
  for (let j = 0; j <= nu; j++) upper.push(lipRow(y1 + (leafH * (j === nu ? nu - 0.35 : j)) / nu, 0.94));
  metal.addStrip(upper);
  const lower = [];
  for (let j = nl; j >= 0; j--) lower.push(lipRow(y0 - (lowH * (j === nl ? nl - 0.35 : j)) / nl, 0.88));
  metal.addStrip(lower);
  metal.shade = 1;

  return metal.finish();
}

// Merge facade pipe geometries (indexed; position, normal, uv, color) baked
// with their matrices; aPipe = index of the pipe within the merged mesh.
function mergeFacade(parts) {
  let nv = 0, ni = 0;
  for (const { geo } of parts) { nv += geo.attributes.position.count; ni += geo.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const pid = new Float32Array(nv), idx = new Uint32Array(ni);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let ov = 0, oi = 0;
  parts.forEach(({ geo, matrix }, k) => {
    const P = geo.attributes.position, N = geo.attributes.normal, n = P.count;
    nm.getNormalMatrix(matrix);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(matrix); pos.set([v.x, v.y, v.z], (ov + i) * 3);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (ov + i) * 3);
      pid[ov + i] = k;
    }
    uv.set(geo.attributes.uv.array, ov * 2);
    col.set(geo.attributes.color.array, ov * 3);
    const I = geo.index.array;
    for (let i = 0; i < I.length; i++) idx[oi + i] = I[i] + ov;
    ov += n; oi += I.length;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPipe', new THREE.BufferAttribute(pid, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Material of a merged facade mesh: the per-pipe material (proto) without its
// own glow; per pipe vec4 uFacade[i] = (emissive radiance rgb, colour factor).
function facadeMaterial(proto, n, kind) {
  const m = proto.clone();
  m.name = 'pipeMetal';
  m.visible = true;
  m.emissive.set(0x000000);
  m.emissiveIntensity = 1;
  const state = Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, 1));
  const uFacade = { value: state };
  m.userData.state = state;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFacade = uFacade;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aPipe;\nuniform vec4 uFacade[${n}];\nvarying vec4 vFacade;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = uFacade[int(aPipe + 0.5)];');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFacade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFacade.w;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vFacade.rgb;');
  };
  m.customProgramCacheKey = () => 'facadePipes' + kind + n;
  return m;
}

// ---------------------------------------------------------------------------
// Facade layout from LAYOUT.sections (see layout.js). Every facade pipe is a
// real note of a real rank: BODY length follows pitch,
//   L = pitchFt * 0.3048 * 2^(-note/12)        (32' C = 9.75 m),
// diameter by normal principal scaling (halving every 16.5 semitones):
// Pedal basses 32' C = 0.48 m, manual 8' ranks 8' C = 0.15 m.
// ---------------------------------------------------------------------------
const FACADE_HALVING = 16.5;
export const facadeBodyLength = (pitchFt, note) => pitchFt * 0.3048 * Math.pow(2, -note / 12);
export function facadeDiameter(pitchFt, note) {
  const t = note + 12 * Math.log2(8 / pitchFt);     // semitones above 8' C
  return pitchFt >= 16
    ? 0.48 * Math.pow(2, -(t + 24) / FACADE_HALVING)
    : 0.15 * Math.pow(2, -t / FACADE_HALVING);
}

// 'cluster' envelope: between the posts, pipe surfaces within z in [0, 0.8].
const CL_Z0 = 0.0, CL_Z1 = 0.8, CL_AX0 = 0.05, CL_AX1 = 0.75, CL_MARGIN = 0.035;
export function clusterEnvelope(sec, LAYOUT) {
  const pw = LAYOUT.postW ?? 0.22;
  return { x0: sec.x - sec.width / 2 + pw / 2 + CL_MARGIN, x1: sec.x + sec.width / 2 - pw / 2 - CL_MARGIN, z0: CL_Z0, z1: CL_Z1 };
}
// 'arch' clear opening between the columns.
export function archOpening(sec) {
  const half = sec.width / 2 - 2 * sec.colR - 0.05;
  return { x0: sec.x - half, x1: sec.x + half };
}

function layoutFacadeSection(sec, LAYOUT) {
  const items = sec.notes.map((note) => ({
    note, len: facadeBodyLength(sec.pitchFt, note), r: facadeDiameter(sec.pitchFt, note) / 2,
  }));
  const n = items.length;
  if (!n) return items;

  if (sec.kind === 'arch') {
    // V of 8' trebles on the toe-board inside the recess; centres evenly spaced
    // across the clear opening, mouths on one level line.
    const { x0, x1 } = archOpening(sec);
    const a = x0 + items[0].r, b = x1 - items[n - 1].r;
    const yToe = sec.impostY + (sec.toeH ?? 0.35);
    items.forEach((it, i) => {
      it.x = n === 1 ? sec.x : a + ((b - a) * i) / (n - 1);
      it.z = -0.4;
      it.rotY = 0;
      it.foot = 0.4;
      it.y0 = yToe;
    });
    return items;
  }

  // 'cluster': big pipes on the stepped plinth in a shallow forward-bowed row.
  const env = clusterEnvelope(sec, LAYOUT);
  const W = env.x1 - env.x0, xm = (env.x0 + env.x1) / 2;
  const sumD = items.reduce((t, it) => t + 2 * it.r, 0);
  const Lmax = Math.max(...items.map((it) => it.len));
  const F = THREE.MathUtils.clamp(0.265 * Lmax, 0.5, 2.6);   // long conical feet; mouths nearly level
  const yToe = sec.impostY + (sec.plinthH ?? 0.5);
  const zLo = (it) => Math.max(CL_AX0, env.z0 + it.r + 0.015);
  const zHi = (it) => Math.min(CL_AX1, env.z1 - it.r - 0.015);
  items.forEach((it) => { it.foot = F * (0.93 + 0.07 * it.len / Lmax); it.y0 = yToe; });

  if (sumD + 0.02 * (n - 1) <= W) {
    const g = (W - sumD) / n;                       // equal gaps, half gaps at the posts
    let x = env.x0 + g / 2;
    const bow = 0.16;
    items.forEach((it) => {
      it.x = x + it.r;
      x += 2 * it.r + g;
      const u = (it.x - xm) / (W / 2);
      it.z = THREE.MathUtils.clamp(0.42 + bow * (1 - u * u), zLo(it), zHi(it));
      it.rotY = Math.atan((2 * bow * u) / (W / 2)) * 0.8;   // mouths follow the bow
    });
    return items;
  }

  // Too wide for one row: stagger into two depth rows (taller row behind),
  // alternating left to right; centres evenly spaced.
  const rowA = items.filter((_, i) => i % 2 === 0), rowB = items.filter((_, i) => i % 2 === 1);
  const mean = (r) => r.reduce((t, it) => t + it.len, 0) / Math.max(1, r.length);
  const back = mean(rowA) >= mean(rowB) ? rowA : rowB;
  const a = env.x0 + items[0].r, b = env.x1 - items[n - 1].r;
  items.forEach((it, i) => {
    it.x = a + ((b - a) * i) / (n - 1);
    it.z = back.includes(it) ? zLo(it) : zHi(it);
    it.rotY = 0;
  });
  return items;
}

// ===========================================================================
// PIPE INVENTORY — every pipe of the organ, generated from STOPS.
// ===========================================================================
const FT8 = 8 * 0.3048;           // speaking length of an open 8' C (m)
const HALVING = 16.5;             // diameter halves every 16.5 semitones
const MIX_TOP = 91;               // mixture ranks break back below ~1.3 cm speaking length

const COMPASS = Object.fromEntries(DIVISIONS.map((d) => [d.id, d.compass]));
const parity = (n) => ((n % 2) + 2) % 2;

// Pipe form and scale (diameter at 8' C, metres) from the stop's name/construction.
function pipeForm(stop) {
  const id = stop.id;
  const has = (...k) => k.some((w) => id.includes(w));
  const f = { shape: 'open', d8: 0.12, mat: 'dull', factor: 1, harmonicFrom: Infinity, wood: false };
  if (stop.construction === 'wood') {
    f.wood = true;
    f.mat = 'oak';
    if (has('open-wood', 'octave-wood')) { f.shape = 'wood'; f.d8 = 0.2; }
    else if (has('sub-bass')) { f.shape = 'woodStopped'; f.d8 = 0.16; }
    else if (id === 'pedal-quint') { f.shape = 'woodStopped'; f.d8 = 0.14; }
    else if (has('gedeckt', 'bourdon', 'lieblich-flute', 'doppel')) { f.shape = 'woodStopped'; f.d8 = 0.115; }
    else if (id === 'pedal-flute') { f.shape = 'woodStopped'; f.d8 = 0.13; }
    else { f.shape = 'wood'; f.d8 = 0.1; }
    if (has('harmonic')) f.harmonicFrom = 17;
    return f;
  }
  if (stop.family === 'reed') {
    f.shape = 'reedCone'; f.d8 = 0.12;
    if (has('tuba', 'tromba', 'ophicleide', 'bombard', 'trombone', 'posaune')) f.d8 = 0.16;
    if (has('horn')) f.d8 = 0.13;
    if (has('oboe', 'hautboy')) f.d8 = 0.075;
    if (has('cor-anglais')) { f.d8 = 0.07; f.factor = 0.5; }
    if (has('bassoon', 'fagotto')) f.d8 = 0.06;
    if (has('clarinet', 'bassetto')) { f.shape = 'reedCyl'; f.d8 = 0.045; f.factor = 0.5; }
    if (has('baryton')) { f.shape = 'reedCyl'; f.d8 = 0.06; f.factor = 0.5; }
    if (has('vox-humana')) { f.shape = 'reedCyl'; f.d8 = 0.05; f.factor = 0.125; f.capped = true; }
    if (has('harmonic')) f.harmonicFrom = 24;
    return f;
  }
  // metal flue
  if (stop.family === 'string') {
    f.mat = 'tin'; f.d8 = 0.085;
    if (has('viole', 'violes')) f.d8 = 0.06;
    if (has('violone', 'violoncello', 'contra-bass')) f.d8 = 0.1;
    if (has('vox-angelica')) f.d8 = 0.075;
    if (has('gamba')) f.d8 = 0.09;
  } else if (stop.family === 'principal') {
    f.d8 = has('dulciana') ? 0.09 : has('geigen') ? 0.13 : has('gemshorn') ? 0.11 : 0.15;
  } else if (stop.family === 'flute') {
    f.d8 = 0.12;
    if (has('quintaton', 'rohr', 'cheminee')) f.shape = 'stopped';
    if (has('pavillon')) f.d8 = 0.13;
    if (has('unda-maris')) f.d8 = 0.1;
    if (has('flageolet')) f.d8 = 0.09;
    if (has('harmonic')) { f.d8 = 0.11; f.harmonicFrom = 17; }
  } else if (stop.family === 'mixture') {
    f.d8 = id.startsWith('pedal') ? 0.13 : 0.12;
    if (has('violes')) { f.d8 = 0.07; f.mat = 'tin'; }
  } else if (stop.family === 'mutation') {
    f.d8 = has('tierce', 'nazard') ? 0.11 : 0.13;
  }
  return f;
}

function makePipe(stop, ownerId, rank, note, rankSemis) {
  const form = pipeForm(stop);
  let t = rankSemis + note;                          // semitones above 8' C
  if (stop.family === 'mixture') while (t > MIX_TOP) t -= 12;
  let L = FT8 * Math.pow(2, -t / 12);
  if (form.shape === 'stopped' || form.shape === 'woodStopped') L *= 0.5;
  if (note >= form.harmonicFrom) L *= 2;
  L *= form.factor;
  let d = Math.max(0.006, form.d8 * Math.pow(2, -t / HALVING));
  if (form.wood) d = Math.max(0.012, d);
  let mat = form.mat;
  if (!form.wood && d >= 0.12) mat = 'zinc';         // zinc basses
  return {
    stopId: ownerId, rankKey: stop.id, rank, noteIndex: note, semis: t,
    length: L, diameter: d, shape: form.shape, mat, capped: !!form.capped, wood: form.wood,
    division: stop.division, location: stop.location || stop.division,
    subdivision: stop.subdivision || null, facade: false,
  };
}

export function buildInventory() {
  const pipes = [];
  const sources = STOPS.filter((s) => !s.derived && s.pipes > 0);
  for (const s of sources) {
    const c = COMPASS[s.division];
    const ranks = Math.max(1, s.ranks);
    const comp = s.composition && s.composition.length === ranks ? s.composition : Array(ranks).fill(s.semitones);
    let deficit = ranks * c - s.pipes;               // celestes: last rank starts higher
    for (let r = 0; r < ranks; r++) {
      let first = 0;
      if (r === ranks - 1 && deficit > 0) first = deficit;
      for (let n = first; n < c; n++) pipes.push(makePipe(s, s.id, r, n, comp[r]));
    }
  }
  // extensions own only the notes outside the source compass
  const owned = new Map();
  const exts = STOPS.filter((s) => s.derived && s.derived.kind === 'extension' && s.pipes > 0)
    .sort((a, b) => Math.abs(a.derived.semitones) - Math.abs(b.derived.semitones));
  for (const e of exts) {
    const src = resolveSource(e);
    const sp = src.stop;
    const c = COMPASS[sp.division];
    const key = sp.id;
    if (!owned.has(key)) owned.set(key, new Set(Array.from({ length: c }, (_, i) => i)));
    const set = owned.get(key);
    const off = src.semitones;
    const idx = [];
    for (let k = 0; k < COMPASS[e.division]; k++) {
      const n = off + k;
      if (!set.has(n)) idx.push(n);
    }
    idx.sort((a, b) => Math.abs(a) - Math.abs(b));
    const take = idx.slice(0, e.pipes).sort((a, b) => a - b);
    for (const n of take) { set.add(n); pipes.push(makePipe(sp, e.id, 0, n, sp.semitones)); }
  }
  pipes.sort((a, b) => (a.division < b.division ? -1 : a.division > b.division ? 1 : 0) ||
    (a.rankKey < b.rankKey ? -1 : a.rankKey > b.rankKey ? 1 : 0) || a.rank - b.rank || a.noteIndex - b.noteIndex);
  return pipes;
}

// ===========================================================================
// CHESTS — soundboards on several levels inside the (open-topped) chamber.
//   F zone (front, behind the facade): z -2.35 .. -0.75
//   B zone (back):                     z -4.8  .. -2.75
//   centre |x| <= 6.4, ends |x| 6.6 .. 9.7 (Pedal on the floor, Tubas high)
// The three arch recesses of the facade (x = section.x +- width/2,
// z -recessDepth .. 0, y 5.2 .. impostY + springH + archR + 0.5) are kept
// clear: every chest whose pipework reaches into a recess's height band gets
// a notch there (pipes and chest woodwork stay behind z = -recessDepth - 0.12).
// The chamber has no roof: interior pipe tops <= TOP_MAX everywhere.
// ===========================================================================
const ZF0 = -2.35, ZF1 = -0.75, ZB0 = -4.8, ZB1 = -2.75, XC = 6.4, XE = 6.6, XW = 9.7;
const ZG0 = -2.47;                // Great reaches back to just clear of the Swell shutters
const CHEST_T = 0.3;
export const TOP_MAX = 17.5;
const SOLO_Y = 11.25;             // Solo chest above the centre arch recess (bottom 10.95)
const RECESS_CLEAR = 0.12;        // pipework stays this far behind the recess back wall
const DOOR = { x0: -1.5, x1: 1.5, z0: -1.2, y1: 5 };

const isTuba = (p) => p.subdivision === 'bombard-tubas';
const isPedalFlue = (p) => p.division === 'pedal' && p.location !== 'swell' && !p.wood && p.shape !== 'reedCone' && p.shape !== 'reedCyl';
const XO = 4.0;   // half width of the Orchestral box; Pedal flue chests beside it

// Arch recess volumes from LAYOUT.sections.
export function recessesOf(LAYOUT) {
  return (LAYOUT?.sections || []).filter((s) => s.kind === 'arch').map((s) => ({
    id: s.id, x0: s.x - s.width / 2, x1: s.x + s.width / 2, z0: -(s.recessDepth ?? 1.3), z1: 0,
    y0: Math.min(5.2, s.impostY), y1: s.impostY + s.springH + s.archR + 0.5,
  }));
}

export function chestsFor(LAYOUT) {
  const recesses = recessesOf(LAYOUT);
  const chests = [
    { id: 'pedal-C', division: 'pedal', label: 'Pedal woods & reeds (C side)', x0: -XW, x1: -XE, z0: ZB0, z1: ZF1, y: 0.6, hMax: TOP_MAX,
      limits: [{ x0: -XW, x1: -XE + 0.15, z0: -2.45, z1: 0, h: 11.0 }], mode: 'side', bassEnd: 'x0', marginK: 0.04,
      select: (p) => p.division === 'pedal' && p.location !== 'swell' && !isPedalFlue(p) && parity(p.noteIndex) === 0 },
    { id: 'pedal-Cs', division: 'pedal', label: 'Pedal woods & reeds (C# side)', x0: XE, x1: XW, z0: ZB0, z1: ZF1, y: 0.6, hMax: TOP_MAX,
      limits: [{ x0: XE - 0.15, x1: XW, z0: -2.45, z1: 0, h: 11.0 }], mode: 'side', bassEnd: 'x1', marginK: 0.04,
      select: (p) => p.division === 'pedal' && p.location !== 'swell' && !isPedalFlue(p) && parity(p.noteIndex) === 1 },
    { id: 'pedal-flue-C', division: 'pedal', label: 'Pedal metal flues (C side)', x0: -XE + 0.02, x1: -XO - 0.15, z0: ZB0, z1: ZB1, y: 0.6, hMax: 6.1,
      mode: 'side', bassEnd: 'x0', margin0: 0.01, marginK: 0.2, select: (p) => isPedalFlue(p) && parity(p.noteIndex) === 0 },
    { id: 'pedal-flue-Cs', division: 'pedal', label: 'Pedal metal flues (C# side)', x0: XO + 0.15, x1: XE - 0.02, z0: ZB0, z1: ZB1, y: 0.6, hMax: 6.1,
      mode: 'side', bassEnd: 'x1', margin0: 0.01, marginK: 0.2, select: (p) => isPedalFlue(p) && parity(p.noteIndex) === 1 },
    { id: 'tubas-C', division: 'bombard', label: 'Tubas (C side, unenclosed)', x0: -XW, x1: -6.85, z0: ZF0, z1: ZF1, y: 11.4, hMax: TOP_MAX,
      mode: 'side', bassEnd: 'x0', margin0: 0.02, marginK: 0.35, select: (p) => isTuba(p) && parity(p.noteIndex) === 0 },
    { id: 'tubas-Cs', division: 'bombard', label: 'Tubas (C# side, unenclosed)', x0: 6.85, x1: XW, z0: ZF0, z1: ZF1, y: 11.4, hMax: TOP_MAX,
      mode: 'side', bassEnd: 'x1', margin0: 0.02, marginK: 0.35, select: (p) => isTuba(p) && parity(p.noteIndex) === 1 },
    { id: 'choir', division: 'choir', label: 'Choir (unenclosed)', x0: -XC, x1: XC, z0: ZF0, z1: ZF1, y: 1.25, hMax: 5.2,
      exclude: [{ x0: -1.55, x1: 1.55, z0: -1.25 }], mode: 'V', margin0: 0.03, marginK: 0.7, select: (p) => p.division === 'choir' },
    { id: 'great', division: 'great', label: 'Great', x0: -XC, x1: XC, z0: ZG0, z1: ZF1, y: 5.6, hMax: TOP_MAX,
      limits: [{ x0: -4.75, x1: 4.75, z0: -9, z1: 0, h: SOLO_Y - CHEST_T - 0.1 }], mode: 'V', marginK: 0.06, select: (p) => p.division === 'great' },
    { id: 'solo', division: 'solo', label: 'Solo & Bombard (enclosed)', x0: -4.6, x1: 4.6, z0: ZF0, z1: -0.9, y: SOLO_Y, hMax: 16.3,
      mode: 'A', marginK: 0.1, alsoBounds: ['bombard'], box: { y1: 16.4, pedal: 'solo-swell-pedal' },
      select: (p) => p.division === 'solo' || (p.division === 'bombard' && !isTuba(p)) },
    { id: 'orchestral', division: 'orchestral', label: 'Orchestral (enclosed)', x0: -XO, x1: XO, z0: ZB0, z1: ZB1, y: 0.6, hMax: 6.1,
      mode: 'V', margin0: 0.015, marginK: 0.4, box: { y1: 6.2, pedal: 'orchestral-swell-pedal' }, select: (p) => p.division === 'orchestral' },
    { id: 'swell', division: 'swell', label: 'Swell (enclosed)', x0: -XC, x1: XC, z0: ZB0, z1: ZB1, y: 6.6, hMax: 14.9,
      mode: 'V', margin0: 0.006, marginK: 0.15, box: { y1: 15.0, pedal: 'swell-swell-pedal' },
      select: (p) => p.division === 'swell' || (p.division === 'pedal' && p.location === 'swell') },
  ];
  // notch every chest whose pipework band overlaps a recess
  for (const c of chests) {
    for (const r of recesses) {
      const ex = { x0: r.x0 - 0.05, x1: r.x1 + 0.05, z0: r.z0 - RECESS_CLEAR, recess: r.id };
      if (ex.x1 <= c.x0 || ex.x0 >= c.x1 || ex.z0 >= c.z1) continue;
      if (c.y - CHEST_T >= r.y1 || c.hMax <= r.y0) continue;
      (c.exclude ||= []).push(ex);
    }
  }
  chests.recesses = recesses;
  return chests;
}

// Footprint / height of one pipe standing on a chest.
function pipeDims(p) {
  const r = p.diameter / 2;
  if (p.shape === 'wood' || p.shape === 'woodStopped') {
    const k = p.shape === 'woodStopped' ? 1.08 : 1;
    const foot = 0.06 + 0.04 * Math.sqrt(p.length);
    return { a: (p.diameter / 2) * k, b: p.diameter * 0.625 * k, foot, stand: foot + p.length + (k > 1 ? 0.04 + 0.12 * p.diameter : 0) };
  }
  if (p.shape === 'reedCone' || p.shape === 'reedCyl') {
    const boot = 0.14 + 0.08 * Math.sqrt(p.length);
    const rb = Math.max(0.01, 0.3 * r + 0.008);
    const a = Math.max(r, rb);
    return { a, b: a, foot: boot, rb, stand: boot + p.length };
  }
  const foot = 0.12 + 0.11 * Math.sqrt(p.length);
  const cap = p.shape === 'stopped' ? 0.4 * Math.max(0.03, p.diameter) : 0;
  return { a: r * (p.shape === 'stopped' ? 1.08 : 1), b: r * (p.shape === 'stopped' ? 1.08 : 1), foot, stand: foot + p.length + cap * 0.4 };
}

function packChest(chest, list) {
  // skyline: piecewise-constant front-most free z along x (exact segments)
  const sx = [chest.x0 - 1, chest.x1 + 1];     // breakpoints
  const sz = [chest.z1];                        // z of segment [sx[i], sx[i+1])
  const EPS = 1e-7;
  const findSeg = (x) => { let lo = 0, hi = sz.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sx[mid] <= x) lo = mid; else hi = mid - 1; } return lo; };
  const skyMin = (xa, xb) => {
    let m = Infinity;
    for (let i = findSeg(xa + EPS); i < sz.length && sx[i] < xb - EPS; i++) m = Math.min(m, sz[i]);
    return m;
  };
  const split = (x) => { const i = findSeg(x); if (Math.abs(sx[i] - x) < 1e-9) return i; sx.splice(i + 1, 0, x); sz.splice(i + 1, 0, sz[i]); return i + 1; };
  const skySet = (xa, xb, z) => {
    const i0 = split(xa), i1 = split(xb);
    for (let i = i0; i < i1; i++) sz[i] = Math.min(sz[i], z);
  };
  for (const ex of chest.exclude || []) skySet(ex.x0, ex.x1, ex.z0);
  // headroom at a footprint: chest.limits lower it (zones under other chests);
  // with chest.raise they raise it instead (zones under the case crowns), and
  // the whole footprint must then lie inside the zone.
  const limitAt = (p, x, z) => {
    let h = chest.hMax;
    for (const L of chest.limits || []) {
      if (chest.raise) {
        if (x - p.a >= L.x0 && x + p.a <= L.x1 && z - p.b >= L.z0 && z + p.b <= L.z1) h = Math.max(h, L.h);
      } else if (x + p.a > L.x0 && x - p.a < L.x1 && z + p.b > L.z0 && z - p.b < L.z1) h = Math.min(h, L.h);
    }
    return h;
  };
  const stats = { overflow: 0, mitred: 0, pushed: 0, tooHigh: 0, minZ: chest.z1, maxTop: chest.y };

  // dims + mitres
  const maxAllowed = Math.max(chest.hMax, ...(chest.limits || []).map((L) => (chest.raise ? L.h : chest.hMax)));
  for (const p of list) {
    const dm = pipeDims(p);
    p.a = dm.a; p.b = dm.b; p.foot = dm.foot; p.rb = dm.rb || 0;
    p.m = chest.margin0 ?? 0.004;
    p.m += (chest.marginK ?? 0.05) * dm.a;
    p.top = chest.y + dm.stand;
    p.mitre = null;
    if (p.top > maxAllowed && p.shape !== 'wood' && p.shape !== 'woodStopped') {
      // double mitre: up, across (towards the front), down
      const r = p.shape === 'reedCone' ? (p.diameter / 2) * 0.85 : p.diameter / 2;
      const h1 = maxAllowed - chest.y - dm.foot - r - 0.03;
      const s0 = 2 * r + 0.05;
      const h2 = Math.min(p.length - h1 - s0, h1 - 0.3);
      const s = p.length - h1 - h2;
      p.mitre = { r, h1, h2, s };
      p.b = Math.max(p.b, (s + 2 * r) / 2);
      p.top = chest.y + dm.foot + h1 + r;
      stats.mitred++;
    }
  }

  // ranks
  const ranks = new Map();
  for (const p of list) {
    const k = `${p.rankKey}#${p.rank}`;
    if (!ranks.has(k)) ranks.set(k, { key: k, pipes: [], maxTop: 0 });
    const R = ranks.get(k);
    R.pipes.push(p);
    R.maxTop = Math.max(R.maxTop, p.top);
  }
  const order = [...ranks.values()].sort((a, b) => a.maxTop - b.maxTop || (a.key < b.key ? -1 : 1));
  const xc = (chest.x0 + chest.x1) / 2;
  const EDGE = 0.04, MID = 0.03;

  // Half-ranks are laid like words in lines: each starts with its bass at the
  // line start (outer end for 'V', middle for 'A'); a word that does not fit
  // the rest of the line starts a new line. Every pipe nests behind what
  // already stands in its channel (skyline), so lines step back row by row.
  const placePipe = (p) => {
    let z = skyMin(p.x - p.a - p.m, p.x + p.a + p.m) - p.b - p.m;
    let lim = limitAt(p, p.x, z);
    while (p.top > lim + 1e-9 && z - p.b > chest.z0) { z -= 0.05; lim = limitAt(p, p.x, z); stats.pushed++; }
    if (p.top > lim + 1e-9) stats.tooHigh++;
    if (z - p.b - p.m < chest.z0 - 1e-6) stats.overflow++;
    p.z = z;
    skySet(p.x - p.a - p.m, p.x + p.a + p.m, z - p.b - p.m);
    stats.minZ = Math.min(stats.minZ, z - p.b);
    stats.maxTop = Math.max(stats.maxTop, p.top);
  };
  const makeHalf = (start, end) => ({ start, end, dir: Math.sign(end - start), avail: Math.abs(end - start), cur: 0 });
  const placeWord = (H, seq) => {
    if (!seq.length) return;
    const ws = seq.map((p) => 2 * (p.a + p.m));
    const W = ws.reduce((t, w) => t + w, 0);
    // x positions for a word starting at offset o (wrapping onto further lines)
    const layout = (o) => {
      const xs = [];
      let c = o;
      for (let k = 0; k < seq.length; k++) {
        if (c + ws[k] > H.avail + 1e-9) c = 0;
        xs.push(H.start + H.dir * (c + ws[k] / 2));
        c += ws[k];
      }
      return { xs, end: c };
    };
    // best fit: try several start offsets, keep the one that pushes the
    // skyline back the least (headroom violations first)
    const cands = new Set([0]);
    if (W <= H.avail) {
      if (H.cur + W <= H.avail) cands.add(H.cur);
      const nc = chest.candidates ?? 12;
      for (let k = 1; k < nc; k++) { const o = (k * (H.avail - W)) / nc; if (o >= 0) cands.add(o); }
      cands.add(H.avail - W);
    }
    let best = null;
    for (const o of cands) {
      const { xs, end } = layout(o);
      let bad = 0, deep = Infinity;
      for (let k = 0; k < seq.length; k++) {
        const p = seq[k];
        const z = skyMin(xs[k] - p.a - p.m, xs[k] + p.a + p.m) - p.b - p.m;
        if (p.top > limitAt(p, xs[k], Math.max(z, chest.z0 + p.b)) + 1e-9) bad++;
        deep = Math.min(deep, z - p.b - p.m);
      }
      const score = bad * 100 - deep + o * 1e-4;
      if (!best || score < best.score) best = { score, xs, end };
    }
    seq.forEach((p, k) => { p.x = best.xs[k]; placePipe(p); });
    H.cur = best.end;
  };

  // lines: 'side' one line from the bass end; 'V' C / C# halves with basses at
  // the outer ends; 'A' basses in the middle; 'M' each half is a small V
  // (basses at the outer ends and at the centre, trebles at the quarter points).
  const xq0 = (chest.x0 + xc) / 2, xq1 = (xc + chest.x1) / 2;
  let lines;
  if (chest.mode === 'side') {
    const a = chest.bassEnd === 'x0' ? chest.x0 + EDGE : chest.x1 - EDGE;
    const b = chest.bassEnd === 'x0' ? chest.x1 - EDGE : chest.x0 + EDGE;
    lines = [[makeHalf(a, b)]];
  } else if (chest.mode === 'V') {
    lines = [[makeHalf(chest.x0 + EDGE, xc - MID)], [makeHalf(chest.x1 - EDGE, xc + MID)]];
  } else if (chest.mode === 'A') {
    lines = [[makeHalf(xc - MID, chest.x0 + EDGE)], [makeHalf(xc + MID, chest.x1 - EDGE)]];
  } else {
    lines = [[makeHalf(chest.x0 + EDGE, xq0 - MID), makeHalf(xc - MID, xq0 + MID)],
      [makeHalf(chest.x1 - EDGE, xq1 + MID), makeHalf(xc + MID, xq1 - MID)]];
  }
  for (const R of order) {
    const ps = R.pipes.sort((a, b) => a.noteIndex - b.noteIndex);
    const sides = lines.length === 1 ? [ps] : [ps.filter((p) => parity(p.noteIndex) === 0), ps.filter((p) => parity(p.noteIndex) === 1)];
    sides.forEach((seq, si) => {
      const L = lines[si];
      if (L.length === 1) placeWord(L[0], seq);
      else { placeWord(L[0], seq.filter((_, k) => k % 2 === 0)); placeWord(L[1], seq.filter((_, k) => k % 2 === 1)); }
    });
  }
  for (const p of list) { p.y0 = chest.y; p.chest = chest.id; }
  return stats;
}

// ===========================================================================
// Glow material: per-instance attribute aGlow = (note glow, registration tint, hover highlight)
// ===========================================================================
const glowUniforms = {
  uGlowColor: { value: new THREE.Color(GLOW_COLOR) },
  uHiColor: { value: new THREE.Color(0x7fc4ff) },
};
function glowMaterial(base, name, tweak = {}) {
  const m = base.clone();
  Object.assign(m, tweak);
  m.name = name;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlowColor = glowUniforms.uGlowColor;
    sh.uniforms.uHiColor = glowUniforms.uHiColor;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;\nuniform vec3 uGlowColor;\nuniform vec3 uHiColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + 0.4 * vGlow.y;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlowColor * (' + GLOW_MAX.toFixed(2) +
        ' * vGlow.x + 0.035 * vGlow.y) + uHiColor * (0.55 * vGlow.z);');
  };
  m.customProgramCacheKey = () => 'organPipeGlow';
  return m;
}

// unit geometries (y from 0 to 1, radius 1) per level of detail: level 0 is
// the full model; levels 1, 2 (camera at least LOD_DIST[i] from every interior
// pipe) use fewer radial segments, chosen so that the silhouette error of the
// largest pipe of each size class stays <= ~1 device pixel at a 2x pixel ratio
// (r * (1 - cos(PI / n)) * 2000 px / distance). Round parts only; boxes and
// mouth planes have a single level.
const LOD_SEGS = [{ s: 6, m: 10, l: 16 }, { s: 4, m: 6, l: 12 }, { s: 3, m: 5, l: 8 }];
const LOD_DIST = [0, 20, 32];
// level-0 culling groups (chest id -> group; other chests: 'rest')
const LOD_GROUPS = { great: 'great', swell: 'swell', solo: 'solo' };
function unitGeometries(level = 0) {
  const tube = (rt, rb, seg, open = true) => new THREE.CylinderGeometry(rt, rb, 1, seg, 1, open).translate(0, 0.5, 0);
  // reed boots stand on the chest: no bottom disc (never visible)
  const boot = (seg) => {
    const g = tube(1, 1, seg, false);
    const bottom = g.groups.find((gr) => gr.materialIndex === 2);
    g.setIndex(Array.from(g.index.array.slice(0, bottom.start)));
    g.clearGroups();
    return g;
  };
  const G = {};
  const segs = LOD_SEGS[level];
  for (const [k, n] of Object.entries(segs)) {
    G['body-' + k] = () => tube(1, 1, n);
    G['foot-' + k] = () => tube(1, 0.25, n);
    G['cone-' + k] = () => tube(1, 0.15, n);
    G['cap-' + k] = () => tube(1, 1, n, false);
  }
  G['boot-s'] = () => boot(segs.s);
  G['boot-m'] = () => boot(segs.m);
  if (level === 0) {
    G.box = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    G.mouth = () => new THREE.PlaneGeometry(1, 1);
  }
  return G;
}
const lod = (d) => (d < 0.03 ? 's' : d < 0.12 ? 'm' : 'l');
// closed solids (stopper caps; boots, open only at the hidden bottom): no back faces
const isClosedPart = (geo) => geo.startsWith('cap-') || geo.startsWith('boot-');

// LOD switched by the distance from the camera to the nearest point of a box
// (THREE.LOD measures to its origin, which is meaningless for a 20 m chamber).
// The renderer calls update(camera) for every LOD it traverses.
const _lodV = new THREE.Vector3(), _lodB = new THREE.Box3();
class BoxLOD extends THREE.LOD {
  constructor(box) { super(); this.box = box; }
  update(camera) {
    const levels = this.levels;
    if (levels.length < 2) return;
    _lodV.setFromMatrixPosition(camera.matrixWorld);
    _lodB.copy(this.box).applyMatrix4(this.matrixWorld);
    const d = _lodB.distanceToPoint(_lodV) / (camera.zoom || 1);
    let cur = 0;
    for (let i = 1; i < levels.length; i++) if (d >= levels[i].distance) cur = i;
    for (let i = 0; i < levels.length; i++) levels[i].object.visible = i === cur;
    this._currentLevel = cur;
  }
}

// ===========================================================================
function buildInterior(group, ctx, facadeMeshes, CHESTS) {
  const { materials: M } = ctx;
  const t0 = Date.now();
  const inventory = buildInventory();

  // ---------------- facade assignment ----------------
  // Each facade mesh names its rank (source stop) and note; that inventory
  // pipe moves to the facade (whichever stop owns it: e.g. Open Diapason II
  // notes -12..-1 belong to the 32' Double Open Diapason extension).
  const byRankNote = new Map();
  for (const p of inventory) if (p.rank === 0) byRankNote.set(p.rankKey + '@' + p.noteIndex, p);
  const facadeAssignment = [];
  for (const mesh of facadeMeshes) {
    const u = mesh.userData;
    const rec = byRankNote.get(u.rankStopId + '@' + u.noteIndex);
    if (!rec || rec.facade) throw new Error(`facade pipe ${mesh.name}: no free pipe ${u.rankStopId} note ${u.noteIndex}`);
    rec.facade = true;
    rec.mesh = mesh;
    rec.x = mesh.position.x; rec.z = mesh.position.z; rec.y0 = mesh.position.y;
    rec.foot = u.footHeight;
    rec.top = u.topY;
    rec.diameter = 2 * u.radius;
    rec.a = rec.b = u.radius;
    rec.chest = 'facade:' + u.section;
    u.stopId = rec.stopId;
    facadeAssignment.push({
      pipe: mesh.name, section: u.section, kind: u.kind, index: u.index,
      stopId: rec.stopId, rankStopId: rec.rankKey, noteIndex: rec.noteIndex,
      nominalLength: +rec.length.toFixed(3), facadeLength: +u.length.toFixed(3),
      diameter: +(2 * u.radius).toFixed(3), foot: +u.footHeight.toFixed(3), topY: +u.topY.toFixed(3),
      x: +mesh.position.x.toFixed(3), z: +mesh.position.z.toFixed(3),
    });
  }

  // ---------------- chests ----------------
  const interior = inventory.filter((p) => !p.facade);
  const byChest = new Map(CHESTS.map((c) => [c.id, []]));
  const unplaced = [];
  for (const p of interior) {
    const c = CHESTS.find((ch) => ch.select(p));
    if (c) byChest.get(c.id).push(p); else unplaced.push(p);
  }
  const chestStats = [];
  for (const c of CHESTS) {
    // greedy packing: if a chest overflows, retry with other start-offset
    // resolutions (deterministic) and keep the first clean result
    let st = packChest(c, byChest.get(c.id));
    for (const nc of [40, 24, 64, 32, 18, 50]) {
      if (!st.overflow && !st.tooHigh) break;
      st = packChest({ ...c, candidates: nc }, byChest.get(c.id));
    }
    chestStats.push({ id: c.id, division: c.division, label: c.label, pipes: byChest.get(c.id).length,
      x: [c.x0, c.x1], z: [c.z0, c.z1], y: c.y, usedDepth: +(c.z1 - st.minZ).toFixed(3), maxTop: +st.maxTop.toFixed(3), ...st });
  }

  // ---------------- instances ----------------
  const glowMats = {
    dull: glowMaterial(M.pipeMetalDull, 'interiorMetal', { side: THREE.DoubleSide }),
    tin: glowMaterial(M.pipeMetalDull, 'interiorTin', { side: THREE.DoubleSide, roughness: 0.3, metalness: 0.95 }),
    zinc: glowMaterial(M.pipeMetalDull, 'interiorZinc', { side: THREE.DoubleSide, roughness: 0.58, metalness: 0.75 }),
    oak: glowMaterial(M.oak, 'interiorOak'),
    dark: glowMaterial(M.pipeDark, 'interiorMouths'),
  };
  glowMats.tin.color = new THREE.Color(0xc9cdcb);
  glowMats.zinc.color = new THREE.Color(0x7b8085);
  const closedMats = {};
  for (const k of ['dull', 'tin', 'zinc']) {
    closedMats[k] = glowMats[k].clone();
    closedMats[k].side = THREE.FrontSide;
    closedMats[k].onBeforeCompile = glowMats[k].onBeforeCompile;
    closedMats[k].customProgramCacheKey = glowMats[k].customProgramCacheKey;
  }
  const matFor = (geo, mat) => (isClosedPart(geo) && closedMats[mat]) || glowMats[mat];

  const buckets = new Map();   // key -> { geo, mat, m: [], owner: [] }
  const bucket = (geo, mat) => {
    const k = geo + '|' + mat;
    if (!buckets.has(k)) buckets.set(k, { key: k, geo, mat, m: [], owner: [] });
    return buckets.get(k);
  };
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
  const QZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // +y -> +z
  const put = (geo, mat, owner, x, y, z, sx, sy, sz, q = null) => {
    const b = bucket(geo, mat);
    if (q) {
      tmpM.compose(tmpP.set(x, y, z), q, tmpS.set(sx, sy, sz));
      b.m.push(...tmpM.elements);
    } else {
      b.m.push(sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1);
    }
    b.owner.push(owner);
  };

  inventory.forEach((p, i) => { p.index = i; });
  for (const p of interior) {
    const i = p.index;
    const { x, z } = p;
    const y = p.y0;
    const d = p.diameter, r = d / 2, L = p.length;
    const lv = lod(d);
    const metal = p.mat;
    if (p.shape === 'wood' || p.shape === 'woodStopped') {
      const dep = d * 1.25;
      put('box', 'oak', i, x, y, z, 0.4 * d, p.foot, 0.4 * d);
      put('box', 'oak', i, x, y + p.foot, z, d, L, dep);
      if (p.shape === 'woodStopped') {
        const h = 0.04 + 0.12 * d;
        put('box', 'oak', i, x, y + p.foot + L - h * 0.5, z, d * 1.08, h, dep * 1.08);
      }
      put('mouth', 'dark', i, x, y + p.foot + 0.15 * d + 0.01, z + dep / 2 + 0.002, 0.72 * d, 0.3 * d, 1);
      continue;
    }
    const reed = p.shape === 'reedCone' || p.shape === 'reedCyl';
    // foot / boot
    let zU = z, zD = z;
    if (p.mitre) { zU = z - p.mitre.s / 2; zD = z + p.mitre.s / 2; }
    if (reed) {
      const bl = p.rb < 0.015 ? 's' : 'm';
      put('boot-' + bl, metal === 'zinc' ? 'zinc' : 'dull', i, x, y, zU, p.rb, p.foot, p.rb);
    } else {
      put('foot-' + lv, metal, i, x, y, zU, r, p.foot, r);
    }
    const yb = y + p.foot;
    if (p.mitre) {
      const { r: rr, h1, h2, s } = p.mitre;
      const ll = lod(2 * rr);
      put('body-' + ll, metal, i, x, yb, zU, rr, h1 + rr, rr);
      put('body-' + ll, metal, i, x, yb + h1, zU - rr, rr, s + 2 * rr, rr, QZ);
      put('body-' + ll, metal, i, x, yb + h1 - h2, zD, rr, h2 + rr, rr);
    } else if (p.shape === 'reedCone') {
      put('cone-' + lv, metal, i, x, yb, z, r, L, r);
    } else {
      put('body-' + lv, metal, i, x, yb, z, r, L, r);
    }
    if (p.shape === 'stopped' || p.capped) {
      const ch = 0.4 * Math.max(0.03, d);
      put('cap-' + lv, metal, i, x, yb + L - ch * 0.6, z, r * 1.08, ch, r * 1.08);
    }
    if (!reed && d >= 0.012) {
      const mw = 1.29 * r, mh = 0.3 * mw + 0.002;
      put('mouth', 'dark', i, x, yb + mh / 2, zU + r * 1.02 + 0.001, mw, mh, 1);
    }
  }

  // Level of detail and culling. Level 0 (camera < LOD_DIST[1] from the
  // pipework: console, choir, close-ups) is split into spatial groups
  // (LOD_GROUPS) so that, seen from the console, the high Great / Swell / Solo
  // chests are frustum-culled (about 2/3 of the interior triangles); levels 1, 2
  // are one InstancedMesh per bucket (from that far everything is in view).
  // Every level reads the same per-bucket matrix / glow arrays (the level-0
  // group meshes use subarray views of them), so glow writes reach all levels.
  const groupOf = (p) => LOD_GROUPS[p.chest] || 'rest';
  const GROUP_ORDER = [...new Set([...Object.values(LOD_GROUPS), 'rest'])];
  const meshes = [];            // level-0 meshes (api.interiorMeshes; glow / instance mapping)
  const glowAttrs = [];         // per level-0 mesh: every glow attribute viewing its data
  const perPipe = new Array(inventory.length).fill(0);
  const GEO_LOD = LOD_DIST.map((_, i) => unitGeometries(i));
  const levels = LOD_DIST.map(() => []);
  const share = (src, glow) => {     // geometry sharing src's vertex data, with its own glow attribute
    const g = new THREE.BufferGeometry();
    for (const [k, v] of Object.entries(src.attributes)) g.setAttribute(k, v);
    g.setIndex(src.index);
    g.boundingBox = src.boundingBox; g.boundingSphere = src.boundingSphere;
    g.setAttribute('aGlow', glow);
    return g;
  };
  const instanced = (geo, mat, matrices, name, owner) => {
    const m = new THREE.InstancedMesh(geo, mat, matrices.count);
    m.instanceMatrix = matrices;
    m.name = name;
    m.castShadow = false;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.computeBoundingBox();
    // sphere around the (tight) instance box: InstancedMesh.computeBoundingSphere
    // scales each unit geometry's sphere by the largest axis scale (the pipe
    // length), which would defeat frustum culling of the groups
    m.boundingSphere = m.boundingBox.getBoundingSphere(new THREE.Sphere());
    m.userData.owner = owner;
    return m;
  };
  for (const b of [...buckets.values()].sort((a, c) => (a.key < c.key ? -1 : 1))) {
    const n = b.owner.length;
    // instances ordered by group (stable)
    const ord = Array.from({ length: n }, (_, i) => i);
    const gi = b.owner.map((o) => GROUP_ORDER.indexOf(groupOf(inventory[o])));
    ord.sort((x, y) => gi[x] - gi[y] || x - y);
    const mat = new Float32Array(n * 16), owner = new Int32Array(n), glowArr = new Float32Array(n * 3);
    ord.forEach((src, i) => { mat.set(b.m.slice(src * 16, src * 16 + 16), i * 16); owner[i] = b.owner[src]; });
    const material = matFor(b.geo, b.mat);
    const base = GEO_LOD[0][b.geo]();
    base.computeBoundingBox(); base.computeBoundingSphere();
    const fullGlow = new THREE.InstancedBufferAttribute(glowArr, 3).setUsage(THREE.DynamicDrawUsage);
    const fullMatrices = new THREE.InstancedBufferAttribute(mat, 16);
    // level 0: one mesh per group
    let s0 = 0;
    for (let g = 0; g < GROUP_ORDER.length; g++) {
      let s1 = s0;
      while (s1 < n && gi[ord[s1]] === g) s1++;
      if (s1 === s0) continue;
      const glow = new THREE.InstancedBufferAttribute(glowArr.subarray(s0 * 3, s1 * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const m = instanced(share(base, glow), material, new THREE.InstancedBufferAttribute(mat.subarray(s0 * 16, s1 * 16), 16),
        'interior:' + b.key + '@' + GROUP_ORDER[g], owner.subarray(s0, s1));
      meshes.push(m);
      glowAttrs.push([glow, fullGlow]);
      levels[0].push(m);
      s0 = s1;
    }
    for (const o of b.owner) perPipe[o]++;
    // levels 1, 2: one mesh per bucket (fewer radial segments for round parts)
    for (let li = 1; li < LOD_DIST.length; li++) {
      const lg = GEO_LOD[li][b.geo] ? GEO_LOD[li][b.geo]() : base;
      if (lg !== base) { lg.computeBoundingBox(); lg.computeBoundingSphere(); }
      levels[li].push(instanced(share(lg, fullGlow), material, fullMatrices, `interiorLod${li}:` + b.key, owner));
    }
  }
  // Level-0 meshes of one group share one culling sphere around the group's
  // box: per-bucket spheres of wide, low parts (boots, feet: 12 m x 0.3 m)
  // would reach down into the console's view although their chest is out of it.
  {
    const gBox = new Map();
    for (const m of levels[0]) { const k = m.name.split('@')[1]; if (!gBox.has(k)) gBox.set(k, new THREE.Box3()); gBox.get(k).union(m.boundingBox); }
    for (const m of levels[0]) m.boundingSphere = gBox.get(m.name.split('@')[1]).getBoundingSphere(new THREE.Sphere());
  }
  // CSR: pipe -> instances
  const start = new Int32Array(inventory.length + 1);
  for (let i = 0; i < inventory.length; i++) start[i + 1] = start[i] + perPipe[i];
  const fill = start.slice(0, inventory.length);
  const IM = new Int32Array(start[inventory.length]), II = new Int32Array(start[inventory.length]);
  meshes.forEach((mesh, mi) => {
    const own = mesh.userData.owner;
    for (let k = 0; k < own.length; k++) { const p = own[k]; IM[fill[p]] = mi; II[fill[p]] = k; fill[p]++; }
  });

  const pipeGroup = new THREE.Group();
  pipeGroup.name = 'interiorPipes';
  const lodBox = new THREE.Box3();
  for (const m of levels[0]) lodBox.union(m.boundingBox);
  const pipeLOD = new BoxLOD(lodBox);
  pipeLOD.name = 'interiorPipesLOD';
  const lodGroups = levels.map((list, i) => {
    const lg = new THREE.Group();
    lg.name = i ? 'interiorPipesLod' + i : 'interiorPipesNear';
    lg.add(...list);
    lg.visible = i === 0;
    pipeLOD.addLevel(lg, LOD_DIST[i]);
    return lg;
  });
  pipeGroup.add(pipeLOD);
  for (const o of [pipeGroup, pipeLOD, ...lodGroups]) { o.matrixAutoUpdate = false; o.updateMatrix(); }
  group.add(pipeGroup);

  // ---------------- woodwork: chests, rack boards, swell boxes, shutters, ladders ----------------
  const struct = [], rack = [];
  const pipeBoxes = interior.map((p) => [p.x - p.a, p.y0, p.z - p.b, p.x + p.a, p.top, p.z + p.b]);
  const free = (x0, y0, z0, x1, y1, z1) =>
    !pipeBoxes.some((b) => b[0] < x1 && b[3] > x0 && b[1] < y1 && b[4] > y0 && b[2] < z1 && b[5] > z0);
  const sbox = (arr, x0, x1, y0, y1, z0, z1) => arr.push([(x0 + x1) / 2, y0, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)]);
  const shutters = [];      // { division, pedal, slats: [{x, y, z, len}] }
  // chest outline: rectangle minus the front notches (doorway, arch recesses)
  const outline = (c) => {
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
  };
  const RECESSES = CHESTS.recesses || [];
  const forbidden = (x0, y0, z0, x1, y1, z1) =>
    RECESSES.some((r) => x0 < r.x1 + 0.02 && x1 > r.x0 - 0.02 && y0 < r.y1 && y1 > r.y0 && z1 > r.z0 - 0.05 && z0 < r.z1) ||
    (x0 < DOOR.x1 && x1 > DOOR.x0 && z1 > DOOR.z0 && y0 < DOOR.y1);
  for (const c of CHESTS) {
    const yb = c.y - CHEST_T;
    const pieces = outline(c);
    for (const [xa, xb, zf] of pieces) {
      sbox(struct, xa, xb, yb, c.y, c.z0, zf);
      sbox(rack, xa, xb, c.y + 0.09, c.y + 0.11, c.z0, zf);
    }
    const frontAt = (x) => { for (const [xa, xb, zf] of pieces) if (x >= xa - 1e-9 && x <= xb + 1e-9) return zf; return c.z1; };
    // frame posts under raised chests (only where they clear the pipework below
    // and the arch recesses / doorway: front posts step back behind them);
    // chests at the side walls also get a bearer fixed to the case wall
    if (yb > 1) {
      for (const px of [c.x0 + 0.06, (c.x0 + c.x1) / 2, c.x1 - 0.06]) for (const front of [false, true]) {
        let ybot = 0.3;
        let pz = front ? frontAt(px) - 0.06 : c.z0 + 0.06;
        for (const r of RECESSES) {
          if (front && px + 0.05 > r.x0 - 0.02 && px - 0.05 < r.x1 + 0.02 && yb > r.y0) pz = Math.min(pz, r.z0 - RECESS_CLEAR - 0.06);
        }
        if (pz - 0.05 < c.z0) continue;
        for (const o of CHESTS) {
          if (o !== c && o.y < yb && px > o.x0 && px < o.x1 && pz > o.z0 && pz < o.z1) ybot = Math.max(ybot, o.y);
        }
        if (free(px - 0.05, ybot, pz - 0.05, px + 0.05, yb, pz + 0.05) && !forbidden(px - 0.05, ybot, pz - 0.05, px + 0.05, yb, pz + 0.05)) {
          sbox(struct, px - 0.05, px + 0.05, ybot, yb, pz - 0.05, pz + 0.05);
        }
      }
      for (const [xa, xb] of [[c.x0, c.x0], [c.x1, c.x1]]) {
        if (Math.abs(Math.abs(xa) - XW) < 1e-6) {
          const sgn = Math.sign(xa);
          sbox(struct, Math.min(xa, sgn * 9.98), Math.max(xb, sgn * 9.98), yb - 0.45, yb, c.z0, c.z1);
        }
      }
    }
    if (c.box) {
      const T = 0.08, y0 = yb, y1 = c.box.y1;
      sbox(struct, c.x0 - T, c.x1 + T, y0, y1, c.z0 - T, c.z0);                       // back wall
      sbox(struct, c.x0 - T, c.x0, y0, y1, c.z0 - T, c.z1 + 0.2);                      // side walls
      sbox(struct, c.x1, c.x1 + T, y0, y1, c.z0 - T, c.z1 + 0.2);
      sbox(struct, c.x0 - T, c.x1 + T, y1 - 0.08, y1, c.z1 + 0.06, c.z1 + 0.2);        // shutter head rail
      // shutter frame: panels <= 2.2 m with mullions
      const zs = c.z1 + 0.13;
      const W = c.x1 - c.x0;
      const np = Math.ceil(W / 2.2);
      const pw = W / np;
      for (let k = 1; k < np; k++) sbox(struct, c.x0 + k * pw - 0.03, c.x0 + k * pw + 0.03, y0, y1 - 0.08, zs - 0.04, zs + 0.04);
      const slats = [];
      const SH = 0.25;
      const ns = Math.floor((y1 - 0.08 - (c.y + 0.02)) / SH);
      for (let k = 0; k < np; k++) {
        for (let j = 0; j < ns; j++) {
          slats.push({ x: c.x0 + (k + 0.5) * pw, y: c.y + 0.02 + (j + 0.5) * SH, z: zs, len: pw - 0.07 });
        }
      }
      shutters.push({ chest: c.id, division: c.division, pedal: c.box.pedal, slats, open: 1, target: 1 });
    }
  }
  // tuba chest supports reach down to the pedal chest posts; ladders in the gaps between centre and ends
  for (const sx of [-1, 1]) {
    const xm = sx * 6.54;
    for (const zr of [-2.72, -2.38]) sbox(struct, xm - 0.025, xm + 0.025, 0.3, 15.1, zr - 0.025, zr + 0.025);
    for (let y = 0.6; y < 15; y += 0.3) sbox(struct, xm - 0.015, xm + 0.015, y, y + 0.03, -2.72, -2.38);
  }
  // walkway (passage boards) on top of the swell box walls and across the gap at the Great level
  sbox(struct, -XC, XC, 15.02, 15.07, ZB0, ZB1 + 0.28);
  sbox(struct, -XC, XC, 5.2, 5.25, -2.74, -2.38);

  const boxGeo = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const boxesMesh = (arr, mat, name) => {
    const m = new THREE.InstancedMesh(boxGeo(), mat, arr.length);
    m.name = name;
    arr.forEach(([x, y, z, sx, sy, sz], k) => m.setMatrixAt(k, tmpM.set(sx, 0, 0, x, 0, sy, 0, y, 0, 0, sz, z, 0, 0, 0, 1)));
    m.instanceMatrix.needsUpdate = true;
    m.receiveShadow = true;
    m.computeBoundingBox(); m.computeBoundingSphere();
    return m;
  };
  const structMesh = boxesMesh(struct, M.darkWoodPlain, 'chestsAndFrames');
  const rackMesh = boxesMesh(rack, M.oak, 'rackBoards');
  const nSlats = shutters.reduce((t, s) => t + s.slats.length, 0);
  const slatGeo = new THREE.BoxGeometry(1, 1, 1);
  const slatMesh = new THREE.InstancedMesh(slatGeo, M.darkWood, nSlats);
  slatMesh.name = 'swellShutters';
  slatMesh.receiveShadow = true;
  let sk = 0;
  for (const s of shutters) { s.offset = sk; sk += s.slats.length; }
  const QS = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0);
  const writeShutters = (s) => {
    QS.setFromAxisAngle(AX, s.open * 1.2);
    s.slats.forEach((sl, k) => {
      tmpM.compose(tmpP.set(sl.x, sl.y, sl.z), QS, tmpS.set(sl.len, 0.245, 0.03));
      slatMesh.setMatrixAt(s.offset + k, tmpM);
    });
    slatMesh.instanceMatrix.needsUpdate = true;
  };
  shutters.forEach(writeShutters);
  slatMesh.computeBoundingBox(); slatMesh.computeBoundingSphere();
  const wood = new THREE.Group();
  wood.name = 'interiorWoodwork';
  wood.add(structMesh, rackMesh, slatMesh);
  for (const o of [wood, structMesh, rackMesh, slatMesh]) { o.matrixAutoUpdate = false; o.updateMatrix(); }
  group.add(wood);

  return {
    inventory, facadeAssignment, chestStats, unplaced, meshes, glowAttrs, start, IM, II, shutters, writeShutters,
    structure: { struct, rack }, buildMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
export function buildPipes(ctx) {
  const { materials: M, LAYOUT, bus, updaters } = ctx;
  const group = new THREE.Group();
  group.name = 'pipes';

  const facade = new THREE.Group();
  facade.name = 'facadePipes';
  group.add(facade);

  const dark = new Builder();
  const pipes = [];           // facade pipe proxies (one per real pipe)
  const glowColor = new THREE.Color(GLOW_COLOR);
  // The facade is drawn as one merged mesh per section kind (cluster / arch:
  // they differ in roughness); a per-vertex pipe id indexes a small uniform
  // array carrying each pipe's emissive glow and registration tint. Each real
  // pipe keeps a proxy Mesh (name, userData, transform, geometry for bounds and
  // raycasts, its own material object whose colour/emissive mirror the state
  // as before) whose material is invisible, so it is never rendered.
  const facadeParts = { cluster: [], arch: [] };
  const facadeSlot = new Map();    // proxy -> [kind, index in the merged mesh]

  for (const sec of LAYOUT.sections || []) {
    if (sec.kind !== 'cluster' && sec.kind !== 'arch') continue;
    const items = layoutFacadeSection(sec, LAYOUT);
    items.forEach((it, index) => {
      const mat = M.pipeMetal.clone();          // per-pipe state (mirrored into the merged mesh's uniforms)
      mat.name = 'pipeMetal';
      mat.vertexColors = true;                  // lips slightly brighter
      mat.roughness = sec.kind === 'cluster' ? 0.26 : 0.2;   // plain silver-grey zinc / spotted tin
      mat.emissive.copy(glowColor);
      mat.emissiveIntensity = 0;
      mat.visible = false;                      // proxy: drawn by the merged facade mesh
      const mesh = new THREE.Mesh(undefined, mat);
      mesh.position.set(it.x, it.y0, it.z);
      mesh.rotation.y = it.rotY;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      dark.matrix = mesh.matrix;
      const full = buildFluePipe({
        r: it.r, len: it.foot + it.len, foot: it.foot,
        nb: it.r > 0.18 ? 18 : it.r > 0.1 ? 13 : 9,
      }, dark);
      const slot = facadeParts[sec.kind].length;
      facadeParts[sec.kind].push({ geo: full, matrix: mesh.matrix, mesh });
      // proxy geometry: positions, normals + index (bounds, raycasting)
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', full.attributes.position);
      pg.setAttribute('normal', full.attributes.normal);
      pg.setIndex(full.index);
      pg.boundingBox = full.boundingBox.clone();
      pg.boundingSphere = full.boundingSphere.clone();
      mesh.geometry = pg;
      facadeSlot.set(mesh, [sec.kind, slot]);
      mesh.name = `pipe:${sec.id}:${index}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = {
        facadePipe: true, section: sec.id, kind: sec.kind, index,
        rankStopId: sec.rank, noteIndex: it.note, pitchFt: sec.pitchFt,
        length: it.len, radius: it.r, footHeight: it.foot,
        toeY: it.y0, mouthY: it.y0 + it.foot, topY: it.y0 + it.foot + it.len, held: 0, glow: 0,
      };
      facade.add(mesh);
      pipes.push(mesh);
    });
  }

  const darkMesh = new THREE.Mesh(dark.finish(), M.pipeDark);
  darkMesh.name = 'pipeMouthsAndTops';
  facade.add(darkMesh);
  const facadeMerged = {};       // kind -> { mesh, state: Vector4[] (rgb = emissive radiance, w = colour factor) }
  for (const [kind, parts] of Object.entries(facadeParts)) {
    if (!parts.length) continue;
    const mesh = new THREE.Mesh(mergeFacade(parts), facadeMaterial(parts[0].mesh.material, parts.length, kind));
    mesh.name = 'facadePipes:' + kind;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    facade.add(mesh);
    facadeMerged[kind] = { mesh, state: mesh.material.userData.state };
  }
  for (const o of [facade, ...facade.children]) { o.matrixAutoUpdate = false; o.updateMatrix(); }

  const CHESTS = chestsFor(LAYOUT);
  const I = buildInterior(group, ctx, pipes, CHESTS);
  const INV = I.inventory;
  const N = INV.length;

  // ---------------- lookup tables ----------------
  const noteKey = (rankKey, n) => rankKey + '@' + n;
  const byNote = new Map();       // "rankStop@note" -> [pipe index] (all ranks)
  const byRank = new Map();       // rankStop -> [pipe index]
  const byOwner = new Map();      // owner stop -> [pipe index]
  const rankRange = new Map();    // rankStop -> [min, max] note
  for (const p of INV) {
    const k = noteKey(p.rankKey, p.noteIndex);
    if (!byNote.has(k)) byNote.set(k, []);
    byNote.get(k).push(p.index);
    if (!byRank.has(p.rankKey)) byRank.set(p.rankKey, []);
    byRank.get(p.rankKey).push(p.index);
    if (!byOwner.has(p.stopId)) byOwner.set(p.stopId, []);
    byOwner.get(p.stopId).push(p.index);
    const rr = rankRange.get(p.rankKey) || [Infinity, -Infinity];
    rr[0] = Math.min(rr[0], p.noteIndex); rr[1] = Math.max(rr[1], p.noteIndex);
    rankRange.set(p.rankKey, rr);
  }
  const facadeOf = new Map();     // pipe index -> mesh
  for (const p of INV) if (p.facade) facadeOf.set(p.index, p.mesh);
  for (const m of pipes) m.userData.baseColor = m.material.color.clone();

  // Resolve a pipe event to (source rank, key index within the source compass, rank).
  // Internal index = key offset of the source stop (0 = its own bottom C,
  // downward extensions negative, upward ones >= compass). The interaction
  // module sends noteIndex counted from the rank's LOWEST pipe including
  // downward extensions, so the rank base (-12 for Open Wood II, Open
  // Diapason II, Ophicleide, Trombone; 0 otherwise) is added back. When the
  // payload's key "<stopId>#<rank>@<sourceKey>" parses, it is used directly
  // (sourceKey - 36). A derived stopId (not sent by interaction.js) is resolved
  // here; its noteIndex/midi is then read as the derived stop's own key.
  const KEY_RE = /^(.+)#(\d+)@(-?\d+)$/;
  function resolveNote(e) {
    const s = stopById(e.stopId);
    if (!s) return { rankKey: null };
    const rank = Number.isInteger(e.rank) ? e.rank : null;
    if (!s.derived) {
      const m = typeof e.key === 'string' ? KEY_RE.exec(e.key) : null;
      if (m && m[1] === s.id) return { rankKey: s.id, idx: Number(m[3]) - 36, rank: Number(m[2]) };
      const base = Math.min(0, rankRange.get(s.id)?.[0] ?? 0);
      if (Number.isFinite(e.noteIndex)) return { rankKey: s.id, idx: Math.round(e.noteIndex) + base, rank };
      if (Number.isFinite(e.midi)) return { rankKey: s.id, idx: Math.round(e.midi) - 36, rank };
      return { rankKey: null };
    }
    const src = resolveSource(s);
    if (!src) return { rankKey: null };
    const n = Number.isFinite(e.noteIndex) ? Math.round(e.noteIndex) : Number.isFinite(e.midi) ? Math.round(e.midi) - 36 : null;
    if (n === null) return { rankKey: null };
    return { rankKey: src.stop.id, idx: n + src.semitones, rank };
  }
  const pipesForEvent = (r) => {
    const list = pipesForNote(r.rankKey, r.idx);
    return r.rank === null || r.rank === undefined ? list : list.filter((p) => INV[p].rank === r.rank);
  };
  function pipesForNote(rankKey, idx) {
    const hit = byNote.get(noteKey(rankKey, idx));
    if (hit) return hit;
    const rr = rankRange.get(rankKey);
    if (rr && idx < rr[0]) {
      // resultant (Acoustic Bass 64'): octave + fifth of the 32' sound together
      const a = byNote.get(noteKey(rankKey, idx + 12)) || [];
      const b = byNote.get(noteKey(rankKey, idx + 19)) || [];
      return a.concat(b);
    }
    return [];
  }
  // pipes a stop plays across its compass (own pipes for real stops)
  function soundingPipes(stopId) {
    const s = stopById(stopId);
    if (!s) return [];
    if (!s.derived) return byOwner.get(stopId) || [];
    const src = resolveSource(s);
    if (!src) return [];
    const out = [];
    const c = COMPASS[s.division];
    for (let k = 0; k < c; k++) out.push(...pipesForNote(src.stop.id, k + src.semitones));
    return [...new Set(out)];
  }

  // ---------------- per-pipe animation state ----------------
  const held = new Int32Array(N), legacy = new Int32Array(N);
  const gCur = new Float32Array(N), tCur = new Float32Array(N), hCur = new Float32Array(N);
  const tTgt = new Uint8Array(N), hTgt = new Uint8Array(N);
  const active = new Set();
  const dirty = new Set();
  let pipeonSeen = false;
  const glowArrays = I.meshes.map((m) => m.geometry.attributes.aGlow.array);
  const ease = (g) => g * g * (3 - 2 * g);

  function writePipe(p) {
    const mesh = facadeOf.get(p);
    if (mesh) {
      const g = gCur[p], h = hCur[p], t = tCur[p];
      const mat = mesh.material;
      const eg = GLOW_MAX * ease(g);
      mat.emissiveIntensity = eg + 0.6 * h;
      if (h > 0) mat.emissive.copy(glowColor).lerp(glowUniforms.uHiColor.value, (0.6 * h) / (eg + 0.6 * h));
      else mat.emissive.copy(glowColor);
      mat.color.copy(mesh.userData.baseColor).multiplyScalar(1 + 0.18 * t);
      mesh.userData.glow = g;
      const [kind, slot] = facadeSlot.get(mesh);
      facadeMerged[kind].state[slot].set(mat.emissive.r * mat.emissiveIntensity, mat.emissive.g * mat.emissiveIntensity,
        mat.emissive.b * mat.emissiveIntensity, 1 + 0.18 * t);
      return;
    }
    const e = ease(gCur[p]);
    for (let k = I.start[p]; k < I.start[p + 1]; k++) {
      const a = glowArrays[I.IM[k]], j = I.II[k] * 3;
      a[j] = e; a[j + 1] = tCur[p]; a[j + 2] = hCur[p];
      dirty.add(I.IM[k]);
    }
  }
  const touch = (p) => active.add(p);

  // ---------------- legacy facade mapping (noteon fallback) ----------------
  // Pedal keys light the cluster pipes (keys C..B: the 32' octave of the
  // Double Open Diapason, which stands in the facade); manual keys light the
  // Open Diapason 1 / 2 trebles in the arches that play that key; keys whose
  // pipes are not in the facade fall back to a size-proportional pipe.
  const bySize = (a, b) =>
    b.userData.length - a.userData.length ||
    Math.abs(b.position.x) - Math.abs(a.position.x) ||
    a.position.x - b.position.x ||
    b.position.z - a.position.z;
  const clusterSorted = pipes.filter((p) => p.userData.kind === 'cluster').sort(bySize);
  const archSorted = pipes.filter((p) => p.userData.kind === 'arch').sort(bySize);
  const pedalPool = clusterSorted.length ? clusterSorted : [...pipes].sort(bySize);
  const manualPool = archSorted.length ? archSorted : [...pipes].sort(bySize);
  const meshToPipe = new Map();
  for (const [pi, m] of facadeOf) meshToPipe.set(m, pi);

  function noteToPipes(midi, manual = 1) {
    if (!Number.isFinite(midi)) return [];
    if (manual === 4) {
      const k = THREE.MathUtils.clamp(Math.round(midi), 36, 67) - 36;        // 32 pedal keys
      const hit = pedalPool.filter((m) => m.userData.noteIndex === k - 12);
      if (hit.length) return hit;
      return [pedalPool[Math.min(pedalPool.length - 1, Math.floor((k * pedalPool.length) / 32))]];
    }
    const k = THREE.MathUtils.clamp(Math.round(midi), 36, 96) - 36;          // 61 manual keys
    const hit = manualPool.filter((m) => m.userData.noteIndex === k);
    if (hit.length) return hit;
    return [manualPool[Math.min(manualPool.length - 1, Math.floor((k * manualPool.length) / 61))]];
  }

  const heldNotes = new Map(); // "manual:midi" -> facade meshes
  const keyOf = (e) => `${e.manual ?? 1}:${e.midi}`;
  function noteOn(e) {
    if (!e || pipeonSeen) return;
    const key = keyOf(e);
    if (heldNotes.has(key)) return;
    const targets = noteToPipes(e.midi, e.manual ?? 1);
    heldNotes.set(key, targets);
    for (const m of targets) { const p = meshToPipe.get(m); legacy[p]++; m.userData.held = legacy[p]; touch(p); }
  }
  function noteOff(e) {
    if (!e) return;
    const key = keyOf(e);
    const targets = heldNotes.get(key);
    if (!targets) return;
    heldNotes.delete(key);
    for (const m of targets) { const p = meshToPipe.get(m); legacy[p] = Math.max(0, legacy[p] - 1); m.userData.held = legacy[p]; touch(p); }
  }

  // ---------------- pipeon / pipeoff ----------------
  const soundRefs = new Map();  // "rankStop@idx#rank" -> count
  const refKey = (r) => noteKey(r.rankKey, r.idx) + '#' + (r.rank ?? '*');
  function pipeOn(e) {
    if (!e) return [];
    if (!pipeonSeen) {
      pipeonSeen = true;
      heldNotes.clear();
      for (const p of facadeOf.keys()) if (legacy[p]) { legacy[p] = 0; touch(p); }
    }
    const r = resolveNote(e);
    if (!r.rankKey || !Number.isFinite(r.idx)) return [];
    const k = refKey(r);
    const c = (soundRefs.get(k) || 0) + 1;
    soundRefs.set(k, c);
    const list = pipesForEvent(r);
    if (c === 1) for (const p of list) { held[p]++; touch(p); }
    return list;
  }
  function pipeOff(e) {
    if (!e) return [];
    const r = resolveNote(e);
    if (!r.rankKey || !Number.isFinite(r.idx)) return [];
    const k = refKey(r);
    const c = soundRefs.get(k) || 0;
    if (!c) return [];
    const list = pipesForEvent(r);
    if (c === 1) { soundRefs.delete(k); for (const p of list) { held[p] = Math.max(0, held[p] - 1); touch(p); } }
    else soundRefs.set(k, c - 1);
    return list;
  }
  function allOff() {
    heldNotes.clear();
    soundRefs.clear();
    for (let p = 0; p < N; p++) if (held[p] || legacy[p] || gCur[p]) { held[p] = 0; legacy[p] = 0; touch(p); }
    for (const m of pipes) m.userData.held = 0;
  }

  // ---------------- registration tint ----------------
  const drawn = new Set();
  function setStop(e) {
    if (!e || !e.id) return;
    const s = stopById(e.id);
    if (!s) return;
    if (e.on) drawn.add(e.id); else drawn.delete(e.id);
    const src = resolveSource(s);
    if (!src) return;
    const rk = src.stop.id;
    const on = [...drawn].some((id) => { const r = resolveSource(id); return r && r.stop.id === rk; }) ? 1 : 0;
    for (const p of byRank.get(rk) || []) if (tTgt[p] !== on) { tTgt[p] = on; touch(p); }
  }

  // ---------------- hover highlight ----------------
  let hiList = [];
  function highlightStop(stopId) {
    for (const p of hiList) { hTgt[p] = 0; touch(p); }
    hiList = stopId ? soundingPipes(stopId) : [];
    for (const p of hiList) { hTgt[p] = 1; touch(p); }
    return hiList.length;
  }

  // ---------------- swell shutters ----------------
  const pedalDivision = new Map(ACCESSORIES.filter((a) => a.kind === 'swell-pedal').map((a) => [a.id, a.division]));
  const animShutters = new Set();
  function setSwell(e) {
    if (!e) return;
    const div = pedalDivision.get(e.id) || e.id || e.division;
    let v = Number(e.value);
    if (!Number.isFinite(v)) return;
    if (v > 1) v /= 127;
    v = THREE.MathUtils.clamp(v, 0, 1);
    for (const s of I.shutters) if (s.division === div || s.pedal === e.id) { s.target = v; animShutters.add(s); }
  }

  bus?.on('noteon', noteOn);
  bus?.on('noteoff', noteOff);
  bus?.on('allnotesoff', allOff);
  bus?.on('pipeon', pipeOn);
  bus?.on('pipeoff', pipeOff);
  bus?.on('stop', setStop);
  bus?.on('swell', setSwell);

  updaters?.push((t, dt) => {
    const step = Math.max(dt || 0, 0);
    if (active.size) {
      const done = [];
      for (const p of active) {
        const gt = (pipeonSeen ? held[p] : legacy[p] + held[p]) > 0 ? 1 : 0;
        let g = gCur[p];
        if (g < gt) g = Math.min(gt, g + step / FADE_IN); else if (g > gt) g = Math.max(gt, g - step / FADE_OUT);
        gCur[p] = g;
        const tt = tTgt[p];
        let tv = tCur[p];
        if (tv < tt) tv = Math.min(tt, tv + step / 0.25); else if (tv > tt) tv = Math.max(tt, tv - step / 0.4);
        tCur[p] = tv;
        const ht = hTgt[p];
        let hv = hCur[p];
        if (hv < ht) hv = Math.min(ht, hv + step / 0.12); else if (hv > ht) hv = Math.max(ht, hv - step / 0.25);
        hCur[p] = hv;
        writePipe(p);
        if (g === gt && tv === tt && hv === ht) done.push(p);
      }
      for (const p of done) active.delete(p);
      for (const mi of dirty) for (const a of I.glowAttrs[mi]) a.needsUpdate = true;
      dirty.clear();
    }
    if (animShutters.size) {
      for (const s of [...animShutters]) {
        const d = s.target - s.open;
        s.open = Math.abs(d) < 1e-3 ? s.target : s.open + Math.sign(d) * Math.min(Math.abs(d), step * 1.5);
        I.writeShutters(s);
        if (s.open === s.target) animShutters.delete(s);
      }
    }
  });

  // ---------------- API ----------------
  const perStop = new Map(), perDivision = new Map();
  for (const p of INV) {
    perStop.set(p.stopId, (perStop.get(p.stopId) || 0) + 1);
    perDivision.set(p.division, (perDivision.get(p.division) || 0) + 1);
  }
  const localPos = (p) => {
    if (p.facade) return new THREE.Vector3(p.mesh.position.x, p.y0 + p.foot + p.mesh.userData.length / 2, p.mesh.position.z);
    return new THREE.Vector3(p.x, p.y0 + p.foot + Math.min(p.length, p.top - p.y0 - p.foot) / 2, p.z);
  };
  function pipeInfo(list) {
    group.updateWorldMatrix(true, false);
    return list.map((pi) => {
      const p = INV[pi];
      return {
        position: localPos(p).applyMatrix4(group.matrixWorld), length: p.length, noteIndex: p.noteIndex,
        rank: p.rank, stopId: p.stopId, rankStopId: p.rankKey, facade: p.facade, diameter: p.diameter, index: pi,
      };
    });
  }
  function pipesOf(stopId) { return pipeInfo(byOwner.has(stopId) ? byOwner.get(stopId) : soundingPipes(stopId)); }

  // division bounds (local -> world at call time is identity unless the group moves; computed in local space)
  const divBoundsLocal = new Map();
  const grow = (div, x0, y0, z0, x1, y1, z1) => {
    if (!divBoundsLocal.has(div)) divBoundsLocal.set(div, new THREE.Box3());
    divBoundsLocal.get(div).union(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
  };
  const chestById = new Map(CHESTS.map((c) => [c.id, c]));
  for (const c of CHESTS) for (const d of [c.division, ...(c.alsoBounds || [])]) grow(d, c.x0, c.y - CHEST_T, c.z0, c.x1, c.box ? c.box.y1 : c.y + 0.5, c.z1);
  for (const p of INV) {
    if (p.facade) continue;
    const ch = chestById.get(p.chest);
    for (const d of [ch.division, ...(ch.alsoBounds || [])]) grow(d, p.x - p.a, p.y0, p.z - p.b, p.x + p.a, p.top, p.z + p.b);
  }
  const fb = new THREE.Box3();
  for (const m of pipes) fb.expandByObject(m);
  divBoundsLocal.set('facade', fb);
  const divisionBounds = new Map();
  const refreshBounds = () => {
    group.updateWorldMatrix(true, false);
    for (const [k, b] of divBoundsLocal) divisionBounds.set(k, b.clone().applyMatrix4(group.matrixWorld));
    return divisionBounds;
  };
  refreshBounds();

  let draws = 0, tris = 0;   // as drawn with the near level of detail (proxies are not drawn)
  group.traverseVisible((o) => {
    if (!o.isMesh || !o.material.visible) return;
    draws++;
    const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
  });

  group.userData.api = {
    // inventory
    inventory: { total: N, perStop, perDivision, facade: I.facadeAssignment.length, interior: N - I.facadeAssignment.length },
    pipes: INV, facadeAssignment: I.facadeAssignment, chests: I.chestStats,
    pipesOf, soundingPipes: (id) => pipeInfo(soundingPipes(id)),
    divisionBounds, refreshBounds,
    highlightStop,
    // note glow
    noteToPipes, facadePipes: pipes, noteOn, noteOff, allOff, pipeOn, pipeOff, setStop, setSwell,
    interiorMeshes: I.meshes, shutters: I.shutters,
    stats: { drawCalls: draws, triangles: tris, buildMs: I.buildMs, unplaced: I.unplaced.length },
  };
  return group;
}
