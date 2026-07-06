// One-off: derive an atmosphere palette (base/fog/glow/smoke) from a cover image.
// Usage: node scripts/derive-atmo.mjs public/assets/projects/*.png
//
// Emits literals to paste into src/data/projects.js. Rules (settled, see memory
// hue-in-world-grade-value-only):
//   base  — near-black, fixed #111111
//   smoke — dark-mid saturated version of the image's dominant hue
//   glow  — MID station of the temperature ramp: warm-leaning, saturated, never white
//   fog   — warm-tinted bright neutral, nudged toward the project hue
// Stations are calibrated so keploy.png (dominant hue ~21°) reproduces the
// hand-tuned project-0 palette (#b25325 / #e8913f / #f2ddc2) within a few degrees.
import sharp from 'sharp';

const WARM_ANCHOR = 45;  // glow leans toward this hue (orange-yellow)
const FOG_ANCHOR  = 35;  // fog starts from warm cream and takes a 25% project tint

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// shortest signed hue distance a→b in degrees
const hueDelta = (a, b) => ((b - a + 540) % 360) - 180;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

async function dominantHue(file) {
  const { data, info } = await sharp(file)
    .resize(96, 96, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Vote hues into 15° bins, weighted by chroma, ignoring near-greys and extremes.
  const BINS = 24;
  const bins = new Array(BINS).fill(0);
  const px = [];
  for (let i = 0; i < info.width * info.height; i++) {
    const [h, s, l] = rgbToHsl(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    if (s < 0.12 || l < 0.06 || l > 0.94) continue;
    const w = s * (1 - Math.abs(2 * l - 1)); // chroma
    bins[Math.floor(h / 15) % BINS] += w;
    px.push([h, s, w]);
  }
  let top = 0;
  for (let i = 1; i < BINS; i++) if (bins[i] > bins[top]) top = i;
  const center = top * 15 + 7.5;

  // Weighted circular mean of hues within ±30° of the winning bin.
  let sx = 0, sy = 0, satSum = 0, wSum = 0;
  for (const [h, s, w] of px) {
    if (Math.abs(hueDelta(center, h)) > 30) continue;
    const rad = (h * Math.PI) / 180;
    sx += Math.cos(rad) * w; sy += Math.sin(rad) * w;
    satSum += s * w; wSum += w;
  }
  const hue = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  return { hue, sat: wSum ? satSum / wSum : 0, coverage: wSum };
}

function derivePalette(hue) {
  const glowHue = hue + clamp(hueDelta(hue, WARM_ANCHOR) / 3, -12, 12);
  const fogHue = FOG_ANCHOR + clamp(hueDelta(FOG_ANCHOR, hue) * 0.25, -30, 30);
  return {
    base: '#111111',
    fog: hslToHex(fogHue, 0.55, 0.85),
    glow: hslToHex(glowHue, 0.78, 0.58),
    smoke: hslToHex(hue, 0.57, 0.42),
  };
}

for (const file of process.argv.slice(2)) {
  const { hue, sat } = await dominantHue(file);
  const p = derivePalette(hue);
  console.log(`${file}\n  dominant hue ${hue.toFixed(1)}°, mean sat ${sat.toFixed(2)}`);
  console.log(`  atmo: { base: '${p.base}', fog: '${p.fog}', glow: '${p.glow}', smoke: '${p.smoke}' },\n`);
}
