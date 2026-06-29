// Homepage — InstancedMesh voxel card driven by cube_positions.json.
// The card is a programmable field of 5760 glass cubes (foundation for edge
// dissolve, hover repulsion, spring return, scroll morphing).
// Exports: initScene(canvas), setProject(idx), setPaused(paused), destroy()

import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ChromaticAberrationEffect, DepthOfFieldEffect } from 'postprocessing';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { ORBIT_PROJECTS } from '../data/projects.js';
import { initEnvironment } from './environment.js';
import { initSkyDome } from './sky-dome.js';
import { initReflectiveFloor } from './reflective-floor.js';
import { Wobble } from '@alienkitty/alien.js/src/three/utils/Wobble.js';
import { Flowmap } from '@alienkitty/alien.js/src/three/utils/Flowmap.js';
import { initMistFront } from './mist-front.js';

// Sky source: 'exr' = sky_env.exr (72 MB, static) · 'dome' = procedural animated dome (no asset).
const SKY_MODE = 'dome';
import { initCloudLayer } from './cloud-layer.js';

// The scene is built imperatively once (initScene runs on page load). Vite HMR hot-swaps this
// module without re-running it, so edits wouldn't show. Force a full reload on any update to
// this module or its deps (cloud-layer, etc.) so the scene always rebuilds fresh. Dev-only.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

// ── Module state ──────────────────────────────────────────────────────────────

let renderer, composer, scene, camera, rafId, bloomEffect;
let cardGroup  = null;   // holds the voxel field; gets float + mouse tilt
let voxelMesh  = null;   // THREE.InstancedMesh — the card itself
let glowPlane  = null;
let _env       = null;   // hero atmosphere (ground / haze / clouds / glow) — disabled this pass
let _cloud     = null;   // composition-validation cloud layer (3 still planes)
let _gui       = null;   // dev-only scene/env controls (lazy, dev/?lights only)
let _sky       = null;   // procedural sky dome (SKY_MODE === 'dome')
let _floor     = null;   // reflective floor below the card
let _wobble    = null;   // alien.js Wobble — 3D Perlin float for cardGroup
let _flowmap   = null;   // alien.js Flowmap — cursor velocity → UV distortion texture
let _godRays   = null;   // procedural god-ray plane behind the card (additive)
const _prevFlowMouse = new THREE.Vector2(); // tracks last flowmap mouse for velocity delta
let _mistFront = null;   // foreground fog drifting in front of the card

// Per-project environment accent (drives ground/clouds/haze/glow tint).
const _accentFor = (idx) => ORBIT_PROJECTS[idx]?.envAccent || '#7fa0ff';
let isMobile   = false;

let _cardFaceAspect = 16 / 10;
const _halfExtent   = new THREE.Vector2(2, 1.24); // face half-extent (world units)

// ── Per-instance voxel data (typed arrays — no object per cube) ───────────────
let _N        = 0;
let _curPos   = null;  // base cube position (matrix written once; shader animates on top)
let _scaleArr = null;  // per-instance uniform scale
let _vox      = null;  // per-cube (depthNorm, rand, lum) → D2 motion/visibility
let _colRand  = null;  // per-COLUMN random (same for all 6 depth cubes in a cell) → whole-column cull
let _revealArr  = null;  // per-cube eased reveal 0→1 (asymmetric attack/release → smooth fade-out)
let _revealAttr = null;  // InstancedBufferAttribute wrapping _revealArr (uploaded per frame)
let _bumpArr    = null;  // per-cube eased bump height 0→1 (fast attack, slow release → slow settle)
let _bumpAttr   = null;  // InstancedBufferAttribute wrapping _bumpArr (uploaded per frame)
const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _sv = new THREE.Vector3();
const _qI = new THREE.Quaternion();
// (cursor-torch scratch removed — using _hit / _cursor directly)

// ── Atmospheric glow behind the card ─────────────────────────────────────────
const GLOW_CLEAR  = 0.35;
const GLOW_IMAGED = 0.05;

// ── Image reconstruction (the cubes ARE the image, C2: per-cube texture window) ─
// Each cube maps its own UV window of the shared cover texture (aUvOffset + uTileScale).
const DEPTH_LUM   = 0.15;  // brighter pixels relief forward (subtle, preserves layout)
const DEPTH_NOISE = 0.03;  // tiny organic break-up
const GRID_COLS = 40, GRID_ROWS = 24; // voxel face grid (matches the Blender model)
let _uvOffset = null;                 // per-cube tile origin in cover-texture space (vec2)
const _uvScale = new THREE.Vector2(); // shared tile size (cover-fit / grid)
const _uvOrigin = new THREE.Vector2(); // cover-fit origin (offU, offV) for live-position UV
const _texLoader = new THREE.TextureLoader();
const _texCache  = {};
let _coverTex = null;                 // current cover as a THREE.Texture (C2 map)

// ── Cursor reveal (D1) ───────────────────────────────────────────────────────
// Per-cube reveal from cursor distance: idle = soft atmospheric ghost, near cursor
// = sharp readable image tiles. Driven in the shader; cursor projected to card-local.
const REVEAL_RADIUS = 2.2;  // local units (card face ~4 × 2.48) — crisp-lens size
const IDLE_FLOOR    = 1.0;  // full exposure everywhere — image stays sharp without hover
let _revealU = null;        // shader.uniforms ref (uCursor / uHover updated per frame)
const _cursor = new THREE.Vector2(0, 0);  // smoothed cursor in card-local face coords
let _hover = 0;                           // 0→1 presence (fades when leaving the card)
let _hoverTarget = 0;
const _raycaster = new THREE.Raycaster();
const _revealPlane = new THREE.Plane();
const _planeN = new THREE.Vector3();
const _hit = new THREE.Vector3();

let currentIdx     = 0;
let isTransitioning = false;
let isActive       = true;
let prefersReduced = false;
const _handlers    = {};
const clock        = new THREE.Clock();
const mouse        = new THREE.Vector2(0, 0);
const targetMouse  = new THREE.Vector2(0, 0);

// ── Lighting presets per project ──────────────────────────────────────────────

// (All scene lights removed — clean slate for rebuilding lighting.)

