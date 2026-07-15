# Portfolio V2 — Technical Source of Truth

> **Read this before touching any code.** It exists so agents don't re-derive the architecture
> file-by-file. Companion docs: `agent.md` (working rules + collaboration style — read it),
> `design.md` (visual decisions), `brainstron/reference_vals.md` (real shader dumps from
> rogierdeboeve.com — ground truth for the hero look; never claim visual parity without
> honestly comparing against it).

## What this is

Aniket Bamotra's portfolio. Static **Astro 4** site, **vanilla JS only** (no React/R3F —
never suggest it), **Three.js r170** + **pmndrs postprocessing** + **GSAP** + **alien.js**
utils. The centerpiece is the homepage hero: a voxel card in a living atmospheric world.
The portfolio itself is the work — craft over speed, no "good enough".

## Commands

```bash
npm run dev        # astro dev server
npm run build      # prebuild runs scripts/check-asset-case.mjs, then astro build
npm run preview
```

- **Deploy:** Cloudflare Pages (static). npm 9.6.7 there → `typescript` is an explicit
  devDependency; CSS must be **imported** in .astro files, never `<link>`ed to `/src` paths.
- **Asset case guard:** macOS is case-insensitive, Cloudflare's Linux is not. The prebuild
  script fails the build if any `/assets/...` path in `src/` doesn't match `git ls-files`
  exactly. Asset filename cases live in git, not the FS.
- **Dev GUI:** lil-gui panels load only in dev or with `?lights` URL flag (`scene-gui.js`).
- **HMR:** `three-scene.js` forces a full page reload on hot update (imperative scene can't
  hot-swap). Don't try to make it HMR-safe.

## Repo map

```
src/pages/            index.astro (hero), about.astro, work/index.astro, work/[id].astro (case studies)
src/components/       Nav, BottomBar, ProjectIndicators, ProjectMeta, WorkEntry(-Small)
src/styles/           global/home/nav/about/work.css — imported, not linked
src/data/projects.js  content model (see "Data model")
src/data/scene-settings.json  scene tuning reference
src/scripts/          all JS — one responsibility per file (see "Module reference")
src/scripts/shaders/noise-glsl.js  shared GLSL noise/FBM (NOISE_GLSL)
public/assets/        cube_positions.json, projects/ covers (webp), textures/ (floor normal)
scripts/              check-asset-case.mjs (prebuild), derive-atmo.mjs (cover → atmo palette)
brainstron/           reference dumps (reference_vals.md, ref-skyDome.ms, Group (1).glb)
agent.md  design.md   rules + design docs
```

Homepage entry: `index.astro` imports `initScene(canvas)` from `three-scene.js`.
**`three-orbit.js` is LEGACY** (old orbit implementation; BottomBar still imports its
prev/next). The live homepage 3D is entirely `three-scene.js`.

---

## Homepage 3D architecture (three-scene.js, ~1500 lines)

### The card

- `InstancedMesh` of **5760 RoundedBox cubes** (`GRID_COLS 40 × GRID_ROWS 24 × 6 deep`),
  positions from `public/assets/cube_positions.json`. Face half-extent `(2, 1.24)` world units.
- Material: patched `MeshStandardMaterial` (`_makeCubeMaterial`) — **unlit cover reproduction**:
  each cube samples its own UV window of the cover (`aUvOffset` + `uTileScale`), plus
  cursor-reveal grade, living-depth field, run-culls, edge translucency, Z recession.
- **Fringe rules** (from reference): dissolve = lattice-aligned run-culls + edge translucency +
  Z recession. **Never XY drift/scatter, never blur the hero object.**
- Per-instance typed arrays only (no object per cube): `curPos, scaleArr, uvOffset, vox,
  revealArr (aReveal), bumpArr (aBump), colRand, runRand`.

### Ring navigation (project switch = camera yaw, "Model 1")

- Camera sits at a **fixed seat** `CAM_PIVOT (0,0,5.5)` and **yaws in place**; walls live on a
  ring of radius `CAM_REST_Z 5.5`, one per project, `RING_STEP = 80°` apart.
  `_ringSlot(θ, out)` gives a slot's world position; wall `rotation.y = θ` faces the seat.
