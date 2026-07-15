// Homepage — InstancedMesh voxel card driven by cube_positions.json.
// Scene tuning reference: src/data/scene-settings.json
// The card is a programmable field of 5760 glass cubes (foundation for edge
// dissolve, hover repulsion, spring return, scroll morphing).
// Exports: initScene(canvas), setProject(idx), setPaused(paused), destroy()

import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ChromaticAberrationEffect, GodRaysEffect, TiltShiftEffect, NoiseEffect, BlendFunction } from 'postprocessing';
import { Fluid } from '@alienkitty/alien.js/src/three/utils/Fluid.js';
import { FluidDistortionEffect } from './fluid-distortion-effect.js';
import { AfterimagePass } from './afterimage-pass.js';
import { GradeEffect } from './grade-effect.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ORBIT_PROJECTS } from '../data/projects.js';
import { initEnvironment } from './environment.js';
import { initSkyDome } from './sky-dome.js';
import { initReflectiveFloor } from './reflective-floor.js';
import { Wobble } from '@alienkitty/alien.js/src/three/utils/Wobble.js';
import { Flowmap } from '@alienkitty/alien.js/src/three/utils/Flowmap.js';
import { initMistFront } from './mist-front.js';
import { initProjector } from './spot-projector.js';
import { initAtmosphere, DEFAULT_ATMO } from './atmosphere.js';
import { initAtmosphereMedium } from './atmosphere-medium.js';
import { initFogVeil } from './fog-veil.js';
import { initFogArc, ARC_DIST, ARC_Y } from './fog-arc.js';
import { initSideLight } from './side-light.js';
import gsap from 'gsap';

// The screen-space atmosphere (atmosphere.js) replaced the dome as the visible backdrop and
// the god rays / mist-front as the light-and-haze story. Modules stay in the repo, gated here.
// (The old sky_env.exr IBL path and the cloud-layer still planes were removed 2026-07-15 —
// environmentIntensity had been 0 since the projector became the only card light.)
const USE_SKY_DOME   = false;
const ENABLE_GODRAYS = false;
const USE_MIST_FRONT = false;

// The scene is built imperatively once (initScene runs on page load). Vite HMR hot-swaps this
// module without re-running it, so edits wouldn't show. Force a full reload on any update to
// this module or its deps so the scene always rebuilds fresh. Dev-only.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

// ── Module state ──────────────────────────────────────────────────────────────

let renderer, composer, scene, camera, rafId, bloomEffect;
let cardGroup  = null;   // holds the voxel field; gets float + mouse tilt
let voxelMesh  = null;   // THREE.InstancedMesh — the card itself
let _env       = null;   // hero atmosphere (ground / haze / clouds / glow) — disabled this pass
let _gui       = null;   // dev-only scene/env controls (lazy, dev/?lights only)
let _sky       = null;   // procedural sky dome (SKY_MODE === 'dome')
let _floor     = null;   // reflective floor below the card
let _wobble    = null;   // alien.js Wobble — 3D Perlin float for cardGroup
let _flowmap   = null;   // alien.js Flowmap — cursor velocity → UV distortion texture
const _prevFlowMouse = new THREE.Vector2(); // tracks last flowmap mouse for velocity delta
let _fluid     = null;   // alien.js Fluid — cursor-splatted ink sim → shared noise/dye texture
const _prevSplat = new THREE.Vector2(-1, -1); // last screen-space (0-1) pointer for splat velocity
let _godRays   = null;   // pmndrs GodRaysEffect (volumetric shafts)
let _godRaySrc = null;   // emissive source mesh the god rays radiate from
let _tiltShift = null;   // pmndrs TiltShiftEffect (focus band)
let _fluidFx   = null;   // custom pmndrs Effect — full-screen ripple driven by the fluid dye
let _afterimage = null;  // custom feedback Pass — temporal ghost trails (ref: fringe echoes)
let _grade = null;       // final split-tone grade — one hue axis across the whole frame (ref LUT feel)
let _mistFront = null;   // foreground fog drifting in front of the card
let _projector = null;   // cursor-driven spotlight projecting the cover image onto the card
let _medium    = null;   // shared atmospheric medium — colors/light/wind/clocks, one transition()
let _atmo      = null;   // world-space sky dome (absorption/scattering cloudscape)
let _veil      = null;   // foreground fog veil — haze over card/floor, seats everything
let _arc       = null;   // foreground fog arc — camera-azimuth-anchored proscenium horseshoe
let _sideLight = null;   // real PointLight keying the card to the atmosphere's glow region
let _ambient   = null;   // AmbientLight — off by default (tuned 2026-07-02); GUI can re-enable

// Cursor energy — accumulated pointer speed with exponential decay; drives the atmosphere's
// fog density / glow swell and the side light. Frame-rate independent (integrated in _tick).
let _energy = 0;
let _prevEnergyT = 0;
const _prevPointer = new THREE.Vector2();
const _atmoParams = { energyGain: 0.08, energyTau: 1.4 };

// Per-project environment accent (drives ground/clouds/haze/glow tint).
const _accentFor = (idx) => ORBIT_PROJECTS[idx]?.envAccent || '#7fa0ff';
// Per-project atmosphere palette (base / fog / glow / smoke).
const _atmoFor = (idx) => ORBIT_PROJECTS[idx]?.atmo || DEFAULT_ATMO;
let isMobile   = false;

let _cardFaceAspect = 16 / 10;
const _halfExtent   = new THREE.Vector2(2, 1.24); // face half-extent (world units)

// ── Per-instance voxel data (typed arrays — no object per cube) ───────────────
let _N        = 0;
let _curPos   = null;  // base cube position (matrix written once; shader animates on top)
let _scaleArr = null;  // per-instance uniform scale
let _vox      = null;  // per-cube (depthNorm, rand, lum) → D2 motion/visibility
let _colRand  = null;  // per-COLUMN random (same for all 6 depth cubes in a cell) → whole-column cull
let _runRand  = null;  // per-RUN random (shared by ~3 adjacent cells in a row) → edge cull in horizontal dashes (ref)
let _revealArr  = null;  // per-cube eased reveal 0→1 (asymmetric attack/release → smooth fade-out)
let _revealAttr = null;  // InstancedBufferAttribute wrapping _revealArr (uploaded per frame)
let _bumpArr    = null;  // per-cube eased bump height 0→1 (fast attack, slow release → slow settle)
let _bumpAttr   = null;  // InstancedBufferAttribute wrapping _bumpArr (uploaded per frame)
const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _sv = new THREE.Vector3();
const _qI = new THREE.Quaternion();
// Scratch for placing a wall's (scene-child) projector in world space each frame.
const _pjPos = new THREE.Vector3(), _pjN = new THREE.Vector3(), _pjR = new THREE.Vector3(), _pjU = new THREE.Vector3();
const _slPos = new THREE.Vector3(); // scratch: side-light world anchor (active wall's frame)
const _wallSlotTmp = new THREE.Vector3(); // scratch: wall face position for the floor's haze band
const _arcDir = new THREE.Vector3(); // scratch: camera-forward direction for the fog arc
const PROJ_DIST = 3.25, PROJ_TRAVEL = 1.0; // lamp stand-off from the face · cursor travel range
// (cursor-torch scratch removed — using _hit / _cursor directly)

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
const IDLE_FLOOR    = 0.32; // idle = dark ghost (ref: card darker than fog, bright core only near cursor)
let _revealU = null;        // persistent cube uniform table (uCursor / uHover updated per frame)
let _cubeU   = null;        // built on first compile, re-assigned into every recompile (see _patchCube)
const _cursor = new THREE.Vector2(0, 0);  // smoothed cursor in card-local face coords
let _hover = 0;                           // 0→1 presence (fades when leaving the card)
let _hoverTarget = 0;
let _cardProx = 0;                        // 0→1 cursor proximity to the card face (gates the projector)
const _camMouse = new THREE.Vector2();    // slower-smoothed mouse for camera parallax
const _raycaster = new THREE.Raycaster();
const _revealPlane = new THREE.Plane();
const _planeN = new THREE.Vector3();
const _hit = new THREE.Vector3();

let currentIdx     = 0;
// Wall pool (Model 1): up to 3 live walls keyed by ring slot index {active-1, active, active+1}.
// _activeWall is the one the camera faces; its fields are mirrored into the singletons above.
const _pool        = new Map(); // slotIndex → wall
let _activeWall    = null;
// Fixed pool of 3 projectors, kept in the scene for the app's lifetime so the light count is
// CONSTANT (adding/removing a light recompiles every lit material → the transition hitch). The
// 3 live walls sit at consecutive ring slots, so slotIndex mod 3 assigns each a distinct lamp;
// the disposed wall and the incoming far wall share a slot mod 3, so exactly 3 lamps recycle.
let _projPool      = [];
// Walls are CACHED by project index and repositioned when reused (never disposed on navigation).
// Each wall keeps its own compiled shader program, so a project's shader compiles once (first
// visit) and is reused forever after — no per-turn recompile hitch. _building dedupes the
// concurrent first-visit builds of the same project.
const _wallCache   = new Map(); // projectIdx → wall
const _building    = new Map(); // projectIdx → Promise<wall> (in-flight first build)
const _wallProjector = (wall) => _projPool[((wall.slotIndex % 3) + 3) % 3];
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
const CAM_REST_Z   = 5.5;
const _camParams   = { travelX: 1.0, travelY: 0.5, zFactor: 1.25, lerp: 0.07 };