// Cursor bump — a bell-shaped dome that rises toward the camera under the pointer.
const BUMP_AMP     = 0.9;        // peak height (world units)
const BUMP_RADIUS  = 1.0;        // bell radius (local face units; < REVEAL_RADIUS for a small bump)
const BUMP_ATTACK  = 0.20;       // rise speed (per frame lerp) — quick up
const BUMP_RELEASE = 0.03;       // fall speed (per frame lerp) — slow down/settle

const LIGHTING_PRESETS = [
  // 0 — DLS — cool blue-violet tint
  {
    ambient: 0x1a2238, ambientInt: 0.5,
    spot: 0xdfe6ff, spotInt: 30, spotPos: [ 2, 4, 4],
    fog: 0x03030a, fogDensity: 0.014,
  },
  // 1 — Particles — electric blue
  {
    ambient: 0x05050f, ambientInt: 0.40,
    spot: 0xaabbff, spotInt: 46, spotPos: [-2, 4, 4],
    fog: 0x020207, fogDensity: 0.020,
  },
  // 2 — Brand — warm emerald
  {
    ambient: 0x040a05, ambientInt: 0.40,
    spot: 0x55ddaa, spotInt: 44, spotPos: [ 1, 5, 4],
    fog: 0x020605, fogDensity: 0.016,
  },
  // 3 — Analytics — deep navy
  {
    ambient: 0x020408, ambientInt: 0.40,
    spot: 0x5577cc, spotInt: 48, spotPos: [ 3, 4, 4],
    fog: 0x010205, fogDensity: 0.022,
  },
  // 4 — Experiments — warm amber
  {
    ambient: 0x0a0600, ambientInt: 0.40,
    spot: 0xffaa44, spotInt: 48, spotPos: [ 2, 3, 5],
    fog: 0x060300, fogDensity: 0.016,
  },
];


// ── Init ──────────────────────────────────────────────────────────────────────

