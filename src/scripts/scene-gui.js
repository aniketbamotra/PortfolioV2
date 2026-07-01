// Dev-only scene/environment controls (lil-gui). Loaded lazily and only in dev or with a
// `?lights` URL flag (see three-scene.js), so it never reaches normal visitors.
// Exposes the Scene's sky-env knobs (blurriness / intensity / rotation for background and
// environment) plus bloom + exposure.
// Exports: initSceneGui({ scene, renderer, bloomEffect, floor }) → { destroy }

import GUI from 'lil-gui';

export function initSceneGui({ scene, renderer, bloomEffect, floor, projector, camera, camParams }) {
  const gui = new GUI({ title: 'Scene' });
  const TAU = Math.PI * 2;

  const env = gui.addFolder('Sky / environment');
  env.add(scene, 'backgroundBlurriness', 0, 1, 0.01).name('bg blurriness');
  env.add(scene, 'backgroundIntensity', 0, 3, 0.01).name('bg intensity');
  env.add(scene, 'environmentIntensity', 0, 3, 0.01).name('env (light) intensity');
  env.add(scene.backgroundRotation, 'y', 0, TAU, 0.01).name('bg rotation');
  env.add(scene.environmentRotation, 'y', 0, TAU, 0.01).name('env rotation');

  if (floor?.mesh) {
    const f = floor.mesh;
    const u = f.material.uniforms;
    const fl = gui.addFolder('Reflective floor');
    fl.add(f, 'visible').name('visible');
    fl.add(f.position, 'y', -6, 2, 0.01).name('height (y)');
    fl.add(f.position, 'x', -10, 10, 0.01).name('offset x');
    fl.add(f.position, 'z', -10, 10, 0.01).name('offset z');
    fl.add(f.rotation, 'x', -Math.PI, 0, 0.01).name('tilt x');
    fl.add(u.uReflectivity, 'value', 0, 1, 0.01).name('reflectivity');
    fl.add(u.uDistort, 'value', 0, 0.15, 0.001).name('flow warp');
    fl.add(u.uFlow, 'value', 0, 4, 0.01).name('flow speed');
    fl.add(u.uNormalRepeat, 'value', 0.1, 6, 0.05).name('texture tiling');
    fl.add(u.uContrast, 'value', 0.5, 3, 0.01).name('contrast');
    fl.add(u.uTint, 'value', 0, 1, 0.01).name('metal tint');
    fl.add(u.uRadius, 'value', 5, 60, 0.5).name('fade radius');
    const proxy = { tint: '#' + u.color.value.getHexString() };
    fl.addColor(proxy, 'tint').name('tint').onChange((v) => u.color.value.set(v));
  }

  if (camera && camParams) {
    const cam = gui.addFolder('Camera');
    cam.add(camParams, 'travelX', 0, 2, 0.01).name('travel X');
    cam.add(camParams, 'travelY', 0, 1, 0.01).name('travel Y');
    cam.add(camParams, 'zFactor', 0, 3, 0.05).name('z coupling');
    cam.add(camParams, 'lerp', 0.005, 0.15, 0.001).name('smoothing');
  }

  if (projector?.light) {
    const l = projector.light;
    const pj = gui.addFolder('Projector');
    pj.add(l, 'visible').name('visible');
    pj.add(l, 'intensity', 0, 400, 1).name('intensity');
    pj.add(l, 'angle', 0.05, Math.PI / 2, 0.01).name('cone angle');
    pj.add(l, 'penumbra', 0, 1, 0.01).name('penumbra (soft)');
    pj.add(l.position, 'z', 0.5, 6, 0.05).name('distance (z)');
    if (projector.params) pj.add(projector.params, 'travel', 0, 5, 0.05).name('cursor travel');
  }

  const post = gui.addFolder('Post');
  if (bloomEffect) {
    post.add(bloomEffect, 'intensity', 0, 3, 0.01).name('bloom intensity');
    if (bloomEffect.luminanceMaterial) {
      post.add(bloomEffect.luminanceMaterial, 'threshold', 0, 1, 0.01).name('bloom threshold');
    }
  }
  if (renderer) post.add(renderer, 'toneMappingExposure', 0, 3, 0.01).name('exposure');

  // Cube ripple controls — attached later, once the cube shader has compiled (uniforms live).
  let _rippleFolder = null;
  function addCubeControls(u) {
    if (!u || _rippleFolder) return;
    _rippleFolder = gui.addFolder('Cube ripple');
    _rippleFolder.add(u.uRippleAmp, 'value', 0, 1, 0.01).name('ripple amp');
    _rippleFolder.add(u.uRipplePeriod, 'value', 0.5, 10, 0.05).name('ripple period (s)');
    if (u.uMouseFactor)    _rippleFolder.add(u.uMouseFactor, 'value', 0, 4, 0.01).name('flow displace');
    if (u.uMouseLightness) _rippleFolder.add(u.uMouseLightness, 'value', 0, 4, 0.01).name('flow brightness');
  }

  return { destroy: () => gui.destroy(), addCubeControls };
}