- `_camAzimuth` accumulates (never wraps). gsap tweens it over `ORBIT_DURATION 1.3s` per turn
  (`navigate(dir)`); wheel/keys/index clicks call it. `isTransitioning` guards re-entry.
- **Wall cache/pool:** `_wallCache` Map projectIdx→wall (built once per project, never
  disposed while alive); `_pool` Map slotIndex→wall = active slot ± 1 (`_ensureNeighbors`).
  `_repositionWall` re-seats a cached wall to a slot (cheap). Walls are pre-compiled at build
  (`renderer.compile`) to avoid the ~140ms first-show shader hitch.
- A `wall` object owns: idx, slotIndex, theta, all typed arrays, mesh, group, `cubeU`
  (uniform table), coverTex, wobble. `_activateWall(wall)` points all module-level singletons
  (voxelMesh, _projector, _revealU…) at it, hides every other wall, and seats the fog planes.
- Turn choreography: incoming wall shown + its projector lit **before** the sweep; cube-scale
  crossfade via `uTransScale` (outgoing `(1-p)²`, incoming `p²`); the wall that will become
  the new far neighbour is warmed mid-turn; `_retint(idx, dur)` crossfades the world palette.

### Lighting (three real lights, count MUST stay constant)

- **Fixed pool of 3 SpotLight projectors** (`spot-projector.js`, `_projPool`), permanent scene
  children. `slotIndex mod 3` assigns each visible wall a distinct lamp. A hidden wall's lamp
  is set to intensity 0 — **never removed/reparented** (changing the scene light count forces
  a recompile of every material = the historical transition jitter). All 3 get a 1×1
  placeholder `.map` at init so `NUM_SPOT_LIGHT_MAPS` is a constant 3.
- Projector = SpotLight whose `.map` is the project cover (pre-rotated π to cancel projector
  inversion), decay 2, tracks the cursor ("reverse" highlight feel). Cover textures cached in
  a module-level Map (`_projTexCache`) — load/upload once ever.
- `_placeProjector(wall, withCursor)` re-places each visible wall's lamp **every frame** in the
  wall's local frame (normal × `PROJ_DIST 3.25`, cursor travel 1.0).
- **Side rim light** (`side-light.js`) — one PointLight; its `params.x/y/z (4.8, 1.6, 3.4)` are
  offsets **in the active wall's local frame**; `_placeSideLight()` places it per frame.
  Intensity swells with cursor energy. IBL/env intensity is 0; ambient off — the projector is
  the only card key light.

### Atmosphere (where the fog light comes from — no scene light involved)

- **`atmosphere-medium.js`** = single source of truth: shared uniform **objects** (palette
  uBase/uFog/uGlow/uSmoke, light kernel uGlowPos/Radius/Stretch/Intensity, uWind, uTime,
  uEnergy, uMouse) adopted **by reference** by every layer. One `medium.transition(palette)`
  recolors the whole world. Owns the glow "breathing" (two incommensurate sines).
  Never reassign the shared `{ value }` objects.
- **`atmosphere.js`** = the visible backdrop: world-space icosphere dome (r 300, detail 10,
  BackSide, sunk y −12.65, rotY −72°). Fragment maps dome UV → **p-space** via
  `uDomCenter (0.45, 0.487)` / `uDomScale (−7.45, −3.27)`; at the rest camera the visible
  window is ±0.89 × ±0.5 (all tuned values are authored in these units). Three FBM cloud
  layers ride shared wind; light = gaussian kernels (skirt + hot core at `uGlowPos`, backlight
  pocket at `uPocketPos`) → Beer-Lambert absorption/scattering. **Darkness away from the light
  falls out of the math** — if a scene goes dark, the kernel probably isn't where you think.
- **View-yaw compensation:** ring navigation yaws the camera, panning the dome (and anything
  painted in p-space) across the frame. `setViewYaw(azimuth)` sets
  `uViewShift = azimuth/2π × uDomScale.x` (called per frame from `_tick`); the shader adds it
  to the kernel + pocket centers so **the light follows the camera** while clouds stay
  world-anchored. Kernels use `wrapKernel` (x-distance wrapped by `|uDomScale.x|`) so the
  compensation is periodic — correct across the dome's UV seam and any accumulated yaw.
  The **cloud noise domain is NOT seam-wrapped** — a vertical smoke discontinuity can appear
  at one azimuth (known, unfixed).