export function initScene(canvas) {
  prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias:             true,
    preserveDrawingBuffer: true,
    powerPreference:       'high-performance',
  });
  isMobile = window.innerWidth < 768;
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04040c);
  // Sky-env look knobs (tunable live via the dev GUI) — soften + dim the visible sky so it
  // reads as atmosphere, while environmentIntensity drives the lighting independently.
  scene.backgroundBlurriness = 0.35;
  scene.backgroundIntensity  = 0.5;
  scene.environmentIntensity = 1.0;

  if (SKY_MODE === 'exr') {
    // Environment map (IBL) from the sky EXR — image-based lighting + visible sky.
    // PMREM prefilters it for roughness-correct reflections.
    const _pmrem = new THREE.PMREMGenerator(renderer);
    _pmrem.compileEquirectangularShader();
    new EXRLoader().load('/assets/sky_env.exr', (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const envRT = _pmrem.fromEquirectangular(tex);
      scene.environment = envRT.texture;
      scene.background = envRT.texture; // sky visible behind the scene
      tex.dispose();
      _pmrem.dispose();
    });
  } else {
    // Procedural animated sky dome is the *visible* backdrop, but the card is *lit* by the
    // real sky EXR (richer, directional IBL than a flat dome snapshot). The dome snapshot is
    // used as an instant placeholder so the first frame isn't unlit while the EXR loads.
    _sky = initSkyDome({ accent: _accentFor(0), renderer });
    scene.add(_sky.mesh);
    scene.background = null; // the dome itself is the backdrop

    const _pmrem = new THREE.PMREMGenerator(renderer);
    _pmrem.compileEquirectangularShader();
    scene.environment = _pmrem.fromScene(scene, 0.04).texture; // placeholder IBL from the dome

    new EXRLoader().load('/assets/sky_env.exr', (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const envRT = _pmrem.fromEquirectangular(tex);
      scene.environment = envRT.texture; // swap to the EXR for lighting; dome stays visible
      tex.dispose();
      _pmrem.dispose();
    });
  }

  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
  // Head-on with the card centre (cardGroup sits at y 0.3) so the face is square to camera.
  camera.position.set(0, 0.3, 6.5);
  camera.lookAt(0, 0.3, 0);

  // Post-processing — bloom + vignette, plus DOF + chromatic aberration (cinematic).
  bloomEffect = new BloomEffect({ intensity: 0.5, luminanceThreshold: 0.72, luminanceSmoothing: 0.7, mipmapBlur: true, radius: 0.6 });
  const vignetteEffect = new VignetteEffect({ darkness: 0.55, offset: 0.35 });
  const chromaticAberration = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(0.0012, 0.0012), radialModulation: true, modulationOffset: 0.15,
  });
  const effects = [bloomEffect, chromaticAberration, vignetteEffect];
  if (!isMobile) {
    // DOF makes the near/far scattered tiles blur while the card mid stays sharp.
    const dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 6.4, worldFocusRange: 1.8, bokehScale: 2.0 });
    effects.unshift(dof);
  }
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, ...effects));

  _handlers.resize = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  };
  _handlers.resize();
  window.addEventListener('resize', _handlers.resize);

  // Lights removed — preset still drives the scene fog below.
  const p0 = LIGHTING_PRESETS[0];

  scene.fog = new THREE.FogExp2(p0.fog, p0.fogDensity);
  renderer.setClearColor(p0.fog);

  // Hero atmosphere around the card (reflective ground, haze, ceiling clouds, glow).
  // Disabled for the cloud composition-validation pass — re-enable later.
  // _env = initEnvironment({ scene, renderer, camera, isMobile, accent: _accentFor(0) });

  // Cloud layer — 3 still planes above/behind the card (validation pass).
  // Disabled for now — cloudA/B/C textures off; the procedural dome carries the sky.
  // _cloud = initCloudLayer({ scene, camera, isMobile, accent: _accentFor(0) });

  // Reflective floor below the card — circular mirror (three Reflector) with ripple + fade.
  _floor = initReflectiveFloor({ scene, renderer, accent: _accentFor(0) });

  // Foreground fog — soft haze drifting in front of the card for depth/separation.
  _mistFront = initMistFront({ accent: _accentFor(0) });
  scene.add(_mistFront.mesh);

  // Dev-only scene/env controls — lazy-loaded so the GUI never ships to normal visitors.
  if (import.meta.env.DEV || location.search.includes('lights')) {
    import('./scene-gui.js').then(({ initSceneGui }) => {
      _gui = initSceneGui({ scene, renderer, bloomEffect, floor: _floor });
    });
  }

  // Cursor velocity → flowmap texture (card-face UV space, 128² HalfFloat RT).
  // Sampled in the cube fragment shader to distort image UVs — image "pours" on cursor drag.
  _flowmap = new Flowmap(renderer, { size: 128, falloff: 0.20, alpha: 1, dissipation: 0.97 });

  // Procedural god-ray plane — additive light shafts behind/around the card.
  _godRays = _buildGodRays(_accentFor(0));

  _buildVoxelCard(); // async — fetches cube_positions.json then builds the InstancedMesh

  // Mouse
  _handlers.mousemove = (e) => {
    targetMouse.set(
       (e.clientX / window.innerWidth)  * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    _hoverTarget = 1;
  };
  window.addEventListener('mousemove', _handlers.mousemove);
  _handlers.mouseout = () => { _hoverTarget = 0; };
  window.addEventListener('blur', _handlers.mouseout);
  document.addEventListener('mouseleave', _handlers.mouseout);

  // Scroll navigation
  let lastScroll = 0;
  _handlers.wheel = (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastScroll < 900) return;
    lastScroll = now;
    if (e.deltaY > 1)       setProject((currentIdx + 1) % ORBIT_PROJECTS.length);
    else if (e.deltaY < -1) setProject((currentIdx - 1 + ORBIT_PROJECTS.length) % ORBIT_PROJECTS.length);
  };
  window.addEventListener('wheel', _handlers.wheel, { passive: false });
  _handlers._canvas = canvas;

  // Keyboard — project navigation
  _handlers.keydown = (e) => {
    if (e.key === 'ArrowDown'  || e.key === 'ArrowRight') setProject((currentIdx + 1) % ORBIT_PROJECTS.length);
    if (e.key === 'ArrowUp'    || e.key === 'ArrowLeft')  setProject((currentIdx - 1 + ORBIT_PROJECTS.length) % ORBIT_PROJECTS.length);
  };
  window.addEventListener('keydown', _handlers.keydown);

  _buildProjectIndex();
  _updateProjectUI(0);

  function _tick() {
    rafId = requestAnimationFrame(_tick);
    if (!isActive) return;

    const t = clock.getElapsedTime();
    mouse.x += (targetMouse.x - mouse.x) * 0.05;
    mouse.y += (targetMouse.y - mouse.y) * 0.05;

    if (cardGroup && !prefersReduced) {
      if (_wobble) _wobble.update(t);   // 3D Perlin float — mutates cardGroup.position in place
      cardGroup.rotation.y = mouse.x * 0.14;
      cardGroup.rotation.x = mouse.y * 0.07;
    }

    // Flowmap: paint cursor velocity into a texture (card-face UV space).
    if (_flowmap && cardGroup) {
      const fm = _flowmap;
      // Convert cursor from card-local world coords to 0-1 face UV space.
      fm.mouse.set(
        (_cursor.x + _halfExtent.x) / (2 * _halfExtent.x),
        (_cursor.y + _halfExtent.y) / (2 * _halfExtent.y),
      );
      fm.velocity.set(fm.mouse.x - _prevFlowMouse.x, fm.mouse.y - _prevFlowMouse.y);
      _prevFlowMouse.copy(fm.mouse);
      fm.material.uniforms.uAspect.value = _halfExtent.x / _halfExtent.y; // card aspect ratio
      fm.update();
      // Sync texture into cube material once shader is compiled.
      if (_revealU && _revealU.uFlowmap) _revealU.uFlowmap.value = fm.uniform.value;
    }

    _updateReveal();
    if (_revealU) _revealU.uTime.value = prefersReduced ? 0 : t;
    if (_env) _env.update(prefersReduced ? 0 : t);
    if (_cloud) _cloud.update(prefersReduced ? 0 : t);
    if (_sky) _sky.update(prefersReduced ? 0 : t);
    if (_floor) _floor.update(prefersReduced ? 0 : t);
    if (_godRays) _godRays.update(prefersReduced ? 0 : t);
    if (_mistFront) _mistFront.update(prefersReduced ? 0 : t);

    composer.render();
  }
  _tick();
}

// ── Voxel card construction ─────────────────────────────────────────────────

