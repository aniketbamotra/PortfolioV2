# Design System — Aniket Bamotra Portfolio
> Single source of truth for all visual, typographic, motion, and interaction decisions.
> Every UI choice made during development must be traceable to a rule in this document.
> When in doubt: do less, not more.

---

## 1. Design Philosophy

This portfolio exists at the seam between design and engineering. The site itself is the proof of that — it should feel technically rigorous and visually considered simultaneously. Nothing here is decorative. Every element either communicates something or gets removed.

**The one rule that governs everything:**
> Black, warm white, and surfaces do the heavy lifting. The accent only directs attention.

If the accent colour is appearing more than once per screen, something is wrong. If an animation exists without a functional reason, remove it. If a component needs more than two states, simplify the component.

---

## 2. Colour

### Base palette

| Token | Value | Role |
|---|---|---|
| `--bg` | `#080808` | Page canvas, Three.js clear colour |
| `--bg2` | `#0f0f0b` | Subtle section distinction, footer zones |
| `--surface` | `#1a1a14` | Cards, raised panels, code blocks |
| `--border` | `rgba(232,232,224,0.06)` | Default dividers, card outlines |
| `--border2` | `rgba(232,232,224,0.12)` | Hover borders, active containers |

### Text

| Token | Value | Role |
|---|---|---|
| `--tx` | `#e8e8e0` | Primary — headings, active nav, CTAs |
| `--tx2` | `rgba(232,232,224,0.42)` | Secondary — body copy, descriptions |
| `--tx3` | `rgba(232,232,224,0.18)` | Muted — labels, metadata, HUD readouts, borders used as text |

### Accent

| Token | Value | Role |
|---|---|---|
| `--acc` | `#c8d44e` | The one colour. Use with extreme restraint. |
| `--acc-bg` | `rgba(200,212,78,0.08)` | Hover fills, tag backgrounds, subtle highlights |
| `--acc-border` | `rgba(200,212,78,0.22)` | Selected/active borders only |

### Accent usage — exhaustive list of permitted uses

The accent `#c8d44e` appears ONLY in:

- The logo animation (primary circle stroke)
- The active nav link underline (`0.5px solid var(--acc)` bottom border)
- The `we-type-dot` bullet on work page entries
- Hover states on `contact-link` arrows on the about page

It does NOT appear on the homepage canvas or in the project index. It does NOT appear on buttons — the scene CTA is a ghost button using `--tx2` and `--border2`. If a new component needs the accent for a reason not listed above, that reason must be documented here before implementation.

### Colour don'ts

- No gray-blue. All neutrals stay warm. `#888` is wrong. `rgba(232,232,224,0.35)` is right.
- No pure white (`#ffffff`). The warmest text is `#e8e8e0`.
- No dark surfaces with blue or purple tint. Surfaces lean warm: `#1a1a14`, not `#1a1a2e`.
- No gradients in UI chrome. Gradients are permitted only in placeholder visuals and Three.js materials.

---

## 3. Typography

### Typefaces

| Role | Family | Source |
|---|---|---|
| UI / Mono | JetBrains Mono | Self-hosted, weights 300 / 400 / 500 |
| Display + Body | Inter | Self-hosted, weights 300 / 400 / 500 / 600 |

No third typeface. Ever. No system fallback that isn't monospace for mono contexts.

### Where each face is used

**JetBrains Mono** — nav links, all labels (`font-size: 8–11px`), metadata, counters, tags, chips, HUD readouts, volume label, index numbers, eyebrows, technical annotations in case studies, code blocks.

**Inter** — project titles (display sizes), section headings, body copy (descriptions, bio, case study narrative), CTA button text (mono exception: button uses mono for the tracking/uppercase treatment).

### Type scale

| Name | Size | Weight | Tracking | Line-height | Face |
|---|---|---|---|---|---| 
| Display | `clamp(36px, 6vw, 80px)` | 600 | `-0.035em` | `0.92` | Inter |
| Heading 1 | `clamp(24px, 3.5vw, 44px)` | 600 | `-0.025em` | `1.0` | Inter |
| Heading 2 | `clamp(18px, 2.4vw, 28px)` | 600 | `-0.02em` | `1.1` | Inter |
| Body | `13–15px` | 300 | `0` | `1.75` | Inter |
| Label | `8–11px` | 400–500 | `0.14–0.22em` | `1` | JetBrains Mono |
| Micro | `7–8px` | 400 | `0.18–0.25em` | `1` | JetBrains Mono |

