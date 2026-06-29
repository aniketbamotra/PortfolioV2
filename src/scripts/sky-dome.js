// Atmospheric-mist dome — a large back-side sphere rendering a calm, cool gradient with soft
// volumetric haze, fully procedural (no asset). The mist is edgeless domain-warped FBM that
// drifts almost imperceptibly, concentrated in the lower half / background, with density pockets
// that let faint light shafts through. Cool desaturated gray-white, lightly catching the accent.
// Reads as premium-CGI atmospheric haze — depth and mood without obscuring the card.
// The EXR still drives the card's lighting; this is purely the visible backdrop.
// Exports: initSkyDome({ accent }) → { mesh, update(time), setColor(hex), destroy() }

import * as THREE from 'three';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main(){
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const SKY_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3  uTop, uBottom, uMist, uAccent;
  varying vec3  vDir;

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
    for (int i = 0; i < 6; i++){ v += amp * noise(p); p = m * p; amp *= 0.5; }
    return v;
  }

  // One localized, edgeless mist bank — domain-warped FBM, confined to an azimuth window so the
  // haze reads as a distinct drifting mass rather than one continuous sheet.
  float mistBank(vec2 uv, float azi, vec2 drift, float scale, float aziC, float aziW){
    vec2 p = uv * scale + drift * uTime;
    vec2 warp = vec2(fbm(p * 0.8), fbm(p * 0.8 + 5.0));
    float n = fbm(p * 1.2 + warp * 0.9);
    n = smoothstep(0.34, 0.85, n);                       // soft pockets, no hard edges
    float da = atan(sin(azi - aziC), cos(azi - aziC));   // wrapped angular distance
    float am = exp(-(da * da) / (2.0 * aziW * aziW));    // gaussian localization
    return n * am;
  }

  void main(){
    vec3 d = normalize(vDir);
    float h   = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);        // 0 = down, 1 = up
    float azi = atan(d.z, d.x);                          // -PI..PI around the dome

    // Calm, cool base gradient — dark and spacious.
    vec3 base = mix(uBottom, uTop, pow(h, 0.85));

    // Project the view dir to a plane (no pole pinch). Three separate banks at different angles,
    // scales and (extremely slow) drifts so the mist breaks into distinct masses.
    vec2 uv = d.xz / (abs(d.y) + 0.55);
    float m1 = mistBank(uv, azi, vec2( 0.006,  0.000), 1.0, -1.9, 0.85);
    float m2 = mistBank(uv, azi, vec2(-0.004,  0.003), 1.4,  0.5, 0.70);
    float m3 = mistBank(uv, azi, vec2( 0.003, -0.002), 0.8,  2.5, 1.00);

    float lowMask = smoothstep(0.80, 0.12, h);           // keep it low / in the background
    float density = clamp(m1 + m2 * 0.85 + m3 * 0.70, 0.0, 1.0) * lowMask;

    // Faint volumetric light shafts through the density pockets (very subtle).
    float rays  = fbm(vec2(uv.x * 1.8 + 3.0, uTime * 0.02));
    float shaft = smoothstep(0.55, 0.95, rays) * smoothstep(0.65, 0.10, h);

    // Cool desaturated gray-white, softly catching the accent light.
    vec3 mistCol = mix(uMist, uAccent, 0.12);

    vec3 col = mix(base, mistCol, density * 0.55);        // never fully opaque → won't obscure
    col += mistCol * shaft * 0.10;

    gl_FragColor = vec4(col, 1.0);
  }`;

export function initSkyDome({ accent } = {}) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTime:   { value: 0 },
      uTop:    { value: new THREE.Color(0x0d1118) }, // cool dark zenith
      uBottom: { value: new THREE.Color(0x07090c) }, // horizon floor
      uMist:   { value: new THREE.Color(0xb8c0c8) }, // cool desaturated gray-white
      uAccent: { value: new THREE.Color(accent || '#7fa0ff') },
    },
  });

  // Radius must stay inside the camera far plane (100); large enough to enclose the scene.
  const geometry = new THREE.SphereGeometry(90, 64, 32);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1000; // draw first → everything else paints over it

  return {
    mesh,
    update(time) { material.uniforms.uTime.value = time; },
    setColor(hex) { material.uniforms.uAccent.value.set(hex); },
    destroy() { geometry.dispose(); material.dispose(); },
  };
}
