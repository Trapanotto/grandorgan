// Architectural context for the Royal Albert Hall organ: organ gallery floor,
// choir tiers, stage, the curved hall wall with box tiers and gallery arcade,
// and a hint of the ceiling with the acoustic "mushrooms".
//
// Everything is static. Geometry is merged per material; repeated elements are
// InstancedMeshes. Nothing enters LAYOUT.reserved (the organ + console volume).
//
// Mood: the organ is the lit subject; the hall sits in warm, dim light. All hall
// surfaces carry a baked light falloff (vertex colours on merged meshes,
// instance colours on instanced ones) that darkens with height and with
// distance from the organ, so the walls recede into darkness.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// ---------------------------------------------------------------- plan curve
// Hall wall in plan: half an ellipse behind/around the organ (semi-axes A, B,
// centre z = ZC) that continues towards the auditorium as a much longer
// ellipse (semi-axis B2) so the side walls run on almost straight.
const A = 25.66, B = 17, B2 = 60, ZC = 9;
const T_MAX = THREE.MathUtils.degToRad(112);

function buildCurveTable() {
  const N = 4000;
  const pts = [];
  let cum = 0, px = 0, pz = 0;
  for (let i = 0; i <= N; i++) {
    const t = -T_MAX + (2 * T_MAX * i) / N;
    const b = Math.abs(t) <= Math.PI / 2 ? B : B2;
    const x = A * Math.sin(t), z = ZC - b * Math.cos(t);
    let tx = A * Math.cos(t), tz = b * Math.sin(t);
    const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    if (i > 0) cum += Math.hypot(x - px, z - pz);
    px = x; pz = z;
    pts.push({ s: cum, x, z, tx, tz });
  }
  const half = cum / 2;
  for (const p of pts) p.s -= half;
  return { pts, half };
}

