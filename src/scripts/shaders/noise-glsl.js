// Shared GLSL noise snippet — the hash21/value-noise/fbm family used across the scene
// (same functions as sky-dome.js / mist-front.js; extracted so new shaders stop duplicating it).
// `NOISE_GLSL` provides hash21/noise plus fixed-octave fbm3/fbm4 variants and rot2.
// Inject at the top of a fragment shader before first use.

export const NOISE_GLSL = /* glsl */`
  float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0,0.0)), c = hash21(i + vec2(0.0,1.0)), d = hash21(i + vec2(1.0,1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm3(vec2 p){
    float v = 0.0, amp = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 3; i++){ v += amp * noise(p); p = m * p; amp *= 0.5; }
    return v;
  }
  float fbm4(vec2 p){
    float v = 0.0, amp = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 4; i++){ v += amp * noise(p); p = m * p; amp *= 0.5; }
    return v;
  }
  mat2 rot2(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
`;
