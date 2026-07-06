// Reflective floor below the voxel card — a circular mirror built on three's Reflector
// (real per-frame mirror render: it re-renders the scene from a mirrored camera into a
// render target, with an oblique clip plane at the floor). Shader follows the reference
// (rogierdeboeve.com, extracted in brainstron/reference_vals.md): a dark-gray planar mirror
// whose reflection is distorted by ONE static soft normal map and boosted ×uFloorMixStrength.
// All visible floor motion comes from the reflected animated atmosphere — the surface itself
// is still. Reads as dark misty terrain, not liquid metal.
// Exports: initReflectiveFloor({ scene, accent, renderer }) → { mesh, update(time), setColor(hex), destroy() }

import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { NOISE_GLSL } from './shaders/noise-glsl.js';

const FLOOR_VERT = /* glsl */`
  uniform mat4 textureMatrix;
  varying vec4 vUv;
  varying vec2 vLocal;
  varying vec2 vMeshUv;
  varying vec3 vWorld;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){
    vUv     = textureMatrix * vec4(position, 1.0);
    vLocal  = position.xy;                      // circle lies in local XY (before -PI/2 tilt)
    vMeshUv = uv;                               // static normal-map lookup (one map across the disc)
    vWorld  = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const FLOOR_FRAG = /* glsl */`
  uniform vec3      color;
  uniform sampler2D tDiffuse;
  uniform sampler2D tNormalMap;
  uniform sampler2D uInk;
  uniform float     uReflectivity, uMirror, uFloorMixStrength, uDist, uRadius, uInkWarp;
  uniform vec2      uNormalScale;
  uniform vec3      uBase;                 // shared medium base — the sky the ground dissolves into
  uniform vec3      uGlowCol;              // shared medium glow — the warm wash the light throws
  uniform vec2      uWind;                 // shared medium wind
  uniform float     uTime;                 // shared medium clock
  uniform float     uFogNear, uFogFar;     // distance-fog band (world units from camera)
  uniform float     uWashGain;             // glow-side ground wash strength
  uniform float     uContactDark;          // darkening under the card mass
  uniform vec3      uFogCol;               // shared medium fog — the mist banks' color
  uniform float     uWaveAmp, uWaveScale, uWaveSpeed;   // live micro-waves on the mirror
  uniform float     uMistAmt, uMistInner, uMistOuter;   // ground mist flanking the card
  uniform float     uMistFloor, uMistLeftBoost;         // min density / dark-side equalizer
  varying vec4 vUv;
  varying vec2 vLocal;
  varying vec2 vMeshUv;
  varying vec3 vWorld;
  #include <logdepthbuf_pars_fragment>

  ${NOISE_GLSL}

  void main(){
    #include <logdepthbuf_fragment>

    // Living water normal: TWO copies of the normal map scroll in different directions
    // and blend — the classic water trick. The surface's own shading (fresnel), the
    // reflection distortion, and the visible grain all undulate together. uWaveSpeed
    // drives the scroll; uWaveAmp cross-fades static terrain → moving water.
    vec2 nuv = vMeshUv * uNormalScale;
    vec4 ncs = texture2D(tNormalMap, nuv);
    vec4 nc1 = texture2D(tNormalMap, nuv + vec2(0.045, 0.032) * uTime * uWaveSpeed);
    vec4 nc2 = texture2D(tNormalMap, nuv * 0.72 - vec2(0.038, -0.027) * uTime * uWaveSpeed + 0.37);
    float waveMix = clamp(uWaveAmp * 40.0, 0.0, 1.0);
    // Blending two maps averages out relief — re-expand around the neutral normal so the
    // moving water keeps the same wave height as the still terrain.
    vec4 ncm = (nc1 + nc2) * 0.5;
    ncm = (ncm - vec4(0.5, 0.5, 0.0, 0.5)) * 1.6 + vec4(0.5, 0.5, 0.0, 0.5);
    vec4 nc = mix(ncs, ncm, waveMix);
    vec3 normal = normalize(vec3(nc.r * uDist - uDist * 0.5, nc.b, nc.g * uDist - uDist * 0.5));
    vec3 coord = vUv.xyz / vUv.w;

    // Cursor-painted fluid ink nudges the reflection — lookup drifts with the shared wind
    // so even the ground ripples ride the same weather.
    vec2 ink = texture2D(uInk, coord.xy + uWind * uTime * 0.3).rg;
    // Live micro-waves — a slow scrolling noise nudge on the reflection lookup so the
    // mirror reads as a faintly breathing surface instead of polished stone.
    vec2 wave = vec2(noise(vWorld.xz * uWaveScale + vec2(uTime * uWaveSpeed, 0.0)),
                     noise(vWorld.xz * uWaveScale + vec2(7.3, 2.1) - uTime * uWaveSpeed * 0.7)) - 0.5;
    vec2 ruv = coord.xy + coord.z * normal.xz * 0.05 + ink * uInkWarp + wave * uWaveAmp;
    vec4 reflectColor = texture2D(tDiffuse, ruv);

    // Fresnel reflectance.
    vec3 toEye = normalize(cameraPosition - vWorld);
    float theta = max(dot(toEye, normal), 0.0);
    float reflectance = max(0.01, min(uReflectivity + (1.0 - uReflectivity) * pow(1.0 - theta, 5.0), 1.0));
    reflectColor = mix(vec4(0.0), reflectColor, reflectance);

    // Dark base × boosted reflection — hue and motion come from the reflected atmosphere.
    vec3 col = color * ((1.0 - min(1.0, uMirror)) + reflectColor.rgb * uFloorMixStrength);

    // Glow-side ground wash (ref: the dirt plane catches the light column's gradient —
    // bright toward the light, falling off across the floor). Noise-modulated by the
    // shared field so the wash breathes with the same weather as the sky.
    float ws = noise(vWorld.xz * 0.1 - uWind * uTime * 3.0);
    float wash = smoothstep(-4.0, 20.0, vWorld.x) * mix(0.7, 1.3, ws);
    col += uGlowCol * wash * uWashGain;

    // Contact shadow — the card mass (at the origin) shades the ground beneath it,
    // seating the card on the floor instead of letting it float over a lit plane.
    float contact = exp(-dot(vWorld.xz * vec2(0.30, 0.55), vWorld.xz * vec2(0.30, 0.55)));
    col *= 1.0 - uContactDark * contact;

    // Participate in the medium: far ground converges to the medium's base color (the actual
    // horizon kill — ground and sky meet at the same value). Fog density churns with a
    // 1-octave sample of the shared field so the ground haze shares the sky's weather.
    float dist = length(vWorld - cameraPosition);
    float fs = noise(vWorld.xz * 0.15 + uWind * uTime * 5.0);
    float fogF = smoothstep(uFogNear, uFogFar, dist);
    fogF = clamp(fogF * mix(0.7, 1.3, fs), 0.0, 1.0);
    col = mix(col, uBase * 0.5, fogF);

    // Rolling ground mist flanking the card (the flanks read empty otherwise) — bands
    // left+right of the card mass, colored by the medium's fog so it belongs to the same
    // weather as the sky. The noise BOILS in place (own slow clock, decoupled from wind
    // advection) and rides on a minimum-density floor, so a bank thins but never vanishes
    // when a low pocket of the field passes through. Left bank gets a small gain — equal
    // density reads dimmer on the frame's dark side.
    float mx = abs(vWorld.x);
    float bankX = smoothstep(uMistInner, uMistInner + 1.5, mx)
                * (1.0 - smoothstep(uMistOuter, uMistOuter + 5.0, mx));
    float bankZ = 1.0 - smoothstep(4.0, 10.0, abs(vWorld.z - 2.0));
    float mn = noise(vWorld.xz * 0.28 + vec2(uTime * 0.03, -uTime * 0.02));
    float side = mix(uMistLeftBoost, 1.0, step(0.0, vWorld.x));
    float mist = bankX * bankZ * (uMistFloor + (1.0 - uMistFloor) * smoothstep(0.35, 0.85, mn))
               * uMistAmt * side;
    col = mix(col, uFogCol * 0.22, clamp(mist, 0.0, 1.0));

    float r = length(vLocal) / uRadius;                   // 0 centre → 1 edge
    float alpha = 1.0 - smoothstep(0.5, 0.95, r);         // trim the disc edge (color does the rest)

    gl_FragColor = vec4(col, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function initReflectiveFloor({ scene, accent, renderer, medium } = {}) {
  const radius = 30;

  // Flat-normal placeholder (RGB 128,128,255 → tangent +Z) so the shader samples a flat surface
  // before the real normal map finishes loading — avoids an undefined sampler / black flash.
  const flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  flatNormal.needsUpdate = true;

  // Flat (black) ink placeholder → zero warp until the fluid dye is attached via setInk.
  const flatInk = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  flatInk.needsUpdate = true;

  const geometry = new THREE.CircleGeometry(radius, 128);
  const floor = new Reflector(geometry, {
    color: 0x3a3a3a,            // dark gray the boosted reflection multiplies
    textureWidth: 1024,
    textureHeight: 1024,
    clipBias: 0.003,
    shader: {
      name: 'ReflectiveFloorShader',
      uniforms: {
        color:         { value: null },        // set by Reflector
        tDiffuse:      { value: null },        // set by Reflector (mirror render target)
        textureMatrix: { value: null },        // set by Reflector
        tNormalMap:    { value: flatNormal },  // swapped for the loaded texture below
        uInk:          { value: flatInk },     // fluid dye — swapped in via setInk
        // Reflectivity 0.05 (raised 2026-07-03 from 0): a whisper of reflection at all
        // angles on top of the grazing fresnel sheen — wet stone, still not a mirror.
        uReflectivity:     { value: 0.05 },
        uMirror:           { value: 1.0 },     // 1 = pure reflection (base color term drops out)
        uFloorMixStrength: { value: 7.1 },     // reflection boost
        uDist:             { value: 1.6 },     // normal distortion strength
        uNormalScale:      { value: new THREE.Vector2(1.6, 1.6) },
        uRadius:           { value: 23 },
        uInkWarp:          { value: 0.0 },     // cursor-ink reflection nudge (off, tuned 2026-07-03)
        // medium participation — placeholders; the shared objects are adopted below
        // (Reflector clones this uniform table, so by-reference adoption must happen after).
        uBase:    { value: new THREE.Color(0x111111) },
        uGlowCol: { value: new THREE.Color(0xe8913f) },
        uWind:    { value: new THREE.Vector2() },
        uTime:    { value: 0 },
        uFogNear: { value: 4.0 },
        uFogFar:  { value: 18.0 },
        // Wash/contact ship OFF (tuned 2026-07-03): the floor is lifted globally via
        // toneMappingExposure 0.38 instead — additive wash read as paint on the mirror.
        uWashGain:    { value: 0.0 },   // glow-side ground wash (GUI-restorable)
        uContactDark: { value: 0.0 },   // contact shadow under the card (GUI-restorable)
        uFogCol:    { value: new THREE.Color(0xf2ddc2) }, // placeholder — medium adopted below
        // live waves — scrolling dual normal maps (surface + reflection move together);
        // amp saturates the water blend at 0.025, speed 1 ≈ one texture repeat / ~35 s
        uWaveAmp:   { value: 0.025 },
        uWaveScale: { value: 1.2 },
        uWaveSpeed: { value: 1.5 },
        // ground mist banks flanking the card
        uMistAmt:   { value: 0.5 },
        uMistInner: { value: 3.5 },
        uMistOuter: { value: 11.0 },
        uMistFloor:     { value: 0.3 },  // min bank density — thins, never vanishes
        uMistLeftBoost: { value: 1.4 },  // dark-side equalizer
      },
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
    },
  });

  // Tiling normal map → the metal's surface grain. Loaded async; assigned on arrival.
  // Normal maps are linear data, so NoColorSpace (NOT sRGB) is required for correct distortion.
  let _normalTex = null;
  new THREE.TextureLoader().load('/assets/textures/floor-normal.png', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = renderer?.capabilities.getMaxAnisotropy?.() || 1;
    _normalTex = tex;
    floor.material.uniforms.tNormalMap.value = tex;
  });

  // The Reflector re-renders the whole scene into its mirror target — including scene.fog,
  // which fogs the far sky dome and makes the reflection read as murky "dirty water". Strip
  // fog for the reflection pass only, then restore it for the main render.
  const _reflect = floor.onBeforeRender;
  floor.onBeforeRender = function (r, s, c) {
    const fog = s.fog;
    s.fog = null;
    _reflect.call(this, r, s, c);
    s.fog = fog;
  };

  floor.rotation.x = -1.5216;       // near-flat, tilted slightly toward the camera
  floor.position.y = -1.65;         // below the card (card centre at origin)
  floor.material.transparent = true;
  floor.material.depthWrite  = false;
  floor.renderOrder = -1;           // after the dome (-1000), before the card

  // Floor color stays fixed (reference behavior): output = color × reflection × mixStrength,
  // so per-project hue arrives through the reflected atmosphere — no accent tinting needed.
  void accent;

  // Adopt the shared medium's uniform objects (post-construction — Reflector cloned the
  // table above). The distance fog then recolors with every medium.transition() for free.
  if (medium) {
    floor.material.uniforms.uBase = medium.u.uBase;
    floor.material.uniforms.uGlowCol = medium.u.uGlow;
    floor.material.uniforms.uFogCol = medium.u.uFog;
    floor.material.uniforms.uWind = medium.u.uWind;
    floor.material.uniforms.uTime = medium.u.uTime;
  }

  scene.add(floor);

  return {
    mesh: floor,
    update() {},                 // surface is static — motion comes from the reflected sky
    setColor() {},               // fixed dark-gray base (see note above)
    setInk(uniform) { floor.material.uniforms.uInk = uniform; }, // adopt the live { value } dye object
    destroy() { floor.dispose(); geometry.dispose(); flatNormal.dispose(); flatInk.dispose(); _normalTex?.dispose(); scene.remove(floor); },
  };
}
