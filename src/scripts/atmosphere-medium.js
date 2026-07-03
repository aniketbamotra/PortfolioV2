// Shared atmospheric medium — the single source of truth every atmospheric layer samples.
// One object owns the shared uniform OBJECTS (palette colors, light kernel, wind, time,
// energy, mouse); the backdrop (atmosphere.js), foreground veil (fog-veil.js), floor fog
// (reflective-floor.js), and the voxel card's fog tint all adopt these BY REFERENCE — the
// same `{ value }` sharing pattern used for the fluid dye — so one `transition(palette)`
// recolors the entire world in a single tween and no layer can drift out of sync.
// Also owns the "life pack" breathing: the glow intensity drifts ±breatheAmt on two
// incommensurate sines, computed once here so every consumer breathes together.
// Exports: initAtmosphereMedium({ palette }) → { u, params, update(), transition(), destroy() }
// plus shared GLSL snippets (LIGHT_KERNEL_GLSL) compiled identically into each consumer.

import * as THREE from 'three';
import gsap from 'gsap';

// The gaussian light kernel — one definition, parameterized so consumers can pass their own
// (possibly mouse-shifted) center while sharing the medium's radius/stretch uniforms.
export const LIGHT_KERNEL_GLSL = /* glsl */`
  float lightKernel(vec2 p, vec2 gp, float radius, float stretch){
    vec2 gd = (p - gp) * vec2(1.0, 1.0 / stretch);
    return exp(-dot(gd, gd) / (radius * radius));
  }
`;

export function initAtmosphereMedium({ palette } = {}) {
  const u = {
    // palette — crossfaded per project via transition(); consumers adopt the objects
    uBase:  { value: new THREE.Color(palette.base) },
    uFog:   { value: new THREE.Color(palette.fog) },
    uGlow:  { value: new THREE.Color(palette.glow) },
    uSmoke: { value: new THREE.Color(palette.smoke) },
    // light kernel (aspect-corrected centered space) — tuned 2026-07-03: kernel center
    // pushed off-frame right and low (1.46, -0.32) so only the hot skirt enters the frame;
    // intensity 2.05 keeps the column blazing (sun-behind-fog, ref orange env)
    uGlowPos:       { value: new THREE.Vector2(1.46, -0.32) },
    uGlowRadius:    { value: 0.96 },
    uGlowStretch:   { value: 0.85 },
    uGlowIntensity: { value: 2.05 }, // written each frame from params (breathing)
    // one wind direction for the whole world (p-units / second)
    uWind: { value: new THREE.Vector2(0.016, -0.004) },
    // clocks / cursor — written once per frame in update()
    uTime:   { value: 0 },
    uEnergy: { value: 0 },
    uMouse:  { value: new THREE.Vector2() },
  };

  const params = {
    glowIntensity: 2.05,  // rest intensity — GUI targets this, breathing modulates around it
    breatheAmt:    0.135, // ±fraction of glow intensity (life pack)
  };

  return {
    u,
    params,

    update(time, energy, mx, my) {
      u.uTime.value = time;
      u.uEnergy.value = energy;
      u.uMouse.value.set(mx, my);
      // Light breathing — two incommensurate periods so it never reads as a loop.
      // time === 0 under reduced motion → a fixed (rest-ish) intensity.
      const breathe = Math.sin(time * (Math.PI * 2 / 7.3)) * 0.6
                    + Math.sin(time * (Math.PI * 2 / 11.7)) * 0.4;
      u.uGlowIntensity.value = params.glowIntensity * (1 + breathe * params.breatheAmt);
    },

    // Crossfade the whole world to a new project palette — every consumer follows by reference.
    transition(palette, { duration = 1.2 } = {}) {
      const targets = { uBase: palette.base, uFog: palette.fog, uGlow: palette.glow, uSmoke: palette.smoke };
      for (const [name, hex] of Object.entries(targets)) {
        const c = new THREE.Color(hex);
        gsap.killTweensOf(u[name].value);
        gsap.to(u[name].value, { r: c.r, g: c.g, b: c.b, duration, ease: 'sine.inOut' });
      }
    },

    destroy() {
      [u.uBase, u.uFog, u.uGlow, u.uSmoke].forEach((uni) => gsap.killTweensOf(uni.value));
    },
  };
}