### Typography rules

- Display and Heading sizes use `clamp()` — never fixed `px` at large sizes
- Labels are ALWAYS uppercase when in JetBrains Mono
- Body copy is NEVER uppercase
- `letter-spacing` on mono labels compensates for the typeface's tight default
- Italics are used once: in the hero descriptor `Design × Engineering / Building interfaces where both sides think` — the second line is italic Inter 300, `var(--tx2)`. Do not introduce italics elsewhere unless a case study layout specifically calls for it.
- No underline on links by default. Underline is a hover state only, and even then prefer colour/opacity shift.

---

## 4. Spacing

Base unit: `8px`. All spacing is a multiple of 8.

| Token | Value | Use |
|---|---|---|
| `--sp-xs` | `8px` | Tight gaps: tag rows, icon gaps |
| `--sp-sm` | `16px` | Internal card padding, small gaps |
| `--sp-md` | `24px` | Component padding |
| `--sp-lg` | `32px` | Section padding, nav padding |
| `--sp-xl` | `48px` | Page-level padding |
| `--sp-2xl` | `64px` | Section separation |
| `--sp-3xl` | `96px` | Major section breaks |

Nav height: `52px` fixed.

---

## 5. Motion

### Principles

1. **One orchestrated moment per page.** Homepage = the full-screen GLSL shader scene, continuously animated. Work page = sequential scroll reveal. About = nothing moves. Case study pages = defined per project.
2. **Motion communicates, it doesn't decorate.** Every animation must answer: what does this tell the user about the state of the interface?
3. **Restraint over richness.** A single well-timed transition lands harder than five simultaneous effects.
4. **Always respect `prefers-reduced-motion`.** Wrap all GSAP and Three.js animations with a check. Orbit still renders; it just doesn't autoplay rotation.

### Timing

| Type | Duration | Easing |
|---|---|---|
| Page transition (out) | `280ms` | `ease-in` |
| Page transition (in) | `400ms` | `ease-out` |
| Hover states | `200ms` | `ease` |
| Logo pulse | `4s` period, sine wave | — |
| Scroll reveal (work page) | `600ms` | `power2.out` (GSAP) |
| Project switch transition | `800ms` total, shader swap at `400ms` | — |

### What does NOT animate

- Nav links (colour shift only, no movement)
- Text (no typewriter effects, no character-by-character reveals)
- Page backgrounds
- Borders or dividers
- Anything on the About page

### GSAP usage rules

- ScrollTrigger for work page reveals only
- No ScrollTrigger on the homepage (homepage is a static GLSL scene, no scroll interaction)
- Page transition curtain is a simple opacity toggle on `#curtain` — not a GSAP timeline
- GSAP is NOT used for the orbit or any Three.js logic

---

## 6. Layout

### Grid

The site does not use a CSS grid system. Layouts are intentional and page-specific. The work page uses a named 3-column grid (`80px 1fr 1fr`). Case study pages define their own layout per project. The about page is a single constrained column (`max-width: 680px`, centred).

### Nav

- Fixed, `top: 0`, `z-index: 500`
- Height: `52px`
- Padding: `0 32px`
- Background: `rgba(8,8,8,0.92)` with `backdrop-filter: blur(16px)` on non-canvas pages
- On the homepage canvas: nav sits over the Three.js scene with `mix-blend-mode: normal` — no blur, fully transparent background
- Logo left, links right. Three links: Work (homepage), All Projects (/work), About (/about)
- Active link: `var(--tx)` colour + `0.5px solid var(--acc)` bottom border
- Inactive links: `var(--tx3)`, uppercase, `0.14em` tracking

### Homepage

- Full viewport, `overflow: hidden`
- Three.js canvas is `position: absolute; inset: 0`
- One full-screen GLSL shader quad fills the canvas at all times
- The shader is unique per project and changes on project switch
- All UI overlays are `position: absolute; z-index: 10`
- No bottom bar, no HUD corners, no orbit ring

UI element positions:
- Logo + nav: top edge, via `Nav.astro` — same as all pages
- Project index: `right: 48px`, vertically centred (`top: 50%`, `translateY(-50%)`)
- Scene meta (role + year): `bottom: 40px`, `left: 48px`
- CTA button: `bottom: 36px`, horizontally centred

### Work page

- `padding-top: 52px` (nav height)
- Header: 2-column grid, left side title, right side description + meta
- Entries: `80px / 1fr / 1fr` grid (index / left-content / right-visual)
- Major entries: full visual area, `aspect-ratio: 16/10`
- Small entries: single row, `height: ~72px`
- Section divider between major and small work
- All left-side content padding: `32px`

