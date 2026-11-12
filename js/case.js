// Organ front architecture of the Royal Albert Hall organ (after photographs
// of the real instrument). NO pipes are built here.
//
//  * Base storey (y 0 .. LAYOUT.baseHeight): pale honey oak. Plinth, panelled
//    bays and pilasters with gilt-lined sunk panels, pierced grilles (tall
//    narrow ones flanking the centre, wide low ones in the side bays), a
//    slightly projecting centre pavilion with a panelled door, door case and
//    round carved medallion, scrolled corbels, a frieze of square rosette
//    coffers and a heavy stepped cornice with dentils and gilt beads.
//  * Above the impost, per LAYOUT.sections:
//      'arch'    – two stout painted columns on rosette pedestals, Ionic-like
//                  capitals, a free-standing semicircular archivolt, a dark
//                  recess (cheeks + back wall) and a toe-board for the pipes.
//      'cluster' – a stepped oak plinth for the big free-standing pipes.
//    Slender stencilled posts at every section boundary, tie rails and a dark
//    gauze behind the clusters (up to y = 9).
//  * Chamber screens: plain dark side/back walls up to LAYOUT.screenTopY.
//
// Everything is merged into one mesh per material (~14 draw calls).
// Gilt overlays stand >= 2 mm proud of the surface they sit on.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { woodTexture } from './materials.js';

const PI = Math.PI;

// ---------------------------------------------------------------------------
// low level geometry helpers
// ---------------------------------------------------------------------------
function rawGeo(pos, nor) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

function quadInto(pos, nor, a0, a1, b0, b1, nA, nB, smooth) {
  const push = (p, n) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); };
  const d1 = [b1[0] - a0[0], b1[1] - a0[1], b1[2] - a0[2]];
  const d2 = [a1[0] - b0[0], a1[1] - b0[1], a1[2] - b0[2]];
  let fn = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
  const fl = Math.hypot(fn[0], fn[1], fn[2]);
  if (fl < 1e-12) return;
  fn = [fn[0] / fl, fn[1] / fl, fn[2] / fl];
  const dot = fn[0] * (nA[0] + nB[0]) + fn[1] * (nA[1] + nB[1]) + fn[2] * (nA[2] + nB[2]);
  const flip = dot < 0;
  if (flip) fn = [-fn[0], -fn[1], -fn[2]];
  const NA = smooth ? nA : fn, NB = smooth ? nB : fn;
  if (!flip) {
    push(a0, NA); push(b0, NB); push(b1, NB);
    push(a0, NA); push(b1, NB); push(a1, NA);
  } else {
    push(a0, NA); push(b1, NB); push(b0, NB);
    push(a0, NA); push(a1, NA); push(b1, NB);
  }
}

// Sweep a 2D profile [[d, y], ...] along horizontal stations {x, z, nx, nz, dy?}.
// A profile point lands at (x + nx*d, y + dy, z + nz*d). List the profile so
// that the outside is on its right hand side (bottom -> top for an outward
// facing moulding). `profile` may be a function of the station.
function sweepGeo(profile, stations, { smooth = true, caps = false } = {}) {
  const pos = [], nor = [];
  const prof = typeof profile === 'function' ? profile : () => profile;
  const pt = (s, p) => [s.x + s.nx * p[0], p[1] + (s.dy || 0), s.z + s.nz * p[0]];
  const hdir = (s) => { const l = Math.hypot(s.nx, s.nz) || 1; return [s.nx / l, s.nz / l]; };
  const segN = (s, p0, p1) => {
    const dd = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dd, dy);
    if (l < 1e-9) return null;
    const h = hdir(s);
    return [h[0] * dy / l, -dd / l, h[1] * dy / l];
  };
  const P = stations.map(prof);
  const np = P[0].length;
  for (let j = 0; j < np - 1; j++) {
    for (let i = 0; i < stations.length - 1; i++) {
      const A = stations[i], B = stations[i + 1];
      const pa0 = P[i][j], pa1 = P[i][j + 1], pb0 = P[i + 1][j], pb1 = P[i + 1][j + 1];
      const nA = segN(A, pa0, pa1), nB = segN(B, pb0, pb1);
      if (!nA || !nB) continue;
      quadInto(pos, nor, pt(A, pa0), pt(A, pa1), pt(B, pb0), pt(B, pb1), nA, nB, smooth);
    }
  }
  if (caps) {
    const push = (p, n) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); };
    for (const k of [0, stations.length - 1]) {
      const s = stations[k], pr = P[k];
      const contour = pr.map((p) => new THREE.Vector2(p[0], p[1]));
      if (contour[0].distanceTo(contour[contour.length - 1]) < 1e-9) contour.pop();
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const n = [-s.nz, 0, s.nx];
      for (const t of tris) {
        const a = pt(s, pr[t[0]]), b = pt(s, pr[t[1]]), c = pt(s, pr[t[2]]);
        push(a, n); push(b, n); push(c, n);
        push(a, [-n[0], 0, -n[2]]); push(c, [-n[0], 0, -n[2]]); push(b, [-n[0], 0, -n[2]]);
      }
    }
  }
  return rawGeo(pos, nor);
}

// Sweep a profile [[h, d], ...] along a path in a vertical XY plane (arches).
// Stations {x, y, nx, ny}: n is the in-plane direction away from the opening.
// A point lands at (x + nx*h, y + ny*h, z0 + d).
function sweepXY(profile, stations, z0, { smooth = false } = {}) {
  const pos = [], nor = [];
  const pt = (s, p) => [s.x + s.nx * p[0], s.y + s.ny * p[0], z0 + p[1]];
  for (let j = 0; j < profile.length - 1; j++) {
    const p0 = profile[j], p1 = profile[j + 1];
    const dh = p1[0] - p0[0], dd = p1[1] - p0[1], l = Math.hypot(dh, dd);
    if (l < 1e-9) continue;
    const nh = dd / l, nd = -dh / l;
    for (let i = 0; i < stations.length - 1; i++) {
      const A = stations[i], B = stations[i + 1];
      quadInto(pos, nor, pt(A, p0), pt(A, p1), pt(B, p0), pt(B, p1),
        [A.nx * nh, A.ny * nh, nd], [B.nx * nh, B.ny * nh, nd], smooth);
    }
  }
  return rawGeo(pos, nor);
}

// semicircle of radius a centred at (xc, ys), from the left springing to the right
function semiStations(xc, ys, a, n) {
  const st = [];
  for (let i = 0; i <= n; i++) {
    const t = PI - (PI * i) / n;
    st.push({ x: xc + a * Math.cos(t), y: ys + a * Math.sin(t), nx: Math.cos(t), ny: Math.sin(t) });
  }
  return st;
}
function ringPath(n = 12) {
  const st = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * PI * i) / n;
    st.push({ x: 0, z: 0, nx: Math.cos(a), nz: Math.sin(a) });
  }
  return st;
}
// Path running around a block: both sides and the front, mitred corners.
function blockPath(x0, x1, zFront, zBack) {
  return [
    { x: x0, z: zBack, nx: -1, nz: 0 },
    { x: x0, z: zFront, nx: -1, nz: 1 },
    { x: x1, z: zFront, nx: 1, nz: 1 },
    { x: x1, z: zBack, nx: 1, nz: 0 },
  ];
}
// straight front-only run
const frontPath = (x0, x1, z) => [{ x: x0, z, nx: 0, nz: 1 }, { x: x1, z, nx: 0, nz: 1 }];
// circle profile (torus section) for lathes: centre (r0, y0), radius t
function torusProf(r0, y0, t, n = 8) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = -PI / 2 + (PI * i) / n;
    p.push([r0 + t * Math.cos(a), y0 + t * Math.sin(a)]);
  }
  return p;
}

