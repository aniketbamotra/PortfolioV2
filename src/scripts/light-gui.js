// Dev-only live light controls (lil-gui). Loaded lazily and only in dev or with a
// `?lights` URL flag (see three-scene.js), so it never reaches normal visitors.
// Sliders for each light's position / intensity / colour / cone, toggleable visual
// helpers, bloom + exposure, and a "Copy values" button that puts pasteable
// constants on the clipboard.
// Exports: initLightGui({ scene, renderer, bloomEffect, lights }) → { update, destroy }

import GUI from 'lil-gui';
import * as THREE from 'three';

export function initLightGui({ scene, renderer, bloomEffect, lights }) {
  const { spotLight, sunLight, cornerLight, hemiLight } = lights;
  const gui = new GUI({ title: 'Lights' });
  const helpers = [];        // { helper, light } pairs, added to scene only while visible
  const state = { helpers: false };

  // colour picker proxy: lil-gui edits a hex string, we push it into the THREE.Color
  const colorCtrl = (folder, label, color) => {
    const proxy = { [label]: '#' + color.getHexString() };
    folder.addColor(proxy, label).onChange((v) => color.set(v));
  };

  const addPosition = (folder, light) => {
    folder.add(light.position, 'x', -25, 25, 0.1);
    folder.add(light.position, 'y', -25, 25, 0.1);
    folder.add(light.position, 'z', -25, 25, 0.1);
  };

  const addSpot = (name, light) => {
    if (!light) return;
    const f = gui.addFolder(name);
    addPosition(f, light);
    f.add(light, 'intensity', 0, 100, 0.5);
    f.add(light, 'angle', 0, Math.PI / 2, 0.01);
    f.add(light, 'penumbra', 0, 1, 0.01);
    f.add(light, 'decay', 0, 3, 0.05);
    colorCtrl(f, 'color', light.color);
  };

  // ── Light folders ───────────────────────────────────────────────────────────
  addSpot('Hero spot', spotLight);
  addSpot('Corner key', cornerLight);

  if (sunLight) {
    const f = gui.addFolder('Sun (directional)');
    addPosition(f, sunLight);
    f.add(sunLight, 'intensity', 0, 10, 0.05);
    colorCtrl(f, 'color', sunLight.color);
  }

  if (hemiLight) {
    const f = gui.addFolder('Hemisphere');
    f.add(hemiLight, 'intensity', 0, 5, 0.05);
    colorCtrl(f, 'sky', hemiLight.color);
    colorCtrl(f, 'ground', hemiLight.groundColor);
  }

  // ── Post ──────────────────────────────────────────────────────────────────────
  if (bloomEffect || renderer) {
    const f = gui.addFolder('Post');
    if (bloomEffect) {
      f.add(bloomEffect, 'intensity', 0, 3, 0.01).name('bloom intensity');
      if (bloomEffect.luminanceMaterial) {
        f.add(bloomEffect.luminanceMaterial, 'threshold', 0, 1, 0.01).name('bloom threshold');
      }
    }
    if (renderer) f.add(renderer, 'toneMappingExposure', 0, 3, 0.01).name('exposure');
  }

  // ── Visual helpers (toggle) ─────────────────────────────────────────────────
  const buildHelpers = () => {
    if (spotLight)   helpers.push({ helper: new THREE.SpotLightHelper(spotLight),        light: spotLight });
    if (cornerLight) helpers.push({ helper: new THREE.SpotLightHelper(cornerLight),      light: cornerLight });
    if (sunLight)    helpers.push({ helper: new THREE.DirectionalLightHelper(sunLight, 2), light: sunLight });
    if (hemiLight)   helpers.push({ helper: new THREE.HemisphereLightHelper(hemiLight, 2), light: hemiLight });
  };
  buildHelpers();
  const applyHelpers = () => {
    for (const { helper } of helpers) {
      if (state.helpers) scene.add(helper); else scene.remove(helper);
    }
  };
  gui.add(state, 'helpers').name('show helpers').onChange(applyHelpers);

  // ── Export ──────────────────────────────────────────────────────────────────
  const hx = (c) => '#' + c.getHexString();
  const p3 = (v) => `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
  const actions = {
    copy() {
      const L = [];
      if (spotLight)   L.push(`Hero spot : pos(${p3(spotLight.position)}) int ${spotLight.intensity} angle ${spotLight.angle.toFixed(3)} pen ${spotLight.penumbra} decay ${spotLight.decay} ${hx(spotLight.color)}`);
      if (cornerLight) {
        L.push(`Corner key: pos(${p3(cornerLight.position)}) int ${cornerLight.intensity} angle ${cornerLight.angle.toFixed(3)} pen ${cornerLight.penumbra} decay ${cornerLight.decay} ${hx(cornerLight.color)}`);
        L.push('');
        L.push(`const CORNER_X        = ${cornerLight.position.x.toFixed(2)};`);
        L.push(`const CORNER_Y        = ${cornerLight.position.y.toFixed(2)};`);
        L.push(`const CORNER_Z        = ${cornerLight.position.z.toFixed(2)};`);
        L.push(`const CORNER_INT      = ${cornerLight.intensity};`);
        L.push(`const CORNER_ANGLE    = ${cornerLight.angle.toFixed(3)};`);
        L.push(`const CORNER_PENUMBRA = ${cornerLight.penumbra};`);
        L.push(`const CORNER_DECAY    = ${cornerLight.decay};`);
      }
      if (sunLight)  L.push(`Sun       : pos(${p3(sunLight.position)}) int ${sunLight.intensity} ${hx(sunLight.color)}`);
      if (hemiLight) L.push(`Hemisphere: int ${hemiLight.intensity} sky ${hx(hemiLight.color)} ground ${hx(hemiLight.groundColor)}`);
      if (bloomEffect) L.push(`Bloom     : intensity ${bloomEffect.intensity}${bloomEffect.luminanceMaterial ? ` threshold ${bloomEffect.luminanceMaterial.threshold}` : ''}`);
      if (renderer)  L.push(`Exposure  : ${renderer.toneMappingExposure}`);
      const text = L.join('\n');
      navigator.clipboard?.writeText(text).then(
        () => console.log('[lights] copied:\n' + text),
        () => console.log('[lights] (clipboard blocked) values:\n' + text),
      );
    },
  };
  gui.add(actions, 'copy').name('Copy values');

  // ── API ─────────────────────────────────────────────────────────────────────
  function update() {
    if (!state.helpers) return;
    for (const { helper } of helpers) helper.update?.();
  }

  function destroy() {
    for (const { helper } of helpers) {
      scene.remove(helper);
      helper.dispose?.();
    }
    helpers.length = 0;
    gui.destroy();
  }

  return { update, destroy };
}