async function _buildVoxelCard() {
  let data;
  try {
    data = await (await fetch('/assets/cube_positions.json')).json();
  } catch (err) {
    console.error('[scene] cube_positions.json load failed:', err);
    return;
  }
  const N = data.length;

  // Dataset bounds + midrange centre.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of data) {
    if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    if (c.z < minZ) minZ = c.z; if (c.z > maxZ) maxZ = c.z;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  const S = 4.0 / Math.max(spanX, spanY, spanZ); // match the previous card footprint

  // World remap so the readable face points at the camera:
  // json x → world X (width), json z → world Y (height), json y → world Z (depth).
  const wHalfX = (spanX * S) / 2;
  const wHalfY = (spanZ * S) / 2;
  const wHalfZ = (spanY * S) / 2; // depth half-extent (the thin 6-layer axis)
  _halfExtent.set(wHalfX, wHalfY);
  _cardFaceAspect = spanX / spanZ;
  const cube = ((spanX * S) / 40) * 0.92; // 40 voxels wide → cell ≈ 0.1; 0.92 leaves a hairline

  _N        = N;
  _curPos   = new Float32Array(N * 3);
  _scaleArr = new Float32Array(N);
  _uvOffset = new Float32Array(N * 2);
  _vox      = new Float32Array(N * 3); // per-cube (depthNorm, rand, lum) for D2 motion/visibility
  _colRand  = new Float32Array(N);     // per-column random (shared across the 6 depth layers)
  _revealArr = new Float32Array(N);    // eased per-cube reveal (starts hidden)
  _bumpArr   = new Float32Array(N);    // eased per-cube bump height (starts flat)

  // C2: each cube maps its own UV window of the shared cover texture (image fragments).
  const cover  = ORBIT_PROJECTS[currentIdx]?.coverImage || null;
  const sample = await _buildColorSampler(cover);          // (u,v) → {lum} for depth relief
  const texInfo = cover ? await _loadCoverTexture(cover) : null; // {texture, aspect}
  _coverTex = texInfo?.texture || null;

  // Cover-fit visible region (image vs face aspect) — baked into the UV windows.
  let offU = 0, offV = 0, spanU = 1, spanV = 1;
  if (texInfo) {
    if (texInfo.aspect > _cardFaceAspect) { spanU = _cardFaceAspect / texInfo.aspect; offU = (1 - spanU) / 2; }
    else                                  { spanV = texInfo.aspect / _cardFaceAspect; offV = (1 - spanV) / 2; }
  }
  _uvScale.set(spanU / GRID_COLS, spanV / GRID_ROWS);
  _uvOrigin.set(offU, offV);

  for (let i = 0; i < N; i++) {
    const c = data[i];
    const wx = (c.x - cx) * S;
    const wy = (c.z - cz) * S;
    const wz = (c.y - cy) * S;
    const h  = _hash(c.x, c.y, c.z);

    // Face UV → luminance (for depth relief).
    const u = (wx + wHalfX) / (2 * wHalfX);
    const v = (wy + wHalfY) / (2 * wHalfY);
    const px = sample(u, v);

    // Per-cube texture window: this cube's grid cell → its tile of the cover.
    const gx = Math.min(GRID_COLS - 1, Math.floor(u * GRID_COLS));
    const gz = Math.min(GRID_ROWS - 1, Math.floor(v * GRID_ROWS));
    _uvOffset[i * 2]     = offU + gx * (spanU / GRID_COLS);
    _uvOffset[i * 2 + 1] = offV + gz * (spanV / GRID_ROWS);

    // per-column random: hash the grid cell only (no depth) → identical for all 6 layers,
    // so the cull removes/keeps a whole depth column together (no orphan cubes).
    _colRand[i] = _hash(gx, gz, 0);

    // Brightness-driven depth relief (small — preserves the Blender layout).
    const rz = wz + (px.lum - 0.5) * DEPTH_LUM + (h - 0.5) * DEPTH_NOISE;
    _curPos[i * 3] = wx; _curPos[i * 3 + 1] = wy; _curPos[i * 3 + 2] = rz;
    _scaleArr[i] = 1;

    // D2 per-cube data: depth layer (0 front → 1 back), random phase, luminance.
    _vox[i * 3]     = (wz + wHalfZ) / (2 * wHalfZ);
    _vox[i * 3 + 1] = h;
    _vox[i * 3 + 2] = px.lum;
  }

  const geo = new THREE.BoxGeometry(cube, cube, cube);
  geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(_uvOffset, 2));
  geo.setAttribute('aVox', new THREE.InstancedBufferAttribute(_vox, 3));
  geo.setAttribute('aColRand', new THREE.InstancedBufferAttribute(_colRand, 1));
  _revealAttr = new THREE.InstancedBufferAttribute(_revealArr, 1);
  _revealAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aReveal', _revealAttr);
  _bumpAttr = new THREE.InstancedBufferAttribute(_bumpArr, 1);
  _bumpAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aBump', _bumpAttr);

  voxelMesh = new THREE.InstancedMesh(geo, _makeCubeMaterial(), N);
  voxelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  voxelMesh.frustumCulled = false;
  _writeAllMatrices();

  cardGroup = new THREE.Group();
  cardGroup.position.set(0, 0.3, -0.6); // pushed back from camera (+Z) a touch
  cardGroup.add(voxelMesh);
  scene.add(cardGroup);

  // Wobble: 3D Perlin float — takes cardGroup.position by reference and lerps it per frame.
  _wobble = new Wobble(cardGroup.position); // origin auto-copied from current position
  _wobble.frequency.set(0.28, 0.20, 0.14); // slow, aperiodic drift
  _wobble.amplitude.set(0.06, 0.09, 0.025); // subtle range; Z barely moves (camera is close)
  _wobble.lerpSpeed = 0.018;

  const cover0 = cover;
  // Atmospheric glow core behind the card (stays world-static, doesn't tilt).
  glowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 2.8),
    new THREE.MeshBasicMaterial({
      map: _makeRadialGlow(), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
      opacity: cover0 ? GLOW_IMAGED : GLOW_CLEAR,
    }),
  );
  glowPlane.position.set(0, 0.3, -0.7);
  scene.add(glowPlane);

  console.log(`[scene] voxel card — ${N} cubes · cell ${cube.toFixed(3)}`);
}

