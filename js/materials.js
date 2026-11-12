import * as THREE from 'three';

// ---------- procedural textures ----------
function canvasTexture(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function woodTexture(base, dark, seed = 1) {
  return canvasTexture(512, (g, n) => {
    const r = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++) {
      const x = r() * n;
      g.strokeStyle = dark;
      g.globalAlpha = 0.05 + r() * 0.22;
      g.lineWidth = 0.5 + r() * 2.5;
      g.beginPath();
      g.moveTo(x, 0);
      let cx = x;
      for (let y = 0; y <= n; y += 32) {
        cx += (r() - 0.5) * 6;
        g.lineTo(cx, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

function noiseTexture(seed, contrast = 60, base = 128) {
  return canvasTexture(256, (g, n) => {
    const r = rng(seed);
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = base + (r() - 0.5) * contrast;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

// ---------- shared material library ----------
// Modules should use these (clone if they need per-object variations).
export function createMaterials() {
  const darkWoodMap = woodTexture('#2a170c', '#0c0502', 3);
  const oakMap = woodTexture('#8a6238', '#4a2f14', 7);
  const rough = noiseTexture(11, 70, 150);

  const M = {
    // Facade pipes: burnished tin/zinc alloy
    pipeMetal: new THREE.MeshStandardMaterial({ color: 0xcfd2cf, metalness: 1.0, roughness: 0.2 }),
    // Interior pipes, duller spotted metal
    pipeMetalDull: new THREE.MeshStandardMaterial({ color: 0x8f9290, metalness: 0.9, roughness: 0.5 }),
    // Dark inside of pipe mouths / pipe tops
    pipeDark: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.2, roughness: 0.9 }),
    // Gilding on mouths, ornaments, mouldings
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1.0, roughness: 0.28 }),
    goldMatte: new THREE.MeshStandardMaterial({ color: 0xb98a36, metalness: 0.8, roughness: 0.5 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 1.0, roughness: 0.35 }),
    // Case woodwork: very dark stained oak
    darkWood: new THREE.MeshStandardMaterial({ color: 0xb0a8a0, map: darkWoodMap, metalness: 0.0, roughness: 0.55 }),
    darkWoodPlain: new THREE.MeshStandardMaterial({ color: 0x24150b, metalness: 0.0, roughness: 0.6 }),
    // Lighter oak (console, choir stalls, floors)
    oak: new THREE.MeshStandardMaterial({ color: 0xffffff, map: oakMap, metalness: 0.0, roughness: 0.5 }),
    floorWood: new THREE.MeshStandardMaterial({ color: 0xb08a5a, map: oakMap, metalness: 0.0, roughness: 0.4 }),
    // Console details
    ivory: new THREE.MeshStandardMaterial({ color: 0xf2ecd9, metalness: 0.0, roughness: 0.35 }),
    ebony: new THREE.MeshStandardMaterial({ color: 0x141211, metalness: 0.0, roughness: 0.3 }),
    // Hall
    redVelvet: new THREE.MeshStandardMaterial({ color: 0x8a1420, metalness: 0.0, roughness: 0.95 }),
    plaster: new THREE.MeshStandardMaterial({ color: 0xd8c9a8, metalness: 0.0, roughness: 0.9 }),
    plasterDark: new THREE.MeshStandardMaterial({ color: 0x6b5a48, metalness: 0.0, roughness: 0.9 }),
    terracotta: new THREE.MeshStandardMaterial({ color: 0x9a5236, metalness: 0.0, roughness: 0.85 }),
    black: new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.0, roughness: 1.0 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xf5f1e6, metalness: 0.0, roughness: 0.9 }),
  };
  for (const [name, m] of Object.entries(M)) m.name = name;
  return M;
}
