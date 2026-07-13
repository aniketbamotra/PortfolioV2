// Side rim light — a themed PointLight that keys the voxel card to the atmosphere's glow
// region, so the card agrees with the bright backdrop behind it. Its offset (x,y,z) is the
// rest position IN THE ACTIVE WALL'S LOCAL FRAME; three-scene places it in world space each
// frame relative to whichever wall is centred (like the projector), so it keys the card no
// matter how far the ring has scrolled. Intensity swells with cursor energy.
// Exports: initSideLight({ scene }) → { light, params, place(pos), update(energy),
//          transition(hex, {duration}), destroy() }

import * as THREE from 'three';
import gsap from 'gsap';

export function initSideLight({ scene } = {}) {
  // A low, close rim gives the voxel field a readable silhouette against the smoke. It is
  // intentionally much dimmer than the projector, so it only catches the outer facets.
  // x/y/z are offsets from the active wall's face centre in its local right/up/normal frame.
  const params = {
    x: 4.8, y: 1.6, z: 3.4, // rest offset — close enough to shape the right-hand silhouette
    base: 12,
    energyBoost: 0.35,
    travel: 0.25,           // cursor drift range (applied in three-scene's wall-local placement)
  };

  const light = new THREE.PointLight(0xffffff, params.base, 0, 2);
  light.visible = true;
  scene.add(light);

  return {
    light,
    params,

    // World-space placement: three-scene computes the wall-relative anchor (+ cursor drift)
    // and sets it here every frame, so the rim follows the centred card around the ring.
    place(pos) {
      light.position.copy(pos);
    },

    update(energy) {
      light.intensity = params.base * (1 + energy * params.energyBoost);
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
