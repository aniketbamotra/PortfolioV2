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
  varying vec3 vWorldPos;
  void main(){
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

// Edge-feathered, accent-tinted cloud with in-shader drift + rotation + slow breathing.
const CLOUD_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform vec3  uAccent;
  uniform float uTime, uOpacity, uRot, uPhase, uCross, uContrast;
  uniform vec2  uDrift;
  // fake scene lighting (manual fog illumination — see initCloudLayer)
  uniform vec3  uSpotPos, uSpotColor;     uniform float uSpotInt;
  uniform vec3  uCornerPos, uCornerColor; uniform float uCornerInt;
  uniform vec3  uSunColor;                uniform float uSunInt;
  uniform vec3  uHemiSky, uHemiGround;    uniform float uHemiInt;
  uniform float uLightGain, uLightFalloff, uAmbientFloor;
  varying vec2  vUv;
  varying vec3  vWorldPos;

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

    // The cloud PNGs are fully opaque (alpha=255); the shape lives in RGB. Derive density
    // from luminance so the structure drives occlusion: bright = dense fog, dark = gap.
    // uContrast crushes the wide mid-band toward gaps → punchier, more defined billows.
    float dens = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    dens = pow(dens, uContrast);
    float alpha = dens * feather * uOpacity * cross;

    // fake fog illumination: positional scatter from the two spots (distance falloff,
    // tinted by light colour) + flat ambient from hemisphere & sun, over an accent floor.
    vec3 albedo = tex.rgb * (0.6 + dens * 0.8);
    float dS = distance(vWorldPos, uSpotPos);
    float dC = distance(vWorldPos, uCornerPos);
    vec3 scatter = uSpotColor   * (uSpotInt   / (1.0 + uLightFalloff * dS * dS))
                 + uCornerColor * (uCornerInt / (1.0 + uLightFalloff * dC * dC));
    vec3 ambient = mix(uHemiGround, uHemiSky, 0.5) * uHemiInt + uSunColor * uSunInt;
    vec3 illum   = uAmbientFloor * uAccent + ambient + scatter * uLightGain;
    vec3 rgb     = albedo * illum;

    gl_FragColor = vec4(rgb, alpha);
  }`;

// ── Foreground depth experiment ──────────────────────────────────────────────
// One barely-visible plane BETWEEN camera and card → camera→foreground air→card→
// background air. Flip these and reload to A/B (no screenshots captured by tooling).
const FG_ENABLED = true;       // foreground layer on/off
const FG_BLEND   = 'normal';   // 'normal' | 'additive'  (test both)
const FG_OPACITY = 0.04;       // 0.01–0.05 range — drop toward 0.01 if it reads as a texture
const CLOUD_CONTRAST = 0.8;    // density gamma: <1 lifts mid-tones (more fog); >1 crisps gaps

// Fake scene lighting on the clouds (manual fog illumination — tune to taste).
const CLOUD_LIGHT_GAIN    = 0.025; // positional spot/corner contribution strength
const CLOUD_LIGHT_FALLOFF = 0.05;  // 1 / (1 + falloff·d²) distance falloff
const CLOUD_AMBIENT_FLOOR = 0.35;  // base accent fill so clouds stay visible where unlit

// plane config: texture, size, position, base tilt, drift(vec2), rotation rate, breathe phase, ω
const PLANES = [
  { tex: '/assets/clouds/cloudA.png', size: 48, pos: [-1, 3.5, -4], tilt: -0.18, drift: [ 0.0020,  0.0011], rot:  0.0040, phase: 0.0, cross: 0.060, opacity: 0.70 },
  { tex: '/assets/clouds/cloudB.png', size: 62, pos: [ 1, 5.0, -6], tilt: -0.16, drift: [-0.0013,  0.0008], rot: -0.0026, phase: 2.1, cross: 0.045, opacity: 0.60 },
  { tex: '/assets/clouds/cloudC.png', size: 78, pos: [-2, 6.5, -8], tilt: -0.14, drift: [ 0.0008, -0.0006], rot:  0.0015, phase: 4.0, cross: 0.035, opacity: 0.50 },
];

export function initCloudLayer({ scene, camera, isMobile, accent, lights }) {
  const { spotLight, cornerLight, sunLight, hemiLight } = lights || {};
  const accentColor = new THREE.Color(accent || '#7fa0ff'); // shared, lerped on transition
  const group = new THREE.Group();
  group.name = 'hero-cloud-layer';
  scene.add(group);

  const loader = new THREE.TextureLoader();
  const materials = [];
  const _disposables = [];
  const textures = [];

  // Fake-light uniforms (one fresh set per material; synced from the live scene lights each frame).
  const lightUniforms = () => ({
    uSpotPos:    { value: new THREE.Vector3() }, uSpotColor:   { value: new THREE.Color(0, 0, 0) }, uSpotInt:   { value: 0 },
    uCornerPos:  { value: new THREE.Vector3() }, uCornerColor: { value: new THREE.Color(0, 0, 0) }, uCornerInt: { value: 0 },
    uSunColor:   { value: new THREE.Color(0, 0, 0) }, uSunInt:  { value: 0 },
    uHemiSky:    { value: new THREE.Color(0, 0, 0) }, uHemiGround: { value: new THREE.Color(0, 0, 0) }, uHemiInt: { value: 0 },
    uLightGain:    { value: CLOUD_LIGHT_GAIN },
    uLightFalloff: { value: CLOUD_LIGHT_FALLOFF },
    uAmbientFloor: { value: CLOUD_AMBIENT_FLOOR },
  });

  PLANES.forEach((cfg, i) => {
    const tex = loader.load(cfg.tex);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    _disposables.push(tex);
    textures.push(tex);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending, // occluding fog: billows cover/dim the bright source behind
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
        uContrast:{ value: CLOUD_CONTRAST },
        ...lightUniforms(),
      },
    });
    _disposables.push(mat);
    materials.push(mat);

    const geo = new THREE.PlaneGeometry(cfg.size, cfg.size);
    _disposables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    mesh.rotation.x = cfg.tilt * Math.PI;     // tilt to face the camera below
    mesh.renderOrder = -8 - i;                // normal blend: farthest (cloudC) draws first → back-to-front
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
        uContrast:{ value: CLOUD_CONTRAST },
        ...lightUniforms(),
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

  // Copy the live scene-light state into a material's fake-light uniforms.
  const syncLights = (u) => {
    if (spotLight)   { u.uSpotPos.value.copy(spotLight.position);     u.uSpotColor.value.copy(spotLight.color);     u.uSpotInt.value   = spotLight.intensity; }
    if (cornerLight) { u.uCornerPos.value.copy(cornerLight.position); u.uCornerColor.value.copy(cornerLight.color); u.uCornerInt.value = cornerLight.intensity; }
    if (sunLight)    { u.uSunColor.value.copy(sunLight.color);        u.uSunInt.value  = sunLight.intensity; }
    if (hemiLight)   { u.uHemiSky.value.copy(hemiLight.color);        u.uHemiGround.value.copy(hemiLight.groundColor); u.uHemiInt.value = hemiLight.intensity; }
  };

  function update(time) {
    _t = time;
    if (transStart >= 0) {
      const p = THREE.MathUtils.clamp((time - transStart) / DUR, 0, 1);
      accentColor.lerpColors(_from, _to, p * p * (3.0 - 2.0 * p));
      if (p >= 1) transStart = -1;
    }
    for (const m of materials) { m.uniforms.uTime.value = time; syncLights(m.uniforms); }
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
