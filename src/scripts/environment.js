// Hero atmosphere — the world around the voxel card. Four layers added to the
// existing scene (the card system is untouched):
//   L1 Reflective ground  — Reflector + separable blur + dudv distortion (wet stone)
//   L2 Atmospheric volume — faint FBM haze planes across depth
//   L3 Ceiling clouds      — large FBM + domain-warp plane overhead (ink-in-water)
//   L4 Atmospheric glow    — large off-center additive glow that feeds bloom
// Per-project accent retints all four on a slow, staggered ~5s timeline, kept
// separate from setProject's 800ms light/texture swap.
// Exports: initEnvironment({ scene, renderer, camera, isMobile, accent })
//          → { update(time), transition(toAccentHex), destroy() }

import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

// ── Shared GLSL ───────────────────────────────────────────────────────────────
// Value noise (no OCTAVES dependency) — safe to drop into any shader.
const NOISE_BASE = /* glsl */`
  float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }`;
// FBM — needs an OCTAVES define (4 desktop / 2 mobile).
const FBM = /* glsl */`
  float fbm(vec2 p){
    float v = 0.0, amp = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < OCTAVES; i++){ v += amp * noise(p); p = m * p; amp *= 0.5; }
    return v;
  }`;

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Plane shader shared by volume + ceiling (UV passthrough).
const PLANE_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const GROUND_Y = -1.6;

