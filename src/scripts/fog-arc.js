// Foreground fog arc — the "proscenium horseshoe": ONE oversized plane between the camera
// and the card. Fog rises from the bottom corners, runs up the flanks (where it visually
// fuses with the mid-ground bank behind the card and OCCLUDES the bank/floor seam), and
// clears over an aggressively noise-eroded elliptical window so the card and its floor
// reflection stay unobscured. The window edge boils — its erosion field has time as an
// axis — so there is never a traceable curve, only fog that happens to thin there.
//
// DELIBERATE exception to "fog planes are world objects seated per wall" (invariant #5):
// this layer is lens-side stage fog. It follows the camera's ring AZIMUTH (placed each
// frame by three-scene at a fixed forward distance from CAM_PIVOT), so it never jumps or
// vanishes at a project turn — the world sweeps behind it. It escapes the "screen-glued
// fog reads dead" trap because mouse parallax still moves the camera relative to it, and
// the boil clock keeps the fog itself forming/dissolving.
//
// Exports: initFogArc({ medium, isMobile }) → { mesh, material, update(), destroy() }
//          ARC_DIST / ARC_Y — forward/vertical offsets, consumed by three-scene's placer.

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise-glsl.js';
import { LIGHT_KERNEL_GLSL } from './atmosphere-medium.js';

// Forward distance from the camera seat and vertical drop of the plane centre. At 2.5
// units a 16:9 frame spans ±2.31 × ±1.30 — the 9×3.6 plane oversizes that to survive
// ultrawide monitors (≈32:9) and mouse parallax without exposing its own edges.
export const ARC_DIST = 2.5;
export const ARC_Y = -0.55;
const PLANE_W = 9;
const PLANE_H = 3.6;

