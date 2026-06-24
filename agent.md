# Agent Rules — Aniket Bamotra Portfolio
> Instructions for Claude Code when working on this project.
> Read this before reading any code. Reference it when making any decision.

---

## Who You Are Working With

Aniket is a UX Engineer and Creative Technologist. He understands code, design systems, Three.js, and GSAP. Do not over-explain basics. Do explain your reasoning when making non-obvious architectural or design choices. Treat this as a peer collaboration, not a tutoring session.

He will be reviewing every output critically. Quality over speed. If something will look wrong or feel wrong, say so before building it.

---

## The Prime Directive

**This portfolio is itself the work.** It demonstrates craft, technical judgment, and design sensibility. Every line of CSS, every timing decision, every component name is a signal. There is no "good enough" — only "would Aniket be proud to show this to a creative director at a top studio" and "would a senior engineer at Google find the implementation clean."

When in doubt, ask. Do not guess at design intent. Do not invent features. Do not add what was not asked for.

---

## Before You Write Any Code

1. Read `design.md` in full. Every visual decision is documented there.
2. Read `src/data/projects.js` to understand the content model.
3. 3. Check if what you're about to build already exists in `src/components/` or `src/scripts/`. Note: the homepage 3D logic lives in `three-scene.js`, not `three-orbit.js`.
4. If the task is a new page or major component, state your implementation plan before writing code and wait for confirmation.

---

## Code Standards

### General

- Write clean, readable, well-commented code. Comments explain *why*, not *what*.
- No magic numbers. Use CSS custom properties from `design.md` or named JS constants.
- No inline styles in `.astro` files except for dynamic values that must be set via JS.
- Every file has a single responsibility. `three-orbit.js` does nothing but the orbit scene.

### CSS

- All custom properties defined in `global.css` `:root`. Never redefined elsewhere.
- No `!important`. Ever. If you need it, the specificity architecture is wrong.
- No Tailwind. No utility classes. No CSS-in-JS.
- Class names are semantic and descriptive: `.work-entry-small`, not `.wes` or `.card-sm`.
- Mobile styles are Phase 2. Write desktop-first. `min-width: 1024px` is the current assumption. Do not add responsive breakpoints yet — they will be added systematically in Phase 2.
- Do not use `transition: all`. Always specify the exact property: `transition: opacity 0.2s ease`.

### JavaScript

- Vanilla JS only. No React, no Vue, no Svelte. No jQuery.
- ES modules throughout. Use `import` / `export`.
- No global variables. Everything is encapsulated in module scope or explicitly exported.
- Three.js, GSAP, Lenis, and Howler are imported via npm, not CDN, in the final build.
- All GSAP ScrollTrigger usage is isolated to `work-reveals.js`.
- All Three.js logic is isolated to `three-scene.js`. It exports an `initScene(canvas)` function and a `destroy()` function.
- Event listeners must be cleaned up. If a script adds a listener, it removes it on `destroy()`.
- Check `prefers-reduced-motion` before initialising any animation:
  ```js
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  ```

### Astro

- Pages are in `src/pages/`. Components are in `src/components/`.
- Pass data via props, not global state.
- Use `client:only="vanilla"` for scripts that need the DOM — avoid `client:load` which implies framework components.
- Frontmatter imports only what is used on that page.
- Layout components (`Nav.astro`, etc.) must not contain page-specific logic.

### Three.js

- One renderer, one scene, one camera. Initialised once, not recreated on navigation.
- Geometries and materials are created once and reused. Never create geometry inside the render loop.
- The render loop uses a `isActive` flag — it pauses when the homepage is not visible.
- Dispose of geometries and materials when the scene is destroyed: `geometry.dispose()`, `material.dispose()`.
- Texture loading uses `THREE.TextureLoader` with a loading manager.

---

## Design Rules (Summary — Full Detail in design.md)

The accent colour `#c8d44e` appears in exactly these places and nowhere else:
- The logo animation (primary circle stroke)
- The active nav link underline
- The `we-type-dot` bullet on work page entries
- Hover states on `contact-link` arrows

It does NOT appear on the homepage at all. The project index uses plain text colour states only (--tx3 / --tx2 / --tx). No accent on the homepage.

If you are about to use `var(--acc)` anywhere not on this list, stop and ask.

The Two Typefaces:
- JetBrains Mono: nav, labels, metadata, tags, counters, HUD, code
- Inter: headings, body, descriptions

No gray-blue. All neutrals are warm. `rgba(232,232,224,x)` not `rgba(200,200,210,x)`.

No animation on the About page. Nothing moves there.

---

## Navigation and Page Transitions

Page transitions use a black curtain div (`#curtain`):
- Navigating away: fade `#curtain` to `opacity: 1` over `280ms`
- Swap the visible view
- Fade `#curtain` back to `opacity: 0` over `400ms`

Do not use `window.location.href` for internal navigation — use the `goto(view)` function in `nav.js`. The Three.js orbit's `requestAnimationFrame` loop checks if `#home` is visible and pauses if not.

---

## Project Data

All project content lives in `src/data/projects.js`. If you need to display a project title, description, tag, or any content in any component, it comes from this file. Never hardcode content in component files.

If project data is missing (cover images, case study content), use the placeholder system defined in `design.md` section 7. Do not invent content.

---

## What You Must Never Do

- Add features that were not requested
- Change the colour palette — it is finalised in `design.md`
- Add a third typeface
- Add Tailwind, a component library, or any CSS framework
- Use `!important` in CSS
- Add responsive breakpoints (Phase 2)
- Add accessibility attributes beyond basic keyboard navigation (Phase 2)
- Use `transition: all`
- Create geometry or materials inside the Three.js render loop
- Reference `three-orbit.js` — it no longer exists, the file is now `three-scene.js`
- Add a second 3D element to the homepage scene — one full-screen shader quad only
- Use a perspective camera for the homepage — it uses OrthographicCamera
- Use the accent colour outside of its documented use cases
- Add animations to the About page
- Use React, Vue, Svelte, or any JS framework
- Add a resume download link, contact form, or dark/light mode toggle — these are explicit non-features
- Commit directly to `main` — use feature branches

---

## When You Are Unsure

If a design decision is not covered by `design.md`, do this in order:
1. Check if the existing code has established a pattern for it
2. Apply the closest existing rule from `design.md`
3. If still unsure, ask before implementing

If a technical decision has multiple valid approaches, state the tradeoffs briefly and recommend one. Do not implement both.

---

## Definition of Done

A task is done when:
- [ ] It matches the specification in `design.md`
- [ ] It works without console errors
- [ ] CSS uses only custom properties defined in `global.css`
- [ ] No hardcoded content (text, colours, sizes) outside of their designated files
- [ ] The `prefers-reduced-motion` check is in place for any new animation
- [ ] Event listeners are cleaned up
- [ ] The code is readable without needing to run it

---

## Phase Awareness

**Phase 1 (current):** Homepage full-screen shader scene with project switching + work page + about page. Desktop only. No audio (slider removed — will return in Phase 2 as an overlay element). Placeholder project content. No case study pages.

**Phase 2 (next):** Case study pages (one per major project, unique layouts). Mobile responsive. Audio (Howler.js + ambient file). Accessibility pass. Performance audit.

**Phase 3 (future):** Post-processing (grain, bloom). Scroll-driven camera in case studies. Possible AI navigation assistant.

Do not implement Phase 2 or 3 features during Phase 1. If you see an opportunity that clearly belongs to a later phase, note it as a comment in the code: `// Phase 2: add bloom post-processing here`.

---

*This document is the law. design.md is the aesthetic. projects.js is the content. Everything else is implementation.*