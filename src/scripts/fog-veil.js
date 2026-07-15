// Mid-ground fog bank — TWO real world-space planes behind the voxel wall (front bank +
// a broader rear bank ~1.2 further back). Unlike a full-screen veil, the card depth-tests
// in front of both: smoke remains bright through the broken silhouette while its front
// faces stay crisp. Two staggered layers stack alpha (the dome's curls can't read through
// the pair) and shear past each other with camera parallax, which one plane can't do.
// This is the light-catching volume between the dark reflector and the distant sky.

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise-glsl.js';
import { LIGHT_KERNEL_GLSL } from './atmosphere-medium.js';

const BANK_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const BANK_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec2 uWind;
  uniform vec3 uBase, uFog, uGlow;
  uniform vec2 uGlowPos;
  uniform float uGlowRadius, uGlowStretch, uGlowIntensity;
  uniform float uBankScale, uBankSpeed, uBankDensity, uBankLightGain;
  uniform float uBankFloor, uBankTop, uBankTopFeather;
  uniform float uBoil, uEdgeAmp, uEdgeScale, uEdgeSpeed;
  uniform float uBotFeather, uBotAmp;
  uniform vec2  uPExtent, uSeed;
  varying vec2 vUv;
  ${NOISE_GLSL}
  ${LIGHT_KERNEL_GLSL}
  #ifdef MOBILE
    #define FBM fbm3
  #else
    #define FBM fbm4
  #endif
  void main(){
    vec2 p = (vUv - 0.5) * uPExtent;
    float t = uTime * uBankSpeed;
    // Form clock — evolves the WARP offsets (not the sample position), so fog masses
    // morph/condense/dissolve in place instead of translating. Same anti-"sliding
    // texture" trick as the dome's ev clock.
    float ev = uTime * uBoil;
    vec2 flow = p + uWind * uTime * 1.6 + uSeed;
    vec2 warp = vec2(FBM(flow * uBankScale + vec2(t, ev)),
                     FBM(flow * uBankScale + vec2(4.6, 1.2) - t - vec2(0.0, ev * 0.7)));
    float density = FBM(flow * uBankScale + warp * 1.5 + vec2(t * 0.4, ev * 0.3));
    density = smoothstep(0.23, 0.93, density);
    // Thickness floor — low pockets of the field THIN the bank but never open a hole
    // (same trick as the ground mist's uMistFloor), so the wall of fog stays continuous.
    density = uBankFloor + (1.0 - uBankFloor) * density;
    float horizontal = smoothstep(0.0, 0.16, vUv.x) * smoothstep(0.0, 0.16, 1.0 - vUv.x);
    // Bottom feather is fixed; the TOP edge is authored: the bank dissolves into the sky
    // across uBankTopFeather ending at a LUMPY skyline — uBankTop is modulated per-column
    // by a noise crest whose second axis is TIME, so crests swell and sink in place
    // (forming, not blowing sideways). Kills the straight rectangle edge.
    float crest = FBM(vec2(p.x * uEdgeScale, uTime * uEdgeSpeed) + uSeed);
    float topEdge = uBankTop + (crest - 0.5) * uEdgeAmp;
    // Bottom edge gets the same treatment (own seed/phase): the fade depth varies per
    // column and breathes over time, so fog fingers reach down over the floor and the
    // floor contact never reads as a straight line.
    float bfield = FBM(vec2(p.x * uEdgeScale * 1.4, uTime * uEdgeSpeed * 0.7) + uSeed * 1.7 + 9.2);
    float botEnd = max(uBotFeather + (bfield - 0.5) * uBotAmp, 0.02);
    float vertical = smoothstep(0.0, botEnd, vUv.y)
                   * (1.0 - smoothstep(topEdge - uBankTopFeather, topEdge, vUv.y));
    vec2 lightP = vec2(p.x * 0.52, p.y);
    float light = lightKernel(lightP, uGlowPos, uGlowRadius, uGlowStretch);
    float alpha = density * horizontal * vertical * uBankDensity * mix(0.55, 1.0, light);
    vec3 col = mix(uBase * 0.65, uFog, 0.55 + light * 0.35);
    col += uGlow * light * uGlowIntensity * uBankLightGain;
    col += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) * (1.0 / 255.0);
    gl_FragColor = vec4(col, alpha);
  }`;

// Plane heights (world units). Both reach past the top of the frame at the seat, so each
// bank's visible height is controlled purely by its uBankTop shader fade, not geometry.
// The original authored plane was 18×3.7; geometry is translated UP so the bottom edge
// stays at that original line and _seatFogPlanes' y offset keeps working unchanged.
const FRONT_H = 6.0;
const REAR_H  = 8.0;
// p-per-world-unit of the ORIGINAL 18×3.7 ↔ ±(1.95, 0.5)-p mapping (slightly anisotropic,
// part of the tuned look) — keeps the noise character identical per world unit on any
// plane size.
const P_PER_WORLD_X = 3.9 / 18;
const P_PER_WORLD_Y = 1.0 / 3.7;

function makeBankGeometry(width, height) {
  const g = new THREE.PlaneGeometry(width, height);
  g.translate(0, (height - 3.7) / 2, 0);
  return g;
}

export function initFogVeil({ medium, isMobile = false } = {}) {
  // Shared medium uniforms are adopted BY REFERENCE per material; `owned` carries each
  // bank's private tuning (never call material.clone() — it deep-copies the shared refs).
  const makeMaterial = (owned) => new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, fog: false,
    vertexShader: BANK_VERT, fragmentShader: BANK_FRAG,
    defines: isMobile ? { MOBILE: '' } : {},
    uniforms: {
      uBase: medium.u.uBase, uFog: medium.u.uFog, uGlow: medium.u.uGlow,
      uGlowPos: medium.u.uGlowPos, uGlowRadius: medium.u.uGlowRadius,
      uGlowStretch: medium.u.uGlowStretch, uGlowIntensity: medium.u.uGlowIntensity,
      uWind: medium.u.uWind, uTime: medium.u.uTime,
      ...Object.fromEntries(Object.entries(owned).map(([k, v]) => [k, { value: v }])),
    },
  });

  // Front bank — retuned 2026-07-14 (boil pass): fast-forming fine field, thin floor —
  // the REAR bank now carries the occlusion, the front carries the visible churn.
  const material = makeMaterial({
    uBankScale: 4.0, uBankSpeed: 0.078,
    uBankDensity: isMobile ? 0.74 : 1.0, uBankLightGain: 0.86,
    uBankFloor: 0.19,       // min density — the bank thins but never breaks open
    uBankTop: 0.72,         // plane-uv where the bank's top edge fully dissolves
    uBankTopFeather: 0.17,  // width of that dissolve band
    uBoil: 0.15,            // form clock — fog condenses/dissolves in place
    uEdgeAmp: 0.19,         // skyline lumpiness (plane-uv) — 0 = straight edge
    uEdgeScale: 0.55,       // crest frequency along x — higher = more, smaller crests
    uEdgeSpeed: 0.255,      // how fast crests swell and sink
    uBotFeather: 0.22,      // bottom fade depth (plane-uv) — was a fixed 0.14
    uBotAmp: 0.18,          // bottom raggedness — fog fingers over the floor contact
    uPExtent: new THREE.Vector2(18 * P_PER_WORLD_X, FRONT_H * P_PER_WORLD_Y),
    uSeed: new THREE.Vector2(11.7, 3.1),
  });
  const frontGeo = makeBankGeometry(18, FRONT_H);

  // Rear bank — broader, dimmer masses ~1.2 behind the front bank. Its own seed decorrelates
  // the two fields; stacked alpha is what finally occludes the dome, and the slight depth
  // gap gives the pair real parallax shear during camera moves.
  const materialRear = makeMaterial({
    uBankScale: 2.4, uBankSpeed: 0.005,
    uBankDensity: isMobile ? 0.74 : 1.0, uBankLightGain: 0.6,
    uBankFloor: 0.39,
    uBankTop: 0.66,         // sits BELOW the front bank's edge — front crests read against sky
    uBankTopFeather: 0.26,
    uBoil: 0.089,           // rear masses form slower — deeper air feels heavier
    uEdgeAmp: 0.37,         // big lazy rear crests behind the front bank's faster ones
    uEdgeScale: 0.5,
    uEdgeSpeed: 0.135,
    uBotFeather: 0.18,      // rear plane is taller — same world-depth fade as the front
    uBotAmp: 0.14,
    uPExtent: new THREE.Vector2(26 * P_PER_WORLD_X, REAR_H * P_PER_WORLD_Y),
    uSeed: new THREE.Vector2(37.2, 17.9),
  });
  const rearGeo = makeBankGeometry(26, REAR_H);

  // FIVE seated bank groups — active wall ± 2 ring slots, assigned by slot mod 5 (the
  // projector pool's pattern). Five, not three, because the bank planes are wide enough
  // that the ±1 neighbours' edges are VISIBLE in-frame at rest: with a 3-pool, every
  // turn had to drop a visible seat (an on-screen pop). With ±2 coverage the seat that
  // gets recycled is 160° away — always off-screen — so turn-start re-seating is
  // invisible. All groups SHARE the two materials and geometries: one GUI/palette edit
  // drives every seat, the shader count stays at two, and each plane is 4 vertices so
  // the extra seats are free.
  const makeGroup = () => {
    const rear = new THREE.Mesh(rearGeo, materialRear);
    rear.position.z = -1.2;   // local: further from the camera than the front bank
    rear.renderOrder = -0.6;  // farther plane draws first for correct alpha stacking
    rear.frustumCulled = false;
    const front = new THREE.Mesh(frontGeo, material);
    front.renderOrder = -0.5; // after floor and rear bank, before the voxel wall
    front.frustumCulled = false;
    const g = new THREE.Group();
    g.add(rear, front);
    g.position.set(0, 0.12, -1.15); // behind its wall's face
    return g;
  };
  const meshes = Array.from({ length: 5 }, makeGroup);

  return {
    meshes,
    mesh: meshes[0], // the active-wall seat (kept for existing call sites)
    material, materialRear,
    update() {},
    destroy() {
      frontGeo.dispose(); rearGeo.dispose();
      material.dispose(); materialRear.dispose();
    },
  };
}