export function initEnvironment({ scene, renderer, camera, isMobile, accent }) {
  const OCT = isMobile ? 2 : 4;
  const group = new THREE.Group();
  group.name = 'hero-environment';
  scene.add(group);

  // ── Accent transition state ─────────────────────────────────────────────────
  // Four staggered stages, each a live THREE.Color shared by-reference into its
  // layer's uniform (except the Reflector ground, whose uniforms get cloned — we
  // copy into it each frame instead).
  const base = new THREE.Color(accent || '#7fa0ff');
  const target = base.clone();
  const mkStage = (offset) => ({ live: base.clone(), from: base.clone(), to: target, offset, dur: 3.5 });
  const stages = {
    atmos:  mkStage(0.0),
    clouds: mkStage(0.6),
    ground: mkStage(1.2),
    glow:   mkStage(1.8),
  };
  const TOTAL = 1.8 + 3.5;
  let transStart = -1;
  let _t = 0;

  const _disposables = [];
  const track = (obj) => { _disposables.push(obj); return obj; };

  // ── Layer 1 — Reflective ground ─────────────────────────────────────────────
  let reflector = null, groundFallback = null, blur = null, origOBR = null, rframe = 0;
  const groundGeo = track(new THREE.PlaneGeometry(60, 60));

  if (!isMobile) {
    const rtW = Math.max(2, Math.round(window.innerWidth * 0.5));
    const rtH = Math.max(2, Math.round(window.innerHeight * 0.5));
    reflector = new Reflector(groundGeo, {
      textureWidth: rtW,
      textureHeight: rtH,
      clipBias: 0.003,
      color: 0x000000,
      shader: _groundShader(),
    });
    reflector.rotateX(-Math.PI / 2);
    reflector.position.y = GROUND_Y;
    reflector.material.transparent = true;
    reflector.material.depthWrite = false;
    reflector.material.fog = false;
    group.add(reflector);

    blur = new BlurPass(renderer, rtW, rtH);

    // Throttle the (expensive) reflection re-render to every other frame.
    origOBR = reflector.onBeforeRender;
    reflector.onBeforeRender = function (r, s, c) {
      if ((rframe++ % 2) === 0) origOBR.call(this, r, s, c);
    };
  } else {
    // Mobile: cheap static gradient + accent wash, no reflection.
    const mat = track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uAccent: { value: stages.ground.live }, uFog: { value: new THREE.Color(0x05060e) } },
      vertexShader: PLANE_VERT,
      fragmentShader: /* glsl */`
        uniform vec3 uAccent; uniform vec3 uFog; varying vec2 vUv;
        void main(){
          float d = length(vUv - 0.5);
          float a = smoothstep(0.5, 0.05, d) * 0.5;
          gl_FragColor = vec4(mix(uFog, uAccent, 0.15), a);
        }`,
    }));
    groundFallback = new THREE.Mesh(groundGeo, mat);
    groundFallback.rotateX(-Math.PI / 2);
    groundFallback.position.y = GROUND_Y;
    group.add(groundFallback);
  }

  // ── Layer 2 — Atmospheric volume ────────────────────────────────────────────
  const volMats = [];
  const volGeo = track(new THREE.PlaneGeometry(34, 26));
  // depth, phase, opacity — front planes faintest so they never smear the card.
  const VOL = isMobile
    ? [[-7, 0.0, 0.05], [-3, 2.1, 0.045]]
    : [[-9, 0.0, 0.05], [-6, 1.3, 0.05], [-3.5, 2.6, 0.045], [-1, 4.0, 0.035], [1.4, 5.5, 0.025]];
  for (const [z, phase, op] of VOL) {
    const mat = track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      defines: { OCTAVES: OCT },
      uniforms: {
        uTime: { value: 0 }, uAccent: { value: stages.atmos.live },
        uPhase: { value: phase }, uOpacity: { value: op },
      },
      vertexShader: PLANE_VERT,
      fragmentShader: /* glsl */`
        uniform float uTime, uPhase, uOpacity; uniform vec3 uAccent; varying vec2 vUv;
        ${NOISE_BASE}${FBM}
        void main(){
          vec2 p = vUv * 2.2 + vec2(uTime * 0.010 + uPhase, uTime * 0.008);
          float n = fbm(p);
          float a = smoothstep(0.35, 0.95, n) * uOpacity;
          vec2 e = smoothstep(0.0, 0.32, vUv) * smoothstep(0.0, 0.32, 1.0 - vUv); // hide plane edges
          a *= e.x * e.y;
          gl_FragColor = vec4(uAccent, a);
        }`,
    }));
    const mesh = new THREE.Mesh(volGeo, mat);
    mesh.position.set((phase - 2.5) * 0.4, 0.3, z); // slight horizontal stagger
    mesh.renderOrder = -1;
    group.add(mesh);
    volMats.push(mat);
  }

  // ── Layer 3 — Ceiling cloud layer ───────────────────────────────────────────
  const ceilGeo = track(new THREE.PlaneGeometry(54, 40));
  const ceilMat = track(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    defines: { OCTAVES: OCT },
    uniforms: { uTime: { value: 0 }, uAccent: { value: stages.clouds.live } },
    vertexShader: PLANE_VERT,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uAccent; varying vec2 vUv;
      ${NOISE_BASE}${FBM}
      void main(){
        vec2 p = vUv * 3.0;
        // domain warp → ink-in-water / aurora folds
        vec2 warp = vec2(fbm(p + vec2(uTime * 0.020, 0.0)), fbm(p + vec2(5.2, uTime * 0.018)));
        float n = fbm(p + warp * 1.6 + uTime * 0.010);
        n = smoothstep(0.32, 0.88, n);
        vec2 e = smoothstep(0.0, 0.38, vUv) * smoothstep(0.0, 0.38, 1.0 - vUv);
        float a = n * 0.24 * e.x * e.y;
        vec3 col = uAccent * (0.55 + n * 0.65); // bright cores feed bloom
        gl_FragColor = vec4(col, a);
      }`,
  }));
  const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
  ceiling.position.set(-1.5, 7.0, -5.0);
  ceiling.rotation.x = -Math.PI * 0.34; // tilt to face the camera/scene below
  ceiling.renderOrder = -2;
  group.add(ceiling);

  // ── Layer 4 — Off-center atmospheric glow ───────────────────────────────────
  const glowTex = track(_makeGlowTexture());
  const glowMat = track(new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 0.5, color: stages.glow.live, toneMapped: false,
  }));
  const glowGeo = track(new THREE.PlaneGeometry(18, 18));
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(5.5, 5.0, -8.0); // upper-right, behind — the brightest zone
  glow.renderOrder = -3;
  group.add(glow);

  // ── Per-frame ───────────────────────────────────────────────────────────────
  const _groundFog = new THREE.Color(0x05060e);

  function update(time) {
    _t = time;

    if (transStart >= 0) {
      const el = time - transStart;
      for (const s of Object.values(stages)) {
        const p = THREE.MathUtils.clamp((el - s.offset) / s.dur, 0, 1);
        s.live.lerpColors(s.from, s.to, p * p * (3.0 - 2.0 * p));
      }
      if (el > TOTAL) transStart = -1;
    }

    if (reflector) {
      const u = reflector.material.uniforms;
      u.uAccent.value.copy(stages.ground.live); // uniforms were cloned → copy
      u.uFog.value.copy(_groundFog);
      u.uTime.value = time;
      u.tBlur.value = blur.render(reflector.getRenderTarget().texture, isMobile ? 1 : 2);
    }

    for (const m of volMats) m.uniforms.uTime.value = time;
    ceilMat.uniforms.uTime.value = time;
  }

  function transition(toHex) {
    if (!toHex) return;
    target.set(toHex);
    for (const s of Object.values(stages)) s.from.copy(s.live);
    transStart = _t;
  }

  function destroy() {
    scene.remove(group);
    if (reflector) { reflector.onBeforeRender = origOBR; reflector.dispose?.(); reflector.getRenderTarget?.()?.dispose?.(); }
    blur?.dispose();
    for (const d of _disposables) d.dispose?.();
  }

  return { update, transition, destroy };
}

// ── Reflector display shader (blurred reflection + dudv distortion) ───────────
function _groundShader() {
  return {
    uniforms: {
      color: { value: null },                 // unused (Reflector sets it)
      tDiffuse: { value: null },               // raw reflection RT (Reflector sets it)
      tBlur: { value: null },                  // blurred reflection (we set it)
      textureMatrix: { value: new THREE.Matrix4() },
      uAccent: { value: new THREE.Color('#7fa0ff') },
      uFog: { value: new THREE.Color(0x05060e) },
      uStrength: { value: 0.5 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform mat4 textureMatrix;
      varying vec4 vUvProj;
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vUvProj = textureMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform sampler2D tBlur; uniform vec3 color;
      uniform vec3 uAccent; uniform vec3 uFog; uniform float uStrength; uniform float uTime;
      varying vec4 vUvProj; varying vec2 vUv;
      ${NOISE_BASE}
      void main(){
        vec2 proj = vUvProj.xy / vUvProj.w;
        // animated dudv — stretched vertically for a wet-stone streak
        float nx = noise(vUv * 8.0 + vec2(uTime * 0.02, 0.0));
        float ny = noise(vUv * 8.0 + vec2(0.0, uTime * 0.015));
        vec2 duv = (vec2(nx, ny) - 0.5) * vec2(0.015, 0.05);
        vec3 refl = texture2D(tBlur, proj + duv).rgb;
        float d = length(vUv - 0.5);
        float vis = smoothstep(0.5, 0.05, d);   // surface fades to nothing away from centre
        vec3 col = mix(uFog, refl, uStrength);   // low reflection strength; surface ~ disappears
        col += uAccent * 0.05 * vis;
        gl_FragColor = vec4(col, vis * 0.85);
      }`,
  };
}

