// Temporal afterimage — full-frame accumulation feedback (ref: fringe cubes leave soft
// ghost echoes as they fade/move; the fog carries the same subtle smear). A pmndrs `Pass`
// (not `Effect`) because feedback needs its own history buffer: each frame composites
// max(current, history × damp) and keeps the result as the next frame's history.
// Sits between the RenderPass and the bloom EffectPass, so trails glow like live pixels.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

const BLEND_FRAG = /* glsl */`
  uniform sampler2D tCur;
  uniform sampler2D tPrev;
  uniform float uDamp;
  varying vec2 vUv;
  void main() {
    vec4 cur  = texture2D(tCur, vUv);
    vec4 prev = texture2D(tPrev, vUv);
    gl_FragColor = max(cur, prev * uDamp);
  }
`;

const COPY_FRAG = /* glsl */`
  uniform sampler2D tCur;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tCur, vUv); }
`;

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

export class AfterimagePass extends Pass {
  constructor({ damp = 0.8 } = {}) {
    super('AfterimagePass');
    this.damp = damp; // per-frame retention at 60fps (rate-compensated in render)

    this._blendMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLEND_FRAG,
      uniforms: {
        tCur:  { value: null },
        tPrev: { value: null },
        uDamp: { value: damp },
      },
      depthTest: false,
      depthWrite: false,
    });
    this._copyMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COPY_FRAG,
      uniforms: { tCur: { value: null } },
      depthTest: false,
      depthWrite: false,
    });

    const rtOpts = { depthBuffer: false, type: THREE.HalfFloatType };
    this._history = new THREE.WebGLRenderTarget(1, 1, rtOpts); // last composited frame
    this._comp    = new THREE.WebGLRenderTarget(1, 1, rtOpts); // this frame's composite
  }

  setSize(width, height) {
    this._history.setSize(width, height);
    this._comp.setSize(width, height);
  }

  render(renderer, inputBuffer, outputBuffer, deltaTime) {
    // Rate-compensate so trail length is stable across refresh rates.
    const dampNow = Math.pow(this.damp, (deltaTime || 1 / 60) * 60);

    // composite: max(current, history × damp) → _comp
    this._blendMat.uniforms.tCur.value  = inputBuffer.texture;
    this._blendMat.uniforms.tPrev.value = this._history.texture;
    this._blendMat.uniforms.uDamp.value = dampNow;
    this.fullscreenMaterial = this._blendMat;
    renderer.setRenderTarget(this._comp);
    renderer.render(this.scene, this.camera);

    // pass the composite on, and keep it as next frame's history (swap, no copy of pixels)
    this._copyMat.uniforms.tCur.value = this._comp.texture;
    this.fullscreenMaterial = this._copyMat;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);

    const t = this._history; this._history = this._comp; this._comp = t;
  }

  dispose() {
    this._history.dispose();
    this._comp.dispose();
    this._blendMat.dispose();
    this._copyMat.dispose();
    super.dispose();
  }
}
