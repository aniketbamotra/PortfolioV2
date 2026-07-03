// Cursor-driven image projector — a SpotLight whose .map is the current project's cover image,
// cast onto the card like a slide projector / gobo. The light's cone projects the (pre-inverted)
// texture; SpotLight.map auto-updates its projection matrix, so no shadow setup is needed.
// The light tracks the cursor; because a projector point-inverts through its apex, moving the
// light WITH the cursor makes the projected highlight slide the opposite way (the "reverse" feel).
// Exports: initProjector({ scene, target }) → { light, setImage(path), update(mx,my),
//          setIntensity(v), destroy() }

import * as THREE from 'three';
import gsap from 'gsap';

const _loader = new THREE.TextureLoader();

export function initProjector({ scene, target = new THREE.Vector3(0, 0, 0) } = {}) {
  const base = new THREE.Vector3(0, 0, 3.25);

  // Physical decay=2: intensity falls off with distance² → natural centre-bright vignette.
  const light = new THREE.SpotLight(0xffffff, 120, 0, Math.PI / 4, 1, 2);
  light.position.copy(base);
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far  = 12;
  light.shadow.focus       = 1;          // shadow camera frustum = the map projection frustum

  const tgt = new THREE.Object3D();
  tgt.position.copy(target);
  light.target = tgt;
  scene.add(tgt);
  scene.add(light);

  let _tex = null;
  // Reference behavior (brainstron/reference_vals.md): the spotlight tracks the cursor — its
  // dump position (0.073, 0.047, 3.7) is a tracked light captured mid-motion.
  const params = {
    travel: 1.0,        // cursor → light translation range (world units)
    tint: 0.0,          // palette lean of the light color (off — tuned 2026-07-03; GUI can raise)
    intensityIdle: 120, // rest brightness — card sits dark against the fog (ref: dark object, hot core)
    intensityMax: 400,  // full projection when the cursor is on the card
  };
  let _presence = 0;    // smoothed cursor-on-card proximity driving the swell

  return {
    light,
    params,

    setImage(path) {
      if (!path) { light.map = null; return; }
      _loader.load(path, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.center.set(0.5, 0.5);
        tex.rotation = Math.PI;          // pre-invert to cancel the projector's point-inversion
        _tex?.dispose();
        _tex = tex;
        light.map = tex;
      });
    },

    // Reverse feel: drive the light with the cursor; the projection inverts → highlight reverses.
    // presence (0–1, card proximity) swells the lamp from idle to max — slow attack/release so
    // the cover image blooms up when the cursor reaches the card rather than switching on.
    update(mx, my, presence = 1) {
      light.position.x = base.x + mx * params.travel;
      light.position.y = base.y + my * params.travel;
      _presence += (presence - _presence) * 0.05;
      light.intensity = params.intensityIdle + (params.intensityMax - params.intensityIdle) * _presence;
    },

    setIntensity(v) { light.intensity = v; },

    // Lean the light color toward the project palette's glow — the card sits in the same
    // color family as the atmosphere without muddying the projected cover.
    transition(glowHex, { duration = 1.2 } = {}) {
      const c = new THREE.Color(0xffffff).lerp(new THREE.Color(glowHex), params.tint);
      gsap.killTweensOf(light.color);
      gsap.to(light.color, { r: c.r, g: c.g, b: c.b, duration, ease: 'sine.inOut' });
    },

    destroy() {
      gsap.killTweensOf(light.color);
      scene.remove(light);
      scene.remove(tgt);
      _tex?.dispose();
    },
  };
}