// ── Camera yaw (Model 1: project switch = camera turns to face the next wall) ──
// The camera sits at a FIXED seat (0,0,CAM_REST_Z) and yaws in place; the walls live on a
// ring around that seat, CAM_REST_Z in front, each RING_STEP apart. Because a neighbour is a
// full RING_STEP off the view axis, it falls outside the frustum and stays hidden at the
// edges (the whole reason the pivot is AT the camera, not behind the wall). At azimuth 0 the
// active wall sits at the world origin — framing identical to before.
const RING_STEP   = THREE.MathUtils.degToRad(80); // camera turn per project switch (~80°)
const CAM_PIVOT   = new THREE.Vector3(0, 0, CAM_REST_Z); // fixed camera seat; it yaws in place
let _camAzimuth   = 0;   // accumulating yaw angle (radians); gsap tweens this on switch
const _wallCenter = new THREE.Vector3(); // scratch: active wall centre (lookAt target)
const _viewFwd    = new THREE.Vector3(); // scratch: camera view direction at current yaw
const _camRight   = new THREE.Vector3(); // scratch: camera-local right (for parallax)

// World transform of a wall at ring angle θ: CAM_REST_Z in front of the camera seat along
// view yaw θ, facing back toward the seat. Writes into outPos; returns rotation.y.
function _ringSlot(theta, outPos) {
  outPos.set(-CAM_REST_Z * Math.sin(theta), 0, CAM_REST_Z * (1 - Math.cos(theta)));
  return theta; // +Z face rotated by θ about Y = (sinθ,0,cosθ) → points back at the seat
}
const BUMP_AMP     = 0.9;        // peak height (world units)
const BUMP_RADIUS  = 1.0;        // bell radius (local face units; < REVEAL_RADIUS for a small bump)
const BUMP_ATTACK  = 0.20;       // rise speed (per frame lerp) — quick up
const BUMP_RELEASE = 0.03;       // fall speed (per frame lerp) — slow down/settle

const LIGHTING_PRESETS = [
  // 0 — Keploy — warm rust
  {
    ambient: 0x1a2238, ambientInt: 0.5,
    spot: 0xdfe6ff, spotInt: 30, spotPos: [ 2, 4, 4],
    fog: 0x04040c, fogDensity: 0.007, // matches atmo.base — scene fog never fights the backdrop
  },
  // 1 — GEMx — emerald
  {
    ambient: 0x040a05, ambientInt: 0.40,
    spot: 0x55ddaa, spotInt: 44, spotPos: [ 1, 5, 4],
    fog: 0x020806, fogDensity: 0.008,
  },
  // 2 — Demand Climate Justice — warm paper
  {
    ambient: 0x0a0600, ambientInt: 0.40,
    spot: 0xe8b98a, spotInt: 44, spotPos: [ 2, 3, 5],
    fog: 0x0a0501, fogDensity: 0.008,
  },
];


// ── Init ──────────────────────────────────────────────────────────────────────