// ── Separable Gaussian blur (ping-pong fullscreen passes) ─────────────────────
class BlurPass {
  constructor(renderer, w, h) {
    this.renderer = renderer;
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(w, h, opts);
    this.rtB = new THREE.WebGLRenderTarget(w, h, opts);
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2(w, h) } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uRes; varying vec2 vUv;
        void main(){
          vec2 texel = uDir / uRes;
          vec4 c = texture2D(tDiffuse, vUv) * 0.227027;
          c += texture2D(tDiffuse, vUv + texel * 1.3846) * 0.316216;
          c += texture2D(tDiffuse, vUv - texel * 1.3846) * 0.316216;
          c += texture2D(tDiffuse, vUv + texel * 3.2308) * 0.070270;
          c += texture2D(tDiffuse, vUv - texel * 3.2308) * 0.070270;
          gl_FragColor = c;
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.scene.add(this.quad);
  }

  render(srcTexture, iterations = 2) {
    const prev = this.renderer.getRenderTarget();
    let src = srcTexture, write = this.rtA, read = this.rtB;
    for (let i = 0; i < iterations; i++) {
      this.mat.uniforms.tDiffuse.value = src;        // horizontal
      this.mat.uniforms.uDir.value.set(1, 0);
      this.renderer.setRenderTarget(write);
      this.renderer.render(this.scene, this.cam);
      src = write.texture; [read, write] = [write, read];
      this.mat.uniforms.tDiffuse.value = src;        // vertical
      this.mat.uniforms.uDir.value.set(0, 1);
      this.renderer.setRenderTarget(write);
      this.renderer.render(this.scene, this.cam);
      src = write.texture; [read, write] = [write, read];
    }
    this.renderer.setRenderTarget(prev);
    return src;
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose();
    this.quad.geometry.dispose(); this.mat.dispose();
  }
}

// White radial sprite — tinted by material.color so the glow follows the accent.
function _makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.Texture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
