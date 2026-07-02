// Reflective floor below the voxel card — a circular mirror built on three's Reflector
// (real per-frame mirror render: it re-renders the scene from a mirrored camera into a
// render target, with an oblique clip plane at the floor). The default Reflector shader is
// swapped for a custom liquid-metal one: a tiling normal-map texture (two layers scrolled in
// opposite directions for flow) distorts the reflection, plus contrast + colour tint + Fresnel
// sheen, and a radial alpha fade so the disc dissolves into the scene.
// Exports: initReflectiveFloor({ scene, accent, renderer }) → { mesh, update(time), setColor(hex), destroy() }

import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

const FLOOR_VERT = /* glsl */`
  uniform mat4 textureMatrix;
  varying vec4 vUv;
  varying vec2 vLocal;
  varying vec3 vWorld;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){
    vUv    = textureMatrix * vec4(position, 1.0);
    vLocal = position.xy;                       // circle lies in local XY (before -PI/2 tilt)
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const FLOOR_FRAG = /* glsl */`
  uniform vec3      color;
  uniform sampler2D tDiffuse;
  uniform sampler2D tNormalMap;
  uniform float     uReflectivity, uRadius, uTime, uDistort, uContrast, uFlow, uTint, uNormalRepeat;
  varying vec4 vUv;
  varying vec2 vLocal;
  varying vec3 vWorld;
  #include <logdepthbuf_pars_fragment>

  void main(){
    #include <logdepthbuf_fragment>

    // Two tiling samples of the normal map, scrolled in opposite directions → flowing liquid
    // metal. The combined tangent-space normal warps the reflection (molten distortion).
    float t = uTime * uFlow;
    vec2 nuv = vLocal * uNormalRepeat;
    vec3 n1 = texture2D(tNormalMap, nuv +        vec2( t * 0.030,  t * 0.020)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormalMap, nuv * 1.7 +  vec2(-t * 0.025,  t * 0.018)).xyz * 2.0 - 1.0;
    vec3 n  = normalize(n1 + n2);

    vec2 proj = vUv.xy / vUv.w + n.xy * uDistort;
    vec3 refl = texture2D(tDiffuse, proj).rgb;

    // Metals tint and harden their reflection: contrast + colour tint.
    refl = pow(max(refl, 0.0), vec3(uContrast));
    vec3 metal = refl * mix(vec3(1.0), color, uTint);

    // Fresnel sheen — brighten the *reflection* at grazing angles (multiplicative, so dark
    // areas stay dark; a flat additive white here reads as fog at this shallow camera angle).
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 5.0);
    metal *= 1.0 + fres * 0.5;

    // Tight specular glints on the steeper faces, faded out at grazing angles.
    metal += smoothstep(0.5, 0.95, 1.0 - n.z) * 0.12 * (1.0 - fres);

    vec3 col = mix(color * 0.25, metal, uReflectivity);   // dark metal base under it all

    float r = length(vLocal) / uRadius;                   // 0 centre → 1 edge
    float alpha = 1.0 - smoothstep(0.35, 1.0, r);         // dissolve the disc into the scene

    gl_FragColor = vec4(col, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function initReflectiveFloor({ scene, accent, renderer } = {}) {
  const radius = 30;

  // Flat-normal placeholder (RGB 128,128,255 → tangent +Z) so the shader samples a flat surface
  // before the real normal map finishes loading — avoids an undefined sampler / black flash.
  const flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  flatNormal.needsUpdate = true;

  const geometry = new THREE.CircleGeometry(radius, 128);
  const floor = new Reflector(geometry, {
    color: 0x111111,            // dark base the reflection is tinted toward
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
        uReflectivity: { value: 1.0 },
        uRadius:       { value: radius },
        uDistort:      { value: 0.025 },  // molten warp strength (how hard the normal warps)
        uContrast:     { value: 1.09 },   // metallic reflection hardness
        uFlow:         { value: 0.31 },   // flow animation speed
        uTint:         { value: 0.82 },   // how much the metal colours the reflection
        uNormalRepeat: { value: 0.1 },    // normal-map tiling density across the disc
        uTime:         { value: 0 },
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

  // The floor stays a dark base (#111111); per-project accent only nudges it subtly so it
  // doesn't wash back to grey.
  if (accent) floor.material.uniforms.color.value.lerp(new THREE.Color(accent), 0.15);

  scene.add(floor);

  return {
    mesh: floor,
    update(time) { floor.material.uniforms.uTime.value = time; },
    setColor(hex) { floor.material.uniforms.color.value.set(0x111111).lerp(new THREE.Color(hex), 0.15); },
    destroy() { floor.dispose(); geometry.dispose(); flatNormal.dispose(); _normalTex?.dispose(); scene.remove(floor); },
  };
}