- **`fog-veil.js`** = mid-ground fog bank plane behind the wall (authored offset: 1.15 behind
  face, y +0.12). **`mist-front.js`** = foreground haze plane (3.0 in front, y +0.3; currently
  gated OFF). Both are **world objects** seated per wall by `_seatFogPlanes(wall)` — at turn
  start for the incoming wall, and on activation. **Never seat them per frame to the camera**
  (screen-glued fog reads dead).
- **`reflective-floor.js`** = circular Reflector mirror (real mirrored re-render); all visible
  floor motion is reflected atmosphere. `setColor(accent)` per project.

### Color rules (settled — do not violate)

- **Hue lives in the world**: the atmosphere's smoke → glow → hot temperature ramp is the ONE
  hue axis. `atmo.glow` must be a warm/saturated MID — **never white**.
- **The grade shapes value only** (`grade-effect.js`): lift blacks, bend highlights warm.
  Grade tints are static/GUI-owned, never tweened per project.
- Per-project color arrives exclusively via `medium.transition()` + `_retint()`.

### Post pipeline (pmndrs, in order)

`RenderPass → AfterimagePass (custom feedback Pass, ghost trails) →
EffectPass(BloomEffect [+ FluidDistortionEffect, TiltShift…]) →
EffectPass(ChromaticAberration, GradeEffect, Vignette, Noise)`

- `fluid-distortion-effect.js` — screen ripple driven by the alien.js Fluid dye (dye:
  `.rg` = signed flow, `.b` = density). The same dye feeds fog thickening (`uInkFog`).
- Bloom: intensity 0.78, threshold 0.48, mipmapBlur.

### Interaction systems (active wall only)

- **mouse** (lerped) drives: camera parallax in camera-local axes, wall tilt (`θ + mx·0.14`),
  projector/side-light travel, kernel mouse-shift.
- **Flowmap** (alien.js) — cursor velocity in card-face UV space → `uFlowmap` (reveal grade).
- **Fluid** (alien.js) — cursor splats → shared dye texture (ripple + fog ink).
- **Energy** — integrated pointer speed w/ exponential decay (`_atmoParams`); swells fog
  density, glow, side light.
- **Reveal/bump** — per-cube eased fields around the cursor (`_updateReveal`), asymmetric
  attack/release; cursor proximity (`_cardProx`) gates projector swell.
- **prefersReduced** honored everywhere: no sweep (snap + 0.4s retint), time frozen at 0,
  no parallax/fluid.

### Public API (used by index.astro / components)

```js
initScene(canvas)   setProject(idx)   setPaused(paused)   destroy()
```

---

## Module reference (src/scripts/)

