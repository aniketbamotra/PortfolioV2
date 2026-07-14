// Layered atmosphere on a WORLD-SPACE sky dome (matches the reference's architecture:
// IcosahedronGeometry r=300 detail=10, BackSide, dome center sunk 12.65 units below the
// floor, rotated -72° about Y — constants lifted from the reference's Object3D dump in
// brainstron/ref-skyDome.ms). Because the dome is real geometry seen through the scene
// camera, sky and floor share one projection: camera motion moves them as one world, and
// the floor's Reflector mirrors the dome correctly with no flip hacks or parallax gains.
// The fragment builds a cloudscape from three noise layers in a 2D domain mapped from the
// dome's spherical UVs (uDomCenter/uDomScale convert UV → the same p-units all the tuned
// kernel/cloud values were authored in), advected by the SHARED wind and colored by an
// absorption/scattering assembly:
//   transmittance = exp(-density × absorb)   (Beer-Lambert through the fog mass)
//   backdrop  = base sky seen through the mass, energized ONLY by the light kernel
//   in-scatter = fog color × light × (1 − transmittance)
//   core       = hot near-white where dense fog meets the light
// Darkness away from the light falls out of the math — no mood multipliers.
// NOTE: unlike the reference (lit MeshStandardMaterial), this stays an UNLIT ShaderMaterial —
// we model the light explicitly via the shared kernel, and the dome does NOT spin (spinning
// the geometry would drag our UV-anchored light kernel with it; wind supplies the drift).
// All palette colors, the light kernel, wind and clocks come from the shared atmospheric
// medium (atmosphere-medium.js) BY REFERENCE — one medium.transition() recolors this layer
// together with the veil, floor fog, and card tint.
// Exports: initAtmosphere({ medium, isMobile }) →
//          { mesh, material, update(), setInk(uniform), destroy() }

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise-glsl.js';
import { LIGHT_KERNEL_GLSL } from './atmosphere-medium.js';

// Palette roles: base = near-black frame tone, fog/glow = neutral silvers (the light does
// the work), smoke = a warm rust that tints the dense cloud masses. Tuned live 2026-07-03;
// used before any project switch.
export const DEFAULT_ATMO = {
  base:  '#111111',
  fog:   '#f2ddc2', // scatter master — warm cream so lit fog never drifts grey-white
  glow:  '#e8913f', // mid station of the temperature ramp (smoke → glow → hot) — warm amber
  smoke: '#b25325',
};

