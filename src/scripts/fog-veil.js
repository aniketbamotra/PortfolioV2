// Foreground fog veil — soft haze composited OVER everything (backdrop, floor, voxel card),
// densest at the frame bottom and side edges. This is the depth layer the reference visibly
// has (fog in front of the card's lower edge): it seats the card in the atmosphere and, with
// the floor's distance fog, removes any trace of a ground/sky junction.
// All colors, the light kernel, wind and clocks come from the shared atmospheric medium BY
// REFERENCE — no transition() of its own; the nearest layer rides the wind fastest (×2.2)
// and samples its own domain offset so it never reads as a copy of the backdrop pattern.
// Note: the Reflector's mirror pass draws this too (clip-space) — the reflection gets fogged,
// which is desirable; hide the mesh inside the floor's onBeforeRender wrapper if ever not.
// Exports: initFogVeil({ medium, isMobile }) → { mesh, material, update(), destroy() }

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise-glsl.js';
import { LIGHT_KERNEL_GLSL } from './atmosphere-medium.js';

const VEIL_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }`;

const VEIL_FRAG = /* glsl */`
  uniform float uTime, uAspect;
  uniform vec2  uWind;
  uniform vec3  uBase, uFog;
  uniform float uGlowRadius, uGlowStretch;
  uniform vec2  uGlowPos;
  uniform float uVeilScale, uVeilSpeed;
  uniform float uBottomStart, uBottomMax, uEdgeWidth, uEdgeMax, uNoiseFloor, uLightResponse;
  varying vec2  vUv;

  ${NOISE_GLSL}
  ${LIGHT_KERNEL_GLSL}

  #ifdef MOBILE
    #define FBM fbm3
  #else
    #define FBM fbm4
  #endif

  void main(){
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);

    // Nearest layer → fastest apparent wind; own domain offset (17.3) so the pattern is a
    // different slice of the shared field, never a copy of the backdrop.
    vec2 pa = p + uWind * uTime * 2.2 + vec2(17.3);
    float t = uTime * uVeilSpeed;
    vec2 q = vec2(FBM(pa * uVeilScale + vec2(t, 0.0)),
                  FBM(pa * uVeilScale + vec2(3.7, 1.9) - t * 0.7));
    float n = FBM(pa * uVeilScale + 1.8 * q + vec2(t * 0.4, 0.0));
    n = smoothstep(0.15, 0.95, n);                      // creamy — never stringy

    float bottom = smoothstep(uBottomStart, 0.0, vUv.y) * uBottomMax;
    float edges  = (smoothstep(uEdgeWidth, 0.0, vUv.x)
                  + smoothstep(1.0 - uEdgeWidth, 1.0, vUv.x)) * uEdgeMax;
    float alpha  = clamp(bottom + edges, 0.0, 0.75) * mix(uNoiseFloor, 1.0, n);

    // Same shared light kernel — the veil brightens on the light side of the frame.
    float light = lightKernel(p, uGlowPos, uGlowRadius, uGlowStretch);
    vec3 col = mix(uBase * 0.6, uFog, light * uLightResponse);

    col += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) * (1.5 / 255.0);
    gl_FragColor = vec4(col, alpha);
  }`;

export function initFogVeil({ medium, isMobile = false } = {}) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    vertexShader: VEIL_VERT,
    fragmentShader: VEIL_FRAG,
    defines: isMobile ? { MOBILE: '' } : {},
    uniforms: {
      // adopted from the shared medium (by reference)
      uBase: medium.u.uBase,
      uFog:  medium.u.uFog,
      uGlowPos:     medium.u.uGlowPos,
      uGlowRadius:  medium.u.uGlowRadius,
      uGlowStretch: medium.u.uGlowStretch,
      uWind: medium.u.uWind,
      uTime: medium.u.uTime,
      // veil-specific — tuned 2026-07-03 (cinematic pass): bottom band OFF; the veil is
      // edge-only side curtains that catch the light hard (response 0.88), framing the card.
      uAspect:        { value: 16 / 9 },
      uVeilScale:     { value: 4.0 },
      uVeilSpeed:     { value: 0.059 },
      uBottomStart:   { value: 0.0 },
      uBottomMax:     { value: 0.0 },
      uEdgeWidth:     { value: 0.35 },
      uEdgeMax:       { value: 1.0 },
      uNoiseFloor:    { value: 0.25 },
      uLightResponse: { value: 0.88 },
    },
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20; // over the card (10), floor (-1), backdrop (-1000)

  return {
    mesh,
    material,
    update() { material.uniforms.uAspect.value = window.innerWidth / window.innerHeight; },
    destroy() { geometry.dispose(); material.dispose(); },
  };
}