### About page

- `max-width: 680px`, `margin: 0 auto`
- `padding: 0 32px 120px`
- Single column throughout
- Contact links: full-width rows with `border-top` / `border-bottom` dividers

---

## 7. Components

### Logo mark

- SVG: two overlapping circles with a vertical stem each
- First circle: `stroke: var(--acc)`, full opacity
- Second circle: `stroke: var(--acc)`, `opacity: 0.45`
- Animation: sine pulse on stroke-opacity only, 4s period, out of phase between circles
- Size in nav: `28 × 19px`
- Never used as a background element, watermark, or decorative fill

### Tags / Chips

- Font: JetBrains Mono, `7–8px`, uppercase, `0.1em` tracking
- Padding: `3px 8–9px`
- Border: `0.5px solid var(--border2)`
- Background: transparent (default) or `var(--acc-bg)` (highlighted)
- Border-radius: `2px` — never fully rounded, never `0`
- Colour: `var(--tx3)` default, `var(--acc)` for highlighted type

### Buttons

**Primary (CTA):**
- Background: `var(--acc)`, text: `#0a0a06` (near-black), font: JetBrains Mono 500
- Padding: `9px 20px`, border-radius: `2px`
- Hover: background lightens to `#d6e35a`, `translateY(-1px)`
- Never use the primary button in more than one place per page

**Ghost:**
- Background: transparent, border: `0.5px solid var(--border2)`, text: `var(--tx2)`
- Hover: border → `rgba(255,255,255,0.25)`, text → `var(--tx)`
- Same size as primary

### Project index (homepage)

- Position: right side, vertically centred
- Font: JetBrains Mono, `11px`, `0.06em` tracking
- Default state: `var(--tx3)`
- Hover: `var(--tx2)`
- Active: `var(--tx)` — no other visual treatment
- Gap between entries: `4px`
- No bullets, no numbers, no accent colour
- Clicking an entry calls `setProject(idx)` in `three-scene.js`

### Scene CTA (homepage)

- Position: bottom centre, `bottom: 36px`
- Font: JetBrains Mono, `10px`, `0.16em` tracking, uppercase
- Style: ghost — transparent background, `0.5px solid var(--border2)`
- Hover: `var(--tx)`, border `rgba(255,255,255,0.25)`
- Text: "View Project ↗" — updates per active project based on `hasCaseStudy` and `liveUrl`
- If `hasCaseStudy: true` → "View Case Study ↗"
- If `hasCaseStudy: false` and `liveUrl` exists → "View Live ↗"
- If neither → button is hidden

### Work entries (major)

- 3-column grid: index number / left content / right visual
- Index: JetBrains Mono, `11px`, `var(--tx3)`, zero-padded (`01`, `02`...)
- Type label: Mono `8px`, with `5px` accent dot
- Title: Inter 600, `clamp(20px, 2.8vw, 34px)`, `-0.025em` tracking
- Visual: `aspect-ratio: 16/10`, `border: 0.5px solid var(--border)`
- Hover: `background: rgba(200,212,78,0.025)`, visual `scale(1.03)`
- CTA: Mono `8px`, `var(--acc)`, gap widens on hover

### Work entries (small)

- 3-column grid: index / body / arrow
- Height: approximately `72px`
- Title: Inter 500, `16px`
- Arrow: `var(--tx3)` → `var(--acc)` + `translate(3px, -3px)` on hover

---

## 8. Three.js Scene Spec

### Architecture

The homepage is a single full-screen GLSL shader rendered via an orthographic camera. There is no orbit ring, no 3D cards, no perspective camera.

- Renderer: `WebGLRenderer`, `antialias: true`, clear colour matches current project `atmosphereColor`
- Pixel ratio: `Math.min(devicePixelRatio, 2)`
- Camera: `OrthographicCamera(-1, 1, 1, -1, 0, 1)` — full-screen quad, no perspective
- Scene: one `PlaneGeometry(2, 2)` mesh with `ShaderMaterial`

### Shader system

Five GLSL fragment shaders, one per project type:

| shaderType | Project | Visual concept |
|---|---|---|
| `token-grid` | Design Language System | Animated token grid, rows pulse in waves |
| `particles` | Interactive Product Experience | Particle field attracted to mouse |
| `flow-field` | Brand Platform | Perlin noise flow field rendered as lines |
| `data-stream` | Analytics Dashboard | Vertical data columns rising and falling |
| `growth` | Creative Experiments | Branching generative growth cycle |

