// Hero cloud layer — composition validation pass.
// Three still frames derived from the approved Blender atmosphere export, layered
// as three large planes above/behind the voxel card. Each plane has its own scale,
// drift, and rotation; all share the project accent tint and breathe (crossfade)
// out of phase so the cloud mass slowly morphs — no video, no sequence playback.
// The card system is untouched.
// Exports: initCloudLayer({ scene, camera, isMobile, accent })
//          → { update(time), transition(toAccentHex), destroy() }

import * as THREE from 'three';

const CLOUD_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Edge-feathered, accent-tinted cloud with in-shader drift + rotation + slow breathing.
const CLOUD_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform vec3  uAccent;
  uniform float uTime, uOpacity, uRot, uPhase, uCross;
  uniform vec2  uDrift;
  varying vec2  vUv;

  void main(){
    // sampling UV: rotate about centre, then drift — both extremely slow
    float a = uRot * uTime;
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 suv = R * (vUv - 0.5) + 0.5 + uDrift * uTime;
    vec4 tex = texture2D(uMap, suv);

    // feather the plane's own border so the rectangle never reads
    vec2 fe = smoothstep(0.0, 0.35, vUv) * smoothstep(0.0, 0.35, 1.0 - vUv);
    float feather = fe.x * fe.y;

    // slow opacity breathing (the "crossfade" between the three layers)
    float cross = 0.6 + 0.4 * sin(uTime * uCross + uPhase);

    float alpha = tex.a * feather * uOpacity * cross;
    // tint toward the accent, lifted at the bright cores so they feed bloom
    vec3 rgb = tex.rgb * uAccent * (0.6 + tex.a * 0.8);

    gl_FragColor = vec4(rgb, alpha);
  }`;

// ── Foreground depth experiment ──────────────────────────────────────────────
// One barely-visible plane BETWEEN camera and card → camera→foreground air→card→
// background air. Flip these and reload to A/B (no screenshots captured by tooling).
const FG_ENABLED = true;       // foreground layer on/off
const FG_BLEND   = 'normal';   // 'normal' | 'additive'  (test both)
const FG_OPACITY = 0.02;       // 0.01–0.03 range — drop toward 0.01 if it reads as a texture

// plane config: texture, size, position, base tilt, drift(vec2), rotation rate, breathe phase, ω
const PLANES = [
  { tex: '/assets/clouds/cloudA.png', size: 48, pos: [-1, 6.5, -5], tilt: -0.34, drift: [ 0.0020,  0.0011], rot:  0.0040, phase: 0.0, cross: 0.060, opacity: 0.11 },
  { tex: '/assets/clouds/cloudB.png', size: 62, pos: [ 1, 8.0, -7], tilt: -0.30, drift: [-0.0013,  0.0008], rot: -0.0026, phase: 2.1, cross: 0.045, opacity: 0.09 },
  { tex: '/assets/clouds/cloudC.png', size: 78, pos: [-2, 9.5, -9], tilt: -0.28, drift: [ 0.0008, -0.0006], rot:  0.0015, phase: 4.0, cross: 0.035, opacity: 0.07 },
];

export function initCloudLayer({ scene, camera, isMobile, accent }) {
  const accentColor = new THREE.Color(accent || '#7fa0ff'); // shared, lerped on transition
  const group = new THREE.Group();
  group.name = 'hero-cloud-layer';
  scene.add(group);

  const loader = new THREE.TextureLoader();
  const materials = [];
  const _disposables = [];
  const textures = [];

  PLANES.forEach((cfg, i) => {
    const tex = loader.load(cfg.tex);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    _disposables.push(tex);
    textures.push(tex);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uMap:     { value: tex },
        uAccent:  { value: accentColor },   // shared instance → all planes retint together
        uTime:    { value: 0 },
        uOpacity: { value: isMobile ? cfg.opacity * 0.7 : cfg.opacity },
        uDrift:   { value: new THREE.Vector2(cfg.drift[0], cfg.drift[1]) },
        uRot:     { value: cfg.rot },
        uPhase:   { value: cfg.phase },
        uCross:   { value: cfg.cross },
      },
    });
    _disposables.push(mat);
    materials.push(mat);

    const geo = new THREE.PlaneGeometry(cfg.size, cfg.size);
    _disposables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    mesh.rotation.x = cfg.tilt * Math.PI;     // tilt to face the camera below
    mesh.renderOrder = -10 + i;               // behind the card, back-to-front among themselves
    group.add(mesh);
  });

  // ── Foreground depth plane (experiment) — one plane in front of the card ──────
  if (FG_ENABLED) {
    const fgMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: FG_BLEND === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uMap:     { value: textures[2] },                // reuse a loaded texture, no new asset
        uAccent:  { value: accentColor },                // same project-tint instance
        uTime:    { value: 0 },
        uOpacity: { value: isMobile ? FG_OPACITY * 0.7 : FG_OPACITY },
        uDrift:   { value: new THREE.Vector2(0.0006, 0.0004) }, // very slow
        uRot:     { value: 0.0008 },
        uPhase:   { value: 1.0 },
        uCross:   { value: 0.03 },
      },
    });
    _disposables.push(fgMat);
    materials.push(fgMat);

    const fgGeo = new THREE.PlaneGeometry(14, 14);
    _disposables.push(fgGeo);
    const fgMesh = new THREE.Mesh(fgGeo, fgMat);
    fgMesh.position.set(0, 0.6, 3.0);  // between card (z≈0) and camera (z 6.5), facing camera
    fgMesh.renderOrder = 5;            // draw after the card → true foreground veil
    group.add(fgMesh);
  }

  // ── Accent transition (own ~4s ease; separate from setProject's 800ms swap) ──
  let _t = 0, transStart = -1;
  const _from = accentColor.clone(), _to = accentColor.clone();
  const DUR = 4.0;

  function update(time) {
    _t = time;
    if (transStart >= 0) {
      const p = THREE.MathUtils.clamp((time - transStart) / DUR, 0, 1);
      accentColor.lerpColors(_from, _to, p * p * (3.0 - 2.0 * p));
      if (p >= 1) transStart = -1;
    }
    for (const m of materials) m.uniforms.uTime.value = time;
  }

  function transition(toHex) {
    if (!toHex) return;
    _from.copy(accentColor);
    _to.set(toHex);
    transStart = _t;
  }

  function destroy() {
    scene.remove(group);
    for (const d of _disposables) d.dispose?.();
  }

  return { update, transition, destroy };
}