const ARC_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const ARC_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec2 uWind;
  uniform vec3 uBase, uFog, uGlow;
  uniform vec2 uGlowPos;
  uniform float uGlowRadius, uGlowStretch, uGlowIntensity;
  uniform float uArcDensity, uArcFloor, uArcScale, uArcSpeed, uBoil, uLightGain;
  uniform vec2  uWinPos, uWinRadii;
  uniform float uWinFeather, uBreakAmp, uBreakScale, uBreakSpeed, uTopOpen;
  uniform float uTopStart, uTopFeather, uTopLump;
  uniform vec2  uPlaneSize;
  varying vec2 vUv;
  ${NOISE_GLSL}
  ${LIGHT_KERNEL_GLSL}
  #ifdef MOBILE
    #define FBM fbm3
  #else
    #define FBM fbm4
  #endif
  void main(){
    vec2 local = (vUv - 0.5) * uPlaneSize; // plane-local world units, origin at plane centre

    // Clear window over the card + its reflection. The edge is eroded by a POSITION-space
    // noise field with time as its own axis (no angular seam, no static coastline): the
    // effective window radius breathes per-direction, so the boundary reads as weather,
    // not as a cut ellipse. uBreakAmp is deliberately large — this erosion is the whole
    // reason the window doesn't become a new traceable line.
    vec2 wd = (local - uWinPos) / uWinRadii;
    // The window OPENS upward: above its centre the y-distance is squashed, so the clear
    // zone extends toward the sky and fog can never arch OVER the card (a closed ellipse
    // read as a reversed horseshoe — lit fog over the top, invisible fog on the dark
    // floor). Fog survives only below and beside the window: a true ∪.
    wd.y *= mix(1.0, uTopOpen, step(0.0, wd.y));
    float d = length(wd);
    float br = (FBM(local * uBreakScale + vec2(0.0, uTime * uBreakSpeed)) - 0.5) * uBreakAmp;
    float win = smoothstep(1.0 + br, 1.0 + br + uWinFeather, d);

    // The arc lives in the lower frame: fade out above uTopStart along a lumpy, breathing
    // skyline (same treatment as the bank tops) so the arms melt into the mid-ground fog.
    float tl = (FBM(vec2(local.x * 0.55, uTime * 0.045) + 3.3) - 0.5) * uTopLump;
    float topFade = 1.0 - smoothstep(uTopStart + tl, uTopStart + tl + uTopFeather, local.y);

    // Feather the oversized plane's own rect so it can never print an edge on screen.
    float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(0.0, 0.06, 1.0 - vUv.x)
               * smoothstep(0.0, 0.1, vUv.y);

    // Perf: the window over the card and the sky above the arms have mask EXACTLY 0 —
    // skip the 3 body-FBM calls there (that clear zone is most of the frame's centre).
    // Output is bit-identical to computing density and multiplying by 0.
    float mask = win * topFade * edge;
    if (mask <= 0.0) { discard; }

    // Body density — bank-family field: domain warp advected by the shared wind, morphed
    // in place by the boil clock (shapes condense/dissolve rather than translate).
    float t = uTime * uArcSpeed;
    float ev = uTime * uBoil;
    vec2 flow = local + uWind * uTime * 2.2 + vec2(23.1, 7.4);
    vec2 warp = vec2(FBM(flow * uArcScale + vec2(t, ev)),
                     FBM(flow * uArcScale + vec2(4.6, 1.2) - t - vec2(0.0, ev * 0.7)));
    float density = FBM(flow * uArcScale + warp * 1.5 + vec2(t * 0.4, ev * 0.3));
    density = smoothstep(0.2, 0.9, density);
    // Thickness floor — the horseshoe arms thin but never open a hole.
    density = uArcFloor + (1.0 - uArcFloor) * density;

    float alpha = density * mask * uArcDensity;

    // Same lighting assembly as the banks — shared kernel, shared palette — so the arc
    // and the bank read as one continuous fog mass where they overlap at the flanks.
    vec2 lightP = vec2(local.x * 0.5, local.y);
    float light = lightKernel(lightP, uGlowPos, uGlowRadius, uGlowStretch);
    float alphaL = alpha * mix(0.6, 1.0, light);
    vec3 col = mix(uBase * 0.65, uFog, 0.55 + light * 0.35);
    col += uGlow * light * uGlowIntensity * uLightGain;
    col += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) * (1.0 / 255.0);
    gl_FragColor = vec4(col, alphaL);
  }`;

export function initFogArc({ medium, isMobile = false } = {}) {
  const material = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, fog: false,
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG,
    defines: isMobile ? { MOBILE: '' } : {},
    uniforms: {
      // shared medium — adopted by reference (never reassign these objects)
      uBase: medium.u.uBase, uFog: medium.u.uFog, uGlow: medium.u.uGlow,
      uGlowPos: medium.u.uGlowPos, uGlowRadius: medium.u.uGlowRadius,
      uGlowStretch: medium.u.uGlowStretch, uGlowIntensity: medium.u.uGlowIntensity,
      uWind: medium.u.uWind, uTime: medium.u.uTime,
      // owned
      uArcDensity: { value: isMobile ? 0.65 : 0.85 },
      uArcFloor:   { value: 0.35 },  // min density in the arms — solid horseshoe, no holes
      uArcScale:   { value: 0.5 },   // field frequency (plane-local world units)
      uArcSpeed:   { value: 0.05 },
      uBoil:       { value: 0.219 }, // forming motion — the arc's primary life (tuned 2026-07-14)
      uLightGain:  { value: 0.5 },
      // clear window (plane-local units; plane centre sits ARC_Y below eye level, so the
      // card centre — world y 0 — is at local y ≈ +0.55). Tuned 2026-07-14: window raised
      // high + narrow (its lower lobe clears the card/reflection; the open top does the
      // rest), arms held low by the negative top start.
      uWinPos:     { value: new THREE.Vector2(0.08, 1.27) },
      uWinRadii:   { value: new THREE.Vector2(1.3, 1.87) },
      uWinFeather: { value: 0.56 },
      uTopOpen:    { value: 0.25 },  // upward window squash: 0 = fully open sky, 1 = closed ellipse
      uBreakAmp:   { value: 0.55 },  // aggressive edge erosion — the load-bearing knob
      uBreakScale: { value: 0.9 },
      uBreakSpeed: { value: 0.04 },
      // upper skyline of the horseshoe arms — negative start keeps the arms below the
      // card's midline; the lumpy feather carries them into the bank
      uTopStart:   { value: -0.1 },
      uTopFeather: { value: 0.7 },
      uTopLump:    { value: 0.5 },
      uPlaneSize:  { value: new THREE.Vector2(PLANE_W, PLANE_H) },
    },
  });

  const geometry = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
  const mesh = new THREE.Mesh(geometry, material);
  // The card's InstancedMesh renders at order 10 with depth testing off — layering here is
  // pure render order, so the arc (in FRONT of the card) must draw after it.
  mesh.renderOrder = 20;
  mesh.frustumCulled = false;

  return {
    mesh, material,
    update() {},
    destroy() { geometry.dispose(); material.dispose(); },
  };
}
