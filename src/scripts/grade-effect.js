// Final color grade — the "film finish" of the pipeline. Since the 2026-07-03 cinematic
// pass, HUE lives in the world (the atmosphere's smoke → glow → hot temperature ramp);
// the grade only shapes VALUE: lift the blacks so they float instead of crushing, and
// bend hot pixels toward a warm highlight temperature instead of clipping to white.
// Defaults are neutral (desat 0, grey shadow tint) — tints are static/GUI-owned, NOT
// tweened per project (per-project color arrives via medium.transition()).
// Runs as a pmndrs Effect in the last EffectPass, after chromatic aberration and before
// vignette/grain, so the grade shapes tone while finish effects sit on top.

import { Effect } from 'postprocessing';
import { Uniform, Color } from 'three';

const FRAG = /* glsl */`
  uniform vec3 uShadowTint;    // hue pulled into the low end (project palette axis)
  uniform vec3 uHighlightTint; // temperature of the high end (warm white)
  uniform float uDesat;        // how far off-axis colors collapse toward neutral
  uniform float uLift;         // shadow floor — blacks float at the shadow hue, never crush
  uniform float uHighBend;     // pull hot pixels toward the highlight hue instead of white
  uniform float uAmount;       // master dry/wet

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // 1) pull everything toward the neutral axis — kills competing hue families
    c = mix(c, vec3(l), uDesat);
    // 2) split-tone temperature ramp along luminance — tinted darks, warm-white lights
    vec3 tint = mix(uShadowTint, uHighlightTint, smoothstep(0.0, 0.85, l));
    c *= tint;
    // 3) shadow lift — a multiply can only darken; ADD a dim bed of the shadow hue so
    //    the darkest values sit at deep-maroon, matching the ref's floated blacks
    c += uShadowTint * (uLift * (1.0 - smoothstep(0.0, 0.4, l)));
    // 4) highlight bend — hot pixels converge on the highlight temperature (yellow-white),
    //    never pure white; keeps the light kernel inside the one-hue world
    c = mix(c, uHighlightTint * min(l * 1.05, 1.0), uHighBend * smoothstep(0.55, 1.0, l));
    outputColor = vec4(mix(inputColor.rgb, c, uAmount), inputColor.a);
  }
`;

export class GradeEffect extends Effect {
  constructor({ shadowTint = 0xcecece, highlightTint = 0xffdf9e, desat = 0,
                lift = 0.05, highBend = 0.35, amount = 0.8 } = {}) {
    super('GradeEffect', FRAG, {
      uniforms: new Map([
        ['uShadowTint',    new Uniform(new Color(shadowTint))],
        ['uHighlightTint', new Uniform(new Color(highlightTint))],
        ['uDesat',         new Uniform(desat)],
        ['uLift',          new Uniform(lift)],
        ['uHighBend',      new Uniform(highBend)],
        ['uAmount',        new Uniform(amount)],
      ]),
    });
  }

  get shadowTint()    { return this.uniforms.get('uShadowTint').value; }
  get highlightTint() { return this.uniforms.get('uHighlightTint').value; }
  get desat()  { return this.uniforms.get('uDesat').value; }
  set desat(v) { this.uniforms.get('uDesat').value = v; }
  get lift()  { return this.uniforms.get('uLift').value; }
  set lift(v) { this.uniforms.get('uLift').value = v; }
  get highBend()  { return this.uniforms.get('uHighBend').value; }
  set highBend(v) { this.uniforms.get('uHighBend').value = v; }
  get amount()  { return this.uniforms.get('uAmount').value; }
  set amount(v) { this.uniforms.get('uAmount').value = v; }

}
