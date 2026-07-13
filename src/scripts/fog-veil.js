// Mid-ground fog bank — a real world-space layer positioned behind the voxel wall. Unlike a
// full-screen veil, the card depth-tests in front of it: smoke remains bright through the
// broken silhouette while its front faces stay crisp. This is the light-catching volume between
// the dark reflector and the distant sky.

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
  varying vec2 vUv;
  ${NOISE_GLSL}
  ${LIGHT_KERNEL_GLSL}
  #ifdef MOBILE
    #define FBM fbm3
  #else
    #define FBM fbm4
  #endif
  void main(){
    vec2 p = (vUv - 0.5) * vec2(3.9, 1.0);
    float t = uTime * uBankSpeed;
    vec2 flow = p + uWind * uTime * 1.6 + vec2(11.7, 3.1);
    vec2 warp = vec2(FBM(flow * uBankScale + vec2(t, 0.0)), FBM(flow * uBankScale + vec2(4.6, 1.2) - t));
    float density = FBM(flow * uBankScale + warp * 1.5 + vec2(t * 0.4, 0.0));
    density = smoothstep(0.23, 0.93, density);
    float horizontal = smoothstep(0.0, 0.16, vUv.x) * smoothstep(0.0, 0.16, 1.0 - vUv.x);
    float vertical = smoothstep(0.0, 0.22, vUv.y) * smoothstep(0.0, 0.22, 1.0 - vUv.y);
    vec2 lightP = vec2(p.x * 0.52, p.y);
    float light = lightKernel(lightP, uGlowPos, uGlowRadius, uGlowStretch);
    float alpha = density * horizontal * vertical * uBankDensity * mix(0.55, 1.0, light);
    vec3 col = mix(uBase * 0.65, uFog, 0.55 + light * 0.35);
    col += uGlow * light * uGlowIntensity * uBankLightGain;
    col += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) * (1.0 / 255.0);
    gl_FragColor = vec4(col, alpha);
  }`;

export function initFogVeil({ medium, isMobile = false } = {}) {
  const material = new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, fog: false,
    vertexShader: BANK_VERT, fragmentShader: BANK_FRAG,
    defines: isMobile ? { MOBILE: '' } : {},
    uniforms: {
      uBase: medium.u.uBase, uFog: medium.u.uFog, uGlow: medium.u.uGlow,
      uGlowPos: medium.u.uGlowPos, uGlowRadius: medium.u.uGlowRadius,
      uGlowStretch: medium.u.uGlowStretch, uGlowIntensity: medium.u.uGlowIntensity,
      uWind: medium.u.uWind, uTime: medium.u.uTime,
      uBankScale: { value: 1.55 }, uBankSpeed: { value: 0.045 },
      uBankDensity: { value: isMobile ? 0.34 : 0.46 }, uBankLightGain: { value: 0.36 },
    },
  });
  const geometry = new THREE.PlaneGeometry(18, 3.7);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0.12, -1.15); // behind the active wall at z=0
  mesh.renderOrder = -0.5; // after floor, before the voxel wall
  mesh.frustumCulled = false;
  return { mesh, material, update() {}, destroy() { geometry.dispose(); material.dispose(); } };
}
