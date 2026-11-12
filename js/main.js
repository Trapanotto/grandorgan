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
import { initInteraction } from './interaction.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

const key = new THREE.SpotLight(0xffe6c4, 1500, 90, 0.36, 0.6, 1.6);
key.position.set(6, 30, 30);
key.target.position.set(0, 9, 0);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.03;
key.shadow.camera.near = 8;
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

// ---------- build ----------
const ctx = {
  THREE, scene, camera, renderer, controls,
  materials: createMaterials(),
  LAYOUT,
  bus: createBus(),
  pickables: [],  // meshes the interaction module may raycast (keys, stops)
  updaters: [],   // functions (time, dt) called every frame
};

ctx.groups = {};
for (const [name, build] of [['hall', buildHall], ['case', buildCase], ['pipes', buildPipes], ['console', buildConsole]]) {
  const group = build(ctx);
  if (group) { scene.add(group); ctx.groups[name] = group; }
}
initInteraction(ctx);

// Toggle to hide the wooden case and reveal the interior pipework.
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
  });
  document.getElementById('ui').appendChild(btn);
}
window.__organ = ctx; // for debugging

document.getElementById('loading')?.remove();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  for (const fn of ctx.updaters) fn(t, dt);
  controls.update();
  renderer.render(scene, camera);
});
