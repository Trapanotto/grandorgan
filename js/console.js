// Royal Albert Hall organ — the console (Spieltisch).
// Four terraced manuals (61 keys each), a concave radiating 32-note
// pedalboard, two tall terraced 45-degree stop jambs carrying every drawknob
// of the real specification (147 stops, 23 couplers, 3 tremulants, generated
// from stoplist.js), thumb pistons in the key slips, brass toe pistons, three
// balanced expression pedals, music desk, lamp, bench. Every control is an
// individually pickable Mesh (see the contract in buildConsole); it is drawn
// through a few InstancedMeshes (one per shape x material), the pickable Mesh
// itself being an invisible-material proxy. Local frame:
// origin on the gallery floor, organist faces -Z, bench on +Z. Units: metres.
import * as THREE from 'three';
import { STOPS, DIVISIONS, COUPLERS, ACCESSORIES } from './stoplist.js';

// ------------------------------------------------------------------ constants
const OCTAVE = 0.164;
const NAT_W = OCTAVE / 7;                 // 23.43 mm natural pitch
const KEYS_W = 36 * NAT_W;                // 61 notes = 36 naturals
const KEY_L = 0.21;                       // pivot -> key front
const HEAD_L = 0.042;                     // natural head (in front of sharps)
const SHARP_L = 0.084;
const SHARP_W = 0.011;
const MAN_Y0 = 0.78;                      // top of Choir naturals
const MAN_DY = 0.065;
const MAN_Z0 = 0.20;                      // front edge of Choir naturals
const MAN_DZ = 0.11;
const KEY_DIP = 0.043;                    // rad (~9 mm at the key front)
const CHEEK_IN = KEYS_W / 2 + 0.0015;
const CHEEK_OUT = 0.47;
const TABLE_Y = 0.735;

// stop jambs: two terraces per jamb, the upper one stepped back by TERRACE
const JAMB_INNER_Z = -0.33;
const JAMB_W = 0.80;                      // along the 45-degree face
const JAMB_TOP = 1.78;
const FRONT_Z = 0.25;                     // front edge of the side panels / top
const SIDE_IN = 1.045;
const SIDE_OUT = 1.09;
const TERRACE = 0.045;
const STOP_TRAVEL = 0.018;
const ROWS = 7;                           // drawknob rows per terrace
const ROW_P = 0.05;
const COL_P = 0.075;
const GROUP_GAP = 0.035;
const KNOB_R = 0.0185;                    // head radius
const LOWER_TOP = 0.86 + KNOB_R + (ROWS - 1) * ROW_P + ROW_P / 2;   // top row centre, lower terrace
const LEDGE_Y = LOWER_TOP + 0.08;
const UPPER_TOP = LEDGE_Y + 0.025 + KNOB_R + (ROWS - 1) * ROW_P + ROW_P / 2;
const TIER_U = [[0.05, 0.775], [0.05, 0.745]];                      // usable u-range of knob centres

const PISTON_TRAVEL = 0.004;
const PISTON_TIME = 0.12;

const PED_R = 2.59;                       // radiation + concavity radius
const PED_PZ = -0.03 + PED_R;             // convergence point (behind the player)
const PED_HEEL = PED_R - 0.45;            // radius of the heel pivots
const PED_DA = 0.0635 / PED_R;            // angle between adjacent naturals
const PED_Y0 = 0.10;                      // top of the middle pedal naturals
const PED_DIP = 0.022;

const SWELL_X = [-0.075, 0.04, 0.155];    // Orchestral, Swell, Solo shoes
const SWELL_PIVOT = [0.305, -0.21];       // y, z
const SWELL_CLOSED = 0.70;                // shoe tilt (rad) at value 0 (toe up)
const SWELL_OPEN = 0.18;                  // at value 1 (toe down)

const SQ = Math.SQRT1_2;

// -------------------------------------------------------------------- helpers
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
function TM(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
  _q.setFromEuler(_e.set(rx, ry, rz, order));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _one);
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Box-projected UVs in metres so the wood grain keeps a constant scale.
function triUV(geo, scale = 2, grainZ = false) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) {
      if (grainZ) { u = p.getX(i); v = p.getZ(i); } else { u = p.getZ(i); v = p.getX(i); }
    } else if (ax >= az) {
      if (grainZ) { u = p.getY(i); v = p.getZ(i); } else { u = p.getZ(i); v = p.getY(i); }
    } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Merge non-indexed geometries (position/normal/uv); optional material groups.
function mergeGeos(list, groups = false) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const out = new THREE.BufferGeometry();
  let o = 0;
  list.forEach((g, i) => {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (groups) out.addGroup(o, c, i);
    o += c;
  });
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// Stack of axis-aligned rectangles ("rings", bottom to top) lofted into a
// flat-shaded solid. ring = [x0, x1, y, z0, z1]. Used for keys (cheap bevels).
function loft(...parts) {
  const P = [];
  const tri = (a, b, c) => P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (const rings of parts) {
    const C = rings.map(([x0, x1, y, z0, z1]) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]);
    const b = C[0], t = C[C.length - 1];
    tri(b[0], b[1], b[2]); tri(b[0], b[2], b[3]);
    tri(t[0], t[3], t[2]); tri(t[0], t[2], t[1]);
    for (let r = 0; r < C.length - 1; r++) {
      const lo = C[r], hi = C[r + 1];
      for (let j = 0; j < 4; j++) {
        const k = (j + 1) % 4;
        tri(lo[j], hi[k], lo[k]); tri(lo[j], hi[j], hi[k]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(P.length / 3 * 2), 2));
  return g;
}

// Accumulates transformed geometry so each material ends up as ONE mesh.
class Builder {
  constructor(tri = false) { this.tri = tri; this.list = []; }
  add(geom, m) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (m) g.applyMatrix4(m);
    if (this.tri) triUV(g);
    this.list.push(g);
    if (geom !== g) geom.dispose();
    return this;
  }
  box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), TM(x, y, z, rx, ry, rz));
  }
  mm(x0, x1, y0, y1, z0, z1) {
    return this.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  mesh(material, name) {
    if (!this.list.length) return null;
    const geo = mergeGeos(this.list);
    this.list.forEach((g) => g.dispose());
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

// ------------------------------------------------------------------- textures
function scoreTexture() {
  return canvasTex(1024, 704, (g, W, H) => {
    const r = rng(1871);
    g.fillStyle = '#f6f1e2'; g.fillRect(0, 0, W, H);
    const grad = g.createLinearGradient(W / 2 - 40, 0, W / 2 + 40, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(60,40,20,0.28)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(W / 2 - 40, 0, 80, H);
    g.strokeStyle = g.fillStyle = '#1b1814';
    for (let page = 0; page < 2; page++) {
      const x0 = page * 512 + 44, x1 = page * 512 + 468;
      let y = 54;
      if (page === 0) {
        g.font = 'italic 26px Georgia, serif'; g.textAlign = 'center';
        g.fillText('Toccata', (x0 + x1) / 2, 46);
        g.font = '11px Georgia, serif'; g.fillText('Allegro maestoso', x0 + 60, 70);
        y = 84;
      }
      // organ systems: three staves (two manual staves + pedal), braced
      for (let sys = 0; y + 150 < H - 20; sys++, y += 172) {
        g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0, y + 136); g.stroke();
        for (let st = 0; st < 3; st++) {
          const sy = y + st * 52;
          g.lineWidth = 1;
          for (let l = 0; l < 5; l++) { g.beginPath(); g.moveTo(x0, sy + l * 8); g.lineTo(x1, sy + l * 8); g.stroke(); }
          // clef squiggle
          g.lineWidth = 2; g.beginPath();
          if (st === 0) { g.moveTo(x0 + 12, sy + 40); g.bezierCurveTo(x0 + 24, sy - 20, x0 - 2, sy + 4, x0 + 12, sy + 26); g.arc(x0 + 12, sy + 22, 6, 1.2, 6.5); }
          else { g.arc(x0 + 12, sy + 12, 8, -2.6, 1.2); g.moveTo(x0 + 24, sy + 6); g.arc(x0 + 24, sy + 6, 1, 0, 7); g.moveTo(x0 + 24, sy + 14); g.arc(x0 + 24, sy + 14, 1, 0, 7); }
          g.stroke();
          // bars and notes (random walk)
          g.lineWidth = 1;
          const bars = 3;
          const bw = (x1 - x0 - 34) / bars;
          let pitch = 4 + Math.floor(r() * 4);
          for (let b = 0; b < bars; b++) {
            const bx = x0 + 34 + b * bw;
            g.beginPath(); g.moveTo(bx + bw, sy); g.lineTo(bx + bw, sy + 32); g.stroke();
            const n = st === 2 ? 2 + Math.floor(r() * 3) : (r() < 0.5 ? 8 : 4);
            const pts = [];
            for (let i = 0; i < n; i++) {
              pitch = Math.max(-2, Math.min(11, pitch + Math.round((r() - 0.5) * 5)));
              const nx = bx + 10 + (i + 0.3) * (bw - 14) / n, ny = sy + 36 - pitch * 4;
              g.beginPath(); g.ellipse(nx, ny, 4.6, 3.3, -0.35, 0, Math.PI * 2);
              if (st === 2 && n === 2) { g.lineWidth = 1.6; g.stroke(); g.lineWidth = 1; } else g.fill();
              const up = pitch < 5;
              const sx = nx + (up ? 4.2 : -4.2), se = ny + (up ? -26 : 26);
              g.beginPath(); g.moveTo(sx, ny); g.lineTo(sx, se); g.stroke();
              if (pitch <= -1 || pitch >= 11) { g.beginPath(); g.moveTo(nx - 8, ny); g.lineTo(nx + 8, ny); g.stroke(); }
              pts.push([sx, se, up]);
            }
            if (n >= 4) { // beam groups of four
              g.lineWidth = 3.4;
              for (let i = 0; i + 3 < pts.length; i += 4) {
                const a = pts[i], c = pts[i + 3];
                if (a[2] !== c[2]) continue;
                g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke();
                if (n === 8) { const o = a[2] ? 6 : -6; g.beginPath(); g.moveTo(a[0], a[1] + o); g.lineTo(c[0], c[1] + o); g.stroke(); }
              }
              g.lineWidth = 1;
            }
          }
        }
      }
      g.font = '11px Georgia, serif'; g.textAlign = 'center';
      g.fillText(String(12 + page), page === 0 ? x0 + 6 : x1 - 6, H - 14);
    }
  });
}

// --------------------------------------------------------- engraving atlas
// One 2048² canvas holds every engraved face: 128 px cells for drawknobs
// (rows 0-10), 128 px solid colour patches (row 11), 64 px cells for pistons/tablets
// (y 1536-1791) and 512×64 department plates (y 1792-2047). Each control mesh
// gets its own UV attribute (positions/normals are shared) pointing into it.
const ATLAS = 2048;
const PATCH = { ebony: 0, rosewood: 1, ivory: 2, brass: 3, dark: 4, red: 5, black: 6 };
const PATCH_COLOR = ['#141211', '#3b1f14', '#f2ecd9', '#b08d4a', '#24201c', '#7c1712', '#0b0a09'];

class Atlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ATLAS;
    this.g = this.canvas.getContext('2d');
    this.g.fillStyle = '#f2ecd9'; this.g.fillRect(0, 0, ATLAS, ATLAS);
    PATCH_COLOR.forEach((c, i) => { this.g.fillStyle = c; this.g.fillRect(i * 128, 1408, 128, 128); });
    this.nKnob = 0; this.nSmall = 0; this.nPlate = 0;
  }
  // rect [x, y, w, h] (canvas px, y down) -> uv rect {u0, u1, v0 (bottom), v1 (top)}
  uv([x, y, w, h], inset = 0) {
    return { u0: (x + inset) / ATLAS, u1: (x + w - inset) / ATLAS, v0: 1 - (y + h - inset) / ATLAS, v1: 1 - (y + inset) / ATLAS };
  }
  patch(name) {
    const i = PATCH[name];
    return [(i * 128 + 64) / ATLAS, 1 - (1408 + 64) / ATLAS];
  }
  knobCell() {
    const i = this.nKnob++;
    if (i >= 176) throw new Error('atlas: too many drawknobs');
    return [(i % 16) * 128, Math.floor(i / 16) * 128, 128, 128];
  }
  smallCell() {
    const i = this.nSmall++;
    if (i >= 128) throw new Error('atlas: too many pistons');
    return [(i % 32) * 64, 1536 + Math.floor(i / 32) * 64, 64, 64];
  }
  plateCell() {
    const i = this.nPlate++;
    if (i >= 16) throw new Error('atlas: too many plates');
    return [(i % 4) * 512, 1792 + Math.floor(i / 4) * 64, 512, 64];
  }
  texture() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.name = 'consoleEngravings';
    return t;
  }
}