// ---------------------------------------------------------------------------
// procedural paint / grille textures
// ---------------------------------------------------------------------------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const C_BLUE = '#4f7671', C_BLUE_D = '#3a5a57', C_CREAM = '#e7d8b4', C_RED = '#8c3c2b', C_GOLD = '#c9a24a';

// posts: one repeat = 64 px across the face, 256 px = 0.66 m of height
function postStencil() {
  return canvasTex(64, 256, (g, W, H) => {
    g.fillStyle = C_BLUE; g.fillRect(0, 0, W, H);
    // chevron band on cream
    g.fillStyle = C_CREAM; g.fillRect(0, 0, W, 66);
    g.strokeStyle = C_RED; g.lineWidth = 5; g.lineJoin = 'miter';
    for (let k = 0; k < 5; k++) {
      const y = 6 + k * 13;
      g.beginPath(); g.moveTo(4, y + 10); g.lineTo(W / 2, y); g.lineTo(W - 4, y + 10); g.stroke();
    }
    g.fillStyle = C_GOLD; g.fillRect(0, 66, W, 6); g.fillRect(0, 184, W, 6);
    // gold diaper lozenges on blue-green
    for (let i = 0; i < 4; i++) {
      const cy = 86 + i * 28;
      g.fillStyle = C_GOLD;
      g.beginPath(); g.moveTo(W / 2, cy - 14); g.lineTo(W / 2 + 20, cy); g.lineTo(W / 2, cy + 14); g.lineTo(W / 2 - 20, cy); g.closePath(); g.fill();
      g.fillStyle = C_BLUE_D;
      g.beginPath(); g.moveTo(W / 2, cy - 9); g.lineTo(W / 2 + 13, cy); g.lineTo(W / 2, cy + 9); g.lineTo(W / 2 - 13, cy); g.closePath(); g.fill();
      g.fillStyle = C_RED; g.beginPath(); g.arc(W / 2, cy, 3.5, 0, 2 * PI); g.fill();
      g.fillStyle = C_CREAM;
      g.beginPath(); g.arc(4, cy + 14, 3, 0, 2 * PI); g.arc(W - 4, cy + 14, 3, 0, 2 * PI); g.fill();
    }
    // cream band with red quatrefoil
    g.fillStyle = C_CREAM; g.fillRect(0, 190, W, 66);
    g.fillStyle = C_RED;
    for (const [dx, dy] of [[0, -9], [0, 9], [-9, 0], [9, 0]]) { g.beginPath(); g.arc(W / 2 + dx, 223 + dy, 8, 0, 2 * PI); g.fill(); }
    g.fillStyle = C_GOLD; g.beginPath(); g.arc(W / 2, 223, 5, 0, 2 * PI); g.fill();
    // border stripes
    g.fillStyle = C_RED; g.fillRect(0, 0, 3, H); g.fillRect(W - 3, 0, 3, H);
    g.fillStyle = C_GOLD; g.fillRect(3, 0, 2, H); g.fillRect(W - 5, 0, 2, H);
  });
}
// column shafts: 3 repeats around, 0.45 m per repeat vertically
function columnStencil() {
  return canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = C_BLUE; g.fillRect(0, 0, W, H);
    g.fillStyle = C_CREAM; g.fillRect(0, 0, W, 22);
    g.fillStyle = C_RED; g.fillRect(0, 22, W, 3); g.fillRect(0, 103, W, 3);
    g.fillStyle = C_GOLD; g.fillRect(0, 25, W, 2); g.fillRect(0, 101, W, 2);
    // gold zigzag
    g.strokeStyle = C_GOLD; g.lineWidth = 4;
    g.beginPath();
    for (let i = 0; i <= 8; i++) g.lineTo(i * 16, i % 2 ? 46 : 62);
    g.stroke();
    // cream lozenge diaper with red dots
    for (let i = 0; i < 4; i++) {
      const cx = 16 + i * 32, cy = 82;
      g.fillStyle = C_CREAM;
      g.beginPath(); g.moveTo(cx, cy - 11); g.lineTo(cx + 9, cy); g.lineTo(cx, cy + 11); g.lineTo(cx - 9, cy); g.closePath(); g.fill();
      g.fillStyle = C_RED; g.beginPath(); g.arc(cx, cy, 3, 0, 2 * PI); g.fill();
    }
    g.fillStyle = C_CREAM; g.fillRect(0, 106, W, 22);
    g.fillStyle = C_RED;
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(8 + i * 16, 117, 3, 0, 2 * PI); g.fill(); }
  });
}
// quatrefoil / roundel lattice (one tile = 0.25 m)
function latticeGrille() {
  return canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = '#7a5532'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#a77a48'; g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, W - 3, H - 3);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    const c = W / 2;
    for (const [dx, dy] of [[0, -17], [0, 17], [-17, 0], [17, 0]]) { g.beginPath(); g.arc(c + dx, c + dy, 15, 0, 2 * PI); g.fill(); }
    g.beginPath(); g.arc(c, c, 14, 0, 2 * PI); g.fill();
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) { g.beginPath(); g.arc(x, y, 17, 0, 2 * PI); g.fill(); }
    for (const [x, y] of [[c, 0], [c, H], [0, c], [W, c]]) {
      g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 7, y); g.lineTo(x, y + 9); g.lineTo(x - 7, y); g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    // gilt dot in the quatrefoil centre bar crossings
    g.fillStyle = '#c9a24a';
    for (const [x, y] of [[c - 12, c - 12], [c + 12, c - 12], [c - 12, c + 12], [c + 12, c + 12]]) { g.beginPath(); g.arc(x, y, 3, 0, 2 * PI); g.fill(); }
  });
}
// arcaded balusters (one tile = 0.1 m wide x 0.2 m tall)
function balusterGrille() {
  return canvasTex(64, 128, (g, W, H) => {
    g.fillStyle = '#7a5532'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    g.beginPath();
    g.moveTo(7, 112); g.lineTo(7, 40); g.arc(32, 40, 25, PI, 0); g.lineTo(57, 112); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#7a5532';
    for (const y of [58, 86]) for (const x of [0, W]) { g.beginPath(); g.ellipse(x, y, 11, 6, 0, 0, 2 * PI); g.fill(); }
    g.fillStyle = '#a77a48'; g.fillRect(0, 112, W, 3);
  });
}

