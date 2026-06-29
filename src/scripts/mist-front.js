// Foreground fog — a large transparent plane between the camera and the card, drifting soft
// edgeless haze across the lower portion of the frame. Adds atmospheric depth and separation in
// FRONT of the card (the dome mist sits behind it). The camera is static, so a fixed world-space
// plane reliably covers the view. Procedural, no asset.
// Exports: initMistFront({ accent }) → { mesh, update(time), setColor(hex), destroy() }

import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */`
  uniform float uTime, uOpacity;
  uniform vec3  uColor, uAccent;
  varying vec2  vUv;

  float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0,0.0)), c = hash21(i + vec2(0.0,1.0)), d = hash21(i + vec2(1.0,1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, amp = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++){ v += amp * noise(p); p = m * p; amp *= 0.5; }
    return v;
  }

  void main(){
    float t = uTime;
    // Slow domain-warped haze.
    vec2 warp = vec2(fbm(vUv * 2.0 + vec2(t * 0.010, 0.0)),
                     fbm(vUv * 2.0 + vec2(5.0, -t * 0.008)));
    float n = fbm(vUv * 2.6 + warp * 0.9 + t * 0.006);
    n = smoothstep(0.30, 0.85, n);

    // Left + right columns only, clear through the centre where the card sits.
    float sides = smoothstep(0.45, 0.06, vUv.x) + smoothstep(0.55, 0.94, vUv.x);
    sides = clamp(sides, 0.0, 1.0);
    float vfade = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y); // hide top/bottom borders
    float a = n * sides * vfade * uOpacity;

    vec3 col = mix(uColor, uAccent, 0.10);
    gl_FragColor = vec4(col, a);
  }`;

export function initMistFront({ accent } = {}) {
  const geometry = new THREE.PlaneGeometry(11, 8);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime:    { value: 0 },
      uColor:   { value: new THREE.Color(0xb8c0c8) }, // cool desaturated gray-white
      uAccent:  { value: new THREE.Color(accent || '#7fa0ff') },
      uOpacity: { value: 0.30 },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0.3, 3.0);   // between camera (z 6.5) and card (z -0.6), centred on the card
  mesh.renderOrder = 50;            // draw after the card → composites in front

  return {
    mesh,
    update(time) { material.uniforms.uTime.value = time; },
    setColor(hex) { material.uniforms.uAccent.value.set(hex); },
    destroy() { geometry.dispose(); material.dispose(); },
  };
}
