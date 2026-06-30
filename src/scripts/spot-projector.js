// Cursor-driven image projector — a SpotLight whose .map is the current project's cover image,
// cast onto the card like a slide projector / gobo. The light's cone projects the (pre-inverted)
// texture; SpotLight.map auto-updates its projection matrix, so no shadow setup is needed.
// The light tracks the cursor; because a projector point-inverts through its apex, moving the
// light WITH the cursor makes the projected highlight slide the opposite way (the "reverse" feel).
// Exports: initProjector({ scene, target }) → { light, setImage(path), update(mx,my),
//          setIntensity(v), destroy() }

import * as THREE from 'three';

const _loader = new THREE.TextureLoader();

export function initProjector({ scene, target = new THREE.Vector3(0, 0.3, -0.6) } = {}) {
  const base = new THREE.Vector3(0, 0.3, 3.7);

  // angle ~30° half-cone covers the card face at this distance; decay 0 + distance 0 = constant
  // (non-physical) falloff so the projected image stays even across the card.
  const light = new THREE.SpotLight(0xffffff, 50, 0, Math.PI / 6, 0.5, 0);
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
  const params = { travel: 1.6 }; // cursor → light translation range (world units)

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
    update(mx, my) {
      light.position.x = base.x + mx * params.travel;
      light.position.y = base.y + my * params.travel;
    },

    setIntensity(v) { light.intensity = v; },

    destroy() {
      scene.remove(light);
      scene.remove(tgt);
      _tex?.dispose();
    },
  };
}