// ---------------------------------------------------------------- small math
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
function ss(e0, e1, x) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
const frac = (x) => x - Math.floor(x);

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// tileable value noise on the unit square (px, py = cells per tile)
function makeNoise(seed) {
  const r = rng(seed), N = 256, g = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) g[i] = r();
  return (u, v, px, py) => {
    const fx = u * px, fy = v * py;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px;
    const y0 = ((iy % py) + py) % py, y1 = (y0 + 1) % py;
    const a = g[y0 * N + x0], b = g[y0 * N + x1], c = g[y1 * N + x0], d = g[y1 * N + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// ---------------------------------------------------------------- procedural textures
// fn(u, v, o) fills o = { r, g, b (sRGB 0..1), h (relief 0..1), rough, metal }.
// Returns { map, bump, mr } (mr: G = roughness, B = metalness) as CanvasTextures.
function canvasTex(w, h, data, srgb) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  img.data.set(data);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function paint(w, h, fn, withMR = false) {
  const col = new Uint8ClampedArray(w * h * 4), bmp = new Uint8ClampedArray(w * h * 4);
  const mr = withMR ? new Uint8ClampedArray(w * h * 4) : null;
  const o = { r: 0, g: 0, b: 0, h: 0, rough: 1, metal: 0 };
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h; // canvas top row = v 1 (flipY)
    for (let x = 0; x < w; x++) {
      o.r = o.g = o.b = o.h = 0; o.rough = 1; o.metal = 0;
      fn((x + 0.5) / w, v, o);
      const k = (y * w + x) * 4;
      col[k] = o.r * 255; col[k + 1] = o.g * 255; col[k + 2] = o.b * 255; col[k + 3] = 255;
      bmp[k] = bmp[k + 1] = bmp[k + 2] = o.h * 255; bmp[k + 3] = 255;
      if (mr) { mr[k] = 255; mr[k + 1] = o.rough * 255; mr[k + 2] = o.metal * 255; mr[k + 3] = 255; }
    }
  }
  return { map: canvasTex(w, h, col, true), bump: canvasTex(w, h, bmp, false), mr: mr ? canvasTex(w, h, mr, false) : null };
}

const mix3 = (o, a, b, t) => { o.r = a[0] + (b[0] - a[0]) * t; o.g = a[1] + (b[1] - a[1]) * t; o.b = a[2] + (b[2] - a[2]) * t; };

function makeHallTextures(boxAR, bayW, bayH) {
  const nz = makeNoise(1871);

  // plaster: soft mottling, one tile = 3 x 3 m
  const plaster = paint(256, 256, (u, v, o) => {
    const n = 0.5 * nz(u, v, 4, 4) + 0.3 * nz(u, v, 12, 12) + 0.2 * nz(u, v, 40, 40);
    const f = nz(u, v, 128, 128);
    const val = 0.8 + 0.17 * n + 0.05 * f;
    o.r = val; o.g = val * (0.97 + 0.04 * n); o.b = val * (0.9 + 0.08 * n);
    o.h = 0.6 * n + 0.4 * f;
  });

  // terracotta frieze: egg-and-dart borders, running scroll with rosettes and
  // palmettes. One tile = 2 x 1 band heights. Painted twice: terracotta (main
  // entablature) and pale cream relief (balcony fronts beside the organ).
  const friezePainter = (ground, relief) => (u, v, o) => {
    const aa = 0.006;
    const band = (x, c, w) => ss(w + aa, w - aa, Math.abs(x - c));
    let h = Math.max(0.65 * band(v, 0.13, 0.012), 0.65 * band(v, 0.87, 0.012));
    if (v < 0.014 || v > 0.986) h = Math.max(h, 0.55);
    const ue = frac(u * 10) - 0.5;
    for (const c of [0.065, 0.935]) {
      const e = Math.hypot(ue / 0.34, (v - c) / 0.045);
      h = Math.max(h, 0.9 * ss(1.0, 0.75, e));
      if (Math.abs(ue) > 0.43 && Math.abs(v - c) < 0.04) h = Math.max(h, 0.55);
    }
    // vine
    const wave = 0.5 + 0.2 * Math.sin(2 * Math.PI * u);
    const slope = 0.2 * Math.PI * Math.cos(2 * Math.PI * u);
    const dv = Math.abs(v - wave) / Math.sqrt(1 + slope * slope);
    if (v > 0.15 && v < 0.85) h = Math.max(h, 0.85 * ss(0.024, 0.013, dv));
    for (const cu of [0, 0.5, 1]) h = Math.max(h, 0.9 * ss(0.036, 0.026, Math.hypot((u - cu) * 2, v - 0.5)));
    { // rosette under the crest
      const dx = (u - 0.25) * 2, dy = v - 0.4;
      const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const pr = 0.15 * (0.72 + 0.28 * Math.cos(8 * a));
      h = Math.max(h, 0.75 * ss(pr + 0.01, pr - 0.01, r) * (0.75 + 0.25 * (1 - r / 0.15)));
      if (Math.abs(r - 0.06) < 0.008) h *= 0.55;
      h = Math.max(h, ss(0.045, 0.035, r));
    }
    { // palmette above the trough
      const dx = (u - 0.75) * 2, dy = v - 0.42;
      const r = Math.hypot(dx, dy), a = Math.atan2(dx, dy);
      if (Math.abs(a) < 1.25 && dy > -0.02) {
        const k = ((a + 1.25) / 2.5) * 7;
        const lobe = 1 - Math.abs(frac(k) - 0.5) * 2;
        const rmax = 0.34 * (0.7 + 0.3 * Math.cos(a)) * (0.75 + 0.25 * lobe);
        const inside = ss(rmax + 0.01, rmax - 0.01, r) * ss(0.12, 0.32, lobe) * ss(0.03, 0.06, r);
        h = Math.max(h, 0.85 * inside * (0.65 + 0.35 * (1 - r / rmax)));
      }
      h = Math.max(h, 0.9 * ss(1, 0.8, Math.hypot(dx / 0.09, (dy + 0.02) / 0.05)));
    }
    const n = 0.5 * nz(u, v, 32, 16) + 0.5 * nz(u, v, 128, 64);
    mix3(o, ground, relief, Math.min(1, h * 1.15));
    const s = 0.88 + 0.14 * n;
    o.r *= s; o.g *= s; o.b *= s;
    o.h = 0.85 * h + 0.1 * n;
  };
  const frieze = paint(512, 256, friezePainter([0.5, 0.24, 0.14], [0.8, 0.6, 0.38]));
  const friezeLight = paint(512, 128, friezePainter([0.56, 0.5, 0.42], [0.9, 0.85, 0.74]));

  // box-front panel: one tile per box (u across box width, v over the panel height)
  const cream = [0.7, 0.6, 0.45], creamDeep = [0.6, 0.5, 0.37], gilt = [0.82, 0.6, 0.27];
  const panel = paint(512, 160, (u, v, o) => {
    const AR = boxAR, X = u * AR, Y = v;
    const d = Math.min(X, AR - X, Y, 1 - Y);
    let h = d < 0.1 ? 0.7 : d < 0.15 ? 0.7 - ((d - 0.1) / 0.05) * 0.4 : 0.3;
    let gold = ss(0.015, 0.008, Math.abs(d - 0.085));
    gold = Math.max(gold, ss(0.009, 0.005, Math.abs(d - 0.19)));
    const cx = X - AR / 2, cy = Y - 0.5;
    const e = Math.hypot(cx / 0.42, cy / 0.3);
    if (e < 1) h = Math.max(h, 0.5 + 0.3 * (1 - e));
    gold = Math.max(gold, ss(0.07, 0.035, Math.abs(e - 1)));
    const rr = Math.hypot(cx, cy);
    gold = Math.max(gold, ss(0.075, 0.06, rr) * (Math.cos(8 * Math.atan2(cy, cx)) > -0.3 ? 1 : 0.5));
    for (const px of [0.19, AR - 0.19]) for (const py of [0.19, 0.81]) gold = Math.max(gold, ss(0.04, 0.028, Math.hypot(X - px, Y - py)));
    // swags from the cartouche towards the corners
    for (const sx of [-1, 1]) {
      const t = (sx * cx - 0.45) / (AR / 2 - 0.65);
      if (t > 0 && t < 1) {
        const yc = 0.5 + 0.18 - 0.22 * Math.sin(Math.PI * t);
        gold = Math.max(gold, 0.85 * ss(0.03, 0.015, Math.abs(Y - yc)) * (0.6 + 0.4 * Math.abs(Math.sin(t * Math.PI * 9))));
      }
    }
    const n = nz(u, v, 64, 20);
    mix3(o, d < 0.15 ? cream : creamDeep, gilt, gold);
    const s = 0.92 + 0.1 * n;
    o.r *= s; o.g *= s; o.b *= s;
    o.h = h + (Math.max(h, 0.95) - h) * gold + 0.04 * n; // gilt beads stand proud
    o.rough = 0.85 - 0.5 * gold; o.metal = gold;
  }, true);

  // Framed wall panels for one bay of the organ wall (u across the bay, pilaster
  // axes at u = 0 / 1; v from the dado rail up to the architrave): cream wall,
  // a tall and an upper panel, each a deep pink-red field inside a moulded gilt
  // frame with an inner gilt fillet and corner paterae.
  const PANELS = [[0.42, 6.95], [7.55, bayH - 0.5]];
  const PX0 = 0.56, FW = 0.13;
  const bayPanels = paint(256, 1024, (u, v, o) => {
    const X = u * bayW, Y = v * bayH;
    const n = 0.5 * nz(u, v, 8, 32) + 0.3 * nz(u, v, 24, 96) + 0.2 * nz(u, v, 96, 256);
    let done = false;
    for (const [y0, y1] of PANELS) {
      const dx = Math.min(X - PX0, bayW - PX0 - X), dy = Math.min(Y - y0, y1 - Y);
      const d = Math.min(dx, dy);
      if (d < -0.05) continue;
      if (d < 0) { // sunk shadow line round the frame
        const t = -d / 0.05;
        const c = 0.55 + 0.4 * t;
        o.r = 0.8 * c; o.g = 0.7 * c; o.b = 0.56 * c; o.h = 0.25 + 0.2 * t; o.rough = 0.9;
        done = true; break;
      }
      if (d < FW) { // gilt ogee moulding
        const t = d / FW;
        const prof = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.75 + 0.25 * ss(0.02, 0, Math.abs(t - 0.2));
        const bead = ss(0.12, 0.05, Math.abs(t - 0.88)) * (0.6 + 0.4 * Math.abs(Math.sin((X + Y) * 60)));
        const lum = 0.55 + 0.45 * prof + 0.25 * bead;
        o.r = 0.8 * lum; o.g = 0.58 * lum; o.b = 0.26 * lum;
        o.h = 0.5 + 0.45 * Math.max(prof, bead); o.rough = 0.38; o.metal = 1;
        done = true; break;
      }
      // field
      const cx = (X - bayW / 2) / (bayW / 2 - PX0 - FW), cy = (Y - (y0 + y1) / 2) / ((y1 - y0) / 2 - FW);
      const vig = clamp01(1 - 0.55 * (cx * cx * 0.6 + cy * cy * 0.4));
      mix3(o, [0.36, 0.06, 0.08], [0.62, 0.17, 0.19], vig);
      const s = 0.9 + 0.14 * n;
      o.r *= s; o.g *= s; o.b *= s;
      o.h = 0.22 + 0.06 * n; o.rough = 0.8;
      const di = d - FW - 0.13; // inner fillet
      let g = ss(0.014, 0.006, Math.abs(di));
      for (const px of [PX0 + FW + 0.13, bayW - PX0 - FW - 0.13]) for (const py of [y0 + FW + 0.13, y1 - FW - 0.13]) {
        const r = Math.hypot(X - px, Y - py);
        g = Math.max(g, ss(0.075, 0.06, r) * (Math.cos(8 * Math.atan2(Y - py, X - px)) > -0.4 ? 1 : 0.6));
      }
      if (g > 0) {
        o.r += (0.85 - o.r) * g; o.g += (0.62 - o.g) * g; o.b += (0.3 - o.b) * g;
        o.h = Math.max(o.h, 0.7 * g); o.rough = 0.8 - 0.45 * g; o.metal = g;
      }
      done = true; break;
    }
    if (!done) { // cream wall
      const val = 0.86 + 0.12 * n;
      o.r = 0.8 * val; o.g = 0.7 * val; o.b = 0.56 * val; o.h = 0.45 + 0.1 * n; o.rough = 0.9;
    }
  }, true);

  // raised-and-fielded oak wainscot with a gilt line in the groove.
  // One tile = half an arcade bay (~1.28 m) x 2.4 m
  const wainscot = paint(128, 256, (u, v, o) => {
    const W = 1.28, H = 2.4, X = u * W, Y = v * H;
    const g = 0.6 * nz(u, v, 48, 4) + 0.4 * nz(u, v, 128, 12);
    const dd = Math.min(X, W - X, Y - 0.25, H - Y);
    let h, tone;
    if (Y < 0.25) { h = 0.8; tone = 0.7; }
    else if (dd < 0.11) { h = 0.75; tone = 1; }
    else if (dd < 0.13) { h = 0.15; tone = 0.5; }
    else if (dd < 0.22) { const t = (dd - 0.13) / 0.09; h = 0.3 + 0.5 * t; tone = 0.82 + 0.15 * t; }
    else { h = 0.8; tone = 1.08; }
    const gl = Y < 0.25 ? 0 : ss(0.007, 0.003, Math.abs(dd - 0.12));
    const t2 = tone * (0.8 + 0.35 * g);
    mix3(o, [0.34 * t2, 0.2 * t2, 0.11 * t2], gilt, gl);
    o.h = h * 0.9 + 0.1 * g;
    o.rough = 0.6 - 0.25 * gl; o.metal = gl;
  }, true);

  plaster.map.repeat.set(1 / 3, 1 / 3); // plaster UVs are in metres
  return { plaster, frieze, friezeLight, panel, bayPanels, wainscot };
}

// ---------------------------------------------------------------- geometry helpers
function gridGeo(rows) {
  // rows[j][i] : Vector3. Front face normal = (d/di) x (d/dj).
  const nj = rows.length, ni = rows[0].length;
  const pos = new Float32Array(nj * ni * 3), uv = new Float32Array(nj * ni * 2);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const p = rows[j][i], k = j * ni + i;
    pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
    uv[k * 2] = i / (ni - 1); uv[k * 2 + 1] = j / (nj - 1);
  }
  const idx = [];
  for (let j = 0; j < nj - 1; j++) for (let i = 0; i < ni - 1; i++) {
    const a = j * ni + i, b = a + 1, c = a + ni + 1, d = a + ni;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function flatPolygon(ptsXZ, y, up = true) {
  const contour = ptsXZ.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = [], nor = [], uv = [];
  const ny = up ? 1 : -1;
  for (const t of tris) {
    const [a, b, c] = t.map((i) => contour[i]);
    // signed area in (x, z); a triangle that is CCW in (x,z) has normal -y
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    const order = (area > 0) === up ? [a, c, b] : [a, b, c];
    for (const p of order) { pos.push(p.x, y, p.y); nor.push(0, ny, 0); uv.push(p.x, p.y); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function planarUV(g, fn) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const r = fn(p.getX(i), p.getY(i), p.getZ(i));
    uv[i * 2] = r[0]; uv[i * 2 + 1] = r[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function rod(p0, p1, r, radial = 8) {
  const d = new V3().subVectors(p1, p0);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
  return g;
}

function roundRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// rounded, bevelled cushion centred on the origin, thickness along z
function cushion(w, h, depth, r, bevel) {
  const g = new THREE.ExtrudeGeometry(roundRect(w - 2 * bevel, h - 2 * bevel, r), {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 3,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

// curve a panel about its vertical axis: the edges come forward (+z)
function bend(g, k, halfW) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + k * (p.getX(i) / halfW) ** 2);
  return g;
}

// Fluted pilaster shaft, 1 m tall (scaled per instance), base on y = 0,
// back on z = 0, face at z = d.
function flutedShaft(w, d, flutes) {
  const sh = new THREE.Shape();
  const margin = 0.07, span = w - 2 * margin, pitch = span / flutes, r = pitch * 0.36;
  sh.moveTo(-w / 2, 0); sh.lineTo(-w / 2, d);
  for (let f = 0; f < flutes; f++) {
    const xc = -span / 2 + pitch * (f + 0.5);
    sh.lineTo(xc - r, d);
    sh.absarc(xc, d, r, Math.PI, 2 * Math.PI, false);
  }
  sh.lineTo(w / 2, d); sh.lineTo(w / 2, 0); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(Math.PI / 2);
  g.translate(0, 1, 0);
  return g;
}

const nonIdx = (g) => (g.index ? g.toNonIndexed() : g);
const mergeAny = (list) => mergeGeometries(list.map(nonIdx));

// =====================================================================
export function buildHall(ctx) {
  const M = ctx.materials;
  const L = ctx.LAYOUT;
  const group = new THREE.Group();
  group.name = 'hall';

  // ---------- plan-curve sampling ----------
  const CT = buildCurveTable();
  const S = CT.half; // curve runs s in [-S, S], s = 0 on the organ axis behind the organ
  function at(s) {
    const pts = CT.pts;
    s = Math.max(-S, Math.min(S, s));
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].s <= s) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi];
    const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    let tx = a.tx + (b.tx - a.tx) * f, tz = a.tz + (b.tz - a.tz) * f;
    const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, tx, tz, nx: -tz, nz: tx };
  }
  // point on the curve, moved `inset` metres towards the hall interior
  function P(s, inset, y) {
    const q = at(s);
    return new V3(q.x + q.nx * inset, y, q.z + q.nz * inset);
  }
  // local X -> tangent, Y -> up, Z -> inward normal
  function frame(s, inset = 0, y = 0) {
    const q = at(s);
    const m = new THREE.Matrix4().makeBasis(new V3(q.tx, 0, q.tz), UP, new V3(q.nx, 0, q.nz));
    m.setPosition(q.x + q.nx * inset, y, q.z + q.nz * inset);
    return m;
  }
  function solveS(fn, lo, hi) { // fn(lo) < 0 <= fn(hi)
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (fn(mid) < 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  // ---------- key dimensions ----------
  const GAL = L.gallery;
  const zFront = GAL.zMax; // 4.5
  const D = 3.2; // inset of the box-tier fronts from the wall
  const sStart = solveS((s) => P(s, D, 0).x - 14.6, 0, S * 0.5); // box block starts here
  const sOrgan = sStart - 0.3; // face of the end wall closing the box block
  const nBox = Math.round((S - sStart) / 2.3);
  const boxW = (S - sStart) / nBox;
  let nBays = Math.round((2 * S) / 2.6);
  if (nBays % 2) nBays++;
  const bayW = (2 * S) / nBays;
  const PANEL_H = 0.72;

  // ---------- materials (shared ones are cloned, never mutated) ----------
  const Y_ARCH = 14.4, Y_FRIEZE0 = 14.6, Y_FRIEZE1 = 15.6, Y_ARC0 = 16.8, Y_ARC1 = 23.6, Y_CORNICE = 26.0;
  const Y_DADO = 2.4, Y_DADO_TOP = 2.62, Y_PANEL_TOP = 14.1;
  const TX = makeHallTextures(boxW / PANEL_H, bayW, Y_PANEL_TOP - Y_DADO_TOP);
  const local = {
    plaster: new THREE.MeshStandardMaterial({ color: 0xa88b65, map: TX.plaster.map, bumpMap: TX.plaster.bump, bumpScale: 1.2, roughness: 0.92, metalness: 0 }),
    plasterDark: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95, metalness: 0 }),
    terracotta: new THREE.MeshStandardMaterial({ color: 0x6e3520, map: TX.plaster.map, bumpMap: TX.plaster.bump, bumpScale: 1.0, roughness: 0.88, metalness: 0 }),
    frieze: new THREE.MeshStandardMaterial({ color: 0xc9b6a4, map: TX.frieze.map, bumpMap: TX.frieze.bump, bumpScale: 4, roughness: 0.85, metalness: 0 }),
    boxPanel: new THREE.MeshStandardMaterial({ color: 0xd8cbb8, map: TX.panel.map, bumpMap: TX.panel.bump, bumpScale: 3, roughnessMap: TX.panel.mr, metalnessMap: TX.panel.mr, roughness: 1, metalness: 0.85 }),
    friezeLight: new THREE.MeshStandardMaterial({ color: 0xe6dccd, map: TX.friezeLight.map, bumpMap: TX.friezeLight.bump, bumpScale: 3, roughness: 0.85, metalness: 0 }),
    bayPanels: new THREE.MeshStandardMaterial({ color: 0xffffff, map: TX.bayPanels.map, bumpMap: TX.bayPanels.bump, bumpScale: 3, roughnessMap: TX.bayPanels.mr, metalnessMap: TX.bayPanels.mr, roughness: 1, metalness: 0.85 }),
    redPanel: new THREE.MeshStandardMaterial({ color: 0x8a2228, map: TX.plaster.map, bumpMap: TX.plaster.bump, bumpScale: 0.6, roughness: 0.75, metalness: 0 }),
    stairRunner: new THREE.MeshStandardMaterial({ color: 0x5b5452, roughness: 0.97, metalness: 0 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.4, metalness: 0.85 }),
    canopy: new THREE.MeshStandardMaterial({ color: 0x57465f, roughness: 0.6, metalness: 0.05, emissive: 0x1c1226, emissiveIntensity: 0.7 }),
    rigging: new THREE.MeshStandardMaterial({ color: 0x1d1d21, roughness: 0.45, metalness: 0.8 }),
    fixture: new THREE.MeshStandardMaterial({ color: 0x0e0e11, roughness: 0.45, metalness: 0.3 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x26262b, roughness: 0.85, metalness: 0.2 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.12, metalness: 0.5, emissive: 0x141a33, emissiveIntensity: 0.6 }),
    wainscot: new THREE.MeshStandardMaterial({ color: 0xffffff, map: TX.wainscot.map, bumpMap: TX.wainscot.bump, bumpScale: 4, roughnessMap: TX.wainscot.mr, metalnessMap: TX.wainscot.mr, roughness: 1, metalness: 0.85 }),
    redVelvet: new THREE.MeshPhysicalMaterial({ color: 0x5a0a13, roughness: 0.9, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: 0xa8303a }),
    seatFrame: new THREE.MeshStandardMaterial({ color: 0x150b06, roughness: 0.5, metalness: 0 }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x2e0a0e, roughness: 1.0, metalness: 0 }),
    seatBank: new THREE.MeshStandardMaterial({ color: 0x3c0910, roughness: 0.95, metalness: 0 }),
    boxInterior: new THREE.MeshStandardMaterial({ color: 0x2a0e0b, roughness: 1.0, metalness: 0, emissive: 0x1c0804, emissiveIntensity: 0.5 }),
    ceilingDark: new THREE.MeshStandardMaterial({ color: 0x140e0c, roughness: 1.0, metalness: 0 }),
    stageEdge: new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.6, metalness: 0 }),
    mushroom: new THREE.MeshStandardMaterial({ color: 0x9c96ae, roughness: 0.75, metalness: 0, emissive: 0x231f30, emissiveIntensity: 0.45 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffe6bd, roughness: 0.4, metalness: 0, emissive: 0xffb866, emissiveIntensity: 2.2 }),
  };
  for (const [k, m] of Object.entries(local)) m.name = 'hall_' + k;

  const baseMats = {}, vcMats = {};
  function baseMat(key) {
    if (baseMats[key]) return baseMats[key];
    let m = local[key];
    if (!m) {
      if (!M[key]) throw new Error('hall: unknown material ' + key);
      m = M[key].clone();
      m.name = 'hall_' + key;
    }
    // walls should not glow flatly from the image-based ambient
    m.envMapIntensity = m.metalness > 0.5 && !m.metalnessMap ? 0.8 : 0.4;
    baseMats[key] = m;
    return m;
  }
  function vcMat(key) { // variant for merged meshes carrying baked falloff
    if (!vcMats[key]) {
      const m = baseMat(key).clone();
      m.vertexColors = true;
      m.name = baseMat(key).name + '_vc';
      vcMats[key] = m;
    }
    return vcMats[key];
  }

  // baked light falloff: 1 near the organ, darker with distance and height
  function shade(x, y, z) {
    const d = Math.hypot(x, (y - 7) * 0.8, z + 1);
    const fd = 1 - 0.68 * ss(11, 42, d);
    const fh = 1 - 0.6 * ss(9, 30, y);
    return Math.max(0.12, fd * fh);
  }
  // warm shift as it gets darker (ochre -> umber)
  const warm = (f, out) => out.setRGB(f, Math.pow(f, 1.12), Math.pow(f, 1.3));

  // ---------- merge buckets ----------
  const buckets = new Map();
  function add(key, g, shadow = 'r') {
    baseMat(key);
    if (g.index) { const ng = g.toNonIndexed(); g.dispose(); g = ng; }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.clearGroups();
    const id = key + '|' + shadow;
    if (!buckets.has(id)) buckets.set(id, { key, shadow, list: [] });
    buckets.get(id).list.push(g);
  }

  const instanced = [];
  const tmpC = new THREE.Color();
  function addInstanced(name, geo, key, matrices, { cast = false, receive = true, lit = true, jitter = 0, seed = 7 } = {}) {
    if (!matrices.length) return null;
    const im = new THREE.InstancedMesh(geo, baseMat(key), matrices.length);
    im.name = 'hall_' + name;
    const r = rng(seed);
    matrices.forEach((m, i) => {
      im.setMatrixAt(i, m);
      if (lit) {
        const e = m.elements;
        const f = shade(e[12], e[13], e[14]) * (1 - jitter * r());
        im.setColorAt(i, warm(f, tmpC));
      }
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = cast; im.receiveShadow = receive;
    im.computeBoundingBox(); im.computeBoundingSphere();
    group.add(im);
    instanced.push(im);
    return im;
  }

  // sweep an (inset, y) profile along the curve; each profile segment is its own
  // strip. UVs: u = s*ku + uOff, v = profile length (m)*kv, or 0..1 with vNorm.
  // Long segments are subdivided so the baked falloff has vertices to live on.
  function sweep(key, s0, s1, profile, step = 0.6, o = {}) {
    const ku = o.ku ?? 1, kv = o.kv ?? 1, uOff = o.uOff ?? 0;
    const prof = [profile[0]];
    for (let j = 1; j < profile.length; j++) {
      const [a0, b0] = profile[j - 1], [a1, b1] = profile[j];
      const k = Math.max(1, Math.ceil(Math.hypot(a1 - a0, b1 - b0) / 2.0));
      for (let i = 1; i <= k; i++) prof.push([a0 + ((a1 - a0) * i) / k, b0 + ((b1 - b0) * i) / k]);
    }
    const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
    const sv = [];
    for (let i = 0; i <= n; i++) sv.push(s0 + ((s1 - s0) * i) / n);
    const cols = prof.map(([inset, y]) => sv.map((s) => P(s, inset, y)));
    const cum = [0];
    for (let j = 1; j < prof.length; j++) cum.push(cum[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]));
    const total = cum[cum.length - 1] || 1;
    const vOf = (j) => (o.vNorm ? cum[j] / total : (cum[j] + prof[0][1]) * kv);
    for (let j = 0; j < prof.length - 1; j++) {
      const g = gridGeo([cols[j], cols[j + 1]]);
      const uv = g.attributes.uv;
      for (let r = 0; r < 2; r++) for (let i = 0; i <= n; i++) uv.setXY(r * (n + 1) + i, sv[i] * ku + uOff, vOf(j + r));
      add(key, g);
    }
  }

  // =================================================================
  // 1. Organ gallery floor (top surface exactly y = 0)
  // =================================================================
  const sWallFront = solveS((s) => at(s).z - zFront, 0, S * 0.7);
  {
    const pts = [];
    const n = Math.ceil((2 * sWallFront) / 0.5);
    for (let i = 0; i <= n; i++) {
      const p = P(-sWallFront + (2 * sWallFront * i) / n, -0.05, 0);
      pts.push([p.x, Math.min(p.z, zFront)]);
    }
    const g = flatPolygon(pts, 0, true);
    planarUV(g, (x, y, z) => [x * 0.5, z * 0.22]);
    add('floorWood', g);
  }

  // =================================================================
  // 2. Choir tiers
  // =================================================================
  const CH = L.choir;
  const HW = CH.halfWidth, NST = CH.steps, DROP = CH.stepDrop;
  const DZ = (CH.zEnd - CH.zStart) / NST;
  const SAG = 0.18; // each row is pulled back at the centre: concave towards the stage
  const rz = (k, x) => CH.zStart + k * DZ - SAG * k * (1 - (x / HW) ** 2);
  const rzSlope = (k, x) => (2 * SAG * k * x) / (HW * HW);
  const stageY = L.stageY;

  const NX = 56;
  const rowPts = (k, y) => {
    const r = [];
    for (let i = 0; i <= NX; i++) { const x = -HW + (2 * HW * i) / NX; r.push(new V3(x, y, rz(k, x))); }
    return r;
  };
  for (let k = 0; k < NST; k++) {
    const riser = gridGeo([rowPts(k, -(k + 1) * DROP), rowPts(k, -k * DROP)]);
    planarUV(riser, (x, y) => [y * 0.6, x * 0.25]);
    add('oak', riser);
    if (k >= 1) {
      const tread = gridGeo([rowPts(k, -k * DROP), rowPts(k - 1, -k * DROP)]);
      planarUV(tread, (x, y, z) => [z * 0.5, x * 0.22]);
      add('floorWood', tread);
    }
  }

  // Ways up: a straight central aisle to the console, and (as in the real
  // hall) two prominent DIAGONAL staircases that climb from the stage beside
  // the central block outwards and up to the organ gallery beside the base.
  const C_HW = 0.8;
  const ST_HW = 0.8, ST_XTOP = 8.4, ST_XBOT = 4.6; // stair half-width; centre |x| at the gallery / at the stage
  const stairSlope = (ST_XBOT - ST_XTOP) / (CH.zEnd - CH.zStart); // d|x|/dz
  const stairX = (z) => ST_XTOP + stairSlope * (z - CH.zStart);
  const stairXk = (sg, k) => { let x = stairX(CH.zStart + k * DZ); x = stairX(rz(k, x)); return sg * stairX(rz(k, x)); };
  const lanes = [{ xk: () => 0, hw: C_HW, slope: 0, sg: 0 }];
  for (const sg of [-1, 1]) lanes.push({ xk: (k) => stairXk(sg, k), hw: ST_HW, slope: sg * stairSlope, sg });

  // box sheared along a lane (x += slope * z), turned to the row, placed
  function laneBox(key, w, h, d, x, y, z, ry, slope, shadow = 'r') {
    const g = new THREE.BoxGeometry(w, h, d);
    if (slope) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + slope * p.getZ(i)); }
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    if (key === 'oak') planarUV(g, (px, py, pz) => [pz * 0.5 + py, px * 0.22]);
    add(key, g, shadow);
  }
  // half-steps (0.5 m risers are too tall to walk) with a grey carpet runner and brass nosings
  for (const ln of lanes) {
    for (let k = 0; k < NST; k++) {
      const x = ln.xk(k), zr = rz(k, x), ry = -Math.atan(rzSlope(k, x));
      const yTop = -(k + 1) * DROP + DROP / 2, rw = ln.hw * 2 - 0.14;
      const xh = x + ln.slope * 0.2;
      laneBox('oak', ln.hw * 2, DROP / 2, 0.4, xh, yTop - DROP / 4, zr + 0.2, ry, ln.slope);
      laneBox('stairRunner', rw, 0.01, 0.4, xh, yTop + 0.005, zr + 0.2, ry, ln.slope);
      laneBox('stairRunner', rw, DROP / 2, 0.01, x + ln.slope * 0.405, yTop - DROP / 4, zr + 0.405, ry, 0);
      laneBox('stairRunner', rw, DROP / 2 - 0.02, 0.01, x, -k * DROP - DROP / 4 - 0.01, zr + 0.005, ry, 0);
      laneBox('brass', ln.hw * 2, 0.012, 0.035, x + ln.slope * 0.385, yTop + 0.011, zr + 0.385, ry, 0);
      laneBox('brass', ln.hw * 2, 0.012, 0.035, x, -k * DROP + 0.006, zr - 0.0175, ry, 0);
      if (k < NST - 1) { // runner on the next tread
        const zn = rz(k + 1, ln.xk(k + 1)), z0 = zr + 0.4, zc = (z0 + zn) / 2;
        laneBox('stairRunner', rw, 0.01, zn - z0, x + ln.slope * (zc - zr), -(k + 1) * DROP + 0.005, zc, ry, ln.slope);
      }
    }
  }

  // dark metal handrails on both sides of each side staircase
  for (const ln of lanes) {
    if (!ln.sg) continue;
    for (const side of [-1, 1]) {
      const pts = [];
      for (let k = 0; k < NST; k++) {
        const x = ln.xk(k) + side * (ln.hw + 0.08);
        pts.push(new V3(x, -k * DROP, rz(k, x) - (k === 0 ? 0.1 : 0.12)));
      }
      { // last post on the stage below the bottom half-step
        const zl = rz(NST - 1, ln.xk(NST - 1)) + 0.6;
        pts.push(new V3(ln.sg * stairX(zl) + side * (ln.hw + 0.08), stageY, zl));
      }
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        add('iron', rod(p, new V3(p.x, p.y + 0.95, p.z), 0.022, 6), 'rc');
        add('iron', rod(new V3(p.x, p.y + 0.93, p.z), new V3(p.x, p.y + 0.99, p.z), 0.034, 8), 'rc');
        if (i) {
          const q = pts[i - 1];
          add('iron', rod(new V3(q.x, q.y + 0.95, q.z), new V3(p.x, p.y + 0.95, p.z), 0.024, 8), 'rc');
          add('iron', rod(new V3(q.x, q.y + 0.5, q.z), new V3(p.x, p.y + 0.5, p.z), 0.012, 5), 'rc');
        }
      }
    }
  }

  // red parapet with gilt lines and a brass rail along the front of the lowest row
  {
    const kB = NST - 1, yTop = stageY + 1.3;
    const zf = (x) => rz(kB, x);
    const gaps = lanes.map((ln) => { const x = ln.xk(kB); return [x - ln.hw - 0.2 + Math.min(0, ln.slope * 0.4), x + ln.hw + 0.2 + Math.max(0, ln.slope * 0.4)]; })
      .sort((a, b) => a[0] - b[0]);
    const segs = [];
    let xa = -HW;
    for (const [g0, g1] of gaps) { segs.push([xa, g0]); xa = g1; }
    segs.push([xa, HW]);
    for (const [x0, x1] of segs) {
      const n = Math.max(2, Math.ceil((x1 - x0) / 0.4));
      const xs = []; for (let i = 0; i <= n; i++) xs.push(x0 + ((x1 - x0) * i) / n);
      const row = (y, dz) => xs.map((x) => new V3(x, y, zf(x) + dz));
      const front = gridGeo([row(stageY, 0.22), row(yTop, 0.22)]);
      planarUV(front, (x, y) => [x / 3, y / 3]);
      add('redPanel', front);
      const backF = gridGeo([row(yTop, 0.01), row(-kB * DROP - DROP, 0.01)]);
      planarUV(backF, (x, y) => [x / 3, y / 3]);
      add('redPanel', backF);
      add('darkWoodPlain', gridGeo(xs.map((x) => [new V3(x, yTop + 0.05, zf(x) - 0.01), new V3(x, yTop + 0.05, zf(x) + 0.25)])), 'rc');
      add('darkWoodPlain', gridGeo([row(yTop, 0.25), row(yTop + 0.05, 0.25)]));
      for (const [ya, yb] of [[stageY + 0.12, stageY + 0.16], [yTop - 0.16, yTop - 0.12]]) add('goldMatte', gridGeo([row(ya, 0.226), row(yb, 0.226)]));
      const nd = Math.max(1, Math.round((x1 - x0) / 1.5));
      for (let i = 0; i <= nd; i++) { // gilt stiles framing the panels
        const x = x0 + 0.06 + ((x1 - x0 - 0.12) * i) / nd;
        add('goldMatte', box(0.035, yTop - stageY - 0.28, 0.012, x, (stageY + yTop) / 2, zf(x) + 0.226, -Math.atan(rzSlope(kB, x))));
      }
      for (const x of [x0, x1]) add('darkWoodPlain', box(0.12, yTop + 0.09 - stageY, 0.28, x, (stageY + yTop + 0.09) / 2, zf(x) + 0.115, -Math.atan(rzSlope(kB, x))), 'rc');
      const curve = new THREE.CatmullRomCurve3(xs.map((x) => new V3(x, yTop + 0.1, zf(x) + 0.12)));
      add('brass', new THREE.TubeGeometry(curve, n * 2, 0.028, 8, false), 'rc');
    }
  }

  // stepped cheek walls closing the tier ends, with a sloping brass handrail
  for (const sg of [-1, 1]) {
    const xc = sg * (HW + 0.15);
    for (let k = 1; k < NST; k++) {
      const z0 = CH.zStart + (k - 1) * DZ, z1 = CH.zStart + k * DZ;
      const yTop = -k * DROP + 0.5;
      const g = box(0.3, yTop - stageY, z1 - z0, xc, (yTop + stageY) / 2, (z0 + z1) / 2);
      planarUV(g, (x, y, z) => [y * 0.5 + x, z * 0.22]);
      add('oak', g);
      add('darkWoodPlain', box(0.36, 0.05, z1 - z0 + 0.03, xc, yTop + 0.025, (z0 + z1) / 2));
      const zm = (z0 + z1) / 2;
      add('brass', rod(new V3(xc, yTop + 0.05, zm), new V3(xc, -DROP * (k - 0.5) + 0.92, zm), 0.016, 6), 'rc');
    }
    const zA = CH.zStart + 0.1, zB = CH.zStart + (NST - 1) * DZ;
    const yl = (z) => (-DROP * (z - CH.zStart)) / DZ + 0.9;
    add('brass', rod(new V3(xc, yl(zA), zA), new V3(xc, yl(zB), zB), 0.024, 8), 'rc');
  }

  // --- seats: tip-up, rounded velvet cushions in a dark curved shell ---
  const RECLINE = -0.1;
  const shell = new THREE.ExtrudeGeometry(roundRect(0.48, 0.6, 0.06), { depth: 0.025, bevelEnabled: false, curveSegments: 3 });
  shell.translate(0, 0, -0.0125); bend(shell, 0.04, 0.24); shell.rotateX(RECLINE); shell.translate(0, 0.64, 0.03);
  const seatFrameGeo = mergeAny([
    box(0.04, 0.62, 0.42, -0.25, 0.31, 0.23),
    box(0.04, 0.62, 0.42, 0.25, 0.31, 0.23),
    box(0.065, 0.035, 0.4, -0.25, 0.637, 0.24),
    box(0.065, 0.035, 0.4, 0.25, 0.637, 0.24),
    shell,
  ]);
  const back = cushion(0.42, 0.47, 0.03, 0.06, 0.022);
  bend(back, 0.035, 0.21); back.rotateX(RECLINE); back.translate(0, 0.665, 0.072);
  const seat = cushion(0.42, 0.4, 0.04, 0.06, 0.022);
  seat.rotateX(0.2); seat.translate(0, 0.55, 0.175);
  const seatUphGeo = mergeAny([back, seat]);
  const plateGeo = new THREE.BoxGeometry(0.07, 0.028, 0.006);
  plateGeo.rotateX(RECLINE); plateGeo.translate(0, 0.86, -0.006);

  const seatM = [];
  const PITCH = 0.52;
  // seat blocks of row k: the full row minus the lanes crossing its tread
  // (the side stairs shift outwards by ~0.45 m per row)
  const sectionsOf = (k) => {
    const gaps = lanes.map((ln) => {
      const a = ln.xk(k - 1), b = ln.xk(k), m = ln.sg ? 0.2 : 0.06;
      return [Math.min(a, b) - ln.hw - m, Math.max(a, b) + ln.hw + m];
    }).sort((p, q) => p[0] - q[0]);
    const out = [];
    let x0 = -HW + 0.12;
    for (const [g0, g1] of gaps) { out.push([x0, g0]); x0 = g1; }
    out.push([x0, HW - 0.12]);
    return out;
  };
  const rotY = new THREE.Matrix4(), tmpM = new THREE.Matrix4();
  for (let k = 1; k < NST; k++) {
    for (const [x0, x1] of sectionsOf(k)) {
      const n = Math.floor((x1 - x0) / PITCH);
      const off = x0 + ((x1 - x0) - n * PITCH) / 2 + PITCH / 2;
      for (let i = 0; i < n; i++) {
        const x = off + i * PITCH;
        const th = -Math.atan(rzSlope(k - 1, x));
        rotY.makeRotationY(th);
        tmpM.copy(rotY).setPosition(x, -k * DROP, rz(k - 1, x) + 0.07);
        seatM.push(tmpM.clone());
      }
    }
  }
  addInstanced('seatFrames', seatFrameGeo, 'seatFrame', seatM, { cast: true });
  addInstanced('seatUpholstery', seatUphGeo, 'redVelvet', seatM, { cast: true, jitter: 0.12, seed: 31 });
  addInstanced('seatPlates', plateGeo, 'brass', seatM);

  // --- brass hoop handrails at the row ends along the central aisle ---
  {
    const path = new THREE.CatmullRomCurve3([
      new V3(0, 0, 0), new V3(0, 0.68, 0), new V3(0, 0.84, 0.08), new V3(0, 0.86, 0.22),
      new V3(0, 0.84, 0.36), new V3(0, 0.68, 0.44), new V3(0, 0, 0.44),
    ], false, 'catmullrom', 0.3);
    const hoopGeo = new THREE.TubeGeometry(path, 20, 0.018, 6, false);
    const ms = [];
    for (const sg of [-1, 1]) for (let k = 1; k < NST; k++) {
      const x = sg * (C_HW + 0.02);
      ms.push(new THREE.Matrix4().makeTranslation(x, -k * DROP, rz(k - 1, x) + 0.1));
    }
    addInstanced('aisleHoops', hoopGeo, 'brass', ms, { cast: true });
  }

  // =================================================================
  // 3. Gallery front balustrade (z just outside the reserved volume)
  // =================================================================
  const sPodium = solveS((s) => P(s, D, 0).z - (zFront - 0.1), 0, S * 0.7);
  const xGalleryEnd = P(sPodium, D, 0).x; // where the gallery front meets the box tiers
  {
    const zB = zFront - 0.08;
    const balM = [];
    const CENTER_GAP = 1.7; // clear view/access from the central aisle to the console
    const xst = stairXk(1, 0); // the side stairs arrive here
    const segs = [[CENTER_GAP, xst - ST_HW - 0.25], [xst + ST_HW + 0.25, xGalleryEnd - 0.05]];
    for (const sg of [-1, 1]) for (const [a, b] of segs) {
      const x0 = sg * a, x1 = sg * b, len = Math.abs(x1 - x0), xc = (x0 + x1) / 2;
      add('darkWoodPlain', box(len, 0.1, 0.16, xc, 0.05, zB), 'rc');
      add('darkWoodPlain', box(len, 0.08, 0.17, xc, 0.92, zB), 'rc');
      add('brass', rod(new V3(x0, 0.99, zB), new V3(x1, 0.99, zB), 0.028, 8), 'rc');
      for (const xe of [x0, x1]) {
        add('darkWoodPlain', box(0.17, 1.06, 0.17, xe, 0.53, zB), 'rc');
        add('brass', box(0.2, 0.03, 0.17, xe, 1.075, zB), 'rc');
      }
      const n = Math.floor((len - 0.2) / 0.17);
      for (let i = 0; i < n; i++) {
        const x = Math.min(x0, x1) + 0.1 + (len - 0.2) * ((i + 0.5) / n);
        balM.push(new THREE.Matrix4().makeTranslation(x, 0.1, zB));
      }
    }
    const prof = [[0.03, 0], [0.046, 0.05], [0.024, 0.12], [0.05, 0.3], [0.032, 0.5], [0.022, 0.62], [0.036, 0.7], [0.03, 0.78]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    addInstanced('balusters', new THREE.LatheGeometry(prof, 8), 'oak', balM, { cast: true });

    // panelled wall under the gallery front, left and right of the choir
    for (const sg of [-1, 1]) {
      const x0 = HW, x1 = xGalleryEnd + 0.5;
      const w = box(x1 - x0, 5 - 0.01, 0.6, sg * (x0 + x1) / 2, -0.01 - (5 - 0.01) / 2, zFront - 0.3);
      planarUV(w, (x, y) => [x / 1.28, (y + 4.1) / 4.1]);
      add('wainscot', w);
      add('terracotta', box(x1 - x0, 0.9, 0.66, sg * (x0 + x1) / 2, -5 + 0.45, zFront - 0.3));
      add('goldMatte', box(x1 - x0, 0.04, 0.63, sg * (x0 + x1) / 2, -0.12, zFront - 0.3));
    }
  }

  // =================================================================
  // 4. Stage and arena floor
  // =================================================================
  const STAGE_HW = 18, STAGE_Z = 30, ARENA_Y = stageY - 1.0;
  {
    const front = [];
    const nf = 32;
    for (let i = 0; i <= nf; i++) {
      const x = STAGE_HW - (2 * STAGE_HW * i) / nf;
      front.push(new V3(x, 0, STAGE_Z - 1.4 * (x / STAGE_HW) ** 2));
    }
    const pts = [[-STAGE_HW, zFront], [STAGE_HW, zFront], ...front.map((p) => [p.x, p.z])];
    const g = flatPolygon(pts, stageY, true);
    planarUV(g, (x, y, z) => [x * 0.5, z * 0.22]);
    add('floorWood', g);
    const outline = [new V3(-STAGE_HW, 0, zFront), ...front.slice().reverse(), new V3(STAGE_HW, 0, zFront)];
    const lo = outline.map((p) => new V3(p.x, ARENA_Y, p.z));
    const hi = outline.map((p) => new V3(p.x, stageY - 0.06, p.z));
    add('stageEdge', gridGeo([lo, hi]));
    const n0 = outline.map((p) => new V3(p.x, stageY - 0.06, p.z));
    const n1 = outline.map((p) => new V3(p.x, stageY, p.z));
    const nose = gridGeo([n0, n1]);
    planarUV(nose, (x, y, z) => [y, (x + z) * 0.22]);
    add('oak', nose);

    // arena / stalls floor fading away into the dark
    const apts = [];
    const sA = solveS((s) => P(s, D - 0.2, 0).z - zFront, 0, S * 0.7);
    const na = Math.ceil((S - sA) / 0.8);
    for (let i = 0; i <= na; i++) { const p = P(sA + ((S - sA) * i) / na, D - 0.2, 0); apts.push([p.x, p.z]); }
    const zEnd = P(S, 0, 0).z;
    apts.push([32, zEnd + 0.1], [32, 78], [-32, 78], [-32, zEnd + 0.1]);
    for (let i = na; i >= 0; i--) { const p = P(-(sA + ((S - sA) * i) / na), D - 0.2, 0); apts.push([p.x, p.z]); }
    add('carpet', flatPolygon(apts, ARENA_Y, true));
  }

  // --- sparse orchestral props ---
  {
    const cz = 26.0;
    add('darkWood', box(1.3, 0.22, 1.3, 0, stageY + 0.11, cz), 'rc');
    add('redVelvet', box(1.1, 0.012, 1.1, 0, stageY + 0.226, cz));
    const y0 = stageY + 0.22, y1 = y0 + 0.95;
    const c = [[-0.6, cz + 0.6], [0.6, cz + 0.6], [-0.6, cz + 0.05], [0.6, cz + 0.05]];
    for (const [x, z] of c) add('brass', rod(new V3(x, y0, z), new V3(x, y1, z), 0.016, 6), 'rc');
    add('brass', rod(new V3(-0.6, y1, cz + 0.6), new V3(0.6, y1, cz + 0.6), 0.02, 6), 'rc');
    add('brass', rod(new V3(-0.6, y1, cz + 0.05), new V3(-0.6, y1, cz + 0.6), 0.02, 6), 'rc');
    add('brass', rod(new V3(0.6, y1, cz + 0.05), new V3(0.6, y1, cz + 0.6), 0.02, 6), 'rc');

    const chairGeo = mergeGeometries([
      box(0.42, 0.04, 0.42, 0, 0.46, 0),
      box(0.42, 0.36, 0.03, 0, 0.8, -0.2),
      box(0.03, 0.98, 0.03, -0.19, 0.49, -0.2), box(0.03, 0.98, 0.03, 0.19, 0.49, -0.2),
      box(0.03, 0.44, 0.03, -0.19, 0.22, 0.19), box(0.03, 0.44, 0.03, 0.19, 0.22, 0.19),
    ]);
    const desk = new THREE.BoxGeometry(0.5, 0.34, 0.012);
    desk.rotateX(-0.3); desk.translate(0, 1.18, 0);
    const standGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6).translate(0, 0.55, 0),
      new THREE.CylinderGeometry(0.17, 0.2, 0.02, 10).translate(0, 0.01, 0),
      desk,
    ]);
    const sheet = new THREE.BoxGeometry(0.42, 0.28, 0.004);
    sheet.rotateX(-0.3); sheet.translate(0, 1.19, 0.01);

    const chairM = [], standM = [];
    const arcs = [[3.3, 7], [5.1, 10], [6.9, 13]];
    for (const [r, n] of arcs) for (let i = 0; i < n; i++) {
      const th = THREE.MathUtils.degToRad(-72 + (144 * i) / (n - 1));
      const x = r * Math.sin(th), z = cz - r * Math.cos(th);
      chairM.push(new THREE.Matrix4().makeRotationY(-th).setPosition(x, stageY, z));
      if (i % 2 === 0) {
        const rr = r - 0.75;
        standM.push(new THREE.Matrix4().makeRotationY(-th).setPosition(rr * Math.sin(th), stageY, cz - rr * Math.cos(th)));
      }
    }
    standM.push(new THREE.Matrix4().makeRotationY(0).setPosition(0, stageY + 0.22, cz - 0.5));
    addInstanced('orchChairs', chairGeo, 'black', chairM, { cast: true });
    addInstanced('musicStands', standGeo, 'black', standM, { cast: true });
    addInstanced('musicSheets', sheet, 'paper', standM);
  }

  // =================================================================
  // 5. The curved wall
  // =================================================================
  // Lower order (gallery level up to the arcade):
  //   organ wall (|s| < sStart): panelled oak dado, cream bays with large
  //   gilt-framed red panels between fluted pilasters, architrave; box block
  //   (|s| > sStart): plain plaster. Full length: terracotta frieze band and a
  //   deep dentilled cornice.
  for (const [a, b] of [[-S, -sStart], [sStart, S]]) {
    sweep('terracotta', a, b, [[0.12, 0], [0.12, 1.1], [0.0, 1.2]]);
    sweep('plaster', a, b, [[0, 1.2], [0, Y_ARCH]]);
  }
  {
    const sw = (key, prof, o) => sweep(key, -sStart, sStart, prof, 0.6, o);
    sw('darkWoodPlain', [[0.14, 0], [0.14, 0.2], [0.1, 0.25]]); // skirting
    sw('wainscot', [[0.1, 0], [0.1, Y_DADO]], { ku: 2 / bayW, kv: 1 / Y_DADO });
    sw('darkWoodPlain', [[0.1, Y_DADO], [0.17, Y_DADO + 0.05], [0.17, Y_DADO + 0.14], [0.08, Y_DADO + 0.2], [0.02, Y_DADO_TOP]]); // dado rail
    sw('goldMatte', [[0.175, Y_DADO + 0.075], [0.175, Y_DADO + 0.115]]);
    sw('bayPanels', [[0.02, Y_DADO_TOP], [0.02, Y_PANEL_TOP]], { ku: 1 / bayW, vNorm: true });
    sw('plaster', [[0.02, Y_PANEL_TOP], [0.08, Y_PANEL_TOP + 0.05], [0.08, Y_ARCH - 0.08], [0.0, Y_ARCH]]);
    sw('goldMatte', [[0.085, Y_PANEL_TOP + 0.1], [0.085, Y_PANEL_TOP + 0.16]]);
  }
  // architrave, frieze, cornice (full length)
  sweep('plaster', -S, S, [[0, Y_ARCH], [0.07, Y_ARCH + 0.05], [0.07, Y_FRIEZE0 - 0.04], [0.04, Y_FRIEZE0]]);
  sweep('goldMatte', -S, S, [[0.075, Y_ARCH + 0.07], [0.075, Y_ARCH + 0.11]]);
  sweep('frieze', -S, S, [[0.04, Y_FRIEZE0], [0.04, Y_FRIEZE1]], 0.5, { ku: 1 / (2 * (Y_FRIEZE1 - Y_FRIEZE0)), vNorm: true });
  const CORNICE_PROFILE = [
    [0.04, Y_FRIEZE1], [0.1, Y_FRIEZE1 + 0.06], [0.1, 15.98], [0.22, 16.04], [0.22, 16.22], // bed + dentil band
    [0.6, 16.25], [0.62, 16.27], [0.62, 16.47], // soffit, corona
    [0.46, 16.6], [0.34, 16.68], [0.1, 16.74], [0, Y_ARC0], // cyma, wash
  ];
  sweep('plaster', -S, S, CORNICE_PROFILE);
  sweep('goldMatte', -S, S, [[0.625, 16.33], [0.625, 16.39]]);
  // entablature under the ceiling
  sweep('plaster', -S, S, [[0, Y_ARC1], [0.1, Y_ARC1 + 0.1]]);
  sweep('frieze', -S, S, [[0.1, Y_ARC1 + 0.1], [0.1, Y_ARC1 + 0.7]], 0.5, { ku: 1 / 1.2, vNorm: true });
  sweep('plaster', -S, S, [[0.1, 24.3], [0.35, 24.5], [0.4, 24.9], [0.4, 25.08], [0.8, 25.1], [0.82, 25.2], [0.82, 25.6], [0.6, 25.7], [0.6, Y_CORNICE]]);
  sweep('gold', -S, S, [[0.825, 25.35], [0.825, 25.43]]);
  {
    // dentils under both cornices
    const dent = new THREE.BoxGeometry(0.1, 0.15, 0.14).translate(0, 0, 0.07);
    const dm = [];
    const n = Math.floor((2 * S) / 0.25);
    for (let i = 0; i < n; i++) {
      const s = -S + (i + 0.5) * (2 * S / n);
      dm.push(frame(s, 0.22, 16.13));
      dm.push(frame(s, 0.4, 24.99));
    }
    addInstanced('dentils', dent, 'plaster', dm);
  }

  // --- gallery arcade ---
  const OW = 1.7, Y_SILL = 17.4, Y_SPRING = 21.3, RAD = OW / 2;
  sweep('boxInterior', -S, S, [[-0.7, Y_SILL - 0.2], [-0.7, Y_SPRING + RAD + 0.2]], 0.9);
  sweep('plasterDark', -S, S, [[0, Y_SILL], [-0.7, Y_SILL]], 0.9); // sill
  const drapeM = [];
  {
    const mapToCurve = (g, s0, inset0) => {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const w = P(s0 + p.getX(i), inset0 + p.getZ(i), p.getY(i));
        p.setXYZ(i, w.x, w.y, w.z);
      }
      g.computeVertexNormals();
      return g;
    };
    const c = bayW / 2;
    const pierM = [], capM = [], archM = [];
    for (let i = 0; i < nBays; i++) {
      const s0 = -S + i * bayW;
      const shape = new THREE.Shape();
      shape.moveTo(0, Y_ARC0); shape.lineTo(bayW, Y_ARC0); shape.lineTo(bayW, Y_ARC1); shape.lineTo(0, Y_ARC1); shape.closePath();
      const hole = new THREE.Path();
      hole.moveTo(c - RAD, Y_SILL); hole.lineTo(c + RAD, Y_SILL); hole.lineTo(c + RAD, Y_SPRING);
      hole.absarc(c, Y_SPRING, RAD, 0, Math.PI, false);
      hole.lineTo(c - RAD, Y_SILL);
      shape.holes.push(hole);
      const sg = new THREE.ShapeGeometry(shape, 10);
      planarUV(sg, (x, y) => [s0 + x, y]); // metres, continuous along the wall
      add('plaster', mapToCurve(sg, s0, 0));

      const outline = [[c + RAD, Y_SILL], [c + RAD, Y_SPRING]];
      for (let a = 1; a <= 12; a++) outline.push([c + RAD * Math.cos((Math.PI * a) / 12), Y_SPRING + RAD * Math.sin((Math.PI * a) / 12)]);
      outline.push([c - RAD, Y_SILL]);
      const r0 = outline.map(([u, v]) => P(s0 + u, 0, v));
      const r1 = outline.map(([u, v]) => P(s0 + u, -0.7, v));
      add('plasterDark', gridGeo([r0, r1]));

      const sm = s0 + c;
      archM.push(frame(sm, 0.02, Y_SPRING));
      drapeM.push(frame(sm, -0.3, Y_SILL).multiply(new THREE.Matrix4().makeScale(OW + 0.1, Y_SPRING + RAD - Y_SILL, 1)));
    }
    for (let i = 0; i <= nBays; i++) {
      const s = -S + i * bayW;
      pierM.push(frame(s, 0.07, (Y_SILL + Y_SPRING) / 2));
      capM.push(frame(s, 0.1, Y_SPRING + 0.1));
    }
    addInstanced('arcadePiers', new THREE.BoxGeometry(0.44, Y_SPRING - Y_SILL, 0.14), 'plaster', pierM);
    addInstanced('arcadeCapitals', new THREE.BoxGeometry(0.56, 0.2, 0.2), 'goldMatte', capM);
    addInstanced('archivolts', new THREE.TorusGeometry(RAD + 0.08, 0.07, 6, 18, Math.PI), 'plaster', archM);
  }

  // --- fluted pilasters (organ wall and box-block end walls) ---
  const PIL_W = 0.7, PIL_D = 0.22, PIL_BASE = 0.28, PIL_CAP = 0.74;
  const pilShaftM = [], pilBaseM = [], pilCapM = [];
  function pilaster(m, y0, y1) { // m: frame at the wall face (local Z out), y0 base bottom, y1 capital top
    const at = (y) => m.clone().multiply(new THREE.Matrix4().makeTranslation(0, y, 0));
    pilBaseM.push(at(y0));
    pilCapM.push(at(y1 - PIL_CAP));
    pilShaftM.push(at(y0 + PIL_BASE).multiply(new THREE.Matrix4().makeScale(1, y1 - PIL_CAP - y0 - PIL_BASE, 1)));
  }
  {
    const kMax = Math.floor((sOrgan - 0.55) / bayW);
    for (let k = -kMax; k <= kMax; k++) pilaster(frame(k * bayW, 0, 0), Y_DADO_TOP, Y_ARCH);
  }

  // --- box tiers on both sides of the organ ---
  const tiers = [{ yb: 0, yt: 3.2 }, { yb: 3.7, yt: 6.9 }, { yb: 7.4, yt: 10.6 }];
  const Y_CIRCLE = 11.1;
  const partM = [], lampM = [];

  for (const sg of [-1, 1]) {
    const s0 = sg > 0 ? sStart : -S, s1 = sg > 0 ? S : -sStart;
    const parapet = (yb) => {
      sweep('plaster', s0, s1, [[D, yb], [D + 0.06, yb + 0.05], [D + 0.13, yb + 0.12]]);
      sweep('boxPanel', s0, s1, [[D + 0.13, yb + 0.12], [D + 0.13, yb + 0.12 + PANEL_H]], 0.4,
        { ku: 1 / boxW, uOff: (-sg * sStart) / boxW, vNorm: true });
      sweep('plaster', s0, s1, [[D + 0.13, yb + 0.84], [D + 0.18, yb + 0.88], [D + 0.04, yb + 0.92], [D + 0.1, yb + 0.95]]);
      sweep('gold', s0, s1, [[D + 0.1, yb + 0.95], [D + 0.1, yb + 1.0]]);
      sweep('redVelvet', s0, s1, [[D + 0.1, yb + 1.0], [D - 0.25, yb + 1.0]]);
    };
    for (const { yb, yt } of tiers) {
      parapet(yb);
      sweep('carpet', s0, s1, [[D - 0.25, yb + 0.6], [D - 1.8, yb + 0.6]], 1.2);
      sweep('boxInterior', s0, s1, [[D - 1.8, yb + 0.6], [D - 1.8, yt]], 0.9);
      sweep('plasterDark', s0, s1, [[D - 1.8, yt], [D, yt]], 0.9);
      // balcony fascia: ornamental relief frieze between gilt beads
      sweep('plaster', s0, s1, [[D, yt], [D + 0.06, yt + 0.05]]);
      sweep('goldMatte', s0, s1, [[D + 0.06, yt + 0.05], [D + 0.065, yt + 0.065], [D + 0.06, yt + 0.08]]);
      sweep('friezeLight', s0, s1, [[D + 0.06, yt + 0.08], [D + 0.06, yt + 0.42]], 0.4, { ku: 1 / 0.68, uOff: (-sg * sStart) / 0.68, vNorm: true });
      sweep('goldMatte', s0, s1, [[D + 0.06, yt + 0.42], [D + 0.065, yt + 0.435], [D + 0.06, yt + 0.45]]);
      sweep('plaster', s0, s1, [[D + 0.06, yt + 0.45], [D, yt + 0.5]]);
      for (let i = 0; i < nBox; i++) {
        const sm = sg * (sStart + (i + 0.5) * boxW);
        drapeM.push(frame(sm, D - 0.22, yb + 1.0).multiply(new THREE.Matrix4().makeScale(boxW - 0.14, yt - yb - 1.0, 1)));
      }
      for (let i = 1; i <= nBox; i++) {
        const sb = sg * (sStart + i * boxW);
        partM.push(frame(sb, D - 0.9, (yb + yt + 0.5) / 2).multiply(new THREE.Matrix4().makeScale(1, yt + 0.5 - yb, 1)));
        lampM.push(frame(sb, D + 0.1, yb + 1.75));
      }
    }
    parapet(Y_CIRCLE);
    sweep('seatBank', s0, s1, [[D - 0.25, 11.9], [2.1, 11.9], [2.1, 12.7], [1.3, 12.7], [1.3, 13.5], [0.5, 13.5], [0.5, 14.3], [0, 14.3]], 0.9);

    // podium below the boxes, in front of the gallery (down to the arena)
    const sp0 = sg > 0 ? sPodium : -S, sp1 = sg > 0 ? S : -sPodium;
    sweep('terracotta', sp0, sp1, [[D + 0.08, ARENA_Y], [D + 0.08, ARENA_Y + 1.1], [D, ARENA_Y + 1.2]]);
    sweep('plasterDark', sp0, sp1, [[D, ARENA_Y + 1.2], [D, -0.22]]);
    sweep('plaster', sp0, sp1, [[D, -0.22], [D + 0.08, -0.14], [D + 0.08, 0], [D, 0]]);

    // end wall closing the box block towards the organ
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(D + 0.12, 0); sh.lineTo(D + 0.12, Y_CIRCLE + 1.05); sh.lineTo(0, 14.9); sh.closePath();
    const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false });
    const q = at(sg * sStart);
    const N = new V3(q.nx, 0, q.nz);
    const em = new THREE.Matrix4().makeBasis(N, UP, new V3().crossVectors(N, UP));
    em.setPosition(q.x, 0, q.z);
    if (sg < 0) eg.translate(0, 0, -0.3); // extrude towards the organ on both sides
    eg.applyMatrix4(em);
    add('plaster', eg);

    // dress the face of the end wall: dado, gilt-framed red panel, pilaster, entablature
    const F = new V3(q.tx, 0, q.tz).multiplyScalar(-sg); // facing the organ
    const X = new V3().crossVectors(UP, F);
    const Q = new V3(q.x, 0, q.z).addScaledVector(F, 0.3);
    const endFrame = (inset, y, out = 0) => {
      const m = new THREE.Matrix4().makeBasis(X, UP, F);
      const p = Q.clone().addScaledVector(N, inset).addScaledVector(F, out);
      return m.setPosition(p.x, y, p.z);
    };
    const put = (key, g, inset, y, out, uvFn) => { if (uvFn) planarUV(g, uvFn); g.applyMatrix4(endFrame(inset, y, out)); add(key, g); };
    const EW = D + 0.12;
    const dmW = D - 1.05, dmC = 0.3 + dmW / 2, dmY0 = Y_DADO_TOP + 0.08, dmY1 = 10.1;
    put('wainscot', new THREE.BoxGeometry(EW - 0.04, Y_DADO, 0.1), EW / 2, Y_DADO / 2, 0.05, (x, y) => [x / 1.28, y / Y_DADO + 0.5]);
    put('darkWoodPlain', new THREE.BoxGeometry(EW, 0.2, 0.17), EW / 2, Y_DADO + 0.1, 0.085);
    put('goldMatte', new THREE.BoxGeometry(EW, 0.04, 0.18), EW / 2, Y_DADO + 0.1, 0.09);
    { // same bay texture as the organ wall, mapped 1:1 in metres
      const ym = (dmY0 + dmY1) / 2, H = Y_PANEL_TOP - Y_DADO_TOP;
      put('bayPanels', new THREE.BoxGeometry(dmW, dmY1 - dmY0, 0.03), dmC, ym, 0.015,
        (x, y) => [0.5 + (sg > 0 ? -x : x) / bayW, (y + ym - Y_DADO_TOP) / H]);
    }
    // entablature block under the circle parapet
    put('plaster', new THREE.BoxGeometry(EW, 0.5, 0.14), EW / 2, 10.82, 0.07);
    put('plaster', new THREE.BoxGeometry(EW + 0.02, 0.14, 0.26), EW / 2, 11.03, 0.13);
    put('goldMatte', new THREE.BoxGeometry(EW, 0.04, 0.15), EW / 2, 10.66, 0.075);
    pilaster(endFrame(D - 0.38, 0, 0), 0, 10.57);
  }
  addInstanced('boxPartitions', new THREE.BoxGeometry(0.14, 1, 1.8), 'plaster', partM);
  addInstanced('boxLamps', new THREE.SphereGeometry(0.075, 10, 7), 'lamp', lampM, { receive: false, lit: false });

  // pilaster instanced meshes
  {
    const baseGeo = mergeAny([
      box(PIL_W + 0.2, 0.14, PIL_D + 0.1, 0, 0.07, (PIL_D + 0.1) / 2),
      box(PIL_W + 0.12, 0.09, PIL_D + 0.07, 0, 0.185, (PIL_D + 0.07) / 2),
      box(PIL_W + 0.06, 0.05, PIL_D + 0.04, 0, 0.255, (PIL_D + 0.04) / 2),
    ]);
    const bellShape = new THREE.Shape();
    bellShape.moveTo(-PIL_W / 2, 0); bellShape.lineTo(PIL_W / 2, 0); bellShape.lineTo(PIL_W / 2 + 0.09, 0.55); bellShape.lineTo(-PIL_W / 2 - 0.09, 0.55); bellShape.closePath();
    const bell = new THREE.ExtrudeGeometry(bellShape, { depth: PIL_D + 0.02, bevelEnabled: false });
    bell.translate(0, 0.05, 0);
    const capPGeo = mergeAny([bell, box(PIL_W + 0.28, 0.14, PIL_D + 0.16, 0, 0.67, (PIL_D + 0.16) / 2)]);
    const leaves = [];
    for (const [x, y, s] of [[-0.22, 0.24, 1], [0, 0.26, 1.1], [0.22, 0.24, 1], [-0.11, 0.42, 0.8], [0.11, 0.42, 0.8]]) {
      const l = new THREE.SphereGeometry(0.09, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      l.rotateX(Math.PI / 2); // dome faces +z
      l.scale(s, 2.1 * s, 0.55);
      l.translate(x, y, PIL_D + 0.02);
      leaves.push(l);
    }
    const vol = (x) => { const t = new THREE.TorusGeometry(0.07, 0.024, 5, 12); t.translate(x, 0.53, PIL_D + 0.04); return t; };
    const capGGeo = mergeAny([
      box(PIL_W + 0.04, 0.05, PIL_D + 0.04, 0, 0.025, (PIL_D + 0.04) / 2), // astragal
      ...leaves, vol(-0.37), vol(0.37),
      box(PIL_W + 0.3, 0.03, PIL_D + 0.17, 0, 0.6, (PIL_D + 0.17) / 2), // abacus fillet
    ]);
    addInstanced('pilasterShafts', flutedShaft(PIL_W, PIL_D, 7), 'plaster', pilShaftM);
    addInstanced('pilasterBases', baseGeo, 'plaster', pilBaseM);
    addInstanced('pilasterCapitals', capPGeo, 'plaster', pilCapM);
    addInstanced('pilasterGilding', capGGeo, 'goldMatte', pilCapM);
  }

  // --- drapes (arcade, boxes, organ wall): tied-back curtains with a valance ---
  {
    const W = 2, H = 2.4, nu = 6, nv = 10;
    const rowsL = [], rowsR = [];
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const w = (0.13 + 0.2 * Math.abs(v - 0.42) / 0.58) * W;
      const rl = [], rr = [];
      for (let i = 0; i <= nu; i++) {
        const uu = i / nu;
        rl.push(new V3(uu * w, v * H, 0.02 + 0.05 * Math.sin(uu * Math.PI * 3.5)));
        const ur = 1 - uu;
        rr.push(new V3(W - ur * w, v * H, 0.02 + 0.05 * Math.sin(ur * Math.PI * 3.5)));
      }
      rowsL.push(rl); rowsR.push(rr);
    }
    const bot = [], top = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24, z = 0.08 + 0.025 * Math.sin(u * Math.PI * 14);
      bot.push(new V3(u * W, H * (0.85 - 0.06 * Math.abs(Math.sin(u * Math.PI * 4))), z));
      top.push(new V3(u * W, H, z));
    }
    const drapeGeo = mergeGeometries([gridGeo(rowsL), gridGeo(rowsR), gridGeo([bot, top])]);
    drapeGeo.translate(-W / 2, 0, 0);
    drapeGeo.scale(1 / W, 1 / H, 1);
    addInstanced('drapes', drapeGeo, 'redVelvet', drapeM, { jitter: 0.1, seed: 5 });
  }

  // =================================================================
  // 6. Ceiling hint + acoustic mushrooms
  // =================================================================
  {
    const C = new V3(0, 0, 12);
    const rows = [[0.022, Y_CORNICE], [0.06, 29.5], [0.14, 32.5], [0.26, 34.8], [0.45, 36.5], [0.7, 37.5]];
    const n = Math.ceil((2 * S) / 1.2);
    const grid = rows.map(([f, y]) => {
      const r = [];
      for (let i = 0; i <= n; i++) {
        const w = P(-S + (2 * S * i) / n, 0, 0);
        r.push(new V3(C.x + (w.x - C.x) * (1 - f), y, C.z + (w.z - C.z) * (1 - f)));
      }
      return r;
    });
    add('ceilingDark', gridGeo(grid), 'n');
    add('ceilingDark', flatPolygon([[-34, -14], [34, -14], [34, 80], [-34, 80]], 37.5, false), 'n');

    const prof = [[0, -0.28], [0.5, -0.24], [0.85, -0.12], [1.0, 0], [0.8, 0.07], [0.3, 0.1], [0, 0.1]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const mushGeo = new THREE.LatheGeometry(prof, 28);
    const r = rng(1871);
    const placed = [], ms = [];
    let guard = 0;
    while (placed.length < 22 && guard++ < 4000) {
      const x = (r() * 2 - 1) * 13, z = 5 + r() * 25;
      if ((x / 13) ** 2 + ((z - 17.5) / 13.5) ** 2 > 1) continue;
      const rad = 1.15 + r() * 0.75;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.rad + rad + 0.5)) continue;
      const y = 30.2 + r() * 3.6;
      placed.push({ x, z, rad });
      const m = new THREE.Matrix4().makeRotationY(r() * 6.28);
      m.multiply(new THREE.Matrix4().makeRotationX((r() - 0.5) * 0.12));
      m.scale(new V3(rad, rad * 0.9, rad));
      m.setPosition(x, y, z);
      ms.push(m);
    }
    addInstanced('mushrooms', mushGeo, 'mushroom', ms, { receive: false });
  }

  // =================================================================
  // 6b. Technical canopy above the organ front: a broad, shallow, curved
  //     reflector, three lighting trusses of moving heads with warm lamp
  //     clusters between them, and flown line-array loudspeakers. Emissive
  //     materials only, no lights. Over the organ footprint (LAYOUT.reserved)
  //     everything stays above yMax; the low parts start at z > zMax.
  // =================================================================
  const RIG = { heads: 0, lampClusters: 0, lineArrayCabinets: 0 };
  {
    const R = L.reserved;
    const CW = 13, ZR = R.zMax + 0.15;
    const yU = (x, z) => 19.75 + 1.3 * clamp01((z - ZR) / 4.75) + 0.45 * (x / CW) ** 2; // underside, rising to the hall
    const zEdge = (x) => 9.2 - 0.6 * (x / CW) ** 2;
    const yHigh = (x) => R.yMax + 0.15 + 0.45 * (x / CW) ** 2;
    const T = (g) => g[0].map((_, i) => g.map((r) => r[i]));
    // closed curved slab: underside yb(x, z), thickness t
    function slab(key, xa, xb, za, zb, yb, t, nx, nn, shadow = 'r') {
      const bot = [], top = [];
      for (let j = 0; j <= nn; j++) {
        const rb = [], rt = [];
        for (let i = 0; i <= nx; i++) {
          const x = xa + ((xb - xa) * i) / nx;
          const z = za(x) + ((zb(x) - za(x)) * j) / nn;
          const y = yb(x, z);
          rb.push(new V3(x, y, z)); rt.push(new V3(x, y + t, z));
        }
        bot.push(rb); top.push(rt);
      }
      add(key, gridGeo(bot), shadow);               // underside (-y)
      add(key, gridGeo(T(top)), shadow);            // top (+y)
      add(key, gridGeo([top[0], bot[0]]), shadow);  // back edge (-z)
      add(key, gridGeo([bot[nn], top[nn]]), shadow); // front edge (+z)
      const cb = T(bot), ct = T(top);
      add(key, gridGeo([cb[0], ct[0]]), shadow);    // -x
      add(key, gridGeo([ct[nx], cb[nx]]), shadow);  // +x
    }
    const SLOT = 0.7, SLOT_Z = 6.15; // opening for the central loudspeaker hang
    slab('canopy', -CW, CW, () => -1, () => ZR, (x) => yHigh(x), 0.15, 26, 6); // high part over the organ
    slab('canopy', -CW, -SLOT, () => ZR, zEdge, yU, 0.15, 16, 8);
    slab('canopy', SLOT, CW, () => ZR, zEdge, yU, 0.15, 16, 8);
    slab('canopy', -SLOT, SLOT, () => SLOT_Z, zEdge, yU, 0.15, 2, 4);
    { // step between the high and the low part
      const xs = []; for (let i = 0; i <= 26; i++) xs.push(-CW + (2 * CW * i) / 26);
      const lo = xs.map((x) => new V3(x, yU(x, ZR), ZR)), hi = xs.map((x) => new V3(x, yHigh(x), ZR));
      add('canopy', gridGeo([lo, hi]));
      add('canopy', gridGeo([hi, lo]));
    }
    // black fascia beam along the hall edge
    slab('fixture', -CW - 0.3, CW + 0.3, (x) => zEdge(x) - 0.12, (x) => zEdge(x) + 0.25, (x) => yU(x, zEdge(x)) - 0.4, 0.75, 28, 1);
    // suspension up into the roof
    for (const x of [-10, -4, 4, 10]) {
      add('rigging', rod(new V3(x, yHigh(x) + 0.15, 1.5), new V3(x, 29.5, 1.5), 0.02, 4));
      add('rigging', rod(new V3(x, yU(x, 7.6) + 0.15, 7.6), new V3(x, 29.5, 7.6), 0.02, 4));
    }

    // box trusses (0.3 m) hung under the reflector
    const XT = 12.6;
    function truss(z, yc) {
      const h = 0.15;
      for (const dy of [-h, h]) for (const dz of [-h, h]) add('rigging', rod(new V3(-XT, yc + dy, z + dz), new V3(XT, yc + dy, z + dz), 0.025, 6));
      const n = Math.round((2 * XT) / 0.6);
      for (let i = 0; i < n; i++) {
        const xa = -XT + (2 * XT * i) / n, xb = -XT + (2 * XT * (i + 1)) / n;
        const f = i % 2 ? 1 : -1;
        for (const dy of [-h, h]) add('rigging', rod(new V3(xa, yc + dy, z - f * h), new V3(xb, yc + dy, z + f * h), 0.011, 4));
        for (const dz of [-h, h]) add('rigging', rod(new V3(xa, yc - f * h, z + dz), new V3(xb, yc + f * h, z + dz), 0.011, 4));
      }
      for (const x of [-12, -7.5, -3, 3, 7.5, 12]) add('rigging', rod(new V3(x, yc + h, z), new V3(x, yU(x, z) + 0.02, z), 0.016, 4));
    }
    const rows = [4.85, 6.5, 8.15].map((z) => ({ z, yc: yU(0, z) - 0.35 }));
    for (const r of rows) truss(r.z, r.yc);

    // moving heads: clamp, base, yoke, head, lens (hanging, lens down)
    const headGeo = mergeAny([
      box(0.1, 0.08, 0.1, 0, -0.04, 0),
      box(0.4, 0.15, 0.34, 0, -0.155, 0),
      box(0.06, 0.4, 0.14, -0.2, -0.43, 0), box(0.06, 0.4, 0.14, 0.2, -0.43, 0),
      new THREE.CylinderGeometry(0.165, 0.15, 0.42, 12).translate(0, -0.5, 0),
      new THREE.CylinderGeometry(0.06, 0.06, 0.46, 8).rotateZ(Math.PI / 2).translate(0, -0.45, 0),
    ]);
    const lensGeo = new THREE.CircleGeometry(0.125, 14).rotateX(Math.PI / 2).translate(0, -0.712, 0);
    const headM = [];
    const rr = rng(4242);
    for (const r of rows) for (let i = 0; i < 12; i++) {
      const x = -11 + 2 * i;
      headM.push(new THREE.Matrix4().makeRotationY((rr() - 0.5) * 1.2).setPosition(x, r.yc - 0.15, r.z));
    }
    addInstanced('movingHeads', headGeo, 'fixture', headM, { receive: false });
    addInstanced('movingHeadLenses', lensGeo, 'lens', headM, { receive: false, lit: false });
    RIG.heads = headM.length;

    // small warm lamp clusters (two bulbs in a black housing, tipped towards the hall)
    const housingGeo = mergeAny([box(0.04, 0.12, 0.04, 0, -0.06, 0), box(0.18, 0.4, 0.14, 0, -0.32, 0)]);
    const bulbGeo = mergeAny([
      new THREE.SphereGeometry(0.058, 10, 6).translate(0, -0.23, 0.065),
      new THREE.SphereGeometry(0.058, 10, 6).translate(0, -0.41, 0.065),
    ]);
    const lampCM = [];
    const lampAt = (x, r) => lampCM.push(new THREE.Matrix4().makeRotationX(0.35).setPosition(x, r.yc - 0.15, r.z + 0.02));
    for (const x of [-8, -4, 4, 8]) lampAt(x, rows[0]);
    for (const r of rows.slice(1)) for (const x of [-10, -6, -2, 2, 6, 10]) lampAt(x, r);
    addInstanced('lampHousings', housingGeo, 'fixture', lampCM, { receive: false });
    addInstanced('lampBulbs', bulbGeo, 'lamp', lampCM, { receive: false, lit: false });
    RIG.lampClusters = lampCM.length;

    // line arrays: J-curved stacks of cabinets (front at local z = 0)
    const cabGeo = new THREE.BoxGeometry(1.0, 0.28, 0.62).translate(0, -0.14, -0.31);
    const grilleGeo = new THREE.PlaneGeometry(0.92, 0.22).translate(0, -0.14, 0.006);
    function lineArray(x, zf, yTop, tiltsDeg, yaw) {
      const B = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, yTop, zf);
      const p = new V3();
      const put = (key, g, m) => { const c = g.clone(); c.applyMatrix4(m); add(key, c); };
      put('rigging', box(1.2, 0.1, 0.8, 0, 0.08, -0.31), B);
      for (const sx of [-0.4, 0.4]) {
        const a = new V3(sx, 0.13, -0.31).applyMatrix4(B);
        add('rigging', rod(a, new V3(a.x, 29.5, a.z), 0.018, 4));
      }
      for (const deg of tiltsDeg) {
        const Rx = new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(deg));
        const M2 = B.clone().multiply(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)).multiply(Rx);
        put('fixture', cabGeo, M2);
        put('grille', grilleGeo, M2);
        p.add(new V3(0, -0.29, 0).applyMatrix4(Rx));
        RIG.lineArrayCabinets++;
      }
    }
    lineArray(0, 5.85, 21.95, [0, 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8], 0);
    for (const sg of [-1, 1]) lineArray(sg * 14.3, 8.7, 22.4, [0, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8], Math.atan2(-sg * 14.3, 17));
  }

  // =================================================================
  // 7. Flush buckets -> one mesh per material, with baked falloff colours
  // =================================================================
  for (const { key, shadow, list } of buckets.values()) {
    const g = mergeGeometries(list, false);
    for (const l of list) l.dispose();
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      warm(shade(p.getX(i), p.getY(i), p.getZ(i)), tmpC);
      col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, vcMat(key));
    mesh.name = 'hall_' + key + (shadow === 'rc' ? '_cast' : '');
    mesh.receiveShadow = shadow !== 'n';
    mesh.castShadow = shadow === 'rc';
    group.add(mesh);
  }

  // =================================================================
  // 8. Warm ambience: two dim house lights out in the auditorium (no shadows)
  // =================================================================
  for (const sx of [-1, 1]) {
    const pl = new THREE.PointLight(0xffa458, 26, 40, 2);
    pl.position.set(sx * 12, 5, 21);
    pl.castShadow = false;
    pl.name = 'hall_ambience';
    group.add(pl);
  }

  group.userData.cameraHints = {
    overview: { position: [0, 3, 33], target: [0, 8, 0] },
    conductor: { position: [0, -2.2, 25], target: [0, 7, 0] },
    choirAisle: { position: [0, 1.2, 9.5], target: [0, 4.5, 0] },
    sideBox: { position: [19, 5.4, 14], target: [0, 8, 0] },
    arcade: { position: [-17, 19.5, 16], target: [2, 10, 0] },
    canopy: { position: [0, 9, 22], target: [0, 19.5, 5] },
  };
  group.userData.info = {
    wallHalfLength: S, boxesPerSidePerTier: nBox, arcadeBays: nBays, seats: seatM.length,
    pilasters: pilShaftM.length, ambienceLights: 2, ambienceIntensityTotal: 52,
    sideStairs: { xTop: stairXk(1, 0), xBottom: stairXk(1, NST - 1), halfWidth: ST_HW },
    movingHeads: RIG.heads, lampClusters: RIG.lampClusters, lineArrayCabinets: RIG.lineArrayCabinets,
  };
  return group;
}