### Uniforms (all shaders share this interface)

| Uniform | Type | Description |
|---|---|---|
| `u_time` | `float` | Elapsed seconds since scene init |
| `u_res` | `vec2` | Canvas resolution in pixels |
| `u_mouse` | `vec2` | Normalised mouse position 0–1 |
| `u_color` | `vec3` | Current project atmosphere colour |

### Project switching

- Duration: `800ms` total
- At `0ms`: begin transition flag, start timing
- At `400ms`: swap fragment shader, update `u_color`, update atmosphere, update UI
- At `800ms`: clear transition flag
- Guard: if `isTransitioning === true`, ignore new switch requests

### Project data fields (added to `projects.js`)

Each project in `ORBIT_PROJECTS` now has:
- `atmosphereColor: string` — CSS hex, used as clear colour and `u_color` uniform
- `shaderType: string` — key into the `SHADERS` map in `three-scene.js`

### Performance rules

- Shader geometry created once, never recreated
- Mouse uniform updated every frame via `mat.uniforms.u_mouse.value.set(x, y)`
- Fragment shader swap sets `mat.needsUpdate = true`
- Render loop pauses when `#home` view is not active — same guard as before
- `destroy()` disposes geometry, material, renderer

---

## 9. What This Site Is Not

These are equally important as the rules above.

- Not a React app
- Not a Tailwind project
- Not a template — every case study page is purpose-designed
- Not a feature showcase — the interactions serve navigation, not novelty
- Not a dark mode / light mode toggle site — dark only, always
- Not responsive yet (Phase 2) — desktop-first, `min-width: 1024px` assumption for v1
- Not accessible yet beyond basics (Phase 2) — keyboard nav exists, ARIA is Phase 2

---

## 10. File Naming and Organisation

```
src/
  styles/
    global.css          ← CSS custom properties, resets, base styles
    nav.css             ← Nav component
    home.css            ← Homepage-specific
    work.css            ← Work page
    about.css           ← About page
  scripts/
    three-scene.js      ← Three.js scene, self-contained
    nav.js              ← Navigation transitions, curtain
    logo.js             ← Logo SVG animation
    work-reveals.js     ← GSAP ScrollTrigger for work page
    audio.js            ← Howler.js setup (Phase 2)
  pages/
    index.astro         ← Homepage
    work/
      index.astro       ← All projects
      [slug].astro      ← Case study pages (Phase 2)
    about.astro         ← About + Contact
  components/
    Nav.astro
    WorkEntry.astro
    WorkEntrySmall.astro
  data/
    projects.js         ← Single source of truth for all project data
  fonts/                ← Self-hosted font files
  assets/
    logo.svg
    projects/           ← Project images/videos (added when available)
```

---

## 11. Project Data Schema

All project content lives in `src/data/projects.js`. No content in component files.

```js
// src/data/projects.js
export const PROJECTS = [
  {
    id: 'project-slug',
    title: 'Project Title',
    shortDesc: 'One sentence for the orbit card and bottom bar.',
    longDesc: 'Two to three sentences for the work page entry.',
    role: 'UX Engineer · Lead',
    year: '2024',
    client: 'Client Name or "Freelance"',
    type: 'enterprise' | 'freelance' | 'experiment' | 'dls',
    hasCaseStudy: true | false,
    liveUrl: 'https://...' | null,
    tags: ['Tag One', 'Tag Two'],
    accentTag: 'Enterprise',   // The tag that gets accent colour treatment
    heroInOrbit: true | false, // Whether this project appears in the homepage scene index
    atmosphereColor: '#080808', // CSS hex — full-bleed background tint per project
    shaderType: 'token-grid',   // GLSL shader type — see design.md section 8
    coverImage: '/assets/projects/slug/cover.webp' | null,
    // Case study data — only if hasCaseStudy: true
    caseStudy: {
      layout: 'dls' | 'webgl' | 'brand' | null, // Which case study layout variant
      challenge: '',
      process: '',
      outcome: '',
      images: [],
    }
  }
]

// Orbit projects — in display order (most impactful first)
export const ORBIT_PROJECTS = PROJECTS.filter(p => p.heroInOrbit);

// Work page — all projects, impact-ordered (set manually)
export const ALL_PROJECTS = PROJECTS; // order in this array = display order
```

---

*Last updated: initial design system pass*
*Next update: after first real project content is added*