export function initScene(canvas) {
  prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer = new THREE.WebGLRenderer({
    canvas,
    // antialias off: every frame is composed through the EffectComposer's render targets,
    // so canvas MSAA never touches visible pixels — it only cost memory/bandwidth.
    antialias:             false,
    // preserveDrawingBuffer off: nothing reads the canvas back (no toDataURL anywhere),
    // and keeping the backbuffer forces an extra copy per frame.
    preserveDrawingBuffer: false,
    powerPreference:       'high-performance',
  });
  isMobile = window.innerWidth < 768;
  // 1.5 caps pixel work at 56% of DPR-2 (perf pass 2026-07-15: the frame is fill-bound —
  // fog FBM + card + dome all scale with pixels). Tunable live via the GUI's render scale.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  // Scene materials render into the composer's RT (no tone mapping applied there), so this
  // only affects shaders that opt in via tonemapping includes — in practice, the floor.
  // Tuned 2026-07-03: 0.38 lifts the ground into a dim lit plane (was 0 = crushed black).
  renderer.toneMappingExposure = 0.38;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04040c);
  // Sky-env look knobs (tunable live via the dev GUI) — soften + dim the visible sky so it
  // reads as atmosphere, while environmentIntensity drives the lighting independently.
  scene.backgroundBlurriness = 0.35;
  scene.backgroundIntensity  = 0.5;
  scene.environmentIntensity = 0; // IBL off (tuned look: the projector is the only card light)

  // The screen-space atmosphere (added below) is the visible backdrop. No environment map:
  // environmentIntensity is 0 (the projector is the only card light), so IBL would be inert.
  scene.background = null;

  if (USE_SKY_DOME) {
    const _pmrem = new THREE.PMREMGenerator(renderer);
    _sky = initSkyDome({ accent: _accentFor(0), renderer });
    scene.add(_sky.mesh);
    scene.environment = _pmrem.fromScene(scene, 0.04).texture; // placeholder IBL from the dome
    _pmrem.dispose();
  }

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 0, CAM_REST_Z);
  camera.lookAt(0, 0, 0);

  // Post-processing — bloom + vignette, plus DOF + chromatic aberration (cinematic).
  bloomEffect = new BloomEffect({ intensity: 0.53, luminanceThreshold: 0.48, luminanceSmoothing: 0.78, mipmapBlur: true, radius: 0.42 });
  const vignetteEffect = new VignetteEffect({ darkness: 0.58, offset: 0.12 });
  // Film grain — OVERLAY keeps grain visible in shadows (SCREEN only lifts; premultiplied
  // grain vanishes in a mostly-dark frame). Tuned 2026-07-03: ON, opacity 0.32 — the film
  // finish of the cinematic pass. _originalBlend lets the GUI toggle round-trip it.
  const noiseEffect = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  noiseEffect.blendMode.opacity.value = 0.14;
  noiseEffect._originalBlend = BlendFunction.OVERLAY;
  const chromaticAberration = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(0.0012, 0.0012), radialModulation: true, modulationOffset: 0.15,
  });
  // God-ray source — a small emissive sphere behind/above the card the shafts radiate from.
  // Must not write depth and be flagged transparent (per GodRaysEffect contract).
  // Disabled: the atmosphere's side glow is the light story now (gated by ENABLE_GODRAYS).
  if (ENABLE_GODRAYS) {
    _godRaySrc = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xbcd0ff, transparent: true, depthWrite: false }),
    );
    _godRaySrc.position.set(0, 3.2, -9);
    _godRaySrc.frustumCulled = false;
    scene.add(_godRaySrc);
    _godRays = new GodRaysEffect(camera, _godRaySrc, {
      density: 0.92, decay: 0.92, weight: 0.5, exposure: 0.5, samples: 60, clampMax: 1.0,
    });
  }

  // Full-screen ripple from the fluid dye (texture attached once _fluid exists, below).
  _fluidFx = new FluidDistortionEffect({ strength: 0.005 });

  // Tilt-shift focus band — OFF by default (tuned 2026-07-03); GUI toggle restores it.
  _tiltShift = new TiltShiftEffect({ offset: 0.0, focusArea: 0.6, feather: 0.25 });
  _tiltShift._originalBlend = _tiltShift.blendMode.blendFunction;
  _tiltShift.blendMode.blendFunction = BlendFunction.SKIP;

  // ChromaticAberrationEffect is a CONVOLUTION effect, which postprocessing refuses to merge
  // into the same EffectPass as the UV-transforming FluidDistortionEffect (mainUv). So the
  // chain is split at that boundary: everything up to tilt-shift in one pass, then CA+vignette
  // in a second. Effect order across the two passes matches the original single-pass intent.
  // DOF removed — it gaussian-blurred the hero card into mush. The reference keeps the card
  // the sharpest thing in frame; all softness lives in the atmosphere.
  const passEffects = [bloomEffect, ...(_godRays ? [_godRays] : []), _fluidFx, _tiltShift];
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Afterimage feedback BEFORE bloom — ghost trails glow like live pixels (ref).
  // Motion-derived, so reduced-motion ships it disabled.
  _afterimage = new AfterimagePass({ damp: 0.8 });
  _afterimage.enabled = !prefersReduced;
  composer.addPass(_afterimage);
  composer.addPass(new EffectPass(camera, ...passEffects));
  // Grade sits after CA, before vignette/grain — color is shaped, finish sits on top.
  _grade = new GradeEffect();
  composer.addPass(new EffectPass(camera, chromaticAberration, _grade, vignetteEffect, noiseEffect));

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

  // Shared atmospheric medium — every layer below adopts its uniform objects by reference;
  // one _medium.transition() recolors backdrop + veil + floor fog + card tint together.
  _medium = initAtmosphereMedium({ palette: _atmoFor(0) });

  // Reflective floor below the card — circular mirror (three Reflector); its distance fog
  // converges the far ground to the medium's base color (the horizon dissolves).
  _floor = initReflectiveFloor({ scene, renderer, accent: _accentFor(0), medium: _medium });

  // Screen-space atmosphere — the visible backdrop, drawn first.
  _atmo = initAtmosphere({ medium: _medium, isMobile });
  scene.add(_atmo.mesh);

  // Mid-ground fog banks — a fixed pool of 3 seated groups (active wall + both ring
  // neighbours, mirroring the 3-projector pool) so the outgoing card keeps its bank
  // during a turn. All three share the same two materials.
  _veil = initFogVeil({ medium: _medium, isMobile });
  for (const m of _veil.meshes) scene.add(m);

  // Foreground fog arc — proscenium horseshoe in front of the card: occludes the bank/floor
  // seam at the flanks, clears over the card + its reflection. Follows the camera's ring
  // azimuth (placed per frame in _tick), so it never jumps or vanishes during a turn.
  _arc = initFogArc({ medium: _medium, isMobile });
  scene.add(_arc.mesh);
  _placeArc();
  // Keep the arc OUT of the floor's mirror render: reflecting lens-side fog would
  // double-fog the flanks the arc is meant to occlude. (reflective-floor already wraps
  // onBeforeRender once to strip scene.fog; this wraps that wrapper.)
  {
    const _mirrorPass = _floor.mesh.onBeforeRender;
    _floor.mesh.onBeforeRender = function (r, s, c) {
      const arcVis = _arc ? _arc.mesh.visible : false;
      if (_arc) _arc.mesh.visible = false;
      _mirrorPass.call(this, r, s, c);
      if (_arc) _arc.mesh.visible = arcVis;
    };
  }

  // Real side light matching the glow — rims the card so it agrees with the bright edge.
  _sideLight = initSideLight({ scene });
  _sideLight.transition(_atmoFor(0).glow, { duration: 0 });

  // A trace of blue-grey fill keeps the shadow-side voxel geometry present without flattening
  // the projector's directional story.
  _ambient = new THREE.AmbientLight(0xaab4c0, 0.025);
  scene.add(_ambient);

  // Foreground fog — retired: the atmosphere's fog layer carries the haze now.
  if (USE_MIST_FRONT) {
    _mistFront = initMistFront({ accent: _accentFor(0) });
    scene.add(_mistFront.mesh);
  }

  // Fixed pool of 3 projectors (see _projPool note). Created once, never destroyed until the
  // scene is — so the light count stays constant. Each live wall is assigned one by slot mod 3;
  // a shown wall attaches + lights its lamp, the active wall's lamp also tracks the cursor.
  // A 1×1 placeholder map is set on every lamp so NUM_SPOT_LIGHT_MAPS is a constant 3 from the
  // start — swapping to a real cover later then never changes that shader define (no recompile).
  const _placeholderMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  _placeholderMap.needsUpdate = true;
  _projPool = [initProjector({ scene }), initProjector({ scene }), initProjector({ scene })];
  _projPool.forEach((p) => { p.light.map = _placeholderMap; p.setIntensity(0); });

  // Cursor velocity → flowmap texture (card-face UV space, 128² HalfFloat RT).
  // Sampled in the cube fragment shader to distort image UVs — image "pours" on cursor drag.
  _flowmap = new Flowmap(renderer, { size: 128, falloff: 0.20, alpha: 1, dissipation: 0.97 });

  // Cursor-splatted fluid ink → a shared dye texture that drives the dome mist/displacement,
  // the floor warp, and the full-screen ripple. Exposes `.uniform` ({ value }) like Flowmap.
  _fluid = new Fluid(renderer, {
    simRes: 128, dyeRes: 512, densityDissipation: 0.9, velocityDissipation: 0.9,
    pressureDissipation: 0.8, curlStrength: 50, radius: 0.6,
  });
  // Consumers adopt the live uniform object once — it always reflects the current dye frame.
  _sky?.setInk(_fluid.uniform);
  _floor?.setInk(_fluid.uniform);
  _atmo?.setInk(_fluid.uniform);
  if (_fluidFx) _fluidFx.map = _fluid.uniform.value;

  // Dev-only scene/env controls — lazy-loaded so the GUI never ships to normal visitors.
  if (import.meta.env.DEV || location.search.includes('lights')) {
    import('./scene-gui.js').then(({ initSceneGui }) => {
      _gui = initSceneGui({
        scene, renderer, bloomEffect, floor: _floor, projector: _projector, camera, camParams: _camParams,
        fx: { godRays: _godRays, godRaySource: _godRaySrc, tiltShift: _tiltShift, fluidDistortion: _fluidFx, noise: noiseEffect, vignette: vignetteEffect, afterimage: _afterimage, grade: _grade },
        fluid: _fluid, sky: _sky,
        atmosphere: _atmo, sideLight: _sideLight, atmoParams: _atmoParams, ambient: _ambient,
        medium: _medium, fogVeil: _veil, fogArc: _arc,
      });
    });
  }

  _initPool(); // async — builds the active wall at slot 0 + prefetches its two neighbours

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
    if (e.deltaY > 1)       navigate(-1);
    else if (e.deltaY < -1) navigate(1);
  };
  window.addEventListener('wheel', _handlers.wheel, { passive: false });
  _handlers._canvas = canvas;

  // Keyboard — project navigation
  _handlers.keydown = (e) => {
    if (e.key === 'ArrowDown'  || e.key === 'ArrowRight') navigate(-1);
    if (e.key === 'ArrowUp'    || e.key === 'ArrowLeft')  navigate(1);
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

    _camMouse.x += (targetMouse.x - _camMouse.x) * _camParams.lerp;
    _camMouse.y += (targetMouse.y - _camMouse.y) * _camParams.lerp;
    // Yaw basis at the current azimuth: view forward and camera-local right. At azimuth 0
    // these are -Z and +X, so the parallax/breathing below reduce exactly to the pre-yaw
    // world-axis math (wall at origin, camera at (0,0,CAM_REST_Z)).
    const th = _camAzimuth;
    _viewFwd.set(-Math.sin(th), 0, -Math.cos(th));  // camera looks along here
    _camRight.set(Math.cos(th), 0, -Math.sin(th));  // camera-local +X
    _ringSlot(th, _wallCenter);                     // active wall centre (lookAt target)
    camera.position.copy(CAM_PIVOT);                // fixed seat; camera yaws in place
    if (!prefersReduced) {
      // Parallax in camera-local axes (was world XYZ) so it stays consistent as we yaw:
      // cursor right → camera left; cursor up → camera up + dolly back (away from the wall).
      const cy = _camMouse.y * _camParams.travelY;
      camera.position.addScaledVector(_camRight, -_camMouse.x * _camParams.travelX);
      camera.position.addScaledVector(THREE.Object3D.DEFAULT_UP, cy);
      camera.position.addScaledVector(_viewFwd, -cy * _camParams.zFactor);
      // Camera breathing (life pack) — sub-pixel drift + a hair of fov, under the parallax.
      camera.position.addScaledVector(_camRight, Math.sin(t * (Math.PI * 2 / 9.2)) * 0.02);
      camera.position.addScaledVector(THREE.Object3D.DEFAULT_UP, Math.sin(t * (Math.PI * 2 / 12.7) + 1.7) * 0.015);
      camera.fov = 55 + Math.sin(t * (Math.PI * 2 / 11.0)) * 0.15;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(_wallCenter);

    if (!prefersReduced) {
      // Apply the wobble + mouse tilt to EVERY visible wall (active + the incoming one mid-turn),
      // not just the active one — otherwise the incoming wall (sitting at plain yaw θ) would snap
      // by mouse.x*0.14 the instant it becomes active on settle (the cursor-dependent perspective
      // jump). Tilt rides on top of each wall's fixed ring yaw so it stays face-outward.
      for (const w of _pool.values()) {
        if (!w.group.visible) continue;
        if (w.wobble) w.wobble.update(t);
        w.group.rotation.y = w.theta + mouse.x * 0.14;
        w.group.rotation.x = mouse.y * 0.07;
        _placeProjector(w, w === _activeWall); // keep each lit wall's lamp in front of its face
      }
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

    // Cursor energy: integrate pointer speed, decay exponentially — the atmosphere's fog
    // density and glow (plus the side light) all swell with recent cursor motion.
    {
      const dt = Math.max(1e-3, t - _prevEnergyT);
      _prevEnergyT = t;
      const speed = targetMouse.distanceTo(_prevPointer) / dt; // NDC units / sec
      _prevPointer.copy(targetMouse);
      _energy = Math.min(1, _energy + speed * _atmoParams.energyGain * dt);
      _energy *= Math.exp(-dt / _atmoParams.energyTau);
    }

    // Fluid ink: splat at the pointer (screen-space 0-1) with its per-frame velocity, then
    // advance the sim before anything samples the dye.
    if (_fluid && !prefersReduced) {
      const sx = mouse.x * 0.5 + 0.5;
      const sy = mouse.y * 0.5 + 0.5;
      if (_prevSplat.x >= 0) {
        const dx = (sx - _prevSplat.x) * 12.0;
        const dy = (sy - _prevSplat.y) * 12.0;
        if (dx * dx + dy * dy > 1e-6) _fluid.splats.push({ x: sx, y: sy, dx, dy });
      }
      _prevSplat.set(sx, sy);
      _fluid.update();
      if (_fluidFx) _fluidFx.map = _fluid.uniform.value; // dye target swaps each frame
    }

    _updateReveal();
    // Advance the shader clock on every live wall (neighbours idle via uTime; active adds reveal).
    const _wt = prefersReduced ? 0 : t;
    for (const w of _pool.values()) if (w.cubeU) w.cubeU.uTime.value = _wt;
    if (_env) _env.update(prefersReduced ? 0 : t);
    if (_sky) _sky.update(prefersReduced ? 0 : t);
    if (_floor) _floor.update(prefersReduced ? 0 : t);
    if (_mistFront) _mistFront.update(prefersReduced ? 0 : t);
    // One medium update feeds every atmospheric layer (backdrop, veil, floor fog, card tint).
    if (_medium) _medium.update(prefersReduced ? 0 : t, prefersReduced ? 0 : _energy, mouse.x, mouse.y);
    // Sky is world geometry (the dome) — camera motion moves it through the projection,
    // no manual parallax. update() only refreshes the screen-resolution uniform (ink).
    if (_atmo) { _atmo.setViewYaw(_camAzimuth); _atmo.update(); }
    _placeArc();
    if (_veil) _veil.update();
    if (_sideLight) { _placeSideLight(); _sideLight.update(prefersReduced ? 0 : _energy); }
    // (projectors are placed per visible wall in the tilt loop above — no single-lamp update)
    if (_gui && _revealU) _gui.addCubeControls(_revealU); // idempotent — attaches once shader is live

    composer.render();
  }
  _tick();
}

// ── Voxel card construction ─────────────────────────────────────────────────

// Fetch + compute the geometry that is IDENTICAL for every wall (cube layout, per-column /
// per-run randoms, face dims). Cached once; each wall only adds its own cover-derived data.
let _wallSeq = 0; // monotonic wall id → unique shader program cache key per wall
let _baseGeoPromise = null;
function _loadBaseGeo() {
  if (_baseGeoPromise) return _baseGeoPromise;
  _baseGeoPromise = (async () => {
    const data = await (await fetch('/assets/cube_positions.json')).json();
    const N = data.length;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of data) {
      if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
      if (c.z < minZ) minZ = c.z; if (c.z > maxZ) maxZ = c.z;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
    const S = 4.0 / Math.max(spanX, spanY, spanZ);
    // json x → world X (width), json z → world Y (height), json y → world Z (depth).
    const wHalfX = (spanX * S) / 2, wHalfY = (spanZ * S) / 2, wHalfZ = (spanY * S) / 2;
    const cube = ((spanX * S) / 40) * 0.92;
    const pos = new Float32Array(N * 3);       // base world pos (wx, wy, wz) — pre depth-relief
    const uv  = new Float32Array(N * 2);        // face UV (u, v) per cube
    const grid = new Int16Array(N * 2);         // grid cell (gx, gz)
    const colRand = new Float32Array(N), runRand = new Float32Array(N);
    const depthNorm = new Float32Array(N), hashArr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const c = data[i];
      const wx = (c.x - cx) * S, wy = (c.z - cz) * S, wz = (c.y - cy) * S;
      const h  = _hash(c.x, c.y, c.z);
      const u = (wx + wHalfX) / (2 * wHalfX), v = (wy + wHalfY) / (2 * wHalfY);
      const gx = Math.min(GRID_COLS - 1, Math.floor(u * GRID_COLS));
      const gz = Math.min(GRID_ROWS - 1, Math.floor(v * GRID_ROWS));
      pos[i * 3] = wx; pos[i * 3 + 1] = wy; pos[i * 3 + 2] = wz;
      uv[i * 2] = u; uv[i * 2 + 1] = v;
      grid[i * 2] = gx; grid[i * 2 + 1] = gz;
      colRand[i] = _hash(gx, gz, 0);
      runRand[i] = _hash(Math.floor(gx / 3), gz, 7);
      depthNorm[i] = (wz + wHalfZ) / (2 * wHalfZ);
      hashArr[i] = h;
    }
    _halfExtent.set(wHalfX, wHalfY);
    _cardFaceAspect = spanX / spanZ;
    console.log(`[scene] base geo — ${N} cubes · cell ${cube.toFixed(3)}`);
    // colRand/runRand arrays are shared read-only; each wall wraps its OWN attribute (so one
    // wall's geometry.dispose() never frees a buffer another wall still references).
    return { N, cube, wHalfX, wHalfY, pos, uv, grid, colRand, runRand, depthNorm, hashArr,
             faceAspect: spanX / spanZ };
  })();
  return _baseGeoPromise;
}

