import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMaterials } from './materials.js';
import { LAYOUT } from './layout.js';
import { createBus } from './bus.js';
import { buildCase } from './case.js';
import { buildPipes } from './pipes.js';
import { buildConsole } from './console.js';
import { buildHall } from './hall.js';
import { initInteraction, createHoldScheduler, createAdaptiveResolution, busHolds, INPUT_RENDER_HOLD, PERF_KEY } from './interaction.js';

// The Technik model loads in parallel; a missing or broken module never breaks the organ.
const technikModule = import('./technik.js').catch((err) => { console.warn('[Orgel] technik.js nicht geladen:', err); return null; });

const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(MAX_PIXEL_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Shadows on demand: the scene is static except keys / drawknobs / pistons / swell pedals;
// the shadow map is redrawn only when something that casts shadows may have moved.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0706);
scene.fog = new THREE.Fog(0x0a0706, 60, 140);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 300);
camera.position.set(0, 5, 34);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 8.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 0.6;
controls.maxDistance = 70;
controls.update();

// ---------- lighting ----------
scene.add(new THREE.HemisphereLight(0xffe2c0, 0x1a0f0a, 0.22));

// The key spot is the ONLY shadow caster (checked after the build). Its cone (0.36 rad from
// 37 m) already frames organ + console (≈ 14 m radius at the target), so the shadow frustum
// is tight: 2048² instead of 4096² (≈ 14 mm per texel at the facade, PCF-soft filtered).
// near 8 -> 16 m (nothing that matters is closer to the lamp) for better depth precision;
// far is taken from light.distance (90) by three.js, which also drives the falloff – kept.
const SHADOW_MAP_SIZE = 2048;
const key = new THREE.SpotLight(0xffe6c4, 1500, 90, 0.36, 0.6, 1.6);
key.position.set(6, 30, 30);
key.target.position.set(0, 9, 0);
key.castShadow = true;
key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.03;
key.shadow.camera.near = 16;
key.shadow.camera.far = 80;
scene.add(key, key.target);

const fillL = new THREE.SpotLight(0xffc890, 420, 70, 0.42, 0.8, 1.6);
fillL.position.set(-22, 14, 22);
fillL.target.position.set(-4, 9, 0);
scene.add(fillL, fillL.target);

const fillR = new THREE.SpotLight(0xc4d4ff, 240, 70, 0.42, 0.8, 1.6);
fillR.position.set(22, 12, 20);
fillR.target.position.set(4, 10, 0);
scene.add(fillR, fillR.target);

// warm uplight glow from inside the case and at the console
const consoleLamp = new THREE.PointLight(0xffd9a0, 3, 5, 2);
consoleLamp.position.set(0, 1.85, 2.6);
scene.add(consoleLamp);

// ---------- render / shadow scheduling ----------
const renderSched = createHoldScheduler({ initialFrames: 3 });
const shadowSched = createHoldScheduler({ initialFrames: 3 });

// ---------- build ----------
const ctx = {
  THREE, scene, camera, renderer, controls,
  materials: createMaterials(),
  LAYOUT,
  bus: createBus(),
  pickables: [],     // meshes the interaction module may raycast (keys, stops)
  updaters: [],      // functions (time, dt) called every frame (also when no frame is rendered)
  lateUpdaters: [],  // functions (time, dt) called every frame after OrbitControls.update (DOM labels)
  /** invalidate the view: render the next frame and keep rendering for `seconds` */
  requestRender: (seconds = 0) => renderSched.request(seconds),
  /** shadow casters moved: redraw the shadow map (and the view) for `seconds` */
  requestShadowUpdate: (seconds = 0) => { shadowSched.request(seconds); renderSched.request(Math.max(seconds, 0.1)); },
};
// Every bus event invalidates the view (glows, keys, shutters) – and the shadow map when a caster moves.
{
  const emit = ctx.bus.emit;
  ctx.bus.emit = function emitAndInvalidate(type, payload) {
    const h = busHolds(type);
    renderSched.request(h.render);
    if (h.shadow) shadowSched.request(h.shadow);
    return emit.call(this, type, payload);
  };
}

ctx.groups = {};
for (const [name, build] of [['hall', buildHall], ['case', buildCase], ['pipes', buildPipes], ['console', buildConsole]]) {
  const group = build(ctx);
  if (group) { scene.add(group); ctx.groups[name] = group; }
}
// Technik-Modus model (after the four builds: it reads ctx.groups); hidden until the mode is on.
{
  const mod = await technikModule;
  if (mod && typeof mod.buildTechnik === 'function') {
    try {
      const g = mod.buildTechnik(ctx);
      if (g && g.isObject3D) { g.visible = false; scene.add(g); ctx.groups.technik = g; }
    } catch (err) { console.warn('[Orgel] Technik-Modell konnte nicht aufgebaut werden:', err); }
  }
}
// shadow budget: the key spot is the only caster
scene.traverse((o) => {
  if (o.isLight && o !== key && o.castShadow) { console.warn(`[Orgel] Schattenwurf von Licht „${o.name || o.type}“ abgeschaltet (nur das Hauptlicht wirft Schatten)`); o.castShadow = false; }
});

const inter = initInteraction(ctx);
ctx.interaction = inter;