// C2 cube material: unlit, maps the shared cover via a per-cube UV window, with the
// cursor-reveal grade + alphaHash dissolve patched into the shader.
function _makeCubeMaterial() {
  // Cloud material: transparent with depthWrite OFF so cubes never depth-reject each
  // other (no vanishing). At rest the scattered cubes overlap into a soft haze; the
  // cursor lens collapses them back to the flat grid → crisp. NormalBlending = glassy
  // haze (swap to AdditiveBlending for a glowing core).
  const m = new THREE.MeshStandardMaterial({
    map: _coverTex, side: THREE.FrontSide,
    roughness: 0.5, metalness: 0.0, envMapIntensity: 1.0, // lit by scene.environment (sky EXR IBL)
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  _patchCube(m);
  return m;
}

// Compose every instance matrix from current positions + per-instance scale.
function _writeAllMatrices() {
  if (!voxelMesh) return;
  for (let i = 0; i < _N; i++) {
    _v3.set(_curPos[i * 3], _curPos[i * 3 + 1], _curPos[i * 3 + 2]);
    const s = _scaleArr[i];
    _sv.set(s, s, s);
    _m4.compose(_v3, _qI, _sv);
    voxelMesh.setMatrixAt(i, _m4);
  }
  voxelMesh.instanceMatrix.needsUpdate = true;
}

// Push the current per-instance colours (sRGB 0–1) into instanceColor.
// Project the cursor onto the card plane → card-local face coords, feed the shader.
function _updateReveal() {
  if (!cardGroup || !_revealU) { _hover += (_hoverTarget - _hover) * 0.08; return; }
  cardGroup.updateMatrixWorld();
  _raycaster.setFromCamera(targetMouse, camera);
  _planeN.set(0, 0, 1).applyQuaternion(cardGroup.quaternion);
  _revealPlane.setFromNormalAndCoplanarPoint(_planeN, cardGroup.position);
  if (_raycaster.ray.intersectPlane(_revealPlane, _hit)) {
    cardGroup.worldToLocal(_hit); // → card-local face space
    _cursor.x += (_hit.x - _cursor.x) * 0.18;
    _cursor.y += (_hit.y - _cursor.y) * 0.18;
  }
  _hover += (_hoverTarget - _hover) * 0.08;
  _revealU.uCursor.value.copy(_cursor);
  _revealU.uHover.value = _hover;

  // Per-cube reveal easing: fast attack, slow release → cubes linger and fade out
  // smoothly when the cursor leaves instead of snapping back to hidden.
  if (_revealArr) {
    const cx = _cursor.x, cy = _cursor.y, r = REVEAL_RADIUS, h = _hover;
    for (let i = 0; i < _N; i++) {
      const dx = _curPos[i * 3]     - cx;
      const dy = _curPos[i * 3 + 1] - cy;
      const dist = Math.hypot(dx, dy);
      let t = (r - dist) / r;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const target = t * t * (3 - 2 * t) * h;     // smoothstep pool × hover presence
      const cur = _revealArr[i];
      _revealArr[i] = cur + (target - cur) * (target > cur ? 0.22 : 0.04); // attack vs release

      // Bump height: own (tighter) radius, fast attack / slow release → lingers and settles
      // down slowly when the cursor moves away.
      let bt = (BUMP_RADIUS - dist) / BUMP_RADIUS;
      bt = bt < 0 ? 0 : bt > 1 ? 1 : bt;
      const bTarget = bt * bt * (3 - 2 * bt) * h;
      const bCur = _bumpArr[i];
      _bumpArr[i] = bCur + (bTarget - bCur) * (bTarget > bCur ? BUMP_ATTACK : BUMP_RELEASE);
    }
    _revealAttr.needsUpdate = true;
    _bumpAttr.needsUpdate = true;
  }
}

// ── Project switching ─────────────────────────────────────────────────────────

export function setProject(idx) {
  if (isTransitioning || idx === currentIdx) return;
  if (idx < 0 || idx >= ORBIT_PROJECTS.length) return;
  isTransitioning = true;
  currentIdx = idx;

  const preset    = LIGHTING_PRESETS[idx];
  const startTime = performance.now();
  const duration  = 800;

  const fromFogColor = scene.fog.color.clone();
  const toFogColor   = new THREE.Color(preset.fog);

  const newCover  = ORBIT_PROJECTS[idx]?.coverImage || null;
  const fromGlow  = glowPlane ? glowPlane.material.opacity : GLOW_CLEAR;
  const toGlow    = newCover ? GLOW_IMAGED : GLOW_CLEAR;

  // Swap the cube texture to the new cover (the image lives in the cube tiles).
  if (newCover) {
    _loadCoverTexture(newCover).then((info) => {
      if (!info || !voxelMesh) return;
      _coverTex = info.texture;
      voxelMesh.material.map = info.texture;
      voxelMesh.material.needsUpdate = true;
    });
  }

  function _interpolate() {
    const t    = Math.min((performance.now() - startTime) / duration, 1.0);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    scene.fog.color.lerpColors(fromFogColor, toFogColor, ease);
    renderer.setClearColor(scene.fog.color);
    if (glowPlane) glowPlane.material.opacity = fromGlow + (toGlow - fromGlow) * ease;

    if (t < 1.0) requestAnimationFrame(_interpolate);
    else isTransitioning = false;
  }

  _interpolate();
  // Environment retints on its own slow, staggered ~5s timeline (separate from the
  // 800ms light/texture swap above).
  if (_env) _env.transition(_accentFor(idx));
  if (_cloud) _cloud.transition(_accentFor(idx));
  if (_sky) _sky.setColor(_accentFor(idx));
  if (_floor) _floor.setColor(_accentFor(idx));
  if (_godRays) _godRays.setColor(_accentFor(idx));
  if (_mistFront) _mistFront.setColor(_accentFor(idx));
  _updateProjectUI(idx);
}

export function setPaused(paused) {
  isActive = !paused;
}

// Load (and cache) the cover as a texture. Resolves with {texture, aspect}.
function _loadCoverTexture(path) {
  if (_texCache[path]) return Promise.resolve(_texCache[path]);
  return new Promise((resolve) => {
    _texLoader.load(path, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer?.capabilities.getMaxAnisotropy?.() || 1;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const info = { texture: tex, aspect: tex.image.width / tex.image.height };
      _texCache[path] = info;
      resolve(info);
    }, undefined, () => resolve(null));
  });
}

// Patch the cube shader (D1 reveal + D2 living depth field). Per cube: UV window into
// the cover; cursor-proximity reveal (grade + dissolve); continuous idle Z oscillation
// per depth layer; zone-based visibility with mid/outer holes; and a soft hover pull.
function _patchCube(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTileScale: { value: _uvScale },
      uUvOrigin:   { value: _uvOrigin }, // (offU,offV) cover-fit origin for live-position UV
      uDriftAmt:   { value: 0.12 },      // XY drift magnitude (world units, ~a few cells)
      uDriftSpeed: { value: 0.4 },       // drift wander speed
      uCursor:    { value: _cursor },
      uHover:     { value: _hover },
      uRadius:    { value: REVEAL_RADIUS },
      uIdleFloor: { value: IDLE_FLOOR },
      uSatFar:    { value: 0.15 },
      uConFar:    { value: 0.70 },
      uBrightFar: { value: 0.85 }, // softened: the spot now supplies the centre→edge falloff
      uFog:       { value: new THREE.Color(0x0a0e1a) },
      uFogAmt:    { value: 0.6 },
      // D2 — motion / zones / pull
      uTime:       { value: 0 },
      uHalfExtent: { value: _halfExtent },
      // alien.js-style Gaussian ring ripple (replaces old sine-wave ripple)
      uRipplePeriod: { value: 3.5 },  // seconds per full ring expansion (two rings staggered)
      uRippleAmp:    { value: 0.38 }, // Z peak displacement at ring crest
      uDepthVisFar:   { value: 0.6 },                       // opacity of the deepest layer (near = 1.0, mid ≈ 0.75)
      uKeepFrac:      { value: 0.6 },                        // keep fraction at the far edges (centre stays 100%)
      uDenseRadius:   { value: 5.0 },                       // cubes within this radius stay fully dense
      uFadeRadius:    { value: 22.0 },                       // by this radius, keep eases to uKeepFrac (corner ≈ 23)
      uPullXY:     { value: 0.18 },
      uPullZ:      { value: 0.10 },
      uOuterFade:  { value: 0.55 },
      uEdgeLayer:  { value: 0.25 },   // front/back layers retain this (middle layers full)
      uHoleThresh: { value: 0.12 },
      uHoleDepth:  { value: 0.70 },
      // D3 — depth cloud + scale-based visibility (compact, dense middle core)
      uDepthScatter: { value: 0.08 }, // per-cube Z spread → 3D cloud (compressed)
      uDepthFunnel:  { value: 0.06 }, // push the centre back into a tunnel
      uHideScale:    { value: 0.0 },  // hidden cubes shrink to this (crisp cull)
      // cursor bump — height scale; the bell + easing is computed CPU-side into aBump
      uBumpAmp:    { value: BUMP_AMP },
      // fluid warp — gravity well + vortex + ring waves on hover
      uWarpRadius: { value: 1.8 },   // warp zone radius (card-local face units)
      uLensAmp:    { value: 0.55 },  // lens dome Z amplitude
      uWaveAmp:    { value: 0.10 },  // outward ring-wave Z amplitude
      uWaveSpeed:  { value: 2.8 },   // wave travel speed (radians / sec)
      // flowmap — cursor velocity → image UV distortion (image "pours" on drag)
      uFlowmap:     _flowmap ? _flowmap.uniform : { value: null },
      uFlowStrength: { value: 0.07 }, // UV slide magnitude (subtle but readable)
    });
    _revealU = shader.uniforms;

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', /* glsl */`
        attribute vec2 aUvOffset; attribute vec3 aVox; attribute float aReveal; attribute float aColRand; attribute float aBump;
        uniform vec2 uTileScale; uniform vec2 uCursor; uniform vec2 uHalfExtent; uniform vec2 uUvOrigin;
        uniform float uHover; uniform float uRadius; uniform float uIdleFloor; uniform float uDriftAmt; uniform float uDriftSpeed;
        uniform float uTime; uniform float uRipplePeriod; uniform float uRippleAmp; uniform float uDepthVisFar; uniform float uKeepFrac; uniform float uDenseRadius; uniform float uFadeRadius;
        uniform float uPullXY; uniform float uPullZ;
        uniform float uOuterFade; uniform float uEdgeLayer; uniform float uHoleThresh; uniform float uHoleDepth;
        uniform float uDepthScatter; uniform float uDepthFunnel; uniform float uHideScale;
        uniform float uBumpAmp;
        uniform float uWarpRadius; uniform float uLensAmp; uniform float uWaveAmp; uniform float uWaveSpeed;
        varying float vReveal;
        varying float vAlpha;
        varying float vWarpPool;
        varying vec2 vFaceUv;
        void main() {`)
      .replace('#include <uv_vertex>', /* glsl */`
        #include <uv_vertex>
        vMapUv = aUvOffset + uv * uTileScale;`)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vec3  _ctr = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float _r   = clamp(length(_ctr.xy / uHalfExtent), 0.0, 1.0); // 0 centre → ~1 edge
        float _lay = aVox.x;
        float _cr2 = fract(aColRand * 263.17 + 0.137);              // per-column 2nd random (decorrelated)
        // cursor pool (D1 reveal)
        float _d    = distance(_ctr.xy, uCursor);
        float _pool = smoothstep(uRadius, 0.0, _d) * uHover;
        vReveal = clamp(uIdleFloor + (1.0 - uIdleFloor) * _pool, 0.0, 1.0);
        // radial distance in cube units (shared by the ripple below)
        float _cell      = (2.0 * uHalfExtent.x) / 40.0; // world size of one grid cell
        float _distCells = length(_ctr.xy) / _cell;
        // every cube carries the image at its depth-faded opacity (all 6 layers)
        float _depthVis = mix(uDepthVisFar, 1.0, _lay); // near 1.0 · mid ~0.75 · far uDepthVisFar
        // radial keep gradient: 100% dense in the centre, easing to uKeepFrac toward the
        // edges (no hard ring). Per-column random → whole columns kept/removed together.
        float _keepProb = mix(1.0, uKeepFrac, smoothstep(uDenseRadius, uFadeRadius, _distCells));
        float _cand   = step(_keepProb, aColRand);
        float _hidden = _cand * (1.0 - aReveal);
        vAlpha = _depthVis * (1.0 - _hidden);
        // motion fades in by radius: still/flat dense centre, animated cloud toward edges.
        // (drift + scatter + ripple all multiply by _move, so this gates them together.)
        float _move = (1.0 - aReveal) * smoothstep(uDenseRadius, uFadeRadius, _distCells);
        // gentle XY drift — whole column drifts together (per-column random) so it stays a
        // coherent stack instead of splitting into orphan cubes. Zero under the hover lens.
        vec2 _drift = vec2(sin(uTime * uDriftSpeed + aColRand * 6.2831),
                           cos(uTime * uDriftSpeed * 0.9 + _cr2 * 6.2831)) * uDriftAmt * _move;
        transformed.xy += _drift;
        // static Z scatter → whole column shifts together (keeps its 6-layer depth spacing)
        float _scatterZ = (_cr2 - 0.5) * 2.0 * uDepthScatter - (1.0 - _r) * uDepthFunnel;
        transformed.z += _scatterZ * _move;
        // alien.js-style Gaussian ring ripple — two staggered expanding rings, each fading as they grow
        float _distW = length(_ctr.xy);                             // world-unit distance from center
        float _maxR  = length(uHalfExtent) * 1.15;                  // expands to just beyond face corner
        float _ph1   = fract(uTime / uRipplePeriod);                // 0→1 over one period
        float _ph2   = fract(uTime / uRipplePeriod + 0.5);          // staggered by half period
        float _gRing1 = exp(-pow(_distW - _ph1 * _maxR, 2.0) * 16.0) * (1.0 - _ph1);
        float _gRing2 = exp(-pow(_distW - _ph2 * _maxR, 2.0) * 16.0) * (1.0 - _ph2);
        transformed.z += (_gRing1 + _gRing2) * uRippleAmp * _move;
        // cursor bump — per-cube eased height (fast attack / slow release on the CPU) so it
        // lingers and settles down slowly; whole column shares aBump → coherent rise.
        transformed.z += uBumpAmp * aBump;
        // ── Fluid warp — gravity well + ring waves ────────────────────────────
        float _warpDist = distance(_ctr.xy, uCursor);
        float _warpPool = smoothstep(uWarpRadius, 0.0, _warpDist) * uHover;
        // Lens dome: centre comes forward, ring gently pulls back (gravitational lensing curvature)
        float _dome = exp(-_warpDist * _warpDist / max(uWarpRadius * uWarpRadius * 0.22, 0.001));
        transformed.z += uLensAmp * _dome * uHover;
        // Outward ring waves propagating from cursor (fluid surface tension)
        float _wave = sin(_warpDist * 5.0 - uTime * uWaveSpeed) * exp(-_warpDist * 2.2);
        transformed.z += uWaveAmp * _wave * clamp(_warpPool * 2.0, 0.0, 1.0);
        vWarpPool = _warpPool;
        vFaceUv = _ctr.xy / (2.0 * uHalfExtent) + 0.5; // 0-1 card-face position (matches flowmap space)
        // live-position UV: sample the cover under the cube's CURRENT location, continuously
        // (no grid quantization) so a drifting cube's fragment slides smoothly — no pop.
        // Resolves to the correct image when collapsed (drift = 0) → crisp on hover.
        vec2 _facePos = _ctr.xy + _drift;
        vec2 _uv01    = clamp(_facePos / (2.0 * uHalfExtent) + 0.5, 0.0, 1.0);
        vec2 _win     = uUvOrigin + _uv01 * (uTileScale * vec2(40.0, 24.0)) - 0.5 * uTileScale;
        vMapUv = _win + uv * uTileScale;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', /* glsl */`
        uniform float uSatFar; uniform float uConFar; uniform float uBrightFar;
        uniform vec3 uFog; uniform float uFogAmt;
        uniform float uTime; uniform float uHover;
        uniform sampler2D uFlowmap; uniform float uFlowStrength;
        varying float vReveal;
        varying float vAlpha;
        varying float vWarpPool;
        varying vec2 vFaceUv;
        vec3 _hueShift(vec3 p, float a) {
          float s = sin(a), c = cos(a), k = (1.0 - c) / 3.0, sq = 0.57735;
          return vec3(
            p.r * (c + k) + p.g * (k - s * sq) + p.b * (k + s * sq),
            p.r * (k + s * sq) + p.g * (c + k) + p.b * (k - s * sq),
            p.r * (k - s * sq) + p.g * (k + s * sq) + p.b * (c + k)
          );
        }
        void main() {`)
      .replace('#include <map_fragment>', /* glsl */`
        // Flowmap: cursor velocity distorts the image UV so it "pours" on drag.
        vec2 _flowVel = texture2D(uFlowmap, vFaceUv).rg;
        vec2 _flowedUv = vMapUv + _flowVel * uFlowStrength * uHover;
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, _flowedUv);
          #ifdef DECODE_VIDEO_TEXTURE
            sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
          #endif
          diffuseColor *= sampledDiffuseColor;
        #endif
        vec3 _c = diffuseColor.rgb;
        float _L = dot(_c, vec3(0.2126, 0.7152, 0.0722));
        _c = mix(vec3(_L), _c, mix(uSatFar, 1.0, vReveal));         // desaturate when far
        _c = (_c - 0.5) * mix(uConFar, 1.0, vReveal) + 0.5;         // soften contrast
        _c *= mix(uBrightFar, 1.0, vReveal);                       // dim when far
        _c = mix(_c, uFog, (1.0 - vReveal) * uFogAmt);             // cool atmospheric tint
        // Iridescent hue shift in the warp zone — slow prismatic drift, stronger at centre
        if (vWarpPool > 0.001) {
          float _hueAngle = uTime * 0.7 + vReveal * 1.5;
          vec3 _irid = _hueShift(_c, _hueAngle);
          _c = mix(_c, _irid, vWarpPool * 0.45);
        }
        diffuseColor.rgb = _c;                          // every cube shows its image fragment
        diffuseColor.a *= vAlpha;                      // glass faint/clearing, image layer solid`);
  };
  material.customProgramCacheKey = () => 'voxel-cube-reveal';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── God-ray plane ─────────────────────────────────────────────────────────────