const FRACTIONS = { '1/3': '⅓', '2/3': '⅔', '3/5': '⅗', '1/2': '½' };
function pitchText(p) {
  if (!p) return '';
  const s = String(p).replace(/(\d+)?\s*(\d\/\d)/, (m, a, f) => (a || '') + (FRACTIONS[f] || ' ' + f));
  return /^\d/.test(s) ? s + '′' : s;
}

function wrapLines(g, text, maxW, size, weight = 'bold') {
  g.font = `${weight} ${size}px Georgia, serif`;
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && g.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Fits `text` into at most `maxLines` lines of width maxW, shrinking the font.
function fitLines(g, text, maxW, maxLines, size, minSize, weight = 'bold') {
  let lines;
  for (; size >= minSize; size--) {
    lines = wrapLines(g, text, maxW, size, weight);
    if (lines.length <= maxLines && lines.every((l) => g.measureText(l).width <= maxW)) break;
  }
  size = Math.max(size, minSize);
  lines = wrapLines(g, text, maxW, size, weight);
  return { lines, size };
}

function fillTextFit(g, s, x, y, maxW) {
  const w = g.measureText(s).width;
  if (w > maxW && w > 0) {
    g.save(); g.translate(x, y); g.scale(maxW / w, 1); g.fillText(s, 0, 0); g.restore();
  } else g.fillText(s, x, y);
}

// Drawknob face: name, pitch, console number. kind: 'stop' | 'reed' | 'coupler' | 'tremulant'
function drawKnobFace(g, [x, y], { name, pitch, num, kind }) {
  const cx = x + 64, cy = y + 64;
  const face = kind === 'coupler' ? '#d3dce3' : '#f2ecd9';
  const ink = kind === 'reed' ? '#9b1810' : kind === 'coupler' ? '#14263a' : '#16120e';
  g.fillStyle = face; g.fillRect(x, y, 128, 128);
  g.strokeStyle = kind === 'coupler' ? 'rgba(20,38,58,0.5)' : 'rgba(70,50,30,0.5)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, 55, 0, Math.PI * 2); g.stroke();
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  const p = pitchText(pitch);
  const { lines, size } = kind === 'coupler'
    ? fitLines(g, name, 86, 4, 15, 9)
    : fitLines(g, name, 84, p ? 3 : 4, 17, 10);
  const lh = size + 2;
  const pitchH = p ? 28 : 0;
  let ty = cy - 5 - (lines.length * lh + pitchH) / 2 + lh / 2;
  g.font = `bold ${size}px Georgia, serif`;
  for (const l of lines) { fillTextFit(g, l, cx, ty, 90); ty += lh; }
  if (p) {
    g.font = `bold ${p.length > 4 ? 20 : 25}px Georgia, serif`;
    fillTextFit(g, p, cx, ty + pitchH / 2 - lh / 2 + 3, 80);
  }
  if (num != null && num !== '') {
    g.font = '11px Georgia, serif';
    g.fillText(String(num), cx, cy + 45);
  }
}

// Piston / tablet face (64 px cell). style: { bg, ink, ring }
function drawSmallFace(g, [x, y], text, { bg = '#f2ecd9', ink = '#16120e', ring = 'rgba(70,50,30,0.45)', square = false } = {}) {
  const cx = x + 32, cy = y + 32;
  g.fillStyle = bg; g.fillRect(x, y, 64, 64);
  if (ring) {
    g.strokeStyle = ring; g.lineWidth = 2;
    g.beginPath();
    if (square) g.rect(x + 5, y + 5, 54, 54); else g.arc(cx, cy, 27, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  const s = String(text);
  if (s.length <= 2 && !s.includes(' ')) { g.font = 'bold 30px Georgia, serif'; fillTextFit(g, s, cx, cy + 1, 50); return; }
  const { lines, size } = fitLines(g, s, 50, 3, 16, 8);
  const lh = size + 1;
  let ty = cy - (lines.length * lh) / 2 + lh / 2;
  g.font = `bold ${size}px Georgia, serif`;
  for (const l of lines) { fillTextFit(g, l, cx, ty, 52); ty += lh; }
}

function drawPlate(g, [x, y, w, h], text) {
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#f6f0de'); grad.addColorStop(1, '#e6dcc2');
  g.fillStyle = grad; g.fillRect(x, y, w, h);
  g.strokeStyle = '#3a2a18'; g.lineWidth = 3; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
  g.fillStyle = '#1a140e'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 34px Georgia, serif';
  fillTextFit(g, text.split('').join(String.fromCharCode(8202)), x + w / 2, y + h / 2 + 2, w - 40);
}

// Base geometry made of parts; variant() clones it with a fresh UV attribute
// (positions/normals shared): 'cell' parts map their 0..1 UVs into an atlas
// cell, other parts collapse onto a solid colour patch.
class UVTemplate {
  constructor(parts) {   // parts: [{ geo, map: 'cell' | patchName }]
    this.ranges = [];
    let o = 0;
    const list = parts.map(({ geo, map }) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      this.ranges.push({ start: o, count: g.attributes.position.count, map });
      o += g.attributes.position.count;
      return g;
    });
    this.base = mergeGeos(list);
    list.forEach((g) => g.dispose());
    parts.forEach(({ geo }) => geo.dispose());
    this.base.computeBoundingSphere();
    this.base.computeBoundingBox();
  }
  variant(atlas, cell, patchOverride = {}) {
    const src = this.base.attributes.uv.array;
    const uv = new Float32Array(src.length);
    const r = cell ? atlas.uv(cell, 3) : null;
    for (const { start, count, map } of this.ranges) {
      if (map === 'cell' && r) {
        for (let i = start; i < start + count; i++) {
          uv[i * 2] = r.u0 + src[i * 2] * (r.u1 - r.u0);
          uv[i * 2 + 1] = r.v0 + src[i * 2 + 1] * (r.v1 - r.v0);
        }
      } else {
        const [pu, pv] = atlas.patch(patchOverride[map] || (map === 'cell' ? 'ivory' : map));
        for (let i = start; i < start + count; i++) { uv[i * 2] = pu; uv[i * 2 + 1] = pv; }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.base.attributes.position);
    g.setAttribute('normal', this.base.attributes.normal);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.boundingSphere = this.base.boundingSphere.clone();
    g.boundingBox = this.base.boundingBox.clone();
    return g;
  }
  // Geometry for an InstancedMesh drawn with atlasMaterial(): the per-control
  // UV remapping that variant() bakes on the CPU is done in the vertex shader
  // from per-instance attributes. aMode per vertex: 0 = fixed patch (baked
  // here), 1 = 'cell' part (iCell = u0, v0, du, dv), 2 = overridable 'ivory'
  // body part (iPatch = patch uv).
  instanced(atlas) {
    if (this._inst) return this._inst;
    const src = this.base.attributes.uv.array;
    const uv = new Float32Array(src.length), mode = new Float32Array(src.length / 2);
    for (const { start, count, map } of this.ranges) {
      const m = map === 'cell' ? 1 : map === 'ivory' ? 2 : 0;
      const [pu, pv] = m === 0 ? atlas.patch(map) : [0, 0];
      for (let i = start; i < start + count; i++) {
        mode[i] = m;
        if (m === 1) { uv[i * 2] = src[i * 2]; uv[i * 2 + 1] = src[i * 2 + 1]; } else { uv[i * 2] = pu; uv[i * 2 + 1] = pv; }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.base.attributes.position);
    g.setAttribute('normal', this.base.attributes.normal);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aMode', new THREE.BufferAttribute(mode, 1));
    g.boundingSphere = this.base.boundingSphere.clone();
    g.boundingBox = this.base.boundingBox.clone();
    this._inst = g;
    return g;
  }
  // per-instance atlas parameters reproducing variant(atlas, cell, patchOverride)
  instanceUV(atlas, cell, patchOverride = {}) {
    const r = cell ? atlas.uv(cell, 3) : null;
    return {
      cell: r ? [r.u0, r.v0, r.u1 - r.u0, r.v1 - r.v0] : [0, 0, 0, 0],
      patch: atlas.patch(patchOverride.ivory || 'ivory'),
    };
  }
}

// Clone of an atlas material for instanced controls (see UVTemplate.instanced).
function atlasMaterial(base, name) {
  const m = base.clone();
  m.name = name;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMode;\nattribute vec4 iCell;\nattribute vec2 iPatch;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n' +
        'vec2 atlasUv = aMode > 1.5 ? iPatch : ( aMode > 0.5 ? iCell.xy + uv * iCell.zw : uv );\n' +
        'vMapUv = ( mapTransform * vec3( atlasUv, 1.0 ) ).xy;\n#endif');
  };
  m.customProgramCacheKey = () => 'consoleAtlasInstanced';
  return m;
}

function plateTexture() {
  return canvasTex(512, 128, (g, W, H) => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#d9b566'); grad.addColorStop(0.5, '#b8924a'); grad.addColorStop(1, '#8f6c30');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2a1c08'; g.lineWidth = 3; g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = '#20150a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 30px Georgia, serif'; g.fillText('HARRISON & HARRISON', W / 2, 46);
    g.font = '19px Georgia, serif'; g.fillText('ORGAN BUILDERS  ·  DURHAM', W / 2, 88);
  });
}

// ---------------------------------------------------------------- key shapes
function manualKeyGeometries() {
  const L = KEY_L, hw = NAT_W / 2 - 0.0005, zH = L - HEAD_L, zT = L - 0.135;
  // sharp centres relative to the left edge of the octave
  const sharpC = [NAT_W - 0.003, 2 * NAT_W + 0.003, 4 * NAT_W - 0.0035, 5 * NAT_W, 6 * NAT_W + 0.0035];
  const leftSharp = [null, 0, 1, null, 2, 3, 4];   // per natural class: sharp on its left
  const rightSharp = [0, 1, null, 2, 3, 4, null];
  const clear = SHARP_W / 2 + 0.0008;
  const natural = (ni, full) => {
    const c = (ni + 0.5) * NAT_W;
    const tx0 = leftSharp[ni] == null ? -hw : sharpC[leftSharp[ni]] + clear - c;
    const tx1 = (full || rightSharp[ni] == null) ? hw : sharpC[rightSharp[ni]] - clear - c;
    const b = 0.0008;
    return loft(
      [[-hw, hw, -0.020, zH, L], [-hw, hw, -b, zH, L], [-hw + b, hw - b, 0, zH, L - b]],
      [[tx0, tx1, -0.020, zT, zH], [tx0, tx1, -b, zT, zH], [tx0 + b * 0.6, tx1 - b * 0.6, 0, zT, zH]],
    );
  };
  const s = SHARP_W / 2, zb = zH - SHARP_L, zf = zH - 0.001;
  const sharp = loft([
    [-s, s, -0.012, zb, zf],
    [-s + 0.0003, s - 0.0003, 0.0082, zb, zf - 0.004],
    [-s + 0.0014, s - 0.0014, 0.010, zb + 0.001, zf - 0.0058],
  ]);
  return {
    naturals: [0, 1, 2, 3, 4, 5, 6].map((ni) => natural(ni, false)),
    topC: natural(0, true),
    sharp,
    sharpC,
  };
}

const NAT_INDEX = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
const SHARP_INDEX = { 1: 0, 3: 1, 6: 2, 8: 3, 10: 4 };

function manualY(i) { return MAN_Y0 + i * MAN_DY; }
function manualZ(i) { return MAN_Z0 - i * MAN_DZ; }
function pedY(x) { return PED_Y0 + PED_R - Math.sqrt(PED_R * PED_R - x * x); }

// ------------------------------------------------------- control planning
// Department groups per jamb terrace, inner (next to the music desk) to outer.
const JAMB_PLAN = [
  { side: -1, name: 'left', tiers: [['pedal'], ['choir', 'orchestral']] },
  { side: 1, name: 'right', tiers: [['great', 'swell'], ['solo', 'bombard']] },
];

// H&H practice: a coupler sits with the department it couples ONTO.
function couplerDept(c) {
  if (c.to === 4) return 'pedal';
  if (c.to === 3) return c.from === 'bombard' ? 'bombard' : 'solo';
  if (c.to === 2) return 'swell';
  if (c.to === 1) return 'great';
  return c.from === 'orchestral' ? 'orchestral' : 'choir';
}

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
const revs = (...c) => c.map((x) => `reversible-${x}`);
const SLIPS = [   // thumb pistons per key slip (index = manual above the slip), '|' = gap
  ['setter', '|', ...range(6, (i) => `general-piston-${i}`), '|', 'choir-cancel', ...range(5, (i) => `choir-piston-${i}`), '|',
    ...range(5, (i) => `orchestral-piston-${i}`), 'orchestral-piston-clarinet', 'orchestral-piston-hautboy', '|',
    ...range(6, (i) => `general-piston-${i + 6}`), '|', 'general-cancel'],
  [...revs('choir-to-pedal', 'great-to-pedal', 'swell-to-pedal', 'solo-to-pedal', 'pedal-ophicleide'), '|',
    'great-cancel', ...range(10, (i) => `great-piston-${i}`), '|', ...revs('choir-to-great', 'swell-to-great', 'solo-to-great'), '|',
    'sequencer-advance-great'],
  ['sequencer-back-swell', '|', ...revs('swell-to-choir', 'solo-to-choir'), '|', 'swell-cancel', ...range(10, (i) => `swell-piston-${i}`), '|',
    ...revs('solo-to-swell'), '|', 'sequencer-advance-swell'],
  ['solo-cancel', ...range(5, (i) => `solo-piston-${i}`), 'solo-piston-corno-di-bassetto', 'solo-piston-french-horn', '|',
    'bombard-piston-tuba', 'bombard-piston-orchestral-trumpet', 'bombard-piston-full-enclosed', 'bombard-piston-tuba-mirabilis',
    'bombard-piston-full-tubas', 'bombard-piston-6'],
];
const TOE_BOARDS = {   // [upper row, lower row], left to right
  [-1]: [range(7, (i) => `pedal-toe-piston-${i}`),
    [...range(3, (i) => `pedal-toe-piston-${i + 7}`), 'pedal-cancel-toe', 'reversible-toe-great-to-pedal',
      'reversible-toe-solo-to-pedal', 'reversible-toe-solo-to-great-and-pedal']],
  [1]: [range(7, (i) => `general-toe-piston-${i}`),
    [...range(5, (i) => `general-toe-piston-${i + 7}`), 'sequencer-back-toe', 'sequencer-advance-toe']],
};
const CHEEK_TABLETS = [   // [manual, side, id] — rocker tablets on the key-cheek fronts
  [0, -1, 'great-pedal-combinations-coupled'], [0, 1, 'swell-on-general-toe-pistons'],
  [1, 1, 'sequencer-back-rocker'], [2, 1, 'sequencer-advance-rocker'],
  [3, -1, 'combination-system'], [3, 1, 'ventils'],
];

const AB = { choir: 'Ch', great: 'Gt', swell: 'Sw', solo: 'So', pedal: 'Ped', orchestral: 'Orch', bombard: 'Bomb' };
const FIXED_AB = {
  Clarinet: 'Cl', 'Orchestral Hautboy': 'Hb', 'Corno di Bassetto': 'CdB', 'French Horn': 'Hn', Tuba: 'Tb',
  'Orchestral Trumpet': 'OTr', 'Full Enclosed': 'Full Encl', 'Tuba Mirabilis': 'Tuba Mir', 'Full Tubas': 'Full Tubas',
};
const TABLET_TEXT = {
  'great-pedal-combinations-coupled': 'Gt & Ped comb', 'swell-on-general-toe-pistons': 'Sw on Gen toe',
  'sequencer-back-rocker': 'Seq −', 'sequencer-advance-rocker': 'Seq +', 'combination-system': 'Mem', ventils: 'Vent',
};
const couplerAbbrev = (id) => id.split('-').filter((w) => AB[w]).map((w) => AB[w]).join(' ');

function pistonFace(a) {
  const n = /-(\d+)$/.exec(a.id);
  switch (a.kind) {
    case 'piston': return { text: a.adjustable && n ? n[1] : (FIXED_AB[a.name] || (n ? n[1] : a.name)) };
    case 'general-piston': return { text: n ? n[1] : 'G', bg: '#17130f', ink: '#efe7d2', ring: 'rgba(240,230,210,0.35)', body: 'ebony' };
    case 'cancel': return a.toe ? { text: '0', toe: true } : { text: '0' };
    case 'general-cancel': return { text: 'GC', ink: '#9b1810' };
    case 'setter': return { text: 'S', bg: '#7c1712', ink: '#f6eedb', ring: 'rgba(255,240,220,0.4)', body: 'red' };
    case 'reversible-piston': return { text: a.stop ? 'Oph' : couplerAbbrev([].concat(a.coupler)[0]) };
    case 'reversible-toe-piston': return { text: [].concat(a.coupler).map(couplerAbbrev).join(' ').split(' ').filter((w, i, l) => l.indexOf(w) === i).join(' '), toe: true };
    case 'sequencer': return a.toe ? { text: a.action === 'back' ? '−' : '+', toe: true }
      : { text: a.action === 'back' ? '−' : '+', bg: '#17130f', ink: '#efe7d2', ring: 'rgba(240,230,210,0.35)', body: 'ebony' };
    case 'toe-piston': return { text: n ? n[1] : '•', toe: true };
    default: return { text: TABLET_TEXT[a.id] || a.name };
  }
}

// ====================================================================== build
// CONTRACT (raycast targets are the Meshes in ctx.pickables, invisible-material
// proxies with the controls' real geometry and transform; this module only
// listens to the bus and animates):
//   key      userData { type:'key', midi, manual }                bus noteon/noteoff
//   stop     userData { type:'stop', id, label, division }        bus 'stop' { id, on }
//   coupler  userData { type:'coupler', id, label }               bus 'coupler' { id, on }
//   trem.    userData { type:'tremulant', id, label }             bus 'tremulant' { id, on }
//   piston   userData { type:'piston', id, label, kind }          bus 'piston' { id }
//   swell    userData { type:'swell', id, label }                 bus 'swell' { id, value 0..1 }
export function buildConsole(ctx) {
  const { materials: M, LAYOUT, bus, pickables, updaters } = ctx;
  const group = new THREE.Group();
  group.name = 'console';
  group.position.set(LAYOUT.console.x, LAYOUT.console.y, LAYOUT.console.z);

  const keys = new Map();
  const controls = new Map();
  const stops = new Map();
  const typed = { stop: stops, coupler: new Map(), tremulant: new Map(), piston: new Map(), swell: new Map() };
  const anims = new Map();             // mesh -> animation state
  const active = new Set();

  const oak = new Builder(true);
  const dark = new Builder(true);
  const brass = new Builder();
  const ivory = new Builder();
  const black = new Builder();
  const ebony = new Builder();
  const paper = new Builder();

  const maple = M.oak.clone();
  maple.name = 'pedalMaple';
  maple.color.setRGB(1.5, 1.38, 1.2);
  maple.roughness = 0.42;

  // shared engraving atlas + the two control materials that use it
  const atlas = new Atlas();
  const atlasTex = atlas.texture();
  const knobMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: atlasTex, metalness: 0, roughness: 0.33 });
  knobMat.name = 'consoleControls';
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: atlasTex, metalness: 1, roughness: 0.34 });
  brassMat.name = 'consoleBrassControls';
  const knobInst = atlasMaterial(knobMat, 'consoleControls');
  const brassInst = atlasMaterial(brassMat, 'consoleBrassControls');

  // ---- rendering of the controls ----
  // Every control (key, drawknob, piston, swell shoe) is a lightweight proxy
  // Mesh: it keeps the geometry, transform, userData and animation state of the
  // control and stays in ctx.pickables (Raycaster ignores material.visible),
  // but its material is invisible, so the renderer and the shadow pass skip
  // it. What is drawn are a few InstancedMeshes (one per geometry x material)
  // whose instance matrices mirror the proxies' local matrices.
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  proxyMat.name = 'consoleControlProxy';
  const batches = new Map();         // key -> { geo, mat, proxies, uv, cast, margin, mesh, dirty }
  const slotOf = new Map();          // proxy -> [batch, index]
  const visual = (proxy, key, geo, mat, { cast = false, uv = null, margin = 0.02 } = {}) => {
    if (!batches.has(key)) batches.set(key, { key, geo, mat, proxies: [], uv: [], cast, margin, mesh: null, dirty: false });
    const b = batches.get(key);
    slotOf.set(proxy, [b, b.proxies.length]);
    b.proxies.push(proxy);
    b.uv.push(uv);
    proxy.matrixAutoUpdate = false;
    proxy.updateMatrix();
  };
  // write a proxy's (changed) transform into its instance
  const sync = (proxy) => {
    proxy.updateMatrix();
    const s = slotOf.get(proxy);
    if (s && s[0].mesh) { s[0].mesh.setMatrixAt(s[1], proxy.matrix); s[0].dirty = true; }
  };
  const buildBatches = () => {
    for (const b of batches.values()) {
      const n = b.proxies.length;
      const mesh = new THREE.InstancedMesh(b.geo, b.mat, n);
      mesh.name = 'consoleInstanced:' + b.key;
      b.proxies.forEach((p, i) => mesh.setMatrixAt(i, p.matrix));
      if (b.uv[0]) {
        const cell = new Float32Array(n * 4), patch = new Float32Array(n * 2);
        b.uv.forEach((u, i) => { cell.set(u.cell, i * 4); patch.set(u.patch, i * 2); });
        b.geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cell, 4));
        b.geo.setAttribute('iPatch', new THREE.InstancedBufferAttribute(patch, 2));
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += b.margin;   // room for key dip / knob draw / shoe tilt
      mesh.castShadow = b.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      b.mesh = mesh;
      group.add(mesh);
    }
  };

  const lerpAnim = (apply, up = 55, down = 32, cur = 0) => ({
    cur, target: cur, apply,
    tick(dt) {
      const rate = this.target > this.cur ? up : down;
      this.cur += (this.target - this.cur) * (1 - Math.exp(-dt * rate));
      const done = Math.abs(this.target - this.cur) < 0.0015;
      if (done) this.cur = this.target;
      this.apply(this.cur);
      return done;
    },
  });
  const pulseAnim = (apply) => ({
    t: 0, apply,
    tick(dt) {
      this.t += dt;
      const t = this.t, a = 0.03;
      const d = t < a ? t / a : t < PISTON_TIME ? 1 - (t - a) / (PISTON_TIME - a) : 0;
      this.apply(d);
      return t >= PISTON_TIME;
    },
  });
  const register = (mesh, type, id, anim) => {
    if (controls.has(id)) throw new Error(`console: duplicate control id ${id}`);
    mesh.name = `${type}:${id}`;
    mesh.castShadow = false;            // tiny parts: no shadow-pass draw calls
    mesh.receiveShadow = true;
    anims.set(mesh, anim);
    controls.set(id, mesh);
    typed[type].set(id, mesh);
    pickables.push(mesh);
    group.add(mesh);
  };

  // ------------------------------------------------------------ cabinet
  for (const s of [-1, 1]) {
    // side panel with the keydesk bracket profile
    const sh = new THREE.Shape();
    sh.moveTo(-0.78, 0); sh.lineTo(0.0, 0); sh.lineTo(0.0, 0.48);
    sh.quadraticCurveTo(0.02, 0.66, 0.30, 0.69);
    sh.lineTo(0.30, 0.765);
    sh.quadraticCurveTo(FRONT_Z + 0.01, 0.775, FRONT_Z, 0.88);
    sh.lineTo(FRONT_Z, JAMB_TOP); sh.lineTo(-0.78, JAMB_TOP); sh.closePath();
    const side = new THREE.ExtrudeGeometry(sh, { depth: SIDE_OUT - SIDE_IN, bevelEnabled: false, curveSegments: 14 });
    side.rotateY(-Math.PI / 2);
    side.translate(s > 0 ? SIDE_OUT : -SIDE_IN, 0, 0);
    oak.add(side);

    // applied panel mouldings on the outer face (lower + upper panel)
    const xo = s * (SIDE_OUT + 0.004);
    const frame = (z0, z1, y0, y1) => {
      const w = 0.065, t = 0.010;
      oak.box(t, w, z1 - z0, xo, y0 + w / 2, (z0 + z1) / 2);
      oak.box(t, w, z1 - z0, xo, y1 - w / 2, (z0 + z1) / 2);
      oak.box(t, y1 - y0 - 2 * w, w, xo, (y0 + y1) / 2, z0 + w / 2);
      oak.box(t, y1 - y0 - 2 * w, w, xo, (y0 + y1) / 2, z1 - w / 2);
      oak.box(0.006, y1 - y0 - 2 * w - 0.05, z1 - z0 - 2 * w - 0.05, s * (SIDE_OUT + 0.002), (y0 + y1) / 2, (z0 + z1) / 2);
      oak.box(0.014, y1 - y0 - 2 * w + 0.012, z1 - z0 - 2 * w + 0.012, s * (SIDE_OUT - 0.002), (y0 + y1) / 2, (z0 + z1) / 2);
    };
    frame(-0.74, -0.05, 0.11, 0.66);
    frame(-0.74, FRONT_Z - 0.05, 0.80, JAMB_TOP - 0.05);
    // skirting
    oak.box(0.02, 0.09, 0.80, s * (SIDE_OUT + 0.008), 0.045, -0.39);
    oak.box(0.026, 0.014, 0.81, s * (SIDE_OUT + 0.010), 0.097, -0.39);

    // key cheeks (stepped with the manuals)
    for (let i = 0; i < 4; i++) {
      const y = manualY(i), z = manualZ(i);
      oak.mm(s > 0 ? CHEEK_IN : -CHEEK_OUT, s > 0 ? CHEEK_OUT : -CHEEK_IN,
        i === 0 ? TABLE_Y : y - 0.052, y + 0.016, i === 3 ? -0.30 : z - 0.14, z + 0.006);
      oak.add(new THREE.CylinderGeometry(0.008, 0.008, CHEEK_OUT - CHEEK_IN, 10, 1, false, 0, Math.PI),
        TM(s * (CHEEK_IN + CHEEK_OUT) / 2, y + 0.008, z + 0.006, 0, 0, Math.PI / 2));
    }
    // recess side wall / inner pilaster of the jamb
    oak.mm(s > 0 ? CHEEK_OUT - 0.02 : -CHEEK_OUT - 0.02, s > 0 ? CHEEK_OUT + 0.02 : -CHEEK_OUT + 0.02, 0.99, JAMB_TOP, -0.46, JAMB_INNER_Z);
  }
  // back panel (faces the organ) with three framed fields
  oak.mm(-SIDE_OUT, SIDE_OUT, 0, JAMB_TOP, -0.78, -0.75);
  for (let k = -1; k <= 1; k++) {
    for (const [y0, y1] of [[0.12, 0.70], [0.82, JAMB_TOP - 0.07]]) {
      oak.box(0.62, y1 - y0, 0.008, k * 0.71, (y0 + y1) / 2, -0.784);
      oak.box(0.52, y1 - y0 - 0.10, 0.008, k * 0.71, (y0 + y1) / 2, -0.789);
    }
  }
  oak.box(2 * SIDE_OUT + 0.036, 0.09, 0.02, 0, 0.045, -0.792);
  // kneeboard, key table with half-round front edge
  oak.mm(-SIDE_IN, SIDE_IN, 0, 0.70, -0.38, -0.36);
  oak.mm(-SIDE_IN, SIDE_IN, 0.69, TABLE_Y, -0.75, 0.215);
  oak.add(new THREE.CylinderGeometry(0.0225, 0.0225, 2 * SIDE_IN, 14, 1, false, 0, Math.PI),
    TM(0, 0.7125, 0.215, 0, 0, Math.PI / 2));
  oak.mm(-SIDE_IN, SIDE_IN, 0.655, 0.69, -0.36, 0.19);            // apron under the table
  // nameboard above the Solo manual and the recess behind the music desk
  oak.mm(-CHEEK_OUT, CHEEK_OUT, manualY(3) + 0.014, 1.14, -0.30, -0.258);
  oak.mm(-CHEEK_OUT, CHEEK_OUT, 0.99, JAMB_TOP, -0.48, -0.46);
  oak.mm(-CHEEK_OUT, CHEEK_OUT, 1.125, 1.14, -0.46, -0.30);
  // moulded top (one canopy over keydesk and both jambs)
  const T0 = JAMB_TOP;
  oak.mm(-SIDE_OUT - 0.012, SIDE_OUT + 0.012, T0, T0 + 0.015, -0.795, FRONT_Z + 0.01);
  oak.mm(-SIDE_OUT - 0.028, SIDE_OUT + 0.028, T0 + 0.015, T0 + 0.04, -0.81, FRONT_Z + 0.025);
  oak.mm(-SIDE_OUT - 0.045, SIDE_OUT + 0.045, T0 + 0.04, T0 + 0.072, -0.825, FRONT_Z + 0.04);
  oak.mm(-SIDE_OUT - 0.035, SIDE_OUT + 0.035, T0 + 0.072, T0 + 0.08, -0.815, FRONT_Z + 0.03);
  oak.add(new THREE.CylinderGeometry(0.012, 0.012, 2 * SIDE_OUT + 0.07, 10), TM(0, T0 + 0.027, FRONT_Z + 0.027, 0, 0, Math.PI / 2));
  oak.mm(-SIDE_IN, SIDE_IN, T0 - 0.025, T0, FRONT_Z - 0.018, FRONT_Z);      // fascia over the opening
  // retracted roll-top: tambour slats curling under the front of the top,
  // each cut to fit between the upper terraces of the jambs
  const upperK = CHEEK_OUT - JAMB_INNER_Z + 2 * TERRACE * SQ;              // upper face: |x| - z = upperK
  for (let k = 0; k < 6; k++) {
    const phi = THREE.MathUtils.degToRad(38 + k * 10.5);
    const z = FRONT_Z - 0.11 + 0.105 * Math.cos(phi), y = T0 - 0.11 + 0.105 * Math.sin(phi);
    const half = Math.min(SIDE_IN, upperK + z - 0.02);
    oak.add(new THREE.CylinderGeometry(0.0095, 0.0095, 2 * half, 8), TM(0, y, z, 0, 0, Math.PI / 2));
  }
  for (const x of [-0.3, 0.3]) brass.add(new THREE.SphereGeometry(0.009, 10, 8), TM(x, T0 - 0.053, FRONT_Z - 0.017));

  // ------------------------------------------------------------ manuals
  const KG = manualKeyGeometries();
  const xLeft = -KEYS_W / 2;
  for (let man = 0; man < 4; man++) {
    const y = manualY(man), z = manualZ(man);
    for (let midi = 36; midi <= 96; midi++) {
      const n = midi - 36, oct = Math.floor(n / 12), pc = n % 12;
      let mesh, vkey, vmat;
      if (pc in NAT_INDEX) {
        const ni = NAT_INDEX[pc];
        mesh = new THREE.Mesh(midi === 96 ? KG.topC : KG.naturals[ni], proxyMat);
        mesh.position.set(xLeft + (oct * 7 + ni + 0.5) * NAT_W, y, z - KEY_L);
        vkey = midi === 96 ? 'naturalTopC' : 'natural' + ni; vmat = M.ivory;
      } else {
        mesh = new THREE.Mesh(KG.sharp, proxyMat);
        mesh.position.set(xLeft + oct * OCTAVE + KG.sharpC[SHARP_INDEX[pc]], y, z - KEY_L);
        vkey = 'sharp'; vmat = M.ebony;
      }
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { type: 'key', midi, manual: man };
      visual(mesh, vkey, mesh.geometry, vmat, { cast: true });
      anims.set(mesh, lerpAnim((v) => { mesh.rotation.x = v * KEY_DIP; sync(mesh); }));
      keys.set(`${man}:${midi}`, mesh);
      pickables.push(mesh);
      group.add(mesh);
    }
    // key slip (carries the thumb pistons)
    const s0 = man === 0 ? TABLE_Y : manualY(man - 1) + 0.014, s1 = y - 0.023;
    oak.mm(-CHEEK_IN, CHEEK_IN, s0, s1, z - 0.14, z - 0.016);
    if (man > 0) black.mm(-CHEEK_IN, CHEEK_IN, s0 - 0.035, s0, z - 0.14, z - 0.03); // felt-dark void behind the lower keys
  }
  black.mm(-CHEEK_IN, CHEEK_IN, TABLE_Y, manualY(3) - 0.02, -0.30, manualZ(3) - 0.14);

  // ------------------------------------------------------------ makers' plate
  {
    const plateMat = M.brass.clone();
    plateMat.name = 'makersPlate';
    plateMat.color.set(0xffffff); plateMat.map = plateTexture(); plateMat.roughness = 0.4;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.0425), plateMat);
    plate.position.set(0, 1.094, -0.2568);
    plate.name = 'makersPlate';
    plate.receiveShadow = true;
    group.add(plate);
    brass.box(0.176, 0.0485, 0.002, 0, 1.094, -0.2578);
  }

  // ------------------------------------------------------------ stop jambs
  const jambInfo = {};
  {
    const knobT = new UVTemplate([
      { geo: new THREE.CylinderGeometry(0.006, 0.006, 0.054, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.003), map: 'ebony' },
      { geo: new THREE.LatheGeometry([
        [0.006, 0.020], [0.0085, 0.024], [0.011, 0.0265], [0.0165, 0.029], [0.0185, 0.033],
        [0.0185, 0.036], [0.0172, 0.0392], [0.0158, 0.040],
      ].map(([r, y]) => new THREE.Vector2(r, y)), 18).rotateX(Math.PI / 2), map: 'rosewood' },
      { geo: new THREE.CircleGeometry(0.0158, 20).translate(0, 0, 0.0401), map: 'cell' },
    ]);
    const washG = new THREE.CircleGeometry(0.0105, 16).translate(0, 0, 0.0036);
    const plateBases = [];
    const divName = (id) => (DIVISIONS.find((d) => d.id === id)?.name || id).split(' (')[0].toUpperCase();
    const placed = new Set();

    for (const { side: s, name: jname, tiers } of JAMB_PLAN) {
      const dir = new THREE.Vector3(s * SQ, 0, SQ), nrm = new THREE.Vector3(-s * SQ, 0, SQ);
      const at = (u, y, off) => new THREE.Vector3(s * CHEEK_OUT, y, JAMB_INNER_Z).addScaledVector(dir, u).addScaledVector(nrm, off);
      const ry = -s * Math.PI / 4;
      const info = { side: s, normal: nrm.clone(), tiers: [] };
      jambInfo[jname] = info;

      // carcase: lower board, ledge with nosing, recessed upper board, veneered fields
      let p = at(JAMB_W / 2 - 0.005, (TABLE_Y + LEDGE_Y) / 2, -0.015);
      oak.box(JAMB_W + 0.03, LEDGE_Y - TABLE_Y, 0.03, p.x, p.y, p.z, 0, ry, 0);
      const uUp0 = -TERRACE, uUp1 = (SIDE_IN - CHEEK_OUT) / SQ - TERRACE;
      p = at((uUp0 + uUp1) / 2, (LEDGE_Y + JAMB_TOP) / 2, -TERRACE - 0.015);
      oak.box(uUp1 - uUp0, JAMB_TOP - LEDGE_Y, 0.03, p.x, p.y, p.z, 0, ry, 0);
      p = at(JAMB_W / 2 - 0.005, LEDGE_Y - 0.01, (0.012 - TERRACE) / 2);
      oak.box(JAMB_W + 0.03, 0.02, TERRACE + 0.012, p.x, p.y, p.z, 0, ry, 0);
      p = at(JAMB_W / 2 - 0.005, LEDGE_Y - 0.01, 0.012);
      oak.add(new THREE.CylinderGeometry(0.01, 0.01, JAMB_W + 0.03, 10, 1, false, 0, Math.PI), TM(p.x, p.y, p.z, 0, ry, Math.PI / 2));
      p = at(0.41, (0.845 + LEDGE_Y - 0.03) / 2, 0.0015);
      dark.box(0.77, LEDGE_Y - 0.03 - 0.845, 0.003, p.x, p.y, p.z, 0, ry, 0);
      p = at(0.38, (LEDGE_Y + 0.012 + JAMB_TOP - 0.06) / 2, -TERRACE + 0.0015);
      dark.box(0.76, JAMB_TOP - 0.06 - LEDGE_Y - 0.012, 0.003, p.x, p.y, p.z, 0, ry, 0);

      tiers.forEach((depts, t) => {
        const off = t ? -TERRACE : 0;
        const yTop = t ? UPPER_TOP : LOWER_TOP;
        const groups = depts.map((dept) => {
          const items = [
            ...STOPS.filter((st) => st.division === dept).sort((a, b) => a.order - b.order || a.number - b.number)
              .map((def) => ({ type: 'stop', def })),
            ...ACCESSORIES.filter((a) => a.kind === 'tremulant' && a.division === dept).map((def) => ({ type: 'tremulant', def })),
            ...COUPLERS.filter((c) => couplerDept(c) === dept).map((def) => ({ type: 'coupler', def })),
          ];
          return { dept, items, cols: Math.max(1, Math.ceil(items.length / ROWS)) };
        });
        const nCols = groups.reduce((n, g) => n + g.cols, 0);
        const span = (nCols - 1) * COL_P + (groups.length - 1) * GROUP_GAP;
        const [ua, ub] = TIER_U[t];
        if (span > ub - ua + 1e-9) throw new Error(`console: ${jname} terrace ${t} too wide (${span.toFixed(3)} m)`);
        let u = (ua + ub) / 2 - span / 2;
        const tierInfo = [];
        for (const g of groups) {
          const u0 = u;
          g.items.forEach((it, i) => {
            const c = Math.floor(i / ROWS), r = i % ROWS;
            const base = at(u0 + c * COL_P, yTop - r * ROW_P - (c % 2 ? ROW_P / 2 : 0), off);
            const d = it.def;
            let cellOpts, label, ud;
            if (it.type === 'stop') {
              label = d.pitch ? `${d.name} ${pitchText(d.pitch)}` : d.name;
              cellOpts = { name: d.name, pitch: d.pitch, num: d.number, kind: d.family === 'reed' ? 'reed' : 'stop' };
              ud = { type: 'stop', id: d.id, label, division: d.division };
            } else if (it.type === 'coupler') {
              label = d.name;
              cellOpts = { name: d.name, pitch: '', num: d.number, kind: 'coupler' };
              ud = { type: 'coupler', id: d.id, label };
            } else {
              label = `Tremulant (${d.division[0].toUpperCase()}${d.division.slice(1)})`;
              cellOpts = { name: d.name, pitch: '', num: d.number, kind: 'tremulant' };
              ud = { type: 'tremulant', id: d.id, label };
            }
            const cell = atlas.knobCell();
            drawKnobFace(atlas.g, cell, cellOpts);
            const mesh = new THREE.Mesh(knobT.base, proxyMat);
            mesh.position.copy(base);
            mesh.rotation.y = ry;
            mesh.userData = ud;
            register(mesh, ud.type, d.id, lerpAnim((v) => { mesh.position.copy(base).addScaledVector(nrm, v * STOP_TRAVEL); sync(mesh); }));
            visual(mesh, 'drawknob', knobT.instanced(atlas), knobInst, { uv: knobT.instanceUV(atlas, cell), margin: STOP_TRAVEL + 0.002 });
            placed.add(d.id);
            black.add(washG.clone(), TM(base.x, base.y, base.z, 0, ry, 0));
          });
          // department name plate above the group
          const gSpan = (g.cols - 1) * COL_P + 2 * KNOB_R;
          const pw = Math.min(0.21, gSpan + 0.04), ph = Math.min(0.026, pw / 8);
          const pc = at(u0 + (g.cols - 1) * COL_P / 2, yTop + KNOB_R + 0.008 + ph / 2, off + 0.0052);
          const cell = atlas.plateCell();
          const title = divName(g.dept);
          drawPlate(atlas.g, cell, title);
          const pg = new THREE.PlaneGeometry(pw, ph);
          const r = atlas.uv(cell, 2), uv = pg.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
          pg.applyMatrix4(TM(pc.x, pc.y, pc.z, 0, ry, 0));
          plateBases.push(pg.toNonIndexed());
          pg.dispose();
          const pb = at(u0 + (g.cols - 1) * COL_P / 2, pc.y, off + 0.0035);
          brass.box(pw + 0.006, ph + 0.006, 0.002, pb.x, pb.y, pb.z, 0, ry, 0);
          tierInfo.push({ department: g.dept, title, knobs: g.items.length, columns: g.cols,
            stops: g.items.filter((x) => x.type === 'stop').length,
            couplers: g.items.filter((x) => x.type === 'coupler').map((x) => x.def.number),
            tremulants: g.items.filter((x) => x.type === 'tremulant').length });
          u = u0 + g.cols * COL_P - COL_P + COL_P + GROUP_GAP;
        }
        info.tiers.push({ terrace: t ? 'upper' : 'lower', groups: tierInfo });
      });
      info.center = at(0.40, (0.86 + UPPER_TOP) / 2, 0);
    }
    washG.dispose();
    // anything the plan missed (future stoplist edits) goes nowhere silently? no: fail loudly
    const missing = [...STOPS, ...COUPLERS, ...ACCESSORIES.filter((a) => a.kind === 'tremulant')].filter((d) => !placed.has(d.id));
    if (missing.length) throw new Error(`console: drawknobs not placed: ${missing.map((d) => d.id).join(', ')}`);
    const plates = new THREE.Mesh(mergeGeos(plateBases), knobMat);
    plateBases.forEach((g) => g.dispose());
    plates.name = 'departmentPlates';
    plates.receiveShadow = true;
    group.add(plates);
  }

  // ------------------------------------------------------ thumb pistons etc.
  {
    const accById = new Map(ACCESSORIES.map((a) => [a.id, a]));
    const done = new Set();
    const pistonT = new UVTemplate([
      { geo: new THREE.CylinderGeometry(0.0055, 0.0058, 0.009, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.0035), map: 'ivory' },
      { geo: new THREE.CircleGeometry(0.0055, 14).translate(0, 0, 0.008), map: 'cell' },
    ]);
    const studT = new UVTemplate([
      { geo: new THREE.LatheGeometry([
        [0.0, -0.002], [0.0085, -0.002], [0.0085, 0.014], [0.016, 0.016], [0.0165, 0.020], [0.013, 0.0245],
      ].map(([r, y]) => new THREE.Vector2(r, y)), 16).rotateX(Math.PI / 2), map: 'brass' },
      { geo: new THREE.CircleGeometry(0.013, 16).translate(0, 0, 0.0245), map: 'cell' },
    ]);
    const tabletT = new UVTemplate([
      { geo: new THREE.BoxGeometry(0.02, 0.028, 0.006).translate(0, 0, 0.003), map: 'ivory' },
      { geo: new THREE.PlaneGeometry(0.0194, 0.0274).translate(0, 0, 0.0061), map: 'cell' },
    ]);
    pistonT.key = 'thumbPiston'; studT.key = 'toeStud'; tabletT.key = 'tablet';
    const _q = new THREE.Quaternion(), _s = new THREE.Vector3();
    const addPiston = (a, template, mat, matrix, square = false) => {
      const f = pistonFace(a);
      const cell = atlas.smallCell();
      const toeStyle = f.toe ? { bg: '#b8944e', ink: '#24170a', ring: 'rgba(40,26,10,0.5)' } : {};
      drawSmallFace(atlas.g, cell, f.text, { ...toeStyle, ...f, square });
      const mesh = new THREE.Mesh(template.base, proxyMat);
      const base = new THREE.Vector3();
      matrix.decompose(base, _q, _s);
      mesh.position.copy(base);
      mesh.quaternion.copy(_q);
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(_q);
      mesh.userData = { type: 'piston', id: a.id, label: a.name, kind: a.kind };
      register(mesh, 'piston', a.id, pulseAnim((d) => { mesh.position.copy(base).addScaledVector(axis, -d * PISTON_TRAVEL); sync(mesh); }));
      visual(mesh, template.key, template.instanced(atlas), mat === brassMat ? brassInst : knobInst,
        { uv: template.instanceUV(atlas, cell, f.body ? { ivory: f.body } : {}), margin: PISTON_TRAVEL + 0.002 });
      done.add(a.id);
    };

    // key slips
    const slipRows = SLIPS.map((row) => row.filter((id) => id === '|' || accById.has(id)));
    const leftovers = ACCESSORIES.filter((a) => a.kind !== 'tremulant' && a.kind !== 'swell-pedal'
      && !SLIPS.flat().includes(a.id) && !Object.values(TOE_BOARDS).flat(2).includes(a.id)
      && !CHEEK_TABLETS.some((t) => t[2] === a.id));
    if (leftovers.length) slipRows[3].push('|', ...leftovers.map((a) => a.id));   // keep every accessory operable
    slipRows.forEach((row, man) => {
      const n = row.filter((id) => id !== '|').length, gaps = row.filter((id) => id === '|').length;
      const GAP = 0.018, maxW = 2 * CHEEK_IN - 0.05;
      let pitch = 0.024;
      if ((n - 1) * pitch + gaps * GAP > maxW) pitch = (maxW - gaps * GAP) / (n - 1);
      let x = -((n - 1) * pitch + gaps * GAP) / 2;
      const s0 = man === 0 ? TABLE_Y : manualY(man - 1) + 0.014, s1 = manualY(man) - 0.023;
      const y = (s0 + s1) / 2, z = manualZ(man) - 0.016;
      for (const id of row) {
        if (id === '|') { x += GAP; continue; }
        addPiston(accById.get(id), pistonT, knobMat, TM(x, y, z));
        x += pitch;
      }
    });

    // rocker tablets on the key-cheek fronts
    for (const [man, s, id] of CHEEK_TABLETS) {
      const a = accById.get(id);
      if (!a || done.has(id)) continue;
      const y = man === 0 ? TABLE_Y + 0.025 : manualY(man) - 0.024;
      addPiston(a, tabletT, knobMat, TM(s * (CHEEK_IN + CHEEK_OUT) / 2, y, manualZ(man) + 0.006, -0.1, 0, 0), true);
    }

    // toe boards with brass toe pistons, either side of the swell pedals
    for (const s of [-1, 1]) {
      const B = TM(s * 0.455, 0.275, -0.322, -0.72, 0, 0);
      oak.add(new THREE.BoxGeometry(0.50, 0.14, 0.018), B);
      oak.add(new THREE.BoxGeometry(0.50, 0.012, 0.03), B.clone().multiply(TM(0, 0.076, 0.004)));
      TOE_BOARDS[s].forEach((rowIds, ri) => {
        const row = rowIds.filter((id) => accById.has(id) && !done.has(id));
        const up = ri === 0;
        row.forEach((id, k) => {
          const x = (k - (row.length - 1) / 2) * 0.066 + (up ? 0.018 : -0.018);
          addPiston(accById.get(id), studT, brassMat, B.clone().multiply(TM(x, up ? 0.034 : -0.034, 0.009)));
        });
      });
    }

    // three balanced expression shoes (Orchestral, Swell, Solo & Bombard)
    const shoeT = new UVTemplate([
      { geo: new THREE.BoxGeometry(0.098, 0.010, 0.27), map: 'brass' },
      { geo: new THREE.BoxGeometry(0.098, 0.018, 0.008).translate(0, 0.012, 0.131), map: 'brass' },
      ...range(9, (k) => ({ geo: new THREE.BoxGeometry(0.084, 0.004, 0.016).translate(0, 0.007, -0.108 + (k - 1) * 0.027), map: 'dark' })),
    ]);
    const shoeG = shoeT.variant(atlas, null);
    const swellDefs = ACCESSORIES.filter((a) => a.kind === 'swell-pedal');
    const order = ['orchestral', 'choir', 'swell', 'solo', 'bombard'];
    swellDefs.sort((a, b) => order.indexOf(a.division) - order.indexOf(b.division));
    const step = 0.115, x0 = swellDefs.length === 3 ? SWELL_X[0] : 0.04 - (swellDefs.length - 1) * step / 2;
    swellDefs.forEach((a, i) => {
      const x = swellDefs.length === 3 ? SWELL_X[i] : x0 + i * step;
      const mesh = new THREE.Mesh(shoeG, proxyMat);
      mesh.position.set(x, SWELL_PIVOT[0], SWELL_PIVOT[1]);
      mesh.userData = { type: 'swell', id: a.id, label: a.name };
      const anim = lerpAnim((v) => { mesh.rotation.x = SWELL_CLOSED + (SWELL_OPEN - SWELL_CLOSED) * v; sync(mesh); }, 9, 9, 1);
      anim.apply(1);
      register(mesh, 'swell', a.id, anim);
      visual(mesh, 'swellShoe', shoeG, brassMat);
      black.add(new THREE.BoxGeometry(0.03, 0.03, 0.14), TM(x, 0.285, -0.29));                       // pivot bracket
      done.add(a.id);
    });
    black.mm(-0.14, 0.22, 0.20, 0.42, -0.362, -0.356);              // shadowed recess behind the shoes
    brass.add(new THREE.CylinderGeometry(0.006, 0.006, 0.36, 8), TM(0.04, 0.29, -0.262, 0, 0, Math.PI / 2));
    const notDone = ACCESSORIES.filter((a) => a.kind !== 'tremulant' && !done.has(a.id));
    if (notDone.length) throw new Error(`console: accessories not placed: ${notDone.map((a) => a.id).join(', ')}`);
  }
  atlasTex.needsUpdate = true;

  // ------------------------------------------------------------ music desk
  {
    const tilt = -0.25;
    const D = TM(0, 1.155, -0.322, tilt, 0, 0);
    const at = (m) => D.clone().multiply(m);
    oak.mm(-0.43, 0.43, 1.14, 1.155, -0.345, -0.285);                // ledge
    oak.mm(-0.43, 0.43, 1.155, 1.167, -0.293, -0.285);               // lip
    oak.add(new THREE.BoxGeometry(0.84, 0.36, 0.012), at(TM(0, 0.18, -0.008)));
    oak.add(new THREE.BoxGeometry(0.84, 0.028, 0.008), at(TM(0, 0.346, 0.002)));
    oak.add(new THREE.BoxGeometry(0.028, 0.33, 0.008), at(TM(-0.406, 0.172, 0.002)));
    oak.add(new THREE.BoxGeometry(0.028, 0.33, 0.008), at(TM(0.406, 0.172, 0.002)));
    paper.add(new THREE.BoxGeometry(0.47, 0.31, 0.009), at(TM(0, 0.158, 0.0045)));
    const pages = [];
    for (const s of [-1, 1]) {
      const pg = new THREE.PlaneGeometry(0.232, 0.305, 6, 1);
      const pos = pg.attributes.position, uv = pg.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getX(i) * s + 0.116) / 0.232;                 // 0 at the gutter, 1 at the fore-edge
        pos.setZ(i, 0.0125 + 0.006 * Math.sin(Math.min(t * 2.2, 1) * Math.PI) * (1 - t * 0.5) - (t < 0.01 ? 0.004 : 0));
        uv.setX(i, s < 0 ? uv.getX(i) * 0.5 : 0.5 + uv.getX(i) * 0.5);
      }
      pg.translate(s * 0.116, 0.158, 0);
      pg.computeVertexNormals();
      pg.applyMatrix4(D);
      pages.push(pg.toNonIndexed());
    }
    const scoreMat = M.paper.clone();
    scoreMat.name = 'score';
    scoreMat.map = scoreTexture();
    scoreMat.side = THREE.DoubleSide;
    const score = new THREE.Mesh(mergeGeos(pages), scoreMat);
    score.name = 'score';
    score.castShadow = score.receiveShadow = true;
    group.add(score);
    for (const x of [-0.2, 0.2]) brass.add(new THREE.BoxGeometry(0.012, 0.03, 0.02), at(TM(x, 0.012, 0.012)));
  }

  // ------------------------------------------------------------------ lamp
  {
    const LY = JAMB_TOP + 0.08, LZ = FRONT_Z - 0.12;   // top surface, lamp post line
    for (const x of [-0.27, 0.27]) {
      brass.add(new THREE.CylinderGeometry(0.022, 0.026, 0.012, 16), TM(x, LY + 0.006, LZ));
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, LY + 0.01, LZ), new THREE.Vector3(x, LY + 0.07, LZ),
        new THREE.Vector3(x, LY + 0.105, LZ + 0.03), new THREE.Vector3(x, LY + 0.105, LZ + 0.09), new THREE.Vector3(x, LY + 0.085, LZ + 0.13),
      ]);
      brass.add(new THREE.TubeGeometry(curve, 18, 0.0055, 8));
      brass.add(new THREE.SphereGeometry(0.009, 10, 8), TM(x, LY + 0.085, LZ + 0.13));
    }
    brass.add(new THREE.CylinderGeometry(0.03, 0.03, 0.66, 20, 1, false), TM(0, LY + 0.07, LZ + 0.135, 0, 0, Math.PI / 2));
    for (const x of [-0.335, 0.335]) brass.add(new THREE.SphereGeometry(0.03, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), TM(x, LY + 0.07, LZ + 0.135, 0, 0, x < 0 ? Math.PI / 2 : -Math.PI / 2));
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.006, 0.026),
      new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 2.2, roughness: 0.6 }));
    glow.material.name = 'lampGlow';
    glow.position.set(0, LY + 0.044, LZ + 0.122);
    glow.rotation.x = 0.5;
    glow.name = 'lampGlow';
    group.add(glow);
  }

  // ------------------------------------------------------------ pedalboard
  {
    const natG = triUV(loft([
      [-0.011, 0.011, -0.045, -0.72, 0],
      [-0.011, 0.011, -0.002, -0.72, 0],
      [-0.009, 0.009, 0, -0.718, -0.002],
    ]), 3, true);
    const leverG = triUV(loft([[-0.010, 0.010, -0.045, -0.60, 0], [-0.010, 0.010, -0.008, -0.60, 0]]), 3, true);
    const capG = loft([
      [-0.011, 0.011, -0.008, -0.605, -0.445],
      [-0.011, 0.011, 0.024, -0.605, -0.468],
      [-0.0085, 0.0085, 0.030, -0.603, -0.478],
    ]);
    const sharpG = mergeGeos([leverG, capG], true);
    const sharpMats = [maple, M.ebony];
    let nat = -1;
    for (let midi = 36; midi <= 67; midi++) {
      const pc = (midi - 36) % 12;
      const isNat = pc in NAT_INDEX;
      if (isNat) nat++;
      const a = ((isNat ? nat : nat + 0.5) - 9) * PED_DA;
      const X = PED_R * Math.sin(a);
      const mesh = new THREE.Mesh(isNat ? natG : sharpG, isNat ? proxyMat : [proxyMat, proxyMat]);
      mesh.position.set(PED_HEEL * Math.sin(a), pedY(X), PED_PZ - PED_HEEL * Math.cos(a));
      mesh.rotation.order = 'YZX';
      mesh.rotation.set(0, -a, Math.asin(X / PED_R));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { type: 'key', midi, manual: 4 };
      visual(mesh, isNat ? 'pedalNatural' : 'pedalSharp', mesh.geometry, isNat ? maple : sharpMats, { cast: true, margin: 0.03 });
      anims.set(mesh, lerpAnim((v) => { mesh.rotation.x = -v * PED_DIP; sync(mesh); }));
      keys.set(`4:${midi}`, mesh);
      pickables.push(mesh);
      group.add(mesh);
    }
    // frame: base board, side cheeks, curved heel board
    black.mm(-0.74, 0.74, 0, 0.02, -0.36, 0.50);
    for (const s of [-1, 1]) {
      const a = s * 10.45 * PED_DA, r = PED_R - 0.085;
      oak.box(0.032, 0.25, 0.80, r * Math.sin(a), 0.125, PED_PZ - r * Math.cos(a), 0, -a, 0);
      oak.box(0.044, 0.014, 0.81, r * Math.sin(a), 0.257, PED_PZ - r * Math.cos(a), 0, -a, 0);
    }
    for (let j = -21; j <= 21; j++) {
      const a = j * PED_DA / 2, r = PED_HEEL - 0.012;
      const h = pedY(PED_R * Math.sin(a)) + 0.016;
      oak.box(r * PED_DA / 2 + 0.004, h, 0.06, r * Math.sin(a), h / 2, PED_PZ - r * Math.cos(a), 0, -a, 0);
    }
  }

  // ----------------------------------------------------------------- bench
  {
    const zc = 0.52;
    oak.mm(-0.75, 0.75, 0.578, 0.612, zc - 0.19, zc + 0.19);
    oak.mm(-0.742, 0.742, 0.612, 0.620, zc - 0.182, zc + 0.182);
    oak.add(new THREE.CylinderGeometry(0.017, 0.017, 1.50, 10, 1, false, 0, Math.PI), TM(0, 0.595, zc - 0.19, -Math.PI / 2, 0, Math.PI / 2));
    oak.mm(-0.66, 0.66, 0.50, 0.578, zc - 0.15, zc - 0.125);        // aprons
    oak.mm(-0.66, 0.66, 0.50, 0.578, zc + 0.125, zc + 0.15);
    for (const s of [-1, 1]) {
      const x = s * 0.69;
      oak.box(0.07, 0.05, 0.54, x, 0.025, zc);                      // sledge foot
      oak.box(0.055, 0.02, 0.44, x, 0.06, zc);
      for (const dz of [-0.13, 0.13]) {
        oak.box(0.055, 0.30, 0.06, x, 0.22, zc + dz);               // lower post (outer sleeve)
        oak.box(0.04, 0.21, 0.045, x, 0.475, zc + dz);              // inner adjustable post
        brass.box(0.008, 0.10, 0.02, x + s * 0.03, 0.31, zc + dz);  // rack plate
        for (let k = 0; k < 4; k++) black.box(0.004, 0.006, 0.012, x + s * 0.035, 0.275 + k * 0.022, zc + dz);
      }
      oak.box(0.05, 0.07, 0.32, x, 0.335, zc);                      // side rail
      oak.box(0.05, 0.045, 0.34, x, 0.555, zc);
    }
    oak.box(1.34, 0.05, 0.03, 0, 0.16, zc + 0.13);                  // rear stretcher
    brass.add(new THREE.CylinderGeometry(0.007, 0.007, 0.10, 10), TM(0.765, 0.335, zc, 0, 0, Math.PI / 2));
    brass.box(0.008, 0.075, 0.016, 0.815, 0.305, zc);
    brass.add(new THREE.CylinderGeometry(0.009, 0.011, 0.05, 10), TM(0.842, 0.272, zc, 0, 0, Math.PI / 2));
    brass.add(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 14), TM(0.72, 0.335, zc, 0, 0, Math.PI / 2));
  }

  // --------------------------------------------------------- emit statics
  const add = (b, mat, name) => { const m = b.mesh(mat, name); if (m) group.add(m); };
  add(oak, M.oak, 'consoleOak');
  add(dark, M.darkWood, 'consoleDarkWood');
  add(brass, M.brass, 'consoleBrass');
  add(ivory, M.ivory, 'consoleIvory');
  add(black, M.black, 'consoleBlack');
  add(ebony, M.ebony, 'consoleEbony');
  add(paper, M.paper, 'consolePaper');
  // everything except the control proxies is static
  for (const o of group.children) if (!slotOf.has(o)) { o.matrixAutoUpdate = false; o.updateMatrix(); }
  buildBatches();

  // -------------------------------------------------------------- behaviour
  const drive = (mesh, target) => {
    const a = mesh && anims.get(mesh);
    if (!a) return;
    a.target = target;
    active.add(a);
  };
  const toggle = (type) => (e) => { if (e && e.id != null) drive(typed[type].get(e.id), e.on ? 1 : 0); };
  const offs = [
    bus.on('noteon', (e) => e && drive(keys.get(`${e.manual}:${e.midi}`), 1)),
    bus.on('noteoff', (e) => e && drive(keys.get(`${e.manual}:${e.midi}`), 0)),
    bus.on('stop', toggle('stop')),
    bus.on('coupler', toggle('coupler')),
    bus.on('tremulant', toggle('tremulant')),
    bus.on('piston', (e) => {
      const a = e && anims.get(typed.piston.get(e.id));
      if (!a) return;
      a.t = 0;
      active.add(a);
    }),
    bus.on('swell', (e) => {
      if (!e) return;
      const v = Number(e.value);
      if (Number.isFinite(v)) drive(typed.swell.get(e.id), Math.min(1, Math.max(0, v)));
    }),
  ];
  updaters.push((t, dt) => {
    if (!active.size) return;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    for (const a of active) if (a.tick(step)) active.delete(a);
    for (const b of batches.values()) if (b.dirty) { b.mesh.instanceMatrix.needsUpdate = true; b.dirty = false; }
  });

  // world-space viewpoints for the integrator
  const W = (v) => v.clone().add(group.position).toArray().map((n) => +n.toFixed(3));
  const jambView = (j) => ({
    position: W(j.center.clone().addScaledVector(j.normal, 0.95).add(new THREE.Vector3(0, 0.12, 0))),
    target: W(j.center),
  });

  group.userData.api = {
    keys,
    controls,
    stops,
    couplers: typed.coupler,
    tremulants: typed.tremulant,
    pistons: typed.piston,
    swells: typed.swell,
    // extras for the integrator (local coordinates of the console group)
    manualTopY: [0, 1, 2, 3].map(manualY),
    manualFrontZ: [0, 1, 2, 3].map(manualZ),
    keyboardWidth: KEYS_W,
    pedalTopY: PED_Y0,
    benchTopY: 0.62,
    musicDesk: new THREE.Vector3(0, 1.31, -0.36),
    jambs: {
      left: { ...jambInfo.left, center: jambInfo.left.center.clone() },
      right: { ...jambInfo.right, center: jambInfo.right.center.clone() },
    },
    // suggested camera placements (WORLD coordinates, [x, y, z])
    views: {
      leftJamb: jambView(jambInfo.left),
      rightJamb: jambView(jambInfo.right),
      organist: { position: W(new THREE.Vector3(0, 1.32, 0.62)), target: W(new THREE.Vector3(0, 1.0, -0.2)) },
      keyboards: { position: W(new THREE.Vector3(0, 1.38, 0.62)), target: W(new THREE.Vector3(0, 0.86, -0.05)) },
      pedals: { position: W(new THREE.Vector3(0.05, 0.95, 0.75)), target: W(new THREE.Vector3(0.0, 0.25, -0.2)) },
      overview: { position: W(new THREE.Vector3(1.9, 2.1, 2.6)), target: W(new THREE.Vector3(0, 1.0, -0.15)) },
    },
    dispose: () => {
      offs.forEach((f) => f && f());
      active.clear();
      atlasTex.dispose();
      knobMat.dispose();
      brassMat.dispose();
      knobInst.dispose();
      brassInst.dispose();
      proxyMat.dispose();
      for (const b of batches.values()) b.mesh?.dispose();
    },
  };
  return group;
}
