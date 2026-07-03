// Final color grade — the "film LUT" of the pipeline (ref: the whole frame lives on ONE
// hue axis; what varies is temperature along it: tinted shadows → neutral mids → warm-white
// highlights). Runs as a pmndrs Effect in the last EffectPass, after chromatic aberration
// and before vignette/grain, so the grade shapes color while finish effects sit on top.
// Per-project: transition() gsap-tweens the shadow tint toward the project's atmo base hue.

import { Effect } from 'postprocessing';
import { Uniform, Color } from 'three';
import gsap from 'gsap';

const FRAG = /* glsl */`
  uniform vec3 uShadowTint;    // hue pulled into the low end (project palette axis)
  uniform vec3 uHighlightTint; // temperature of the high end (warm white)
  uniform float uDesat;        // how far off-axis colors collapse toward neutral
  uniform float uAmount;       // master dry/wet

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // 1) pull everything toward the neutral axis — kills competing hue families
    c = mix(c, vec3(l), uDesat);
    // 2) split-tone temperature ramp along luminance — tinted darks, warm-white lights
    vec3 tint = mix(uShadowTint, uHighlightTint, smoothstep(0.0, 0.85, l));
    c *= tint;
    outputColor = vec4(mix(inputColor.rgb, c, uAmount), inputColor.a);
  }
`;

export class GradeEffect extends Effect {
  constructor({ shadowTint = 0xb98a6a, highlightTint = 0xfff6ea, desat = 0.35, amount = 0.8 } = {}) {
    super('GradeEffect', FRAG, {
      uniforms: new Map([
        ['uShadowTint',    new Uniform(new Color(shadowTint))],
        ['uHighlightTint', new Uniform(new Color(highlightTint))],
        ['uDesat',         new Uniform(desat)],
        ['uAmount',        new Uniform(amount)],
      ]),
    });
  }

  get shadowTint()    { return this.uniforms.get('uShadowTint').value; }
  get highlightTint() { return this.uniforms.get('uHighlightTint').value; }
  get desat()  { return this.uniforms.get('uDesat').value; }
  set desat(v) { this.uniforms.get('uDesat').value = v; }
  get amount()  { return this.uniforms.get('uAmount').value; }
  set amount(v) { this.uniforms.get('uAmount').value = v; }

  // Lean the shadow axis toward a project's palette color. The tint must live near
  // luminance 1 (it multiplies), so the hue is adopted at a fixed brightness/saturation
  // rather than the raw palette value (which may be near-black or oversaturated).
  transition(baseHex, { duration = 1.2, saturation = 0.35 } = {}) {
    const hsl = {};
    new Color(baseHex).getHSL(hsl);
    const target = new Color().setHSL(hsl.h, Math.min(hsl.s, 0.9) * saturation, 0.62);
    const c = this.shadowTint;
    gsap.killTweensOf(c);
    gsap.to(c, { r: target.r, g: target.g, b: target.b, duration, ease: 'sine.inOut' });
  }
}