const ATMO_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv; // the icosphere's spherical unwrap — the cloud domain lives in UV space
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const ATMO_FRAG = /* glsl */`
  uniform float uTime, uEnergy;
  uniform vec2  uMouse, uWind;
  uniform vec2  uDomCenter, uDomScale, uResolution;
  uniform vec3  uBase, uFog, uGlow, uSmoke, uAmbient;
  uniform float uL1Alpha, uL1Speed, uL1Scale;
  uniform float uL2Alpha, uL2Scale;
  uniform float uL3Alpha, uL3Speed, uL3Scale;
  uniform float uL1Mix2, uWarp, uDensityGamma, uAbsorb, uCoreGain, uAmbientAmt;
  uniform float uScatterGain, uHaloGain, uBackdropFloor;
  uniform float uEnergyGain, uInkFog;
  uniform float uCoreSize, uCoreBoost, uLidDensity, uLidStart;
  uniform vec3  uHotColor;
  uniform vec2  uPocketPos;
  uniform float uPocketRadius, uPocketStretch, uPocketIntensity;
  uniform float uSwirl, uSwirlScale, uSwirlSpeed;
  uniform float uGlowIntensity, uGlowEnergyGain, uGlowRadius, uGlowStretch, uGlowMouseShift;
  uniform vec2  uGlowPos;
  uniform float uViewShift;
  uniform sampler2D uInk;
  varying vec2  vUv;

  ${NOISE_GLSL}
  ${LIGHT_KERNEL_GLSL}

  // Seam-safe kernel: the dome's u wraps 0→1, so x-distance must wrap by the dome's
  // u-period in p-units (|uDomScale.x|). Makes the kernel continuous across the UV seam
  // and correct for ANY accumulated ring yaw (uViewShift can grow without bound).
  float wrapKernel(vec2 p, vec2 gp, float radius, float stretch, float period){
    vec2 gd = p - gp;
    gd.x -= period * floor(gd.x / period + 0.5); // nearest periodic image
    gd.y /= stretch;
    return exp(-dot(gd, gd) / (radius * radius));
  }

  #ifdef MOBILE
    #define FBM fbm3
  #else
    #define FBM fbm4
  #endif

  void main(){
    // Dome UV → p-space: the same units every kernel/cloud value was tuned in (at the rest
    // camera, the visible UV window maps to the old screen extents ±0.89 × ±0.5).
    vec2 p = (vUv - uDomCenter) * uDomScale;

    // ── Shared light kernel, two lobes (ref: sun-behind-fog column at the frame edge) ──
    // broad soft skirt carries illumination across most of the frame; a tight hot core
    // pins the yellow-white kernel at the edge. Same shared center/radius uniforms.
    // uViewShift compensates the kernel for camera azimuth (ring navigation yaws the camera
    // in place, panning the dome — and everything painted in p-space — across the frame):
    // the LIGHT follows the camera so every project keeps the tuned composition, while the
    // cloud domain below stays world-anchored and sweeps by naturally during a turn.
    vec2  view  = vec2(uViewShift, 0.0);
    vec2  gpos  = uGlowPos + view + uMouse * uGlowMouseShift;
    float uPeriod = abs(uDomScale.x); // one full dome revolution in p-units
    float skirt = wrapKernel(p, gpos, uGlowRadius, uGlowStretch, uPeriod);
    float core  = wrapKernel(p, gpos, uGlowRadius * uCoreSize, uGlowStretch * 0.8, uPeriod);
    // Backlight pocket — a stationary bright fog patch directly behind the card (ref: the
    // brightest mid-frame fog sits behind the voxel wall, so the card and its fringe cubes
    // silhouette against brightness instead of floating in darkness). Rides p-space, so it
    // shifts with camera parallax like something anchored in the world; view-compensated so
    // it stays behind whichever card the camera currently faces.
    float pocket = wrapKernel(p, uPocketPos + view, uPocketRadius, uPocketStretch, uPeriod);
    float light = skirt + core * uCoreBoost + pocket * uPocketIntensity;
    float lit   = light * (uGlowIntensity + uEnergy * uGlowEnergyGain);

    // Blackbody-style temperature ramp along light intensity — penumbra sits at the smoke
    // rust, mids at the glow color, the core bends toward hot near-white. ONE hue axis.
    float lt = clamp(light, 0.0, 1.0);
    vec3 lightTint = mix(uSmoke, uGlow, smoothstep(0.0, 0.55, lt));
    lightTint = mix(lightTint, uHotColor, smoothstep(0.45, 1.0, lt));

    // ── Density field: three layers riding the shared wind with depth parallax ──
    // (per-layer wind factors; small private speeds add internal churn; ev evolves the warp
    //  offsets so plumes change SHAPE, not just translate — the anti-"sliding texture" clock)
    // Local eddies (desktop): 2D curl noise — displace each point ALONG the contour lines
    // of a slow scalar field (velocity = rotated gradient, divergence-free), giving many
    // small closed circulation cells. Eddy size is set purely by uSwirlScale, independent
    // of screen position. (The old version rotated the whole domain about the p-space
    // ORIGIN — twist displacement grew with distance from screen centre, so single swirls
    // arced frame-high from the floor to the zenith and marbled the horizon/reflection.)
    // The light kernel reads the undisplaced p — only the weather swirls.
    #ifdef MOBILE
      vec2 pd = p;
    #else
      const float SW_EPS = 0.08; // gradient probe span (sp-units) — softens the finest curl
      vec2 sp = p * uSwirlScale - uTime * uSwirlSpeed;
      float sw0 = FBM(sp);
      vec2 curl = vec2(FBM(sp + vec2(0.0, SW_EPS)) - sw0,
                       sw0 - FBM(sp + vec2(SW_EPS, 0.0))) / SW_EPS;
      vec2 pd = p + curl * uSwirl;
    #endif
    float ev = uTime * 0.025;
    float t1 = uTime * uL1Speed * 0.5;
    vec2 pa1 = pd + uWind * uTime;
    vec2 q  = vec2(FBM(pa1 * uL1Scale + vec2(ev, t1)),
                   FBM(pa1 * uL1Scale + vec2(5.2, 1.3) - vec2(t1 * 0.6, ev)));
    float l1 = FBM(pa1 * uL1Scale + uWarp * q + vec2(t1 * 0.25, 0.0));
    l1 = smoothstep(0.25, 0.95, l1);   // soft carve — creamy masses, no stringy filaments

    // Layer 2 counter-drifts AGAINST the wind — layers crossing each other kills the
    // "one texture on a globe" read.
    vec2 pa2 = pd - uWind * uTime * 0.4;
    float l2 = FBM(pa2 * uL2Scale + uWarp * 1.6 * q + vec2(ev * 0.7, 0.0));
    l2 = smoothstep(0.20, 0.95, l2);

    #ifdef MOBILE
      float l3 = 0.0;
    #else
      vec2 pa3 = pd + uWind * uTime * 1.6;
      float t3 = uTime * uL3Speed * 0.5;
      float l3 = FBM(pa3 * uL3Scale + q * 0.8 + vec2(-t3, t3 * 0.6));
    #endif

    // Cursor-ink fog thickening is a SCREEN effect (fluid dye lives in screen space) —
    // sample by fragment position. Slightly off in the mirror pass (different RT size);
    // at uInkFog 0.09 that's invisible.
    float ink = texture2D(uInk, gl_FragCoord.xy / uResolution).b;
    // Ceiling lid — smoke pools overhead IN THE WORLD (p-space, anchored to the dome), so
    // the dark upper band comes from OCCLUSION of the lit medium, not absence of light,
    // and pans correctly with the camera. Modulated by layer 1 so the lid keeps plume
    // structure instead of a flat gradient. (p.y + 0.5 ≈ the old screen-y at rest camera.)
    float lid = smoothstep(uLidStart, 1.0, p.y + 0.5) * uLidDensity * (0.45 + 0.75 * l1);
    float d = l1 * uL1Alpha
            + l2 * uL2Alpha * mix(1.0, l1 * 2.0, uL1Mix2)
            + l3 * uL3Alpha * (0.6 + uEnergy * uEnergyGain)
            + ink * uInkFog
            + lid;
    d = pow(clamp(d, 0.0, 1.0), uDensityGamma);

    // ── Absorption / scattering assembly — darkness falls out of the math ──
    float transmit = exp(-d * uAbsorb);
    // base sky seen through the fog mass, energized by the light plus a lifted ambient bed
    // (ref: "dark" is dim rust, never black — the medium always glows a little). Dense smoke
    // occludes the ambient bed too — the ceiling lid must crush toward near-black maroon,
    // not sit at half the bed like thin air does.
    float bed = uBackdropFloor * (0.2 + 0.8 * transmit);
    vec3 backdrop = mix(uSmoke, uBase, transmit) * (bed + (1.0 - bed) * light);
    // light scattered toward the camera by the fog — hue rides the temperature ramp
    // (deep rust far from the light → hot amber near it), warmed by the ambient tint
    vec3 scatter = uFog * mix(uSmoke * 1.5, lightTint, smoothstep(0.1, 0.85, lt))
                 * mix(vec3(1.0), uAmbient * 2.0, uAmbientAmt)
                 * lit * (1.0 - transmit) * uScatterGain;
    // hot core where dense fog meets the light — bends toward the hot color, not pure white
    vec3 corec = mix(uHotColor, vec3(1.0), 0.3) * pow(d * lit, 1.5) * uCoreGain;

    vec3 col = backdrop + scatter + corec;
    col += lightTint * light * lit * 0.35 * transmit * uHaloGain; // direct halo through THIN air only

    // Banding kill on near-black gradients (temporal dither, ±0.75/255).
    col += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) * (1.5 / 255.0);
    gl_FragColor = vec4(col, 1.0);
  }`;

