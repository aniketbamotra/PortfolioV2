// Dev-only scene/environment controls (lil-gui). Loaded lazily and only in dev or with a
// `?lights` URL flag (see three-scene.js), so it never reaches normal visitors.
// Exposes the Scene's sky-env knobs (blurriness / intensity / rotation for background and
// environment) plus bloom + exposure.
// Exports: initSceneGui({ scene, renderer, bloomEffect, floor }) → { destroy }

import GUI from 'lil-gui';
import { BlendFunction } from 'postprocessing';

export function initSceneGui({ scene, renderer, bloomEffect, floor, projector, camera, camParams, fx, fluid, sky, atmosphere, sideLight, atmoParams, ambient, medium, fogVeil }) {
  const gui = new GUI({ title: 'Scene' });

  // A pmndrs Effect is toggled on/off by swapping its blend function to SKIP (fully bypassed)
  // and back. Effects that ship disabled carry their intended blend in `_originalBlend` so
  // the toggle can restore it (a SKIP-at-init blend would otherwise be "restored" to SKIP).
  function addEffectToggle(folder, effect, label = 'enabled') {
    const current = effect.blendMode.blendFunction;
    const original = effect._originalBlend ?? (current !== BlendFunction.SKIP ? current : BlendFunction.NORMAL);
    const proxy = { enabled: current !== BlendFunction.SKIP };
    folder.add(proxy, 'enabled').name(label).onChange((on) => {
      effect.blendMode.blendFunction = on ? original : BlendFunction.SKIP;
    });
  }

  const actions = { 'Copy settings': () => {
    navigator.clipboard.writeText(JSON.stringify(gui.save(), null, 2))
      .then(() => console.log('[gui] settings copied to clipboard'))
      .catch(() => console.warn('[gui] clipboard write failed'));
  }};
  gui.add(actions, 'Copy settings');

  // Pruned 2026-07-03 (hard to find sliders): removed dead/stable folders — Sky/environment
  // (dome disabled), Ambient + Side light (off), Tilt-shift (disabled), Camera, Cursor
  // energy, Fluid ink, Fluid distortion — and long-stable rows inside the kept folders.
  // Everything still works via its baked defaults; restore rows from git if needed.

  if (floor?.mesh) {
    const f = floor.mesh;
    const u = f.material.uniforms;
    const fl = gui.addFolder('Reflective floor');
    fl.close();
    fl.add(f, 'visible').name('visible');
    fl.add(u.uFloorMixStrength, 'value', 0, 30, 0.1).name('mix strength');
    fl.add(u.uDist, 'value', 0, 5, 0.05).name('normal distortion');
    fl.add(u.uWashGain, 'value', 0, 0.5, 0.005).name('glow wash');
    fl.add(u.uContactDark, 'value', 0, 1, 0.01).name('contact shadow');
    const proxy = { base: '#' + u.color.value.getHexString() };
    fl.addColor(proxy, 'base').name('base color').onChange((v) => u.color.value.set(v));
  }

  // ── Director — four write-through macros over the atmospheric system. Macro sets, the
  // detail folders below refine; base values are captured here at init. ──
  if (atmosphere?.material && medium) {
    const u = atmosphere.material.uniforms;
    const base = {
      l1: u.uL1Alpha.value, l2: u.uL2Alpha.value, l3: u.uL3Alpha.value,
      absorb: u.uAbsorb.value, backdropFloor: u.uBackdropFloor.value,
      wind: medium.u.uWind.value.clone(),
      vigDark: fx?.vignette?.darkness ?? 0.7,
      grain: fx?.noise ? fx.noise.blendMode.opacity.value : 0.14,
    };
    const director = { density: 1, wind: 1, scattering: 1, mood: 0 };
    const dir = gui.addFolder('Director');
    dir.add(director, 'density', 0, 2, 0.01).name('Density').onChange((v) => {
      u.uL1Alpha.value = base.l1 * v;
      u.uL2Alpha.value = base.l2 * v;
      u.uL3Alpha.value = base.l3 * v;
      u.uAbsorb.value = Math.max(0.2, base.absorb * (2 - v));
    });
    dir.add(director, 'wind', 0, 2, 0.01).name('Wind').onChange((v) => {
      medium.u.uWind.value.copy(base.wind).multiplyScalar(v);
    });
    dir.add(director, 'scattering', 0, 2, 0.01).name('Scattering').onChange((v) => {
      u.uScatterGain.value = v;
      u.uHaloGain.value = v;
    });
    dir.add(director, 'mood', 0, 1, 0.01).name('Mood').onChange((v) => {
      u.uBackdropFloor.value = base.backdropFloor * (1 - v * 0.8);
      if (fx?.vignette) fx.vignette.darkness = Math.min(0.95, base.vigDark + v * 0.25);
      if (fx?.noise) fx.noise.blendMode.opacity.value = base.grain + v * 0.1;
    });
  }

  // ── Atmosphere (screen-space backdrop — absorption/scattering cloudscape) ──
  if (atmosphere?.material) {
    const u = atmosphere.material.uniforms;
    const at = gui.addFolder('Atmosphere');
    at.close();
    at.add(atmosphere.mesh, 'visible').name('visible');

    // Colors are the shared medium's — edits recolor every layer at once.
    const colors = { base: 'uBase', fog: 'uFog', glow: 'uGlow', smoke: 'uSmoke' };
    const proxy = {};
    for (const [label, name] of Object.entries(colors)) {
      proxy[label] = '#' + u[name].value.getHexString();
      at.addColor(proxy, label).name(label + ' color').onChange((v) => u[name].value.set(v));
    }

    at.add(u.uL1Alpha, 'value', 0, 1.5, 0.01).name('L1 plumes alpha');
    at.add(u.uL1Speed, 'value', 0, 0.1, 0.001).name('L1 plumes speed');
    at.add(u.uL1Scale, 'value', 0.1, 3, 0.01).name('L1 plumes scale');
    at.add(u.uL2Alpha, 'value', 0, 1.5, 0.01).name('L2 structure alpha');
    at.add(u.uL2Scale, 'value', 0.2, 5, 0.05).name('L2 structure scale');
    at.add(u.uL3Alpha, 'value', 0, 1.5, 0.01).name('L3 detail alpha');
    at.add(u.uL3Speed, 'value', 0, 0.3, 0.005).name('L3 detail speed');
    at.add(u.uL3Scale, 'value', 0.5, 10, 0.1).name('L3 detail scale');
    at.add(u.uWarp, 'value', 0, 4, 0.05).name('domain warp');
    at.add(u.uDensityGamma, 'value', 0.2, 3, 0.05).name('density gamma');
    at.add(u.uAbsorb, 'value', 0, 6, 0.05).name('absorption');
    at.add(u.uScatterGain, 'value', 0, 2, 0.01).name('scatter gain');
    at.add(u.uHaloGain, 'value', 0, 2, 0.01).name('halo gain');
    at.add(u.uBackdropFloor, 'value', 0, 0.5, 0.005).name('backdrop floor');
    at.add(u.uCoreGain, 'value', 0, 3, 0.05).name('core gain');
    at.add(u.uAmbientAmt, 'value', 0, 1, 0.01).name('ambient tint amt');
    if (medium) {
      at.add(medium.params, 'glowIntensity', 0, 3, 0.01).name('glow intensity');
    }
    at.add(u.uGlowRadius, 'value', 0.05, 2, 0.01).name('glow radius');
    at.add(u.uCoreSize, 'value', 0.05, 1, 0.01).name('core size (frac)');
    at.add(u.uCoreBoost, 'value', 0, 4, 0.05).name('core boost');
    const hotProxy = { hot: '#' + u.uHotColor.value.getHexString() };
    at.addColor(hotProxy, 'hot').name('hot color').onChange((v) => u.uHotColor.value.set(v));
    at.add(u.uLidDensity, 'value', 0, 1.5, 0.01).name('ceiling lid density');
    at.add(u.uLidStart, 'value', 0, 1, 0.01).name('ceiling lid start');
    at.add(u.uPocketIntensity, 'value', 0, 2, 0.01).name('card pocket intensity');
    at.add(u.uPocketRadius, 'value', 0.1, 1.5, 0.01).name('card pocket radius');
    at.add(u.uPocketStretch, 'value', 0.2, 3, 0.05).name('card pocket stretch');
    at.add(u.uPocketPos.value, 'x', -1, 1, 0.01).name('card pocket x');
    at.add(u.uPocketPos.value, 'y', -1, 1, 0.01).name('card pocket y');
    at.add(u.uGlowStretch, 'value', 0.1, 4, 0.05).name('glow stretch (v)');
    at.add(u.uGlowPos.value, 'x', -1.5, 1.5, 0.01).name('glow pos x');
    at.add(u.uGlowPos.value, 'y', -1, 1, 0.01).name('glow pos y');
  }

  // ── Fog veil (foreground haze over card/floor) ──
  if (fogVeil?.material) {
    const u = fogVeil.material.uniforms;
    const fv = gui.addFolder('Fog veil');
    fv.close();
    fv.add(fogVeil.mesh, 'visible').name('visible');
    fv.add(u.uBottomStart, 'value', 0, 1, 0.01).name('bottom start');
    fv.add(u.uBottomMax, 'value', 0, 1, 0.01).name('bottom max');
    fv.add(u.uEdgeWidth, 'value', 0, 0.4, 0.005).name('edge width');
    fv.add(u.uEdgeMax, 'value', 0, 1, 0.01).name('edge max');
    fv.add(u.uVeilScale, 'value', 0.3, 4, 0.05).name('scale');
    fv.add(u.uVeilSpeed, 'value', 0, 0.1, 0.001).name('speed');
    fv.add(u.uNoiseFloor, 'value', 0, 1, 0.01).name('noise floor');
    fv.add(u.uLightResponse, 'value', 0, 1, 0.01).name('light response');
  }

  if (projector?.light) {
    const l = projector.light;
    const pj = gui.addFolder('Projector');
    pj.close();
    pj.add(l, 'visible').name('visible');
    if (projector.params?.intensityMax !== undefined) {
      pj.add(projector.params, 'intensityIdle', 0, 400, 1).name('intensity (idle)');
      pj.add(projector.params, 'intensityMax', 0, 400, 1).name('intensity (hover)');
    } else {
      pj.add(l, 'intensity', 0, 400, 1).name('intensity');
    }
    if (projector.params?.tint !== undefined) pj.add(projector.params, 'tint', 0, 1, 0.01).name('palette tint');
  }

  const post = gui.addFolder('Post');
  if (bloomEffect) {
    post.add(bloomEffect, 'intensity', 0, 3, 0.01).name('bloom intensity');
    if (bloomEffect.luminanceMaterial) {
      post.add(bloomEffect.luminanceMaterial, 'threshold', 0, 1, 0.01).name('bloom threshold');
    }
    if (bloomEffect.mipmapBlurPass) {
      post.add(bloomEffect.mipmapBlurPass, 'radius', 0.1, 1, 0.01).name('bloom radius (halation)');
    }
  }
  if (renderer) post.add(renderer, 'toneMappingExposure', 0, 3, 0.01).name('exposure');
  if (fx?.grade) {
    const g = fx.grade;
    addEffectToggle(post, g, 'grade enabled');
    post.add(g, 'amount', 0, 1, 0.01).name('grade amount');
    post.add(g, 'desat', 0, 1, 0.01).name('grade desat');
    post.add(g, 'lift', 0, 0.2, 0.005).name('grade shadow lift');
    post.add(g, 'highBend', 0, 1, 0.01).name('grade high bend');
    const gp = { shadow: '#' + g.shadowTint.getHexString(), highlight: '#' + g.highlightTint.getHexString() };
    post.addColor(gp, 'shadow').name('grade shadow tint').onChange((v) => g.shadowTint.set(v));
    post.addColor(gp, 'highlight').name('grade highlight tint').onChange((v) => g.highlightTint.set(v));
  }
  if (fx?.afterimage) {
    post.add(fx.afterimage, 'enabled').name('trails enabled');
    post.add(fx.afterimage, 'damp', 0, 0.97, 0.01).name('trail length');
  }
  if (fx?.vignette) {
    post.add(fx.vignette, 'darkness', 0, 1, 0.01).name('vignette darkness');
    post.add(fx.vignette, 'offset', 0, 1, 0.01).name('vignette offset');
  }
  if (fx?.noise) {
    addEffectToggle(post, fx.noise, 'grain enabled');
    post.add(fx.noise.blendMode.opacity, 'value', 0, 0.5, 0.01).name('grain opacity');
  }

  // Cube controls — attached later, once the cube shader has compiled (uniforms live).
  let _cubeFolder = null;
  function addCubeControls(u) {
    if (!u || _cubeFolder) return;
    _cubeFolder = gui.addFolder('Cubes');
    // noise-field cull (silhouette erosion)
    if (u.uKeepFrac) {
      _cubeFolder.add(u.uKeepFrac, 'value', 0, 1, 0.01).name('edge keep frac');
      _cubeFolder.add(u.uDenseRadius, 'value', 0, 1, 0.01).name('dense core radius');
      _cubeFolder.add(u.uFadeRadius, 'value', 0.2, 1.4, 0.01).name('erode end radius');
      _cubeFolder.add(u.uCullScale, 'value', 0.03, 0.4, 0.005).name('bite size (freq)');
      _cubeFolder.add(u.uCullDrift, 'value', 0, 0.08, 0.001).name('bite drift (0=frozen)');
      _cubeFolder.add(u.uDepthScatter, 'value', 0, 1, 0.01).name('depth scatter (z)');
    }
    _cubeFolder.add(u.uRippleAmp, 'value', 0, 1, 0.01).name('ripple amp');
    _cubeFolder.add(u.uRipplePeriod, 'value', 0.5, 10, 0.05).name('ripple period (s)');
    if (u.uMouseFactor)    _cubeFolder.add(u.uMouseFactor, 'value', 0, 4, 0.01).name('flow displace');
    if (u.uMouseLightness) _cubeFolder.add(u.uMouseLightness, 'value', 0, 4, 0.01).name('flow brightness');
    if (u.uFogAmt)         _cubeFolder.add(u.uFogAmt, 'value', 0, 1, 0.01).name('atmo tint amt');
  }

  return { destroy: () => gui.destroy(), addCubeControls };
}