// Build ONE self-contained wall for `idx`, seated at ring `slotIndex`. Returns a wall object
// holding its own arrays, mesh/group, material and uniform table (cubeU). The interactive
// systems (reveal/flowmap/projector) run only on the ACTIVE wall (see _activateWall); a
// neighbour just idles its shader via uTime and renders its baked cover.
async function _buildWall(idx, slotIndex) {
  const base = await _loadBaseGeo();
  if (!scene) return null; // destroyed mid-load
  const { N } = base;
  const cover   = ORBIT_PROJECTS[idx]?.coverImage || null;
  const sample  = await _buildColorSampler(cover);
  const texInfo = cover ? await _loadCoverTexture(cover) : null;

  // Cover-fit visible region (image vs face aspect) — baked into the UV windows.
  let offU = 0, offV = 0, spanU = 1, spanV = 1;
  if (texInfo) {
    if (texInfo.aspect > base.faceAspect) { spanU = base.faceAspect / texInfo.aspect; offU = (1 - spanU) / 2; }
    else                                  { spanV = texInfo.aspect / base.faceAspect; offV = (1 - spanV) / 2; }
  }
  const uvScale  = new THREE.Vector2(spanU / GRID_COLS, spanV / GRID_ROWS);
  const uvOrigin = new THREE.Vector2(offU, offV);

  const curPos    = new Float32Array(N * 3);
  const scaleArr  = new Float32Array(N);
  const uvOffset  = new Float32Array(N * 2);
  const vox       = new Float32Array(N * 3);
  const revealArr = new Float32Array(N);
  const bumpArr   = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const wx = base.pos[i * 3], wy = base.pos[i * 3 + 1], wz = base.pos[i * 3 + 2];
    const u = base.uv[i * 2], v = base.uv[i * 2 + 1];
    const gx = base.grid[i * 2], gz = base.grid[i * 2 + 1];
    const px = sample(u, v);
    uvOffset[i * 2]     = offU + gx * (spanU / GRID_COLS);
    uvOffset[i * 2 + 1] = offV + gz * (spanV / GRID_ROWS);
    const rz = wz + (px.lum - 0.5) * DEPTH_LUM + (base.hashArr[i] - 0.5) * DEPTH_NOISE;
    curPos[i * 3] = wx; curPos[i * 3 + 1] = wy; curPos[i * 3 + 2] = rz;
    scaleArr[i] = 1;
    vox[i * 3] = base.depthNorm[i]; vox[i * 3 + 1] = base.hashArr[i]; vox[i * 3 + 2] = px.lum;
  }

  const geo = new RoundedBoxGeometry(base.cube, base.cube, base.cube, 1, base.cube * 0.04);
  geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(uvOffset, 2));
  geo.setAttribute('aVox', new THREE.InstancedBufferAttribute(vox, 3));
  geo.setAttribute('aColRand', new THREE.InstancedBufferAttribute(base.colRand, 1));
  geo.setAttribute('aRunRand', new THREE.InstancedBufferAttribute(base.runRand, 1));
  const revealAttr = new THREE.InstancedBufferAttribute(revealArr, 1);
  revealAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aReveal', revealAttr);
  const bumpAttr = new THREE.InstancedBufferAttribute(bumpArr, 1);
  bumpAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aBump', bumpAttr);

  const wall = {
    uid: _wallSeq++,
    idx, slotIndex, theta: slotIndex * RING_STEP,
    curPos, scaleArr, uvOffset, vox, revealArr, revealAttr, bumpArr, bumpAttr,
    uvScale, uvOrigin, coverTex: texInfo?.texture || null, N,
    cubeU: null, mesh: null, group: null, wobble: null,
  };
  const material = _makeCubeMaterial(wall);
  const mesh = new THREE.InstancedMesh(geo, material, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  wall.mesh = mesh;
  _writeMatrices(wall);

  const group = new THREE.Group();
  _ringSlot(wall.theta, group.position);
  group.rotation.y = wall.theta; // face radially outward
  group.add(mesh);
  scene.add(group);
  wall.group = group;

  // Wobble oscillates the wall around its ring seat (origin auto-copied from group.position).
  const wob = new Wobble(group.position);
  wob.frequency.set(0.28, 0.20, 0.14);
  wob.amplitude.set(0.06, 0.09, 0.025);
  wob.lerpSpeed = 0.018;
  wall.wobble = wob;

  // Pre-warm this wall's shader NOW (build time, off the critical path) so it doesn't compile
  // the first time it's shown — that compile is the ~140ms hitch at turn start. The light count
  // is constant (fixed projector pool), so the compiled program stays valid. compile() is sync
  // and needs the object visible to include it; it renders nothing, so no flash.
  group.visible = true;
  renderer.compile(scene, camera);
  group.visible = false; // neighbours stay hidden until a turn reveals them (see navigate)

  return wall;
}

