// Side rim light — a themed PointLight at the right edge that keys the voxel card to the
// atmosphere's glow region, so the card agrees with the bright backdrop behind it.
// Intensity swells with cursor energy; position drifts subtly with the mouse.
// Exports: initSideLight({ scene }) → { light, params, update(energy,mx,my),
//          transition(hex, {duration}), destroy() }

import * as THREE from 'three';
import gsap from 'gsap';

export function initSideLight({ scene } = {}) {
  // Tuned live 2026-07-02: disabled by default (base 0 + hidden) — the white-fog atmosphere
  // and the 400-intensity projector carry the card now. Re-enable via the GUI to experiment.
  const params = {
    x: 12, y: 0.8, z: 2.5,  // rest position — far right of the card
    base: 0,                // rest intensity
    energyBoost: 0.6,       // fraction of base added at full cursor energy
    travel: 0.4,            // mouse → position drift (world units)
  };

  const light = new THREE.PointLight(0xffffff, params.base, 0, 2);
  light.position.set(params.x, params.y, params.z);
  light.visible = false;
  scene.add(light);

  return {
    light,
    params,

    update(energy, mx, my) {
      light.intensity = params.base * (1 + energy * params.energyBoost);
      light.position.x = params.x + mx * params.travel;
      light.position.y = params.y + my * params.travel;
    },

    transition(hex, { duration = 1.2 } = {}) {
      const c = new THREE.Color(hex);
      gsap.killTweensOf(light.color);
      gsap.to(light.color, { r: c.r, g: c.g, b: c.b, duration, ease: 'sine.inOut' });
    },

    destroy() {
      gsap.killTweensOf(light.color);
      scene.remove(light);
      light.dispose();
    },
  };
}
