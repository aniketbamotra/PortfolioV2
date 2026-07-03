// Full-screen ripple driven by the alien.js Fluid dye texture. As a pmndrs `Effect` it
// slots into the existing EffectPass (no separate composer). `mainUv` offsets each pixel's
// sample coord by the local ink flow, so the whole rendered frame warps where the cursor
// has painted fluid — and settles as the ink dissipates.
// The dye stores advected splat colour in .rg (signed flow) and density in .b.

import { Effect } from 'postprocessing';
import { Uniform } from 'three';

const FRAG = /* glsl */`
  uniform sampler2D map;   // fluid dye (RG = flow, B = density)
  uniform float strength;

  void mainUv(inout vec2 uv) {
    vec3 ink = texture2D(map, uv).rgb;
    // Signed flow from the advected splat colour; density gates the magnitude so still
    // areas stay undistorted. Y is flipped to match screen space.
    vec2 flow = vec2(ink.r, -ink.g) * ink.b;
    uv += flow * strength;
  }
`;

export class FluidDistortionEffect extends Effect {
  constructor({ blendFunction, strength = 0.02, map = null } = {}) {
    super('FluidDistortionEffect', FRAG, {
      blendFunction,
      uniforms: new Map([
        ['map', new Uniform(map)],
        ['strength', new Uniform(strength)],
      ]),
    });
  }

  // Point at the live dye texture each frame (the sim swaps its render target).
  set map(texture) { this.uniforms.get('map').value = texture; }
  get strength() { return this.uniforms.get('strength').value; }
  set strength(v) { this.uniforms.get('strength').value = v; }
}