export function initAtmosphere({ medium, isMobile = false } = {}) {
  // Flat black placeholder so uInk is never null before the fluid dye is attached
  // (mirrors the sky-dome/floor pattern). Zero ink until setInk swaps in the live texture.
  const flatInk = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  flatInk.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fog: false,
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    defines: isMobile ? { MOBILE: '' } : {},
    uniforms: {
      // ── adopted from the shared medium (by reference — never reassign the objects) ──
      uBase:  medium.u.uBase,
      uFog:   medium.u.uFog,
      uGlow:  medium.u.uGlow,
      uSmoke: medium.u.uSmoke,
      uGlowPos:       medium.u.uGlowPos,
      uGlowRadius:    medium.u.uGlowRadius,
      uGlowStretch:   medium.u.uGlowStretch,
      uGlowIntensity: medium.u.uGlowIntensity,
      uWind:   medium.u.uWind,
      uTime:   medium.u.uTime,
      uEnergy: medium.u.uEnergy,
      uMouse:  medium.u.uMouse,
      // ── layer-specific (owned) ──
      // Dome UV → p-space mapping. At fov 55° / aspect 16:9 the rest camera sees ~86° of
      // azimuth (0.24 of u) and ~55° of inclination (0.31 of v); scale converts that
      // window to the old screen extents (±0.89 × ±0.5) so all tuned values carry over.
      // Center = the UV the rest camera looks at, derived from the dome transform
      // (sunk -12.65, rotated -72°) and three's polyhedron UV convention (u = azimuth of
      // (z,-x), v = inclination of -y) — both axes run OPPOSITE to screen, hence negative
      // scales. Retunable in GUI.
      uDomCenter:  { value: new THREE.Vector2(0.415, 0.465) },
      uDomScale:   { value: new THREE.Vector2(-6.4, -4.0) },
      uResolution: { value: new THREE.Vector2(1920, 1080) },
      uAmbient:  { value: new THREE.Color(0xa79d99) }, // warm-neutral lit-fog tint
      // cloud layers (à la the reference's uShader1/2/3 {alpha,speed,scale}) — retuned
      // 2026-07-14 (curl-eddy pass: L3 detail now carries the body, L1 plumes accent)
      uL1Alpha: { value: 0.13 }, uL1Speed: { value: 0.033 }, uL1Scale: { value: 1.27 },
      uL2Alpha: { value: 0.66 }, uL2Scale: { value: 2.75 },
      uL3Alpha: { value: 1.46 }, uL3Speed: { value: 0.155 }, uL3Scale: { value: 4.3 },
      uL1Mix2:       { value: 1.0 },   // how much layer 1 gates layer 2
      uWarp:         { value: 0.1 },   // domain-warp strength (lower = creamier)
      uDensityGamma: { value: 0.9 },   // tonal carve of the summed density
      uAbsorb:       { value: 3.8 },   // denser air preserves shadow detail and separation
      uCoreGain:     { value: 1.8 },
      uAmbientAmt:   { value: 0.2 },
      uScatterGain:   { value: 0.38 }, // bright environment supplies the broad illumination
      uHaloGain:      { value: 1.21 },
      uBackdropFloor: { value: 0.17 },
      // two-lobe kernel + temperature ramp (ref: hot yellow-white column at the frame edge)
      uCoreSize:   { value: 0.42 },    // hot-core radius as a fraction of the skirt radius
      uCoreBoost:  { value: 2.4 },     // a pin of warmth, not a blown-out sun
      uHotColor:   { value: new THREE.Color(0xe7d7c5) }, // desaturated warm core
      // ceiling smoke lid — occludes the lit medium at the top of the frame
      uLidDensity: { value: 0.26 },
      uLidStart:   { value: 0.35 },    // screen-y where the lid begins to gather
      // backlight pocket — subtle bright fog patch behind the card, biased to the card's
      // dark (left) side so the fringe silhouettes without flattening the projector story
      uPocketPos:       { value: new THREE.Vector2(-0.27, 0.08) },
      uPocketRadius:    { value: 0.81 },
      uPocketStretch:   { value: 0.65 }, // wider than tall — matches the card's footprint
      uPocketIntensity: { value: 0.46 },
      // curl-noise eddies — local circulation of the cloud field (desktop only)
      uSwirl:      { value: 0.135 }, // displacement amplitude (p-units) along the curl
      uSwirlScale: { value: 1.6 },   // eddy frequency — HIGHER = smaller swirl circles
      uSwirlSpeed: { value: 0.015 }, // how fast the eddy pattern itself drifts/breathes
      uEnergyGain:   { value: 0.7 },   // cursor energy → layer-3 detail boost
      uInkFog:       { value: 0.09 },  // fluid-dye trail → local fog thickening
      uGlowEnergyGain: { value: 0.0 },
      uGlowMouseShift: { value: 0.03 },
      uViewShift:      { value: 0.0 }, // camera-azimuth compensation (p-units) — see setViewYaw

      uInk: { value: flatInk }, // fluid dye — swapped in via setInk
    },
  });

  // Reference dome constants (brainstron/ref-skyDome.ms): icosphere r=300 detail=10,
  // BackSide (we render the inside), center sunk 12.65 below the floor so the horizon
  // ring falls below eye level, rotated -72° about Y (art-directed UV seam placement —
  // keeps the unwrap seam behind the visible window).
  const geometry = new THREE.IcosahedronGeometry(300, 10);
  material.side = THREE.BackSide;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -12.65;
  mesh.rotation.y = -Math.PI * 0.4;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000; // draw first — everything else paints over it
  // Real world geometry: the floor's Reflector mirrors it with correct perspective — no
  // flip hacks, no parallax gains. Camera motion moves sky and floor as one world.

  const u = material.uniforms;

  return {
    mesh,
    material,

    // Time/energy/mouse/colors arrive via the shared medium — only view-local state here.
    update() {
      u.uResolution.value.set(window.innerWidth * devicePixelRatio, window.innerHeight * devicePixelRatio);
    },

    setInk(uniform) { material.uniforms.uInk = uniform; }, // adopt the live { value } dye object

    // Keep the light kernel (and pocket) framed at the camera's current ring azimuth.
    // Yawing by θ pans the dome's viewed UV window by θ/2π of u (three's polyhedron
    // azimuth convention); × uDomScale.x converts that to p-units, giving the offset the
    // kernel centers need so the composition stays put on screen. Called every frame.
    setViewYaw(azimuth) {
      u.uViewShift.value = (azimuth / (Math.PI * 2)) * u.uDomScale.value.x;
    },

    destroy() {
      geometry.dispose();
      material.dispose();
      flatInk.dispose();
    },
  };
}