// Position a wall's assigned (scene-child) projector in front of its face. withCursor adds the
// reverse-parallax cursor offset (active wall only). Runs each frame for every visible wall.
function _placeProjector(wall, withCursor) {
  const pj = _wallProjector(wall);
  const g = wall.group;
  _pjN.set(0, 0, 1).applyQuaternion(g.quaternion); // face normal (toward camera)
  _pjPos.copy(g.position).addScaledVector(_pjN, PROJ_DIST);
  if (withCursor) {
    _pjR.set(1, 0, 0).applyQuaternion(g.quaternion);
    _pjU.set(0, 1, 0).applyQuaternion(g.quaternion);
    _pjPos.addScaledVector(_pjR, mouse.x * PROJ_TRAVEL).addScaledVector(_pjU, mouse.y * PROJ_TRAVEL);
  }
  pj.place(_pjPos, g.position);
}

// Seat the fog planes at a wall's ring slot as WORLD objects (veil 1.15 behind the face,
// mist 3.0 in front — the offsets they were authored with at slot 0). Called on activation,
// not per frame: at rest they're world-anchored (parallax like everything else), during a
// turn the old seat sweeps out of frame with its wall, and the new seat is behind the
// incoming wall — never a screen-glued fog layer.
// Seat the fog arc at the camera's CURRENT ring azimuth (continuous, mid-turn included):
// a fixed forward distance from the seat, always facing it. Called every frame from _tick —
// the arc pans with the view instead of jumping between wall seats, so project turns keep
// an unbroken foreground. (Deliberate exception to "fog planes seat per wall"; see fog-arc.js.)
function _placeArc() {
  if (!_arc) return;
  _ringSlot(_camAzimuth, _arcDir);
  _arcDir.sub(CAM_PIVOT).normalize();
  _arc.mesh.position.copy(CAM_PIVOT).addScaledVector(_arcDir, ARC_DIST);
  _arc.mesh.position.y += ARC_Y;
  _arc.mesh.rotation.y = _camAzimuth;
}

function _seatFogPlanes(wall) {
  if (!wall) return;
  const th = wall.theta;
  _slPos.set(Math.sin(th), 0, Math.cos(th)); // wall face normal (toward the camera seat)
  // Re-anchor the floor's fog-bank contact haze to this wall's frame, so the matte band
  // stays glued behind the active card at every ring azimuth.
  if (_floor?.setWallFrame) {
    _ringSlot(th, _wallSlotTmp);
    _floor.setWallFrame(_slPos, _wallSlotTmp);
  }
  if (_veil) {
    // Seat the 5-bank pool over slots wall±2, each mesh keyed by slot mod 5 (projector
    // pattern). A slot that stays in the neighbourhood keeps ITS mesh at an identical
    // transform — zero motion — so re-seating at turn start is invisible: the only mesh
    // that moves is the one recycled from the slot 2 turns behind (160° away, off-screen).
    // Same authored offsets as ever: 1.15 behind the face along its normal, y +0.12.
    for (let s = wall.slotIndex - 2; s <= wall.slotIndex + 2; s++) {
      const m = _veil.meshes[((s % 5) + 5) % 5];
      const t = s * RING_STEP;
      _ringSlot(t, m.position);
      m.position.x -= Math.sin(t) * 1.15;
      m.position.z -= Math.cos(t) * 1.15;
      m.position.y += 0.12;
      m.rotation.y = t;
    }
  }
  if (_mistFront) {
    _ringSlot(th, _mistFront.mesh.position);
    _mistFront.mesh.position.addScaledVector(_slPos, 3.0);
    _mistFront.mesh.position.y += 0.3;
    _mistFront.mesh.rotation.y = th;
  }
}

// Anchor the side rim light to the active wall's local frame (its params.x/y/z are offsets in
// the wall's right/up/normal basis) plus a subtle cursor drift, so it keys the centred card
// wherever the ring has scrolled to — instead of staying pinned near ring slot 0.
function _placeSideLight() {
  if (!_sideLight || !_activeWall) return;
  const g = _activeWall.group;
  const p = _sideLight.params;
  _pjN.set(0, 0, 1).applyQuaternion(g.quaternion); // face normal (toward camera)
  _pjR.set(1, 0, 0).applyQuaternion(g.quaternion); // wall-local right
  _pjU.set(0, 1, 0).applyQuaternion(g.quaternion); // wall-local up
  const dx = prefersReduced ? 0 : mouse.x * p.travel;
  const dy = prefersReduced ? 0 : mouse.y * p.travel;
  _slPos.copy(g.position)
    .addScaledVector(_pjR, p.x + dx)
    .addScaledVector(_pjU, p.y + dy)
    .addScaledVector(_pjN, p.z);
  _sideLight.place(_slPos);
}

// Show/hide a wall together with its assigned (pooled) projector, so a hidden wall casts no
// light and a shown wall is immediately lit (the incoming wall swipes in already projected).
// The projector stays a scene child (constant light count); only its image/tint/intensity and
// world position change here — placement is refreshed every frame in _tick.
function _setWallVisible(wall, vis) {
  wall.group.visible = vis;
  const pj = _wallProjector(wall);
  if (vis) {
    pj.setImage(ORBIT_PROJECTS[wall.idx]?.coverImage || null);
    pj.transition(_atmoFor(wall.idx).glow, { duration: 0 });
    pj.setIntensity(pj.params.intensityIdle);
    _placeProjector(wall, wall === _activeWall);
  } else {
    pj.setIntensity(0);
  }
}

// Point the module-level "active" singletons at `wall` so the existing per-frame interactive
// code (reveal, flowmap, tilt, GUI) drives whichever wall the camera is currently facing.
function _activateWall(wall) {
  if (!wall) return;
  _activeWall = wall;
  currentIdx  = wall.idx;
  voxelMesh   = wall.mesh;
  cardGroup   = wall.group;
  _curPos     = wall.curPos;
  _scaleArr   = wall.scaleArr;
  _uvOffset   = wall.uvOffset;
  _vox        = wall.vox;
  _revealArr  = wall.revealArr;
  _revealAttr = wall.revealAttr;
  _bumpArr    = wall.bumpArr;
  _bumpAttr   = wall.bumpAttr;
  _N          = wall.N;
  _coverTex   = wall.coverTex;
  _wobble     = wall.wobble;
  _projector  = _wallProjector(wall); // cursor tracking (in _tick) drives the active wall's lamp
  _seatFogPlanes(wall); // world-anchored fog planes re-seat at the wall's ring slot
  _revealU = _cubeU = wall.cubeU;
  wall.cubeU.uTransScale.value = 1; // the centred wall is always full size
  // Reset interaction state so the new wall starts idle (no stale cursor pool carrying over).
  _hover = 0; _hoverTarget = 0; _cardProx = 0;
  // Only the active wall is visible+lit at rest — hide every neighbour (and kill its lamp) so
  // none peeks or casts stray light (a turn re-shows just the incoming wall; see navigate).
  for (const w of _pool.values()) _setWallVisible(w, w === wall);
}