// ---------------------------------------------------------------------------
export function buildCase(ctx) {
  const { materials: M, LAYOUT: L } = ctx;
  const group = new THREE.Group();
  group.name = 'organCase';

  // ---- local materials (ctx.materials is never mutated) ---------------------
  const oak = M.oak.clone();
  oak.map = woodTexture('#dcb27c', '#a77a45', 41);
  oak.color.set(0xfff2dc);
  oak.roughness = 0.5;
  const oakDeep = oak.clone();
  oakDeep.color.set(0xcfa878);
  const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
  const grilleMat = (map) => new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.6, metalness: 0.05, alphaTest: 0.5, side: THREE.DoubleSide });
  const MAT = {
    oak, oakDeep,
    gold: M.gold, goldMatte: M.goldMatte,
    blue: std(0x56807a, 0.62),
    cream: std(0xe8dbbb, 0.55),
    red: std(0x8c3b2a, 0.6),
    postPaint: std(0xffffff, 0.55, { map: postStencil() }),
    colPaint: std(0xffffff, 0.55, { map: columnStencil() }),
    recess: std(0x06080e, 0.95),
    chamber: std(0x1b1713, 0.85),
    gauze: std(0x0c0d11, 1.0),
    grilleL: grilleMat(latticeGrille()),
    grilleB: grilleMat(balusterGrille()),
  };
  for (const [k, m] of Object.entries(MAT)) if (m !== M.gold && m !== M.goldMatte) m.name = `case_${k}`;

  const buckets = {};
  for (const k of Object.keys(MAT)) buckets[k] = [];

  function add(key, geo) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.morphAttributes = {};
    g.clearGroups();
    buckets[key].push(g);
  }
  function box(key, x0, x1, y0, y1, z0, z1) {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
    if (w < 1e-5 || h < 1e-5 || d < 1e-5) return null;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    add(key, g);
    return g;
  }
  // mirrored helpers (x -> -x)
  const boxM = (key, x0, x1, y0, y1, z0, z1) => { box(key, x0, x1, y0, y1, z0, z1); box(key, -x1, -x0, y0, y1, z0, z1); };
  const sweep = (key, profile, stations, opts) => add(key, sweepGeo(profile, stations, opts));
  const bead = (key, stations, d, y0, y1, t = 0.004, opts) =>
    sweep(key, [[d, y0], [d + t, y0], [d + t, y1], [d, y1]], stations, { smooth: false, ...opts });
  function lathe(key, prof, x, z, n = 24, { smooth = true, uv = null } = {}) {
    const g = sweepGeo(prof, ringPath(n), { smooth });
    if (uv) uv(g);
    g.translate(x, 0, z);
    add(key, g);
  }
  const rectShape = (x0, x1, y0, y1) => {
    const s = new THREE.Shape();
    s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.closePath();
    return s;
  };
  const rectHole = (x0, x1, y0, y1) => {
    const p = new THREE.Path();
    p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.closePath();
    return p;
  };
  // raised-and-fielded panel standing on the plane z, facing +z
  function field(key, shape, z, raise = 0.03, bevel = 0.045) {
    const bt = raise * 0.35;
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: raise - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bevel,
      bevelOffset: -bevel, bevelSegments: 1, curveSegments: 6,
    });
    g.translate(0, 0, z + bt);
    add(key, g);
  }
  const fieldRect = (key, x0, x1, y0, y1, z, raise = 0.03, bevel = 0.045) => {
    if (x1 - x0 > 2 * bevel + 0.02 && y1 - y0 > 2 * bevel + 0.02) field(key, rectShape(x0, x1, y0, y1), z, raise, bevel);
  };
  // rectangular frame of boards (width w) around [x0,x1]x[y0,y1] (outside the rect)
  function frame(key, x0, x1, y0, y1, w, z0, z1) {
    box(key, x0 - w, x1 + w, y0 - w, y0, z0, z1);
    box(key, x0 - w, x1 + w, y1, y1 + w, z0, z1);
    box(key, x0 - w, x0, y0, y1, z0, z1);
    box(key, x1, x1 + w, y0, y1, z0, z1);
  }
  // thin gilt line rectangle (strips of width t) lying on plane z, proud by p
  const giltRect = (key, x0, x1, y0, y1, z, t = 0.012, p = 0.004) => frame(key, x0 + t, x1 - t, y0 + t, y1 - t, t, z, z + p);

  // ---- ornaments ------------------------------------------------------------
  const ring12 = ringPath(12);
  const leafBase = new THREE.SphereGeometry(1, 6, 4).toNonIndexed();
  const ballBase = new THREE.SphereGeometry(1, 8, 5).toNonIndexed();
  function leaf(key, x, y, z, len, wid, ang, thick = 0.02) {
    const g = leafBase.clone();
    g.scale(len, wid, thick);
    g.rotateZ(ang);
    g.translate(x, y, z);
    add(key, g);
  }
  function ball(key, x, y, z, r, sz = 1) {
    const g = ballBase.clone();
    g.scale(r, r, r * sz);
    g.translate(x, y, z);
    add(key, g);
  }
  // round carved rosette on plane z facing +z
  function rosette(key, x, y, z, r, depth = 0.03) {
    const prof = [[r, 0], [r, depth * 0.35], [0.85 * r, depth * 0.9], [0.6 * r, depth * 0.5],
      [0.42 * r, depth * 0.55], [0.3 * r, depth * 1.15], [0, depth]];
    const g = sweepGeo(prof.slice().reverse(), ring12);
    g.rotateX(PI / 2);
    g.translate(x, y, z);
    add(key, g);
  }
  // square coffer with a gilded rosette; s = outer size; sits on plane z
  function rosettePanel(x, y, z, s) {
    const b = 0.13 * s, h = s / 2;
    frame('oak', x - h + b, x + h - b, y - h + b, y + h - b, b, z, z + 0.022);
    box('oakDeep', x - h + b, x + h - b, y - h + b, y + h - b, z, z + 0.003);
    rosette('gold', x, y, z + 0.003, 0.2 * s, 0.03 * s / 0.3);
    for (let i = 0; i < 8; i++) {
      const a = (i * PI) / 4 + PI / 8;
      leaf('goldMatte', x + Math.cos(a) * 0.27 * s, y + Math.sin(a) * 0.27 * s, z + 0.008, 0.1 * s, 0.045 * s, a, 0.012);
    }
  }
  // panel: bolection frame + raised field + gilt line, on plane z
  function panel(x0, x1, y0, y1, z = 0) {
    frame('oak', x0, x1, y0, y1, 0.045, z, z + 0.035);
    giltRect('gold', x0, x1, y0, y1, z, 0.01, 0.004);
    fieldRect('oak', x0 + 0.05, x1 - 0.05, y0 + 0.05, y1 - 0.05, z, 0.03, Math.min(0.06, (x1 - x0) * 0.12));
  }
  const panelM = (x0, x1, y0, y1, z) => { panel(x0, x1, y0, y1, z); panel(-x1, -x0, y0, y1, z); };
  // pilaster with sunk gilt-lined panel, on plane z
  function pilaster(xc, w, y0, y1, z, proj = 0.05, withRosette = true) {
    const h = w / 2, b = Math.min(0.05, w * 0.18);
    box('oak', xc - h, xc + h, y0, y1, z, z + proj);
    // base and capital blocks
    box('oak', xc - h - 0.02, xc + h + 0.02, y0, y0 + 0.16, z, z + proj + 0.02);
    box('oak', xc - h - 0.025, xc + h + 0.025, y1 - 0.14, y1, z, z + proj + 0.025);
    box('gold', xc - h - 0.025, xc + h + 0.025, y1 - 0.105, y1 - 0.09, z + proj + 0.025, z + proj + 0.029);
    // raised border around a sunk field
    frame('oak', xc - h + b, xc + h - b, y0 + 0.16 + b, y1 - 0.14 - b, b, z + proj, z + proj + 0.022);
    giltRect('gold', xc - h + b, xc + h - b, y0 + 0.16 + b, y1 - 0.14 - b, z + proj, 0.008, 0.004);
    if (withRosette && w > 0.2) rosette('gold', xc, y1 - 0.14 - b - w * 0.3, z + proj + 0.004, Math.min(0.06, w * 0.18), 0.022);
  }
  const pilasterM = (xc, ...a) => { pilaster(xc, ...a); pilaster(-xc, ...a); };

  // pierced grille in an opening [x0,x1]x[y0,y1]; face plane zf (opening reveal behind it)
  function grille(type, x0, x1, y0, y1, zf, zg = -0.025) {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, zg);
    add(type === 'lattice' ? 'grilleL' : 'grilleB', g);
    box('recess', x0 - 0.04, x1 + 0.04, y0 - 0.04, y1 + 0.04, -0.15, -0.13);
    frame('oak', x0, x1, y0, y1, 0.05, zf, zf + 0.04);
    giltRect('gold', x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, zf + 0.04, 0.012, 0.004);
  }

  // =========================================================================
  // dimensions
  // =========================================================================
  const HX = L.caseWidth / 2;            // 10
  const ZBK = -L.caseDepth;              // -5
  const BH = L.baseHeight;               // 5.2 (impost)
  const PZ = 0.1;                        // centre pavilion face
  const PX = 1.6;                        // pavilion half width
  const Y_ARCH = 3.93;                   // bottom of the architrave
  const sections = L.sections;
  const impost = sections[0]?.impostY ?? BH;

  // =========================================================================
  // 1. BASE STOREY
  // =========================================================================
  // ---- openings ----
  const holesMain = [];
  const tallG = { x0: 1.88, x1: 2.42, y0: 0.7, y1: 3.75, rail: 2.55 };
  const sideG = { x0: 4.85, x1: 6.85, y0: 3.0, y1: 3.78 };
  const door = { x0: -0.78, x1: 0.78, y0: 0.3, y1: 2.5 };
  const pavG = { x0: -0.66, x1: 0.66, y0: 3.0, y1: 3.8 };
  const pavN = { x0: 0.9, x1: 1.12, y0: 3.0, y1: 3.8 };
  const pavHoles = () => [
    rectHole(door.x0, door.x1, door.y0, door.y1),
    rectHole(pavG.x0, pavG.x1, pavG.y0, pavG.y1),
    rectHole(pavN.x0, pavN.x1, pavN.y0, pavN.y1),
    rectHole(-pavN.x1, -pavN.x0, pavN.y0, pavN.y1),
  ];
  for (const s of [1, -1]) {
    holesMain.push(rectHole(Math.min(s * tallG.x0, s * tallG.x1), Math.max(s * tallG.x0, s * tallG.x1), tallG.y0, tallG.y1));
    holesMain.push(rectHole(Math.min(s * sideG.x0, s * sideG.x1), Math.max(s * sideG.x0, s * sideG.x1), sideG.y0, sideG.y1));
  }
  holesMain.push(...pavHoles());

  // ---- main front wall (z -0.06..0) and the entablature beam behind the cornice
  {
    const sh = rectShape(-HX, HX, 0, Y_ARCH);
    sh.holes.push(...holesMain);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false });
    g.translate(0, 0, -0.06);
    add('oak', g);
    box('oak', -HX, HX, Y_ARCH, BH, -0.45, 0);
    // side walls of the base storey and back screen
    for (const s of [-1, 1]) {
      box('oak', s * (HX - 0.06), s * HX, 0, BH, ZBK, -0.06);
      // panels on the outer side faces
      for (let c = 0; c < 4; c++) {
        const za = ZBK + 0.25 + c * 1.15, zb = za + 0.95;
        for (const [ya, yb] of [[0.45, 2.75], [3.0, 3.78]]) {
          const xo = s * HX;
          box('oak', xo, xo + s * 0.03, ya, yb, za, zb);
          box('oak', xo, xo + s * 0.05, ya + 0.08, yb - 0.08, za + 0.08, zb - 0.08);
          box('gold', xo, xo + s * 0.034, ya + 0.04, yb - 0.04, za + 0.04, za + 0.052);
        }
      }
    }
    box('chamber', -HX, HX, 0, L.screenTopY, ZBK - 0.045, ZBK);
  }

  // ---- plinth (wraps round the sides) ----
  const PLINTH = [[0, 0], [0.14, 0], [0.14, 0.17], [0.125, 0.19], [0.105, 0.205], [0.09, 0.23], [0.08, 0.26], [0.06, 0.275], [0.06, 0.28], [0, 0.28]];
  sweep('oak', PLINTH, blockPath(-HX, HX, 0, ZBK), { smooth: false, caps: true });
  bead('gold', blockPath(-HX, HX, 0, ZBK), 0.14, 0.12, 0.135, 0.004);
  // pavilion plinth (projects less: console zone stays clear, z <= 0.24)
  sweep('oak', PLINTH.map(([d, y]) => [d * 0.7, y]), blockPath(-PX, PX, PZ, 0), { smooth: false });
  bead('gold', blockPath(-PX, PX, PZ, 0), 0.098, 0.12, 0.135, 0.004);

  // ---- centre pavilion ----
  {
    const sh = rectShape(-PX, PX, 0.2, 4.06);
    sh.holes.push(...pavHoles());
    const g = new THREE.ExtrudeGeometry(sh, { depth: PZ, bevelEnabled: false });
    add('oak', g);
    // corner pilasters
    pilasterM(1.49, 0.22, 0.28, 3.93, PZ, 0.05, true);
    // door case: pilasters, entablature
    for (const s of [-1, 1]) {
      const xa = s * 0.93;
      box('oak', xa - 0.12, xa + 0.12, 0.28, door.y1, PZ, PZ + 0.05);
      box('oak', xa - 0.135, xa + 0.135, 0.28, 0.5, PZ, PZ + 0.07);
      box('oak', xa - 0.14, xa + 0.14, door.y1 - 0.16, door.y1, PZ, PZ + 0.075);
      box('gold', xa - 0.14, xa + 0.14, door.y1 - 0.12, door.y1 - 0.105, PZ + 0.075, PZ + 0.079);
      frame('oak', xa - 0.07, xa + 0.07, 0.58, door.y1 - 0.24, 0.025, PZ + 0.05, PZ + 0.07);
      giltRect('gold', xa - 0.07, xa + 0.07, 0.58, door.y1 - 0.24, PZ + 0.05, 0.008, 0.004);
      // little gilt drops on the pilaster face
      for (let i = 0; i < 4; i++) ball('gold', xa, 0.75 + i * 0.4, PZ + 0.05, 0.022, 0.6);
    }
    // entablature
    box('oak', -1.12, 1.12, door.y1, door.y1 + 0.1, PZ, PZ + 0.065);
    box('gold', -1.12, 1.12, door.y1 + 0.04, door.y1 + 0.052, PZ + 0.065, PZ + 0.069);
    box('oak', -1.1, 1.1, door.y1 + 0.1, door.y1 + 0.22, PZ, PZ + 0.055);
    for (let i = -5; i <= 5; i++) rosette('gold', i * 0.19, door.y1 + 0.16, PZ + 0.055, 0.035, 0.018);
    const ENT = [[0, 0], [0.02, 0.005], [0.04, 0.03], [0.06, 0.07], [0.068, 0.085], [0.068, 0.12], [0, 0.12]];
    sweep('oak', ENT.map(([d, y]) => [d, y + door.y1 + 0.22]), blockPath(-1.14, 1.14, PZ + 0.07, PZ), { smooth: false, caps: true });
    bead('gold', blockPath(-1.14, 1.14, PZ + 0.07, PZ), 0.068, door.y1 + 0.3, door.y1 + 0.312, 0.004);

    // door: two panelled leaves under a transom with the round medallion
    box('oak', door.x0, door.x1, door.y0, door.y1, -0.05, -0.012);
    const zD = -0.012;
    box('oak', -0.015, 0.015, door.y0, 1.92, zD, zD + 0.02);           // meeting stile
    box('oak', door.x0, door.x1, 1.92, 1.99, zD, zD + 0.03);          // transom rail
    box('gold', door.x0, door.x1, 1.95, 1.962, zD + 0.03, zD + 0.034);
    for (const s of [-1, 1]) {
      const xa = s * 0.06, xb = s * 0.72;
      panel(Math.min(xa, xb), Math.max(xa, xb), 0.42, 1.02, zD);
      panel(Math.min(xa, xb), Math.max(xa, xb), 1.12, 1.82, zD);
      ball('gold', s * 0.045, 1.05, zD + 0.02, 0.018);                // knob
      panel(Math.min(s * 0.37, s * 0.72), Math.max(s * 0.37, s * 0.72), 2.05, 2.44, zD);
    }
    // medallion: dark square ground, gilt rings, radiating leaves, boss
    const my = 2.235, mz = zD;
    frame('oak', -0.27, 0.27, my - 0.25, my + 0.25, 0.035, mz, mz + 0.035);
    box('recess', -0.27, 0.27, my - 0.25, my + 0.25, mz, mz + 0.004);
    const ringG = new THREE.TorusGeometry(0.21, 0.016, 6, 40);
    ringG.translate(0, my, mz + 0.016); add('gold', ringG);
    const ringG2 = new THREE.TorusGeometry(0.14, 0.01, 6, 32);
    ringG2.translate(0, my, mz + 0.012); add('gold', ringG2);
    for (let i = 0; i < 16; i++) {
      const a = (i * PI) / 8;
      leaf(i % 2 ? 'goldMatte' : 'gold', Math.cos(a) * 0.175, my + Math.sin(a) * 0.175, mz + 0.012, 0.028, 0.012, a, 0.008);
    }
    rosette('gold', 0, my, mz + 0.004, 0.1, 0.035);
    for (const [cx, cy] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) ball('goldMatte', cx, my + cy, mz + 0.004, 0.02, 0.6);

    // pavilion grilles above the door case
    grille('baluster', pavG.x0, pavG.x1, pavG.y0, pavG.y1, PZ);
    grille('lattice', pavN.x0, pavN.x1, pavN.y0, pavN.y1, PZ);
    grille('lattice', -pavN.x1, -pavN.x0, pavN.y0, pavN.y1, PZ);
  }

  // ---- pilasters, panels and grilles of the main wall ----
  pilasterM(2.75, 0.24, 0.28, Y_ARCH, 0, 0.05);
  pilasterM(4.0, 0.5, 0.28, Y_ARCH, 0, 0.06, false);
  pilasterM(7.6, 0.32, 0.28, Y_ARCH, 0, 0.05);
  pilasterM(9.7, 0.5, 0.28, Y_ARCH, 0, 0.06, false);
  for (const s of [1, -1]) {
    const mx = (a, b) => [Math.min(s * a, s * b), Math.max(s * a, s * b)];
    // tall narrow grille: lattice below, arcaded balusters above a rail
    const [tx0, tx1] = mx(tallG.x0, tallG.x1);
    const pl = new THREE.PlaneGeometry(tx1 - tx0, tallG.rail - tallG.y0);
    pl.translate((tx0 + tx1) / 2, (tallG.y0 + tallG.rail) / 2, -0.025); add('grilleL', pl);
    const pb = new THREE.PlaneGeometry(tx1 - tx0, tallG.y1 - tallG.rail);
    pb.translate((tx0 + tx1) / 2, (tallG.rail + tallG.y1) / 2, -0.025); add('grilleB', pb);
    box('recess', tx0 - 0.04, tx1 + 0.04, tallG.y0 - 0.04, tallG.y1 + 0.04, -0.15, -0.13);
    frame('oak', tx0, tx1, tallG.y0, tallG.y1, 0.05, 0, 0.04);
    giltRect('gold', tx0 - 0.05, tx1 + 0.05, tallG.y0 - 0.05, tallG.y1 + 0.05, 0.04, 0.012, 0.004);
    box('oak', tx0, tx1, tallG.rail - 0.04, tallG.rail + 0.04, -0.03, 0.035);
    box('gold', tx0, tx1, tallG.rail - 0.006, tallG.rail + 0.006, 0.035, 0.039);
    // small panel below
    const [ux0, ux1] = mx(1.9, 2.4);
    panel(ux0, ux1, 0.36, 0.56, 0);
    // side bay wide grille + large panel below
    const [sx0, sx1] = mx(sideG.x0, sideG.x1);
    grille('lattice', sx0, sx1, sideG.y0, sideG.y1, 0);
    const [px0, px1] = mx(4.45, 7.24);
    panel(px0, px1, 0.45, 2.75, 0);
    const [qx0, qx1] = mx(4.45, 4.7), [rx0, rx1] = mx(7.0, 7.24);
    panel(qx0, qx1, 3.0, 3.78, 0);
    panel(rx0, rx1, 3.0, 3.78, 0);
  }
  // bay between the tall grille and the corbel pilaster
  panelM(2.95, 3.66, 0.45, 2.75, 0);
  panelM(2.95, 3.66, 3.0, 3.78, 0);
  // outermost bays
  panelM(7.92, 9.3, 0.45, 2.75, 0);
  panelM(7.92, 9.3, 3.0, 3.78, 0);
  // dado rail across the plain bays
  for (const [a, b] of [[2.87, 3.75], [4.25, 7.44], [7.76, 9.45]]) {
    boxM('oak', a, b, 2.83, 2.92, 0, 0.04);
    boxM('gold', a, b, 2.87, 2.882, 0.04, 0.044);
  }

  // ---- architrave + rosette frieze + cornice (wraps round the sides) ----
  const CORNICE = [
    [0, Y_ARCH], [0.07, Y_ARCH], [0.07, 3.975], [0.085, 3.99], [0.085, 4.045], [0.1, 4.06], [0.1, 4.085], [0.11, 4.1],
    [0.11, 4.5],
    [0.15, 4.51], [0.15, 4.54], [0.16, 4.545], [0.16, 4.67], [0.24, 4.675], [0.24, 4.70],
    [0.26, 4.71], [0.285, 4.735], [0.3, 4.765], [0.305, 4.79], [0.5, 4.8], [0.51, 4.81], [0.51, 4.97], [0.53, 4.98], [0.53, 5.0],
    [0.545, 5.02], [0.565, 5.06], [0.575, 5.1], [0.58, 5.12], [0.58, BH], [0, BH],
  ];
  const corniceUpper = CORNICE.slice(CORNICE.findIndex((p) => p[1] === 4.5));
  const mainPath = blockPath(-HX, HX, 0, ZBK);
  sweep('oak', CORNICE, mainPath, { smooth: false, caps: true });
  bead('gold', mainPath, 0.085, 4.012, 4.024, 0.004);
  bead('gold', mainPath, 0.11, 4.47, 4.48, 0.004);
  bead('gold', mainPath, 0.51, 4.88, 4.895, 0.004);
  bead('gold', mainPath, 0.58, 5.15, 5.162, 0.004);

  // cornice breaks forward over the corbels
  const corbelX = [-9.72, -4.0, 4.0, 9.72];
  const ressaut = (xc) => {
    const x0 = xc - 0.3, x1 = Math.min(xc + 0.3, HX - 0.02), x0c = Math.max(x0, -HX + 0.02);
    const p = blockPath(x0c, x1, 0.08, 0).map((s) => ({ ...s, dy: 0.02 }));
    sweep('oak', [[0, 4.5], ...corniceUpper], p, { smooth: false });
    bead('gold', p, 0.51, 4.88, 4.895, 0.004);
    bead('gold', p, 0.58, 5.15, 5.162, 0.004);
  };
  corbelX.forEach(ressaut);
  const nearCorbel = (x, r) => corbelX.some((c) => Math.abs(x - c) < r);

  // dentils and a row of gilt beads
  for (let x = -HX + 0.08; x <= HX - 0.08; x += 0.1) {
    if (nearCorbel(x, 0.36)) continue;
    box('oak', x - 0.028, x + 0.028, 4.56, 4.665, 0.16, 0.232);
  }
  for (let x = -HX + 0.05; x <= HX - 0.05; x += 0.05) {
    if (nearCorbel(x, 0.34)) continue;
    ball('goldMatte', x, 4.742, 0.282, 0.014, 0.8);
  }
  // rosette coffers in the frieze
  for (let i = -24; i <= 24; i++) {
    const x = i * 0.405;
    if (Math.abs(x) > HX - 0.2 || nearCorbel(x, 0.42)) continue;
    rosettePanel(x, 4.29, 0.11, 0.3);
  }

  // ---- scrolled corbels ----
  {
    const cs = new THREE.Shape();
    cs.moveTo(0, 0); cs.lineTo(0.5, 0); cs.lineTo(0.5, -0.05); cs.lineTo(0.46, -0.07); cs.lineTo(0.36, -0.07);
    for (let i = 0; i <= 12; i++) {
      const a = (80 - (170 * i) / 12) * PI / 180;
      cs.lineTo(0.32 + 0.14 * Math.cos(a), -0.21 + 0.14 * Math.sin(a));
    }
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      cs.lineTo(0.3 - 0.15 * t - 0.03 * Math.sin(PI * t), -0.36 - 0.42 * t);
    }
    for (let i = 0; i <= 8; i++) {
      const a = (60 - (150 * i) / 8) * PI / 180;
      cs.lineTo(0.12 + 0.07 * Math.cos(a), -0.85 + 0.07 * Math.sin(a));
    }
    cs.lineTo(0.04, -0.95); cs.lineTo(0, -0.95); cs.closePath();
    const W = 0.36, top = 4.52, zw = 0.06;
    const DROP = [[0.001, 0], [0.05, 0.02], [0.06, 0.06], [0.035, 0.1], [0.045, 0.14], [0.02, 0.2], [0.001, 0.22]];
    for (const xc of corbelX) {
      const g = new THREE.ExtrudeGeometry(cs, { depth: W, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 4 });
      g.rotateY(-PI / 2);
      g.translate(xc + W / 2, top, zw);
      add('oak', g);
      for (const s of [-1, 1]) {
        const xs = xc + s * (W / 2 + 0.008);
        const big = new THREE.CylinderGeometry(0.12, 0.12, 0.012, 20); big.rotateZ(PI / 2); big.translate(xs + s * 0.006, top - 0.21, zw + 0.32); add('oak', big);
        const tor = new THREE.TorusGeometry(0.085, 0.011, 5, 24); tor.rotateY(PI / 2); tor.translate(xs + s * 0.012, top - 0.21, zw + 0.32); add('gold', tor);
        ball('gold', xs + s * 0.012, top - 0.21, zw + 0.32, 0.03);
        const sm = new THREE.CylinderGeometry(0.06, 0.06, 0.012, 16); sm.rotateZ(PI / 2); sm.translate(xs + s * 0.006, top - 0.85, zw + 0.12); add('oak', sm);
        ball('gold', xs + s * 0.012, top - 0.85, zw + 0.12, 0.02);
      }
      // acanthus leaf down the front and the gilt top fillet
      for (let i = 0; i < 4; i++) leaf('gold', xc, top - 0.42 - i * 0.1, zw + 0.27 - i * 0.035, 0.08, 0.05 - i * 0.007, PI / 2, 0.02);
      box('gold', xc - W / 2 - 0.012, xc + W / 2 + 0.012, top - 0.045, top - 0.03, zw, zw + 0.516);
      const dg = sweepGeo(DROP.map(([r, y]) => [r, -y]).reverse(), ring12);
      dg.translate(xc, top - 0.95, zw + 0.07);
      add('gold', dg);
    }
  }

  // =========================================================================
  // 2. ABOVE THE IMPOST
  // =========================================================================
  const info = { posts: [], archOpenings: [], plinths: [] };
  const PZC = -0.32;              // post centre plane (behind the column backs)
  const PW = L.postW ?? 0.22;

  const colUV = (g) => {
    const P = g.attributes.position, U = g.attributes.uv;
    for (let i = 0; i < P.count; i += 3) {
      const u = [0, 1, 2].map((k) => (Math.atan2(P.getZ(i + k), P.getX(i + k)) / (2 * PI) + 0.5) * 3);
      if (Math.max(...u) - Math.min(...u) > 1.5) for (let k = 0; k < 3; k++) if (u[k] < 1.5) u[k] += 3;
      for (let k = 0; k < 3; k++) U.setXY(i + k, u[k], P.getY(i + k) / 0.45);
    }
  };

  function column(xa, sec) {
    const imp = sec.impostY, cr = sec.colR, s = imp + sec.springH;
    const rs = cr * 0.8, zb = -0.19;            // nothing of the column reaches behind zb
    // pedestal (0.9 m) with a square rosette panel
    const yP = imp + 0.9;
    box('oak', xa - cr - 0.04, xa + cr + 0.04, imp, imp + 0.1, zb, cr + 0.04);
    box('oak', xa - cr - 0.02, xa + cr + 0.02, imp + 0.1, imp + 0.14, zb, cr + 0.02);
    box('oak', xa - cr, xa + cr, imp + 0.14, imp + 0.76, zb, cr);
    box('oak', xa - cr - 0.02, xa + cr + 0.02, imp + 0.76, imp + 0.8, zb, cr + 0.02);
    box('oak', xa - cr - 0.035, xa + cr + 0.035, imp + 0.8, yP, zb, cr + 0.035);
    box('gold', xa - cr - 0.035, xa + cr + 0.035, imp + 0.845, imp + 0.857, cr + 0.035, cr + 0.039);
    box('gold', xa - cr - 0.04, xa + cr + 0.04, imp + 0.06, imp + 0.072, cr + 0.04, cr + 0.044);
    rosettePanel(xa, imp + 0.45, cr, Math.min(0.32, 2 * cr - 0.04));
    // attic base
    lathe('cream', [[cr * 0.93, yP], [cr * 0.93, yP + 0.035], ...torusProf(cr * 0.86, yP + 0.075, 0.04), [rs + 0.03, yP + 0.12], ...torusProf(rs + 0.02, yP + 0.145, 0.025, 6), [rs, yP + 0.17]], xa, 0, 28, { smooth: true });
    lathe('gold', torusProf(cr * 0.86 + 0.002, yP + 0.075, 0.03, 6).map(([d, y]) => [d + 0.012, y]), xa, 0, 28);
    const y0 = yP + 0.17, y3 = s - 0.5;
    const y1 = y0 + (y3 - y0) / 3, y2 = y0 + (2 * (y3 - y0)) / 3;
    // fluted (reeded) lower third
    const flutes = (st) => {
      const a = Math.atan2(st.nz, st.nx);
      const r = rs - 0.012 * Math.abs(Math.sin(10 * a));
      return [[r, y0], [r, y1]];
    };
    add('blue', (() => { const g = sweepGeo(flutes, ringPath(120), { smooth: false }); g.translate(xa, 0, 0); return g; })());
    // stencilled upper shaft
    lathe('colPaint', [[rs, y1 + 0.07], [rs * 0.985, y2], [rs * 0.97, y3]], xa, 0, 28, { uv: colUV });
    // turned bands
    for (const yb of [y1, y2 + 0.0]) {
      const r0 = yb === y1 ? rs : rs * 0.985;
      lathe('gold', [[r0, yb], ...torusProf(r0 + 0.004, yb + 0.035, 0.022, 6), [r0, yb + 0.07]], xa, 0, 24);
    }
    lathe('cream', [[rs * 0.985 + 0.006, y2 + 0.071], [rs * 0.985 + 0.006, y2 + 0.1], [rs * 0.985 - 0.001, y2 + 0.1]], xa, 0, 24);
    // astragal, necking, echinus
    lathe('gold', torusProf(rs * 0.97, y3 + 0.02, 0.022, 6), xa, 0, 24);
    lathe('cream', [[rs * 0.97, y3 + 0.04], [rs * 0.97, y3 + 0.1], [rs + 0.01, y3 + 0.12], [rs + 0.05, y3 + 0.15], [rs + 0.065, y3 + 0.18], [rs + 0.06, y3 + 0.19], [0.001, y3 + 0.19]], xa, 0, 24);
    for (let i = 0; i < 12; i++) {
      const a = (i * PI) / 6;
      if (Math.sin(a) < -0.3) continue;          // keep the back clear
      ball('gold', xa + Math.cos(a) * (rs + 0.052), y3 + 0.155, Math.sin(a) * (rs + 0.052), 0.02);
    }
    // volutes (scroll axes along z) and canalis
    const vy = s - 0.33, vr = 0.075, vx = rs + 0.035;
    for (const sx of [-1, 1]) {
      const cyl = new THREE.CylinderGeometry(vr, vr, 0.34, 18); cyl.rotateX(PI / 2); cyl.translate(xa + sx * vx, vy, 0); add('cream', cyl);
      for (const sz of [-1, 1]) {
        const zf = sz * 0.17 + sz * 0.004;
        const t1 = new THREE.TorusGeometry(0.055, 0.01, 5, 20); t1.translate(xa + sx * vx, vy, zf); add('gold', t1);
        const t2 = new THREE.TorusGeometry(0.03, 0.008, 5, 16); t2.translate(xa + sx * vx, vy, zf); add('gold', t2);
        ball('gold', xa + sx * vx, vy, zf, 0.016, 0.6);
      }
    }
    box('cream', xa - vx, xa + vx, s - 0.29, s - 0.22, -0.17, 0.17);
    box('red', xa - vx, xa + vx, s - 0.265, s - 0.25, 0.17, 0.174);
    // abacus and impost block
    box('blue', xa - 0.25, xa + 0.25, s - 0.22, s - 0.14, zb, 0.23);
    box('gold', xa - 0.25, xa + 0.25, s - 0.185, s - 0.173, 0.23, 0.234);
    box('cream', xa - 0.23, xa + 0.23, s - 0.14, s - 0.002, zb, 0.2);
    box('red', xa - 0.23, xa + 0.23, s - 0.03, s - 0.018, 0.2, 0.204);
    rosette('gold', xa, s - 0.075, 0.2, 0.04, 0.018);
  }

  function archSection(sec) {
    const xc = sec.x, hw = sec.width / 2, cr = sec.colR, imp = sec.impostY;
    const s = imp + sec.springH, R = sec.archR, rd = sec.recessDepth, toeY = imp + sec.toeH;
    const AW = 0.34;
    for (const sx of [-1, 1]) column(xc + sx * (hw - cr), sec);
    // ---- archivolt (free-standing, all of it behind z = 0) ----
    const st = semiStations(xc, s, R, 48);
    add('cream', sweepXY([[AW, -0.2], [AW, -0.06], [AW - 0.005, -0.035], [AW - 0.02, -0.02], [AW - 0.035, -0.02], [AW - 0.04, -0.04]], st, 0));
    add('blue', sweepXY([[AW - 0.04, -0.04], [0.22, -0.04]], st, 0));
    add('gold', sweepXY([[0.22, -0.04], [0.218, -0.02], [0.21, -0.008], [0.2, -0.02], [0.198, -0.04]], st, 0));
    add('cream', sweepXY([[0.198, -0.04], [0.1, -0.04]], st, 0));
    add('gold', sweepXY([[0.1, -0.04], [0.095, -0.015], [0.085, -0.006], [0.075, -0.02], [0.07, -0.03]], st, 0));
    add('cream', sweepXY([[0.07, -0.03], [0.05, -0.03], [0.03, -0.045], [0, -0.045], [0, -0.2]], st, 0));
    add('recess', sweepXY([[0, -0.2], [AW, -0.2]], st, 0));
    add('red', sweepXY([[0.152, -0.04], [0.152, -0.037], [0.146, -0.037], [0.146, -0.04]], st, 0));
    // beads round the outer band, stencil dots on the fascia
    const nb = Math.round((PI * (R + 0.26)) / 0.085);
    for (let i = 0; i <= nb; i++) {
      const t = PI - (PI * i) / nb;
      ball(i % 2 ? 'cream' : 'gold', xc + Math.cos(t) * (R + 0.26), s + Math.sin(t) * (R + 0.26), -0.042, i % 2 ? 0.018 : 0.026, 0.9);
    }
    const nd = Math.round((PI * (R + 0.15)) / 0.17);
    for (let i = 0; i <= nd; i++) {
      const t = PI - (PI * (i + 0.5)) / (nd + 1);
      leaf('blue', xc + Math.cos(t) * (R + 0.15), s + Math.sin(t) * (R + 0.15), -0.04, 0.04, 0.022, t, 0.006);
    }
    // end caps over the impost blocks
    for (const sx of [-1, 1]) {
      const a = xc + sx * R, b = xc + sx * (R + AW);
      box('cream', Math.min(a, b), Math.max(a, b), s - 0.03, s, -0.2, -0.004);
    }
    // ---- recess: dark back wall (arch-headed), dark side cheeks ----
    const R2 = R + AW;
    const bs = new THREE.Shape();
    bs.moveTo(xc - R2, imp); bs.lineTo(xc + R2, imp); bs.lineTo(xc + R2, s);
    bs.absarc(xc, s, R2, 0, PI, false);
    bs.lineTo(xc - R2, imp);
    const bg = new THREE.ExtrudeGeometry(bs, { depth: 0.02, bevelEnabled: false, curveSegments: 40 });
    bg.translate(0, 0, -rd - 0.02);
    add('recess', bg);
    for (const sx of [-1, 1]) {
      const a = xc + sx * R, b = xc + sx * (R + 0.03);
      box('recess', Math.min(a, b), Math.max(a, b), imp, s, -rd, -0.2);
    }
    // ---- toe-board ----
    box('oak', xc - R, xc + R, imp, toeY, -rd, 0.02);
    box('oak', xc - R, xc + R, toeY - 0.04, toeY, 0.02, 0.05);
    box('gold', xc - R, xc + R, toeY - 0.025, toeY - 0.013, 0.05, 0.054);
    const ihw = hw - 2 * cr;
    panel(xc - ihw + 0.1, xc + ihw - 0.1, imp + 0.07, toeY - 0.1, 0.02);
    info.archOpenings.push({ id: sec.id, x: xc, springY: s, archR: R, innerHalfWidth: +ihw.toFixed(4), recessZ: -rd, toeY });
  }

  function clusterSection(sec) {
    const imp = sec.impostY, top = imp + sec.plinthH;
    const x0 = sec.x - sec.width / 2 + PW / 2 + 0.005, x1 = sec.x + sec.width / 2 - PW / 2 - 0.005;
    const h = top - imp;
    const yA = imp + h * 0.22, yB = imp + h * 0.76;
    // step 1 (plinth), step 2 (panelled die), step 3 (moulded cap)
    box('oak', x0, x1, imp, yA, -0.1, 0.9);
    box('gold', x0, x1, yA - 0.035, yA - 0.023, 0.9, 0.904);
    box('oak', x0 + 0.04, x1 - 0.04, yA, yB, -0.1, 0.83);
    sweep('oak', [[0, 0], [0.012, 0.01], [0.03, 0.04], [0.045, 0.08], [0.05, top - yB], [0, top - yB]].map(([d, y]) => [d, y + yB]),
      blockPath(x0 + 0.01, x1 - 0.01, 0.83, -0.1), { smooth: false, caps: true });
    box('oak', x0 + 0.01, x1 - 0.01, top - 0.02, top, -0.1, 0.83);
    bead('gold', blockPath(x0 + 0.01, x1 - 0.01, 0.83, -0.1), 0.05, top - 0.04, top - 0.028, 0.004);
    // die front: panels with square rosettes
    const n = Math.max(1, Math.round((x1 - x0 - 0.08) / 0.8));
    const pw = (x1 - x0 - 0.08) / n;
    for (let i = 0; i < n; i++) {
      const a = x0 + 0.04 + i * pw, b = a + pw;
      const cx = (a + b) / 2, cy = (yA + yB) / 2, sz = Math.min(0.22, yB - yA - 0.04);
      frame('oak', a + 0.04, b - 0.04, yA + 0.03, yB - 0.03, 0.02, 0.83, 0.85);
      rosettePanel(cx, cy, 0.83, sz);
      for (const sx of [-1, 1]) {
        const ea = cx + sx * (sz / 2 + 0.03), eb = cx + sx * (pw / 2 - 0.07);
        if (Math.abs(eb - ea) > 0.12) {
          fieldRect('oak', Math.min(ea, eb), Math.max(ea, eb), yA + 0.05, yB - 0.05, 0.83, 0.02, 0.03);
        }
      }
    }
    info.plinths.push({ id: sec.id, x: (x0 + x1) / 2, width: x1 - x0, topY: top, zMin: -0.1, zMax: 0.9 });
    // gauze backing and pipe-rack tie rails between the posts
    const g0 = sec.x - sec.width / 2 + PW / 2, g1 = sec.x + sec.width / 2 - PW / 2;
    box('gauze', g0, g1, imp, Math.min(9.0, L.screenTopY), -0.165, -0.155);
    for (const yr of [imp + 4.0, imp + 6.6]) {
      box('chamber', g0, g1, yr - 0.03, yr + 0.03, -0.27, -0.22);
    }
  }

  for (const sec of sections) {
    if (sec.kind === 'arch') archSection(sec);
    else if (sec.kind === 'cluster') clusterSection(sec);
  }

  // ---- slender stencilled posts at every section boundary ----
  {
    const xs = [];
    for (const sec of sections) for (const x of [sec.x - sec.width / 2, sec.x + sec.width / 2]) {
      if (!xs.some((v) => Math.abs(v - x) < 1e-3)) xs.push(+x.toFixed(4));
    }
    xs.sort((a, b) => a - b);
    const h = PW / 2, zf = PZC + h, zbk = PZC - h;
    for (const px of xs) {
      const yb = impost, yt = impost + 7.0, ys = yb + 0.32;
      // moulded base block (kept behind z = -0.2)
      box('oak', px - h - 0.035, px + h + 0.035, yb, yb + 0.22, zbk - 0.035, -0.2);
      box('oak', px - h - 0.02, px + h + 0.02, yb + 0.22, ys, zbk - 0.02, -0.205);
      box('gold', px - h - 0.035, px + h + 0.035, yb + 0.18, yb + 0.192, -0.2, -0.196);
      // painted shaft
      const g = new THREE.BoxGeometry(PW, yt - ys, PW);
      const U = g.attributes.uv;
      for (let i = 0; i < U.count; i++) U.setY(i, U.getY(i) * (yt - ys) / 0.66);
      g.translate(px, (ys + yt) / 2, PZC);
      add('postPaint', g);
      // gilt collars
      for (let yc = ys + 1.2; yc < yt - 0.5; yc += 1.6) box('gold', px - h - 0.006, px + h + 0.006, yc, yc + 0.035, zbk - 0.006, zf + 0.006);
      // cap and finial
      box('oak', px - h - 0.03, px + h + 0.03, yt, yt + 0.06, zbk - 0.03, zf + 0.03);
      box('gold', px - h - 0.03, px + h + 0.03, yt + 0.025, yt + 0.037, zf + 0.03, zf + 0.034);
      box('oak', px - h - 0.05, px + h + 0.05, yt + 0.06, yt + 0.12, zbk - 0.05, zf + 0.05);
      const FIN = [[0.001, 0], [0.06, 0], [0.06, 0.02], [0.04, 0.04], [0.075, 0.1], [0.08, 0.14], [0.06, 0.19], [0.03, 0.22], [0.035, 0.25], [0.02, 0.3], [0.008, 0.4], [0.001, 0.42]];
      lathe('gold', FIN.map(([r, y]) => [r, y + yt + 0.12]), px, PZC, 16);
      info.posts.push(px);
    }
  }

  // =========================================================================
  // 3. CHAMBER SCREENS above the base (plain, dark, up to screenTopY)
  // =========================================================================
  for (const s of [-1, 1]) {
    box('chamber', s * (HX - 0.05), s * HX, BH, L.screenTopY, ZBK, PZC - PW / 2 - 0.01);
  }

  // =========================================================================
  // merge (one mesh per material) + world-space UVs where needed
  // =========================================================================
  let triangles = 0;
  for (const [key, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    const geo = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    const P = geo.attributes.position, U = geo.attributes.uv;
    if (key === 'oak' || key === 'oakDeep' || key === 'chamber') {
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 3) {
        a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
        n.subVectors(b, a).cross(c.sub(a));
        const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
        for (let k = 0; k < 3; k++) {
          const x = P.getX(i + k), y = P.getY(i + k), z = P.getZ(i + k);
          if (ay > ax && ay > az) U.setXY(i + k, z * 0.5, x * 0.25);
          else if (ax > az) U.setXY(i + k, z * 0.5, y * 0.25);
          else U.setXY(i + k, x * 0.5, y * 0.25);
        }
      }
    } else if (key === 'grilleL' || key === 'grilleB') {
      const tw = key === 'grilleL' ? 0.25 : 0.1, th = key === 'grilleL' ? 0.25 : 0.2;
      for (let i = 0; i < P.count; i++) U.setXY(i, P.getX(i) / tw + 0.5, (P.getY(i) - 0.7) / th);
    }
    U.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, MAT[key]);
    mesh.name = `case_${key}`;
    mesh.castShadow = !(key === 'grilleL' || key === 'grilleB' || key === 'gauze');
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;     // static (vertices are in group space)
    triangles += P.count / 3;
    group.add(mesh);
  }
  leafBase.dispose();
  ballBase.dispose();
  group.userData.info = info;
  group.userData.stats = { drawCalls: group.children.length, triangles };
  return group;
}