// Procedural additive plane behind the card. Animated ray spokes + gaussian
// falloff. Bloom turns the bright core into visible shafts through cube gaps.

function _buildGodRays(accentHex) {
  const geo = new THREE.PlaneGeometry(8, 5.5);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:   { value: 0 },
      uAccent: { value: new THREE.Color(accentHex) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3  uAccent;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv * 2.0 - 1.0;          // -1..1
        float dist = length(uv);
        float angle = atan(uv.y, uv.x);
        // Radial gaussian falloff — concentrated core
        float radial = exp(-dist * dist * 3.2);
        // Three harmonic ray bands at different speeds/counts
        float r1 = pow(max(0.0, sin(angle * 4.0 + uTime * 0.16)), 6.0);
        float r2 = pow(max(0.0, sin(angle * 7.0 - uTime * 0.11)), 7.0) * 0.55;
        float r3 = pow(max(0.0, cos(angle * 3.0 + uTime * 0.07)), 8.0) * 0.35;
        float rays = r1 + r2 + r3;
        // Breathing modulation (whole field pulses slowly)
        float breathe = 0.75 + 0.25 * sin(uTime * 0.38);
        float intensity = radial * (0.18 + rays * 0.82) * breathe;
        gl_FragColor = vec4(uAccent * intensity, intensity * 0.28);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0.3, -1.4); // just behind the card face
  scene.add(mesh);

  return {
    mesh,
    update(t)   { mat.uniforms.uTime.value = t; },
    setColor(h) { mat.uniforms.uAccent.value.set(h); },
    destroy()   { scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}

function _hash(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// Saturation-weighted dominant colour of the cover (sRGB 0–1), normalised to full
// brightness so it reads as a vivid hue (the dark background contributes ~nothing, the
// vivid accent wins — e.g. GEMx's emerald). intensity stays controlled by TORCH_INT.
function _dominantOf(px) {
  let wr = 0, wg = 0, wb = 0, wsum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const max = Math.max(r, g, b), sat = max - Math.min(r, g, b);
    const w = sat * sat * max; // favour vivid + bright pixels
    wr += r * w; wg += g * w; wb += b * w; wsum += w;
  }
  if (wsum < 1e-4) return { r: 0.5, g: 0.55, b: 0.62 }; // near-greyscale cover → neutral
  const m = Math.max(wr, wg, wb, 1e-4);
  return { r: wr / m, g: wg / m, b: wb / m };
}

// Sample the cover image colour at a face UV. Returns (u,v) → {r,g,b,lum} (0–1) over
// the cover-fit face, with a `.dominant` {r,g,b} property for the torch tint; falls back
// to a neutral glass tint when there's no cover.
async function _buildColorSampler(cover) {
  const NEUTRAL = { r: 0.10, g: 0.12, b: 0.18, lum: 0.12 };
  const _neutral = () => NEUTRAL; _neutral.dominant = { r: 0.5, g: 0.55, b: 0.62 };
  if (!cover) return _neutral;
  let img;
  try { img = new Image(); img.src = cover; await img.decode(); }
  catch { return _neutral; }

  // ~face resolution (40×24) — the reconstruction is inherently a coarse mosaic.
  const cw = 160, ch = Math.max(1, Math.round(cw / _cardFaceAspect));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Cover-fit crop (no stretch) — match the displayed framing.
  const ia = img.width / img.height, ca = cw / ch;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (ia > ca) { sw = img.height * ca; sx = (img.width - sw) / 2; }
  else         { sh = img.width / ca;  sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
  const px = ctx.getImageData(0, 0, cw, ch).data;

  const sampler = (u, v) => {
    const x = Math.min(cw - 1, Math.max(0, Math.floor(u * cw)));
    const y = Math.min(ch - 1, Math.max(0, Math.floor((1 - v) * ch))); // flip v → image top
    const o = (y * cw + x) * 4;
    const r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255;
    return { r, g, b, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
  };
  sampler.dominant = _dominantOf(px);
  return sampler;
}

// Soft radial gradient used as the luminous core behind the card.
function _makeRadialGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0,   'rgba(150,180,255,0.90)');
  g.addColorStop(0.4, 'rgba(70,100,200,0.35)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.Texture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ── UI ────────────────────────────────────────────────────────────────────────

function _buildProjectIndex() {
  const container = document.getElementById('projectIndex');
  if (!container) return;
  container.innerHTML = ORBIT_PROJECTS.map((p, i) => `
    <div class="pi-entry${i === 0 ? ' active' : ''}" data-index="${i}">${p.title}</div>
  `).join('');
  container.querySelectorAll('.pi-entry').forEach(el => {
    el.addEventListener('click', () => setProject(parseInt(el.dataset.index, 10)));
  });
}

function _updateProjectUI(idx) {
  const proj   = ORBIT_PROJECTS[idx];
  const roleEl = document.getElementById('sceneRole');
  const yearEl = document.getElementById('sceneYear');
  const ctaEl  = document.getElementById('sceneCta');

  document.querySelectorAll('.pi-entry').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });

  if (roleEl) roleEl.textContent = proj.role;
  if (yearEl) yearEl.textContent = proj.year;

  if (ctaEl) {
    if (proj.hasCaseStudy) {
      ctaEl.textContent = 'View Case Study ↗';
      ctaEl.removeAttribute('aria-disabled');
      ctaEl.style.opacity       = '';
      ctaEl.style.pointerEvents = '';
    } else if (proj.liveUrl) {
      ctaEl.textContent = 'View Live ↗';
      ctaEl.href        = proj.liveUrl;
      ctaEl.removeAttribute('aria-disabled');
      ctaEl.style.opacity       = '';
      ctaEl.style.pointerEvents = '';
    } else {
      ctaEl.textContent = 'Case Study Soon';
      ctaEl.setAttribute('aria-disabled', 'true');
      ctaEl.style.opacity       = '0.35';
      ctaEl.style.pointerEvents = 'none';
    }
  }
}

// ── Destroy ───────────────────────────────────────────────────────────────────

export function destroy() {
  cancelAnimationFrame(rafId);
  _env?.destroy();
  _env = null;
  _cloud?.destroy();
  _cloud = null;
  _gui?.destroy();
  _gui = null;
  _sky?.destroy();
  _sky = null;
  _floor?.destroy();
  _floor = null;
  _godRays?.destroy();
  _godRays = null;
  _flowmap?.destroy();
  _flowmap = null;
  _wobble = null;
  _mistFront?.destroy();
  _mistFront = null;
  window.removeEventListener('resize',    _handlers.resize);
  window.removeEventListener('mousemove', _handlers.mousemove);
  window.removeEventListener('keydown',   _handlers.keydown);
  window.removeEventListener('wheel',     _handlers.wheel);
  window.removeEventListener('blur',      _handlers.mouseout);
  document.removeEventListener('mouseleave', _handlers.mouseout);
  _handlers._canvas = null;
  scene?.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); });
    }
  });
  composer?.dispose();
  renderer?.dispose();
  _curPos = _scaleArr = _uvOffset = _vox = _colRand = _revealArr = _revealAttr = _bumpArr = _bumpAttr = null;
  renderer = composer = scene = camera = cardGroup = voxelMesh = glowPlane = _coverTex = _revealU = null;
}