// Toggle to hide the wooden case and reveal the interior pipework (sits in front of "Technik").
{
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'case-toggle';
  btn.setAttribute('aria-pressed', 'false');
  btn.textContent = 'Gehäuse ausblenden';
  btn.addEventListener('click', () => {
    const g = ctx.groups.case;
    if (!g) return;
    g.visible = !g.visible;
    btn.setAttribute('aria-pressed', String(!g.visible));
    btn.textContent = g.visible ? 'Gehäuse ausblenden' : 'Gehäuse einblenden';
    ctx.requestShadowUpdate(0.2);
  });
  const row = document.getElementById('rah-toggles');
  if (row) row.prepend(btn); else document.getElementById('ui').appendChild(btn);
}

// ---------- performance state + optional readout (F9) ----------
const adaptive = createAdaptiveResolution({ devicePixelRatio: MAX_PIXEL_RATIO });
const perf = {
  fps: 0, frameMs: 0, workMs: 0, pixelRatio: renderer.getPixelRatio(), maxPixelRatio: MAX_PIXEL_RATIO,
  calls: 0, triangles: 0, renderedFrames: 0, skippedFrames: 0, shadowUpdates: 0, paused: false,
  shadowMapSize: SHADOW_MAP_SIZE,
};
ctx.perf = perf;
window.__organ = ctx; // for debugging; ctx.perf, ctx.groups, ctx.requestRender

const readout = document.createElement('div');
readout.id = 'perf-readout';
readout.hidden = true;
readout.setAttribute('aria-hidden', 'true');
document.body.appendChild(readout);
let readoutAt = 0;
function updateReadout(nowMs, force = false) {
  if (readout.hidden || (!force && nowMs - readoutAt < 250)) return;
  readoutAt = nowMs;
  const total = perf.renderedFrames + perf.skippedFrames;
  readout.textContent = `${perf.fps.toFixed(0)} B/s gerendert · ${perf.frameMs.toFixed(1)} ms/Bild · CPU ${perf.workMs.toFixed(1)} ms\n`
    + `Auflösung ×${perf.pixelRatio} (max ×${perf.maxPixelRatio}) · ${perf.calls} Aufrufe · ${(perf.triangles / 1e6).toFixed(2)} M Dreiecke\n`
    + `gerendert ${perf.renderedFrames} · übersprungen ${perf.skippedFrames} (${total ? Math.round((100 * perf.skippedFrames) / total) : 0} %) · Schatten ${perf.shadowUpdates}`;
}
window.addEventListener('keydown', (e) => {
  if (e.code !== PERF_KEY && e.key !== PERF_KEY) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  if (e.repeat) return;
  readout.hidden = !readout.hidden;
  updateReadout(performance.now(), true);
});

// ---------- invalidation sources ----------
// any pointer / keyboard input: render for a while (hover tooltips, drags, OrbitControls inertia)
{
  const poke = () => renderSched.request(INPUT_RENDER_HOLD);
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'touchstart', 'touchmove']) {
    window.addEventListener(t, poke, { capture: true, passive: true });
  }
}
controls.addEventListener('change', () => renderSched.request(0)); // also fires while damping settles

document.getElementById('loading')?.remove();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  ctx.requestShadowUpdate(0.3);
});

// ---------- frame loop ----------
const clock = new THREE.Clock();
let lastRenderAt = null;
let lastFrameRendered = false;
let fpsFrames = 0;
let fpsSince = performance.now();
function frame() {
  const t0 = performance.now();
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  for (const fn of ctx.updaters) fn(t, dt);
  controls.update();
  for (const fn of ctx.lateUpdaters) fn(t, dt);
  const now = t0 / 1000;
  let active = true;
  try { active = !!inter.isAnimating(); } catch { active = true; }
  if (t0 - fpsSince >= 1000) { perf.fps = (fpsFrames * 1000) / (t0 - fpsSince); fpsFrames = 0; fpsSince = t0; }
  if (!renderSched.frame(now, active)) {
    perf.skippedFrames++;
    lastFrameRendered = false;
    updateReadout(t0);
    return;
  }
  if (shadowSched.frame(now)) { renderer.shadowMap.needsUpdate = true; perf.shadowUpdates++; }
  renderer.render(scene, camera);
  const work = performance.now() - t0;
  perf.renderedFrames++;
  fpsFrames++;
  perf.calls = renderer.info.render.calls;
  perf.triangles = renderer.info.render.triangles;
  perf.workMs = perf.workMs ? perf.workMs + (work - perf.workMs) * 0.1 : work;
  // adaptive resolution: only from consecutive rendered frames (continuous rendering, e.g. orbiting)
  if (lastFrameRendered && lastRenderAt !== null) {
    let flying = false;
    try { flying = !!inter.isFlying(); } catch { flying = false; }
    const ratio = adaptive.sample(now, t0 - lastRenderAt, work, !flying);
    if (ratio) { renderer.setPixelRatio(ratio); perf.pixelRatio = ratio; renderSched.request(0.1); }
    perf.frameMs = adaptive.average() ?? t0 - lastRenderAt;
  }
  lastFrameRendered = true;
  lastRenderAt = t0;
  updateReadout(t0);
}

// pause the loop entirely while the tab is hidden (interaction.js stops demo / MIDI playback then)
function runLoop(on) { renderer.setAnimationLoop(on ? frame : null); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { perf.paused = true; runLoop(false); return; }
  perf.paused = false;
  clock.getDelta();
  lastFrameRendered = false;
  renderSched.request(1);
  shadowSched.request(0.1);
  runLoop(true);
});
runLoop(!document.hidden);