| File | Status | Role / key exports |
|---|---|---|
| `three-scene.js` | **LIVE — the homepage** | everything above |
| `atmosphere-medium.js` | live | `initAtmosphereMedium({palette})` → `{u, params, update(t,energy,mx,my), transition(palette,{duration}), destroy}`; exports `LIGHT_KERNEL_GLSL` |
| `atmosphere.js` | live | `initAtmosphere({medium, isMobile})` → `{mesh, material, update(), setInk(uniform), setViewYaw(azimuth), destroy}`; exports `DEFAULT_ATMO` |
| `fog-veil.js` | live | `initFogVeil({medium, isMobile})` → `{mesh, material, update, destroy}` |
| `reflective-floor.js` | live | `initReflectiveFloor({scene, accent, renderer, medium})` → `{mesh, update(t), setColor(hex), destroy}` |
| `spot-projector.js` | live | `initProjector({scene, target})` → `{light, params, setImage(path), update(mx,my,presence), setIntensity(v), place(pos,target), transition(glowHex,{duration}), destroy}` |
| `side-light.js` | live | `initSideLight({scene})` → `{light, params, place(pos), update(energy), transition(hex,{duration}), destroy}` |
| `grade-effect.js` | live | `GradeEffect` (pmndrs Effect) — value-only grade |
| `afterimage-pass.js` | live | `AfterimagePass` (pmndrs Pass) — feedback trails |
| `fluid-distortion-effect.js` | live | `FluidDistortionEffect` (pmndrs Effect) |
| `scene-gui.js` | dev-only | `initSceneGui({...everything})` — lazy, `?lights`/dev |
| `shaders/noise-glsl.js` | live | `NOISE_GLSL` (hash/noise/fbm3/fbm4) |
| `nav.js` | live | `goto(viewId)` — ALL internal nav goes through this, never `location.href`; curtain fade |
| `logo.js` | live | logo circle pulse (rAF) |
| `mist-front.js` | gated off (`USE_MIST_FRONT=false`) | foreground haze plane |
| `sky-dome.js` | gated off (`USE_SKY_DOME=false`) | old procedural backdrop |
| `environment.js` | disabled | old 4-layer env (pre-atmosphere) |
| `three-orbit.js` | **legacy** | old orbit scene; BottomBar still imports `prevProject/nextProject` |
| `light-gui.js` | dev-only, legacy-ish | old light GUI |
| `audio.js`, `work-reveals.js` | Phase-2 stubs | Howler ambient / ScrollTrigger reveals — don't implement unprompted |

Feature gates at the top of `three-scene.js`: `USE_SKY_DOME=false`,
`ENABLE_GODRAYS=false`, `USE_MIST_FRONT=false`.

## Data model (`src/data/projects.js`)

`PROJECTS` array; `ORBIT_PROJECTS = PROJECTS.filter(p => p.heroInOrbit)` (currently 3:
keploy, gemx, demand-climate-justice). Copy is placeholder pending real case-study text.

Per project: `id, title, shortDesc, longDesc, role, year, client, type, hasCaseStudy,
liveUrl, tags[], accentTag, heroInOrbit, atmosphereColor, envAccent, shaderType,
coverImage ('/assets/projects/…' — case must match git), caseStudy{layout, challenge,
process, outcome, images[]}` and:

```js
atmo: { base, fog, glow, smoke,               // palette (hex)
        light: { position:[x,y] /* p-space, rest frame */, radius, stretch, intensity } }
```

Palette rules: base near-black · fog = warm-tinted bright neutral · glow = warm-leaning
saturated MID (never white) · smoke = dark-mid saturated dominant hue. Project 0 is the
hand-tuned calibration anchor; new palettes via `node scripts/derive-atmo.mjs` from the cover.

## Invariants & gotchas (violating these has burned us before)

1. **Scene light count never changes** at runtime — fixed 3-projector pool + 1 point light;
   hide via intensity 0, not removal. Otherwise: full material recompile mid-turn (jitter).
2. **Shared uniforms are adopted by reference** — mutate `.value`, never reassign the objects
   in `medium.u` (or a consumer silently detaches).
3. **p-space is the atmosphere's tuning frame** (rest camera at azimuth 0, window ±0.89×±0.5).
   Anything positional added there needs yaw compensation (`uViewShift`) and seam wrapping.
4. **`_camAzimuth` accumulates unboundedly** — anything derived from it must be periodic.
5. Fog planes are world objects, seated per wall — never camera-glued.
6. Walls/textures are cached forever by design; disposal happens only in `destroy()`.
   Cover textures: `_texCache` (card) and `_projTexCache` (projectors) are separate.
7. Asset paths: exact case per git; run `npm run check:assets` if you add any.
8. Hue in world / grade value-only; never blur the hero; fringe = culls + translucency +
   recession only.
9. All internal navigation through `nav.js goto()`; ScrollTrigger logic only in
   `work-reveals.js`.
10. Honor `prefers-reduced-motion` in anything animated you add.
11. No magic numbers — named constants/CSS custom properties; comments explain *why*.

## When you change the hero's look

Compare screenshots against `brainstron/reference_vals.md` honestly before claiming parity.
Tuned dates in comments (e.g. "tuned 2026-07-03") mark hand-calibrated values — don't nudge
them casually; expose new knobs to `scene-gui.js` instead so Aniket can tune live.