// C2 cube material: unlit, maps the wall's cover via a per-cube UV window, with the
// cursor-reveal grade + living-depth field patched into the shader (per-wall uniform table).
function _makeCubeMaterial(wall) {
  const m = new THREE.MeshStandardMaterial({
    map: wall.coverTex, side: THREE.FrontSide,
    color: 0x808080,
    roughness: 1.0, metalness: 0.0, envMapIntensity: 0.75,
    transparent: true, depthWrite: false, depthTest: false, dithering: true,
    blending: THREE.NormalBlending,
  });
  _patchCube(m, wall);
  return m;
}

// Compose a wall's instance matrices from its current positions + per-instance scale.
function _writeMatrices(wall) {
  const mesh = wall.mesh;
  for (let i = 0; i < wall.N; i++) {
    _v3.set(wall.curPos[i * 3], wall.curPos[i * 3 + 1], wall.curPos[i * 3 + 2]);
    const s = wall.scaleArr[i];
    _sv.set(s, s, s);
    _m4.compose(_v3, _qI, _sv);
    mesh.setMatrixAt(i, _m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// Push the current per-instance colours (sRGB 0–1) into instanceColor.
// Project the cursor onto the card plane → card-local face coords, feed the shader.
function _updateReveal() {
  // Freeze the cursor lens during a turn: the active wall is swinging out of frame and the
  // arriving wall starts idle (reset in _activateWall), so no reveal work is meaningful.
  if (!cardGroup || !_revealU || isTransitioning) { _hover += (0 - _hover) * 0.08; return; }
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

  // Cursor proximity to the card rect (face ~4 × 2.48) with a soft margin — the projector
  // swells from idle to full as the cursor approaches, so the cover reads only at the core.
  {
    const dx = Math.max(Math.abs(_cursor.x) - 2.0, 0);
    const dy = Math.max(Math.abs(_cursor.y) - 1.24, 0);
    const d = Math.hypot(dx, dy) / 1.5;               // 1.5-unit falloff margin
    const t = 1 - Math.min(d, 1);
    _cardProx = t * t * (3 - 2 * t) * _hover;         // smoothstep × window presence
  }

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

// ── Project switching (Model 1: camera orbits the ring to the neighbour wall) ────

// Free a wall's GPU resources. The cover texture is cached in _texCache and reused, so it
// is NOT disposed here; the shared colRand/runRand JS arrays live on (each wall wrapped them
// in its own attribute, so this geometry.dispose() only frees this wall's buffers).
function _disposeWall(wall) {
  if (!wall) return;
  // Projectors are permanent scene children (never parented to wall groups), so nothing to
  // rescue here — just free this wall's geometry/material. (Called only on destroy.)
  scene.remove(wall.group);
  wall.mesh.geometry.dispose();
  wall.mesh.material.dispose();
}

// Move a cached wall to a ring slot (position, yaw, wobble origin). Cheap — no rebuild/recompile.
function _repositionWall(wall, slot) {
  wall.slotIndex = slot;
  wall.theta = slot * RING_STEP;
  _ringSlot(wall.theta, wall.group.position);
  wall.group.rotation.y = wall.theta;
  if (wall.wobble?.origin) wall.wobble.origin.copy(wall.group.position);
}

// Get the cached wall for a project (building + caching it once on first visit), placed at `slot`.
// Concurrent first-visit calls for the same project share one build via _building.
async function _getWall(idx, slot) {
  let wall = _wallCache.get(idx);
  if (!wall) {
    if (!_building.has(idx)) {
      _building.set(idx, _buildWall(idx, slot).then((w) => {
        _building.delete(idx);
        if (w) _wallCache.set(idx, w);
        return w;
      }));
    }
    wall = await _building.get(idx);
    if (!wall) return null;
  }
  _repositionWall(wall, slot);
  return wall;
}

// Keep the pool = the active slot and its two neighbours (all cached/repositioned, none disposed).
async function _ensureNeighbors() {
  if (!_activeWall) return;
  const S = _activeWall.slotIndex, P = _activeWall.idx, n = ORBIT_PROJECTS.length;
  const want = [
    { slot: S - 1, idx: (P - 1 + n) % n },
    { slot: S,     idx: P },
    { slot: S + 1, idx: (P + 1) % n },
  ];
  const walls = await Promise.all(want.map((x) => _getWall(x.idx, x.slot)));
  _pool.clear();
  want.forEach((x, i) => { if (walls[i]) _pool.set(x.slot, walls[i]); });
  // Only the active wall is visible at rest; every other cached wall (neighbours + off-window) hidden.
  for (const w of _wallCache.values()) _setWallVisible(w, w === _activeWall);
}

// Build the first wall at slot 0 and prefetch its neighbours (all cached for reuse).
async function _initPool() {
  const first = await _getWall(currentIdx, 0);
  if (!first) return;
  _pool.set(0, first);
  _activateWall(first); // attaches + lights this wall's pooled projector via _setWallVisible
  await _ensureNeighbors();

  // Warm each wall off-screen at load: neighbours sit a full RING_STEP to the side (out of frame),
  // so fully showing+lighting them for a few frames lets the composer compile their shader variant
  // AND uploads their projector cover textures now — instead of hitching mid-turn on first visit.
  // No visible flash (they're off-frame). Then restore to just the active wall visible.
  for (const w of _wallCache.values()) _setWallVisible(w, true);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
  for (const w of _wallCache.values()) _setWallVisible(w, w === _activeWall);
}

// Crossfade the world (fog + medium + lights + projector tint) to `idx` over `duration`.
function _retint(idx, duration) {
  const preset = LIGHTING_PRESETS[idx % LIGHTING_PRESETS.length];
  const toFog  = new THREE.Color(preset.fog);
  gsap.killTweensOf(scene.fog.color);
  gsap.to(scene.fog.color, {
    r: toFog.r, g: toFog.g, b: toFog.b, duration, ease: 'power2.inOut',
    onUpdate: () => renderer.setClearColor(scene.fog.color),
  });
  if (_floor) _floor.setColor(_accentFor(idx));
  _medium?.transition(_atmoFor(idx), { duration });
  _sideLight?.transition(_atmoFor(idx).glow, { duration });
  // (per-wall projectors carry their own palette tint from build — nothing to retint here)
}

const ORBIT_DURATION = 1.3; // seconds per project turn

// Orbit the camera one ring step in `dir` (+1 next / -1 prev) to the neighbouring wall.
function navigate(dir) {
  if (isTransitioning || !_activeWall) return;
  const targetSlot = _activeWall.slotIndex + dir;
  const targetWall = _pool.get(targetSlot);
  if (!targetWall) return; // neighbour not built yet — ignore
  isTransitioning = true;
  const newIdx = targetWall.idx;

  // Reveal + light the incoming wall from ITS OWN projector, so it swipes in already projected.
  // The outgoing (active) wall keeps its own lamp and swipes out still lit; _activateWall hides
  // it (and kills its lamp) on settle. World palette crossfades across the turn.
  _setWallVisible(targetWall, true);
  _seatFogPlanes(targetWall); // fog bank waits at the destination slot before the sweep starts
  _updateProjectUI(newIdx);

  const outWall = _activeWall;
  outWall.cubeU.uTransScale.value  = 1; // shrinks 1→0 across the turn
  targetWall.cubeU.uTransScale.value = 0; // grows 0→1 across the turn (start hidden-small)

  // Warm the wall that will become the new far neighbour DURING the turn: for a project already
  // visited this is a cheap reposition; for a first visit it builds+compiles off-screen mid-turn
  // (masked by motion) instead of hitching at settle. Fire-and-forget; _ensureNeighbors reconciles.
  const n = ORBIT_PROJECTS.length;
  _getWall((newIdx + dir + n) % n, targetSlot + dir);

  const settle = () => {
    _camAzimuth = targetSlot * RING_STEP;
    _activateWall(targetWall);                // interaction transfers to the arrived wall (scale→1)
    _ensureNeighbors().then(() => { isTransitioning = false; });
  };

  // Reduced motion: no camera sweep — snap the yaw and do a quick palette crossfade instead.
  if (prefersReduced) {
    _retint(newIdx, 0.4);
    _camAzimuth = targetSlot * RING_STEP;
    settle();
    return;
  }

  _retint(newIdx, ORBIT_DURATION);
  const orbit = { a: _camAzimuth };
  gsap.killTweensOf(orbit);
  const tween = gsap.to(orbit, {
    a: targetSlot * RING_STEP, duration: ORBIT_DURATION, ease: 'power2.inOut',
    onUpdate: () => {
      _camAzimuth = orbit.a;
      // Cube-size effect on the turn's LINEAR progress. Outgoing shrinks front-loaded ((1-p)²)
      // so it's mostly gone while still on screen; incoming grows back-loaded (p²) so it stays
      // near zero until it enters frame then assembles to full right as it centres.
      const p = tween.progress();
      const inv = 1 - p;
      outWall.cubeU.uTransScale.value    = inv * inv;
      targetWall.cubeU.uTransScale.value = p * p;
    },
    onComplete: settle,
  });
}

// Public API: jump to a project index by turning the short way around the ring (one step for
// adjacent projects; the index list is small so a single step reaches any neighbour).
export function setProject(idx) {
  if (isTransitioning || !_activeWall || idx === _activeWall.idx) return;
  if (idx < 0 || idx >= ORBIT_PROJECTS.length) return;
  const n = ORBIT_PROJECTS.length;
  const fwd = (idx - _activeWall.idx + n) % n;    // steps going next
  navigate(fwd <= n - fwd ? 1 : -1);
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
function _patchCube(material, wall) {
  // Per-wall uniform table, built synchronously so it's available before first compile
  // (the tick loop and _activateWall reference wall.cubeU immediately). Captured in the
  // onBeforeCompile closure and reused across recompiles so GUI bindings survive. Per-wall
  // fields: uTileScale/uUvOrigin (cover-fit), uCursor/uHover (interaction — only the active
  // wall's are driven; neighbours idle at uHover 0). Shared by reference: uFog (medium base),
  // uFlowmap, uHalfExtent (all walls share one geometry footprint).
  const cubeU = {
      uTileScale: { value: wall.uvScale },
      uUvOrigin:   { value: wall.uvOrigin }, // (offU,offV) cover-fit origin for live-position UV
      uDriftAmt:   { value: 0.0 },       // XY drift OFF — ref keeps every cube on the grid lattice
      uDriftSpeed: { value: 0.4 },       // drift wander speed
      uTransScale: { value: 1.0 },       // per-wall cube size 0→1 (transition shrink/grow; 1 = full)
      uCursor:    { value: new THREE.Vector2() },
      uHover:     { value: 0 },
      uRadius:    { value: REVEAL_RADIUS },
      uIdleFloor: { value: IDLE_FLOOR },
      uSatFar:    { value: 0.45 },
      uConFar:    { value: 0.8 },
      uBrightFar: { value: 0.4 },  // idle cubes sit dark against the fog; reveal lifts to full
      // Atmospheric tint adopts the medium's base color BY REFERENCE — the card breathes
      // with the palette on every project switch, zero tween code.
      uFog:       _medium ? _medium.u.uBase : { value: new THREE.Color(0x0a0e1a) },
      uFogAmt:    { value: 0.0 },  // atmo tint off (hand-tuned 2026-07-03 — cover colors stay pure)
      // D2 — motion / zones / pull
      uTime:       { value: 0 },
      uHalfExtent: { value: _halfExtent },
      // alien.js-style Gaussian ring ripple (replaces old sine-wave ripple)
      uRipplePeriod: { value: 8.7 },  // seconds per full ring expansion (two rings staggered)
      uRippleAmp:    { value: 0.74 }, // Z peak displacement at ring crest
      uDepthVisFar:   { value: 0.8 },                       // opacity of the deepest layer (near = 1.0)
      uKeepFrac:      { value: 0.83 },                      // keep fraction at the far edges (centre stays 100%)
      uDenseRadius:   { value: 0.1 },                       // NORMALIZED elliptical radius — dense core ends here
      uFadeRadius:    { value: 0.8 },                       // fully eroded by the face boundary (corner ≈ 1.41)
      uCullScale:     { value: 0.25 },                      // cull field frequency (smaller = bigger bites)
      uCullDrift:     { value: 0.036 },                     // gentle field drift — bites migrate slowly (hand-tuned 2026-07-03)
      uPullXY:     { value: 0.18 },
      uPullZ:      { value: 0.10 },
      uOuterFade:  { value: 0.55 },
      uEdgeLayer:  { value: 0.25 },   // front/back layers retain this (middle layers full)
      uHoleThresh: { value: 0.12 },
      uHoleDepth:  { value: 0.70 },
      // D3 — depth cloud + scale-based visibility (compact, dense middle core)
      uDepthScatter: { value: 1.0 },  // per-column Z spread at the edges → volumetric fringe (centre stays flat via _move)
      uDepthFunnel:  { value: 0.0 },  // centre tunnel off (ref: dense readable core)
      uHideScale:    { value: 0.0 },  // hidden cubes shrink to this (crisp cull)
      // idle opacity classes (keyed off per-cube hash aVox.y, uniform in [0,1])
      uTranspFrac:  { value: 0.06 },  uTranspAlpha: { value: 0.35 }, // "transparent" cubes
      uTransFrac:   { value: 0.10 },  uTransAlpha:  { value: 0.55 }, // translucent (a bit higher)
      uFrostFrac:   { value: 0.05 },  uFrostAlpha:  { value: 0.60 }, // frosted (rough + milky)
      uFrostRough:  { value: 0.5 },   // extra roughness added to frosted cubes
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
      uMouseFactor:    { value: 4.0 },  // flow speed → per-cube Z displacement
      uMouseLightness: { value: 4.0 },  // flow speed → brightness lift (ref tMouseSim hover-brighten)
      // static per-cube Perlin grain — spatially-coherent surface variation (brightness + roughness)
      uGrainScale: { value: 1.6 },   // noise frequency across the card face
      uGrainAmt:   { value: 0.16 },  // brightness variation (± fraction)
      uGrainRough: { value: 0.30 },  // roughness variation (± absolute)
  };
  wall.cubeU = cubeU;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cubeU);

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', /* glsl */`
        attribute vec2 aUvOffset; attribute vec3 aVox; attribute float aReveal; attribute float aColRand; attribute float aRunRand; attribute float aBump;
        uniform vec2 uTileScale; uniform vec2 uCursor; uniform vec2 uHalfExtent; uniform vec2 uUvOrigin;
        uniform float uHover; uniform float uRadius; uniform float uIdleFloor; uniform float uDriftAmt; uniform float uDriftSpeed;
        uniform float uTransScale;
        uniform float uTime; uniform float uRipplePeriod; uniform float uRippleAmp; uniform float uDepthVisFar; uniform float uKeepFrac; uniform float uDenseRadius; uniform float uFadeRadius;
        uniform float uCullScale; uniform float uCullDrift;
        uniform float uPullXY; uniform float uPullZ;
        uniform float uOuterFade; uniform float uEdgeLayer; uniform float uHoleThresh; uniform float uHoleDepth;
        uniform float uDepthScatter; uniform float uDepthFunnel; uniform float uHideScale;
        uniform float uTranspFrac; uniform float uTranspAlpha; uniform float uTransFrac; uniform float uTransAlpha;
        uniform float uFrostFrac; uniform float uFrostAlpha;
        uniform float uBumpAmp;
        uniform float uWarpRadius; uniform float uLensAmp; uniform float uWaveAmp; uniform float uWaveSpeed;
        uniform float uGrainScale;
        uniform sampler2D uFlowmap; uniform float uMouseFactor;
        varying float vReveal;
        varying float vAlpha;
        varying float vWarpPool;
        varying float vGrain;
        varying float vFrost;
        varying float vFlow;
        varying vec2 vFaceUv;
        float _gh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float _gn(vec2 p){ vec2 i = floor(p), f = fract(p); float a=_gh(i),b=_gh(i+vec2(1,0)),c=_gh(i+vec2(0,1)),d=_gh(i+vec2(1,1)); vec2 u=f*f*(3.0-2.0*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
        float _gf(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*_gn(p); p*=1.9; a*=0.5; } return v; }
        void main() {`)
      .replace('#include <uv_vertex>', /* glsl */`
        #include <uv_vertex>
        // vMapUv is a three built-in varying declared only under USE_MAP (i.e. when the cover
        // texture is present). Guard every write/read so the card still compiles + renders when
        // a cover is slow or fails to load — otherwise the whole material fails to link.
        #ifdef USE_MAP
        vMapUv = aUvOffset + uv * uTileScale;
        #endif`)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        // Transition scale — shrink each cube around its own centre (0 = gone, 1 = full). Applied
        // to the geometry vertex before displacements so the card dissolves into shrinking cubes.
        transformed *= uTransScale;
        vec3  _ctr = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float _r   = clamp(length(_ctr.xy / uHalfExtent), 0.0, 1.0); // 0 centre → ~1 edge
        float _lay = aVox.x;
        float _cr2 = fract(aColRand * 263.17 + 0.137);              // per-column 2nd random (decorrelated)
        float _cubeRand = fract(aVox.y * 157.31 + aVox.x * 3.7);    // per-cube random (breaks column coherence at edges)
        // cursor pool (D1 reveal)
        float _d    = distance(_ctr.xy, uCursor);
        float _pool = smoothstep(uRadius, 0.0, _d) * uHover;
        vReveal = clamp(uIdleFloor + (1.0 - uIdleFloor) * _pool, 0.0, 1.0);
        // radial distance in cube units (shared by the ripple below)
        float _cell      = (2.0 * uHalfExtent.x) / 40.0; // world size of one grid cell
        float _distCells = length(_ctr.xy) / _cell;
        // every cube carries the image at its depth-faded opacity (all 6 layers)
        float _depthVis = mix(uDepthVisFar, 1.0, _lay); // near 1.0 · mid ~0.75 · far uDepthVisFar
        // erosion band: normalized ELLIPTICAL radius (aspect-aware — top/bottom erode the
        // same as left/right; cell distance kept the 40-wide × 24-tall face solid vertically),
        // jittered per-run by a decorrelated hash → ragged organic bites + floating outlier
        // dashes instead of a smooth ring (ref silhouette has no straight edge anywhere)
        // ── Noise-field cull ── ONE low-frequency field over the face (fbm) instead of
        // independent per-run randoms: holes cluster into organic bites and survivors
        // form connected islands (ref), not confetti. _ctr.xy is identical for a cell's
        // 6 depth layers, so depth columns stay whole for free. uCullDrift > 0 migrates
        // the pattern over time (cubes fade in/out); ships at 0 = frozen.
        vec2  _cellUv = _ctr.xy / _cell;                       // grid-cell coordinates
        float _field  = _gf(_cellUv * uCullScale + uTime * uCullDrift * vec2(1.0, -0.65) + 3.7);
        float _erode  = smoothstep(uDenseRadius, uFadeRadius, _r);
        // cull threshold sinks with erosion: centre keeps everything, fringe keeps only
        // where the field runs low. Wide band → the drifting field FADES cubes in/out
        // (ref video: gaps migrate continuously, nothing pops).
        float _th   = mix(0.95, uKeepFrac * 0.5 + 0.12, _erode);
        float _cand = smoothstep(_th, _th + 0.1, _field);
        float _hidden = _cand * (1.0 - aReveal);
        // idle material classes by per-cube hash: transparent · translucent · frosted · normal.
        // Class fractions swell toward the edges (ref: centre almost all opaque, fringe is
        // mostly translucent ghosts / frosted milk) — same radial band as the cull.
        float _clsGain = mix(0.35, 3.2, _erode);
        float _opCls = 1.0; vFrost = 0.0;
        float _t1 = uTranspFrac * _clsGain, _t2 = _t1 + uTransFrac * _clsGain, _t3 = _t2 + uFrostFrac * _clsGain;
        if      (aVox.y < _t1) _opCls = uTranspAlpha;
        else if (aVox.y < _t2) _opCls = uTransAlpha;
        else if (aVox.y < _t3) { _opCls = uFrostAlpha; vFrost = 1.0; }
        // under the cursor pool, restore class cubes to normal (opaque, un-frosted)
        _opCls  = mix(_opCls, 1.0, _pool);
        vFrost *= (1.0 - _pool);
        // survivors near the cull threshold turn ghostly → soft translucent halos
        // around each bite instead of hard hole edges (restored under the cursor pool)
        _opCls *= mix(1.0, 0.5, smoothstep(_th - 0.16, _th, _field) * (1.0 - _pool));
        vAlpha = _depthVis * (1.0 - _hidden) * _opCls;
        // motion fades in by radius: still/flat dense centre, animated cloud toward edges.
        // (drift + scatter + ripple all multiply by _move, so this gates them together.)
        float _move = (1.0 - aReveal) * _erode;
        // gentle XY drift — whole column drifts together (per-column random) so it stays a
        // coherent stack instead of splitting into orphan cubes. Zero under the hover lens.
        vec2 _drift = vec2(sin(uTime * uDriftSpeed + aColRand * 6.2831),
                           cos(uTime * uDriftSpeed * 0.9 + _cr2 * 6.2831)) * uDriftAmt * _move;
        transformed.xy += _drift;
        // static Z scatter — follows the cull field (with light per-cube variation) so
        // surviving clusters recede together as blobs (ref). Cubes NEVER leave the XY lattice.
        float _scatterZ = mix(_field - 0.45, _cubeRand - 0.5, 0.25) * 2.0 * uDepthScatter - (1.0 - _r) * uDepthFunnel;
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
        vGrain = _gf(_ctr.xy * uGrainScale + 11.3);    // static per-cube Perlin grain (no uTime)
        // Flowmap (cursor velocity sim) → per-cube push toward camera + brightness signal.
        float _flowSpd = length(texture2D(uFlowmap, vFaceUv).rg);
        transformed.z += _flowSpd * uMouseFactor;
        vFlow = _flowSpd;
        // live-position UV: sample the cover under the cube's CURRENT location, continuously
        // (no grid quantization) so a drifting cube's fragment slides smoothly — no pop.
        // Resolves to the correct image when collapsed (drift = 0) → crisp on hover.
        #ifdef USE_MAP
        vec2 _facePos = _ctr.xy + _drift;
        vec2 _uv01    = clamp(_facePos / (2.0 * uHalfExtent) + 0.5, 0.0, 1.0);
        vec2 _win     = uUvOrigin + _uv01 * (uTileScale * vec2(40.0, 24.0)) - 0.5 * uTileScale;
        vMapUv = _win + uv * uTileScale;
        #endif`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (vGrain - 0.5) * uGrainRough + vFrost * uFrostRough, 0.04, 1.0);`)
      .replace('void main() {', /* glsl */`
        uniform float uSatFar; uniform float uConFar; uniform float uBrightFar;
        uniform vec3 uFog; uniform float uFogAmt;
        uniform float uTime; uniform float uHover;
        uniform sampler2D uFlowmap; uniform float uFlowStrength;
        uniform float uGrainAmt; uniform float uGrainRough; uniform float uFrostRough;
        uniform float uMouseLightness;
        varying float vReveal;
        varying float vAlpha;
        varying float vWarpPool;
        varying float vGrain;
        varying float vFrost;
        varying float vFlow;
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
        #ifdef USE_MAP
          // Flowmap: cursor velocity distorts the image UV so it "pours" on drag.
          // (vMapUv only exists under USE_MAP — keep the flow-UV read inside the guard.)
          vec2 _flowVel = texture2D(uFlowmap, vFaceUv).rg;
          vec2 _flowedUv = vMapUv + _flowVel * uFlowStrength * uHover;
          vec4 sampledDiffuseColor = texture2D(map, _flowedUv);
          #ifdef DECODE_VIDEO_TEXTURE
            sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
          #endif
          // Image-in-cube disabled for now — the projector spotlight carries the image instead.
          // diffuseColor *= sampledDiffuseColor;
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
        _c *= mix(1.0 - uGrainAmt, 1.0 + uGrainAmt, vGrain);  // static Perlin brightness grain
        _c *= 1.0 + clamp(vFlow, 0.0, 1.0) * uMouseLightness; // cursor-flow brightness lift
        _c = mix(_c, mix(_c, vec3(dot(_c, vec3(0.333)) + 0.12), 0.6), vFrost); // frosted: milky, desaturated
        diffuseColor.rgb = _c;                          // every cube shows its image fragment
        diffuseColor.a *= vAlpha;                      // glass faint/clearing, image layer solid`);
  };
  // Unique per wall: each wall material must compile its own program so its onBeforeCompile
  // runs and its per-wall uniform table is merged (a shared key would reuse one program and
  // skip the merge for later walls).
  material.customProgramCacheKey = () => 'voxel-cube-reveal-' + wall.uid;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  _gui?.destroy();
  _gui = null;
  _sky?.destroy();
  _sky = null;
  _floor?.destroy();
  _floor = null;
  _flowmap?.destroy();
  _flowmap = null;
  _fluid?.destroy();
  _fluid = null;
  _godRaySrc?.geometry.dispose();
  _godRaySrc?.material.dispose();
  _godRaySrc = null;
  _godRays = null;
  _tiltShift = null;
  _fluidFx = null;
  _wobble = null;
  _mistFront?.destroy();
  _mistFront = null;
  for (const w of _wallCache.values()) _disposeWall(w);
  _wallCache.clear();
  _projPool.forEach((p) => p.destroy());
  _projPool = [];
  _projector = null;
  _atmo?.destroy();
  _atmo = null;
  _veil?.destroy();
  _veil = null;
  _arc?.destroy();
  _arc = null;
  _medium?.destroy();
  _medium = null;
  _sideLight?.destroy();
  _sideLight = null;
  if (_ambient) { gsap.killTweensOf(_ambient.color); scene?.remove(_ambient); _ambient.dispose(); _ambient = null; }
  if (scene?.fog) gsap.killTweensOf(scene.fog.color);
  _pool.clear();
  _activeWall = null;
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
  renderer = composer = scene = camera = cardGroup = voxelMesh = _coverTex = _revealU = _cubeU = null;
}
