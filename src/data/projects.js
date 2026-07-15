// Real project slots (copy is DUMMY placeholder for now — awaiting final case-study text).
// atmo palettes: project 0 is the hand-tuned reference (2026-07-03); projects 1-2 were
// derived from their cover images via scripts/derive-atmo.mjs (dominant-hue cluster →
// base/fog/glow/smoke stations) and are tunable literals. Rules (settled): base near-black,
// fog = warm-tinted bright neutral, glow = warm-leaning saturated MID of the temperature
// ramp (never white), smoke = dark-mid saturated dominant hue.
export const PROJECTS = [
  {
    id: 'keploy',
    title: 'Keploy',
    // shortDesc/longDesc are DUMMY copy aligned with the caseStudy content below.
    shortDesc: 'Design language system for an open-source API testing platform.',
    longDesc: 'A design language system and frontend architecture for an open-source API testing platform — token pipeline, 38-component library, and the redesign of the test-run console.',
    role: 'UX Engineer',
    year: '2025',
    client: 'Keploy',
    type: 'enterprise',
    hasCaseStudy: true,
    liveUrl: null,
    tags: ['Design Systems', 'React', 'Open Source'],
    accentTag: 'Product',
    heroInOrbit: true,
    atmosphereColor: '#08080f',
    envAccent: '#ffaa66',
    // Hand-tuned reference palette (2026-07-03) — derive-atmo.mjs reproduces it within a
    // few degrees (#a8522e/#e78b40/#eed9c4), left untouched as the calibration anchor.
    atmo: { base: '#0b1020', fog: '#b8c8e3', glow: '#82adff', smoke: '#2b3e66', light: { position: [1.16, 0.12], radius: 1.04, stretch: 1.12, intensity: 1.58 } },
    shaderType: 'token-grid',
    coverImage: '/assets/projects/keploy.webp',
    // Case-study content is DUMMY placeholder copy (plausible, technical-audience tone)
    // rendered by pages/work/keploy.astro. Replace with real text when available.
    caseStudy: {
      layout: 'dls',
      headline: 'A design language system and frontend architecture for an open-source API testing platform.',
      overview:
        'Keploy records real API traffic and replays it as deterministic tests and mocks. ' +
        'The product surface had grown organically across a web console, a VS Code extension, and docs — ' +
        'three codebases, three visual dialects, no shared source of truth. I owned the design language ' +
        'system end-to-end: token pipeline, component library, and the redesign of the test-run console ' +
        'that sits on top of it.',
      timeline: 'Jan 2024 — Mar 2025',
      team: 'Solo designer-engineer, embedded with 4 core maintainers',
      scope: ['Design language system', 'Token pipeline', 'React component library', 'Test-run console'],
      stack: ['React 18', 'TypeScript', 'Style Dictionary', 'Radix Primitives', 'Storybook', 'Vitest + Playwright'],
      challenge: [
        'Developer tools earn trust through precision. When a diff viewer renders a flaky timestamp as a ' +
        'test failure, or two surfaces disagree about what "warning orange" means, users stop believing ' +
        'the tool — and an API testing platform lives or dies on believability.',
        'The audit found 14 button variants, 9 shades of the brand orange, and three different table ' +
        'implementations — one of which locked up above ~2,000 rows. Contributors (this is an open-source ' +
        'project, so most frontend PRs come from strangers) had no way to know which pattern was canonical. ' +
        'The brief: one system rigorous enough that a first-time contributor ships on-brand UI by default, ' +
        'without a designer in the loop.',
      ],
      sections: [
        {
          kicker: '01 — Foundation',
          title: 'Tokens as the contract',
          paragraphs: [
            'Everything starts from a three-tier token architecture — primitives → semantic aliases → ' +
            'component tokens — authored once in JSON and compiled by Style Dictionary to CSS custom ' +
            'properties, a typed TypeScript map, and a Tailwind preset. No surface consumes a raw hex ' +
            'value; the semantic layer is the only public API, so retheming (including the dark-first ' +
            'console theme) is a data change, not a refactor.',
            'The typed map matters more than it sounds: token names are string-literal types, so a ' +
            'contributor referencing a token that does not exist gets a compile error, not a silently ' +
            'wrong color in production.',
          ],
          code: {
            label: 'tokens/semantic.json → generated types',
            source:
`// tokens compile to CSS vars + a literal-typed map
export const token = {
  'surface.raised':   'var(--kp-surface-raised)',
  'status.pass':      'var(--kp-status-pass)',
  'status.flaky':     'var(--kp-status-flaky)',
  'diff.added.bg':    'var(--kp-diff-added-bg)',
} as const satisfies TokenMap;

// ✗ token['status.sucess'] — compile error, not a wrong color`,
          },
        },
        {
          kicker: '02 — Components',
          title: 'Headless core, styled shell',
          paragraphs: [
            'The library is 38 components in two layers: Radix primitives handle focus management, ' +
            'ARIA wiring, and collision-aware positioning; a thin styled shell binds them to the token ' +
            'system. Compound-component APIs keep composition in JSX rather than in prop soup — a test-run ' +
            'card is <TestRun> wrapping <TestRun.Status>, <TestRun.Diff>, <TestRun.Meta>, not a component ' +
            'with 30 props.',
            'Every component ships with Storybook coverage, an interaction test, and a docs page generated ' +
            'from the same source. CI runs axe on every story; a PR that regresses contrast or keyboard ' +
            'reachability fails before review.',
          ],
          figure: { label: 'Component library — 38 components, Storybook coverage map' },
        },
        {
          kicker: '03 — The hard problem',
          title: 'Making replayed traffic legible',
          paragraphs: [
            'The core screen is a diff between a recorded API response and the replayed one. Raw JSON ' +
            'diffs are hostile: a 4,000-line payload with one meaningful change and forty noisy ones ' +
            '(timestamps, UUIDs, server nonces). The redesigned diff viewer classifies noise ' +
            'declaratively — fields matched by the project\'s noise config render de-emphasized and ' +
            'excluded from the pass/fail verdict, with a one-click affordance to promote a flaky field ' +
            'into the config.',
            'Test runs routinely contain thousands of assertions, so the run table is virtualized ' +
            '(TanStack Virtual) with stable row heights and keyboard-first navigation: j/k row ' +
            'traversal, enter to expand a diff, and every state deep-linkable. A 10,000-row run scrolls ' +
            'at 60fps where the old table died at 2,000.',
          ],
          figure: { label: 'Diff viewer — noise classification and latency waterfall' },
        },
        {
          kicker: '04 — Adoption',
          title: 'Migration without a flag day',
          paragraphs: [
            'Rewrites stall; strangler migrations ship. Legacy screens got the token CSS variables ' +
            'injected at the root, so old components inherited the new palette immediately, and a ' +
            'codemod swapped the highest-traffic primitives (Button, Input, Table) in bulk. An ESLint ' +
            'rule flags raw hex values and legacy imports on every new PR, so the system tightens ' +
            'instead of eroding — the ratchet, not the review comment, guards consistency.',
          ],
        },
      ],
      outcome: {
        paragraphs: [
          'Dummy numbers, real shape: the system cut frontend build time for new screens by roughly ' +
          '60%, and contributor UI PRs stopped needing design review in the common case — the tokens, ' +
          'lint rules, and CI gates carry that review instead. The console redesign shipped with the ' +
          'v2.3 release and became the default surface for new users.',
        ],
        metrics: [
          { value: '38', label: 'components in the system', note: '100% Storybook + axe coverage' },
          { value: '−62%', label: 'UI build time for new screens', note: 'measured across 6 releases' },
          { value: '10k', label: 'rows at 60fps', note: 'virtualized run table (was ~2k)' },
          { value: '0', label: 'raw hex values in app code', note: 'enforced by lint ratchet' },
        ],
      },
      images: [],
    }
  },
  {
    id: 'gemx',
    title: 'GEMx',
    // shortDesc/longDesc are DUMMY copy aligned with the caseStudy content below.
    shortDesc: 'Brand identity and a real-time WebGL showroom for a gemstone exchange.',
    longDesc: 'Brand identity and a real-time WebGL gemstone showroom, built as one system — dispersion optics in the logotype, dispersion shaders on screen, 60fps on a mid-tier phone.',
    role: 'Creative Technologist',
    year: '2024',
    client: 'GEMx',
    type: 'freelance',
    hasCaseStudy: true,
    liveUrl: null,
    tags: ['Three.js', 'WebGL', 'Brand'],
    accentTag: 'Freelance',
    heroInOrbit: true,
    atmosphereColor: '#04100a',
    envAccent: '#55ddaa',
    // Derived from Gemx.png (dominant hue 157.7°) via scripts/derive-atmo.mjs
    atmo: { base: '#07110f', fog: '#b7d8ca', glow: '#60c49b', smoke: '#1f493d', light: { position: [1.12, 0.04], radius: 0.94, stretch: 1.3, intensity: 1.42 } },
    shaderType: 'flow-field',
    coverImage: '/assets/projects/Gemx.webp',
    // Case-study content is DUMMY placeholder copy — replace with real text when available.
    caseStudy: {
      layout: 'brand',
      headline: 'Brand identity and a real-time WebGL showroom for a gemstone exchange.',
      overview:
        'GEMx connects independent gem cutters with buyers who never get to hold the stone. ' +
        'The pitch: if the product is light itself, the website has to render light honestly. ' +
        'I built the identity and the interactive marketing site as one system — a logotype drawn ' +
        'from dispersion optics, and a real-time gemstone renderer that runs on a mid-tier phone.',
      timeline: 'Apr 2024 — Sep 2024',
      team: 'Solo, with GEMx founders and a gemologist consultant',
      scope: ['Brand identity', 'Real-time gemstone renderer', 'Marketing site', 'CMS handoff'],
      stack: ['Three.js', 'Custom GLSL', 'Astro', 'GSAP', 'Sanity CMS'],
      challenge: [
        'Gem trading runs on physical inspection — color, cut, and "fire" (dispersion, the rainbow ' +
        'flashes as a stone moves). Photography flattens all three, which is why online gem listings ' +
        'look like costume jewelry and price accordingly. GEMx needed buyers to trust a stone they ' +
        'could only see through a screen.',
        'The constraint that shaped everything: the buyers are not on workstations. They are dealers ' +
        'checking listings on phones in markets in Jaipur, Bangkok, and Antwerp. Path-traced gem ' +
        'renders were off the table — the fire had to be real-time, on hardware I did not control, ' +
        'on networks I could not assume.',
      ],
      sections: [
        {
          kicker: '01 — Identity',
          title: 'A brand drawn from optics',
          paragraphs: [
            'The identity starts where the product does: refraction. The logotype is set on a baseline ' +
            'that kinks at the angle light bends entering corundum (the sapphire family) — a detail ' +
            'nobody consciously reads and every gemologist feels. The palette is sampled from ' +
            'certification-grade color standards rather than a brand-book mood, so a "GEMx emerald ' +
            'green" is a measurable thing, not a vibe.',
            'Everything ships as tokens: the print deck, the site, and the renderer\'s material presets ' +
            'draw from one palette definition, so the stone on screen and the wordmark beside it agree.',
          ],
          figure: { label: 'Identity system — logotype construction and certification palette' },
        },
        {
          kicker: '02 — Rendering',
          title: 'Faking fire honestly',
          paragraphs: [
            'Real dispersion needs spectral ray tracing; phones need something else. The renderer fakes ' +
            'it in layers that each stay cheap: cubemap refraction with a per-channel index of ' +
            'refraction offset (three texture taps buy the rainbow), a facet-space glint pass driven by ' +
            'the device gyroscope so the stone flashes as the phone tilts, and screen-space sparkle ' +
            'seeded per-facet so highlights sit on geometry, not on the screen.',
            'The honesty rule: every approximation was reviewed against reference footage of the actual ' +
            'stones with the gemologist. If a shortcut made a stone look better than it is, it came ' +
            'out — the renderer is a listing, not an ad.',
          ],
          code: {
            label: 'gem.frag — per-channel IOR dispersion (abridged)',
            source:
`// three refractions, one per channel — the cheap rainbow
vec3 dispersed;
dispersed.r = texture(uEnv, refract(V, N, uIOR * 0.985)).r;
dispersed.g = texture(uEnv, refract(V, N, uIOR        )).g;
dispersed.b = texture(uEnv, refract(V, N, uIOR * 1.015)).b;

// facet glint — gyro-driven, seeded per facet so
// sparkle sticks to geometry, not to the screen
float glint = facetSparkle(vFacetId, uTilt);`,
          },
        },
        {
          kicker: '03 — Performance',
          title: 'A budget, not a benchmark',
          paragraphs: [
            'The site holds a hard envelope: 60fps on a three-year-old mid-tier Android, first paint ' +
            'before the 3D loads, total transfer including geometry under 3.5MB. A device probe on ' +
            'first frame sorts hardware into three quality tiers — resolution scale, sparkle density, ' +
            'and refraction taps degrade together, so a low tier looks simpler, never broken.',
            'The stone geometry ships as Draco-compressed buffers behind a poster frame; the page is ' +
            'fully readable before WebGL wakes up, and stays fully readable if it never does.',
          ],
          figure: { label: 'Quality tiers — the same stone at high / mid / low envelope' },
        },
        {
          kicker: '04 — Handoff',
          title: 'A showroom the founders can run',
          paragraphs: [
            'New stones enter through Sanity: the founders upload certification data and studio ' +
            'turntable photos, and the pipeline derives material presets (IOR, dispersion strength, ' +
            'body color) from the certificate fields. No developer in the loop per listing — the ' +
            'renderer reads the CMS like a database of physics, which is what a gem certificate is.',
          ],
        },
      ],
      outcome: {
        paragraphs: [
          'Dummy numbers, real shape: the interactive showroom became the sales deck — founders open ' +
          'listings in meetings instead of slides. Session data moved the way a showroom should: ' +
          'people stay, tilt the stone, and come back with the phone held sideways.',
        ],
        metrics: [
          { value: '60fps', label: 'on mid-tier mobile', note: 'three-year-old Android, tier 2' },
          { value: '1.8s', label: 'first contentful paint', note: 'page readable before WebGL wakes' },
          { value: '3.2MB', label: 'total transfer with 3D', note: 'Draco geometry + KTX2 environments' },
          { value: '+34%', label: 'median session duration', note: 'vs. the photo-grid predecessor' },
        ],
      },
      images: [],
    }
  },
  {
    id: 'demand-climate-justice',
    title: 'Demand Climate Justice',
    // shortDesc/longDesc are DUMMY copy aligned with the caseStudy content below.
    shortDesc: 'Multilingual campaign platform for a global climate justice coalition.',
    longDesc: 'A campaign platform for a 200-organisation climate justice coalition — eleven languages on one layout, a 150KB page budget enforced in CI, built to load over 2G.',
    role: 'Design Technologist',
    year: '2023',
    client: 'DCJ',
    type: 'freelance',
    hasCaseStudy: true,
    liveUrl: null,
    tags: ['Astro', 'Motion Design', 'Campaign'],
    accentTag: 'Campaign',
    heroInOrbit: true,
    atmosphereColor: '#0d0a06',
    envAccent: '#e8b98a',
    // Derived from DCJ.png (dominant hue 20.7°) via scripts/derive-atmo.mjs
    atmo: { base: '#160b08', fog: '#efd1ad', glow: '#ed9446', smoke: '#6a2e1d', light: { position: [1.27, 0.16], radius: 1.08, stretch: 1.0, intensity: 1.72 } },
    shaderType: 'growth',
    coverImage: '/assets/projects/DCJ.webp',
    // Case-study content is DUMMY placeholder copy — replace with real text when available.
    caseStudy: {
      layout: 'campaign',
      headline: 'A multilingual campaign platform for a global climate justice coalition.',
      overview:
        'Demand Climate Justice is a coalition of 200+ grassroots organisations across the Global ' +
        'South. The platform carries their campaigns: actions, petitions, and briefings that have to ' +
        'load on a shared phone over 2G in Manila as reliably as on fibre in Berlin. I designed and ' +
        'built the site — static-first Astro, motion used as punctuation, and a content model that ' +
        'translators run without engineers.',
      timeline: 'Feb 2023 — Aug 2023',
      team: 'Solo build, with the coalition\'s comms working group',
      scope: ['Campaign platform', 'Design system', 'i18n architecture', 'Action toolkit'],
      stack: ['Astro', 'Vanilla JS', 'GSAP ScrollTrigger', 'Decap CMS', 'Cloudflare Pages'],
      challenge: [
        'Campaign sites usually optimise for the newsroom demo: heavy hero video, parallax ' +
        'everything, a cookie wall, and a 9MB payload that excludes exactly the people the campaign ' +
        'claims to represent. The coalition\'s brief inverted that — the primary audience is an ' +
        'organiser on an entry-level Android with intermittent connectivity, and the secondary ' +
        'audience is a journalist on deadline. Both need the same page to work in under three seconds.',
        'The second constraint was voice. Eleven languages at launch, several right-to-left, ' +
        'translated by volunteers on their own schedule. The design could not depend on line counts, ' +
        'text direction, or any one language\'s rhythm — and it had to feel urgent in all of them.',
      ],
      sections: [
        {
          kicker: '01 — Constraints',
          title: 'The performance budget is the brief',
          paragraphs: [
            'Every page holds a hard budget: 150KB total transfer, zero client-side JavaScript by ' +
            'default, interactive in one round trip. Astro\'s static output does most of the work — ' +
            'JS is opt-in per island, and only two islands exist site-wide (the petition form and the ' +
            'language switcher). Images ship as AVIF with aggressive art-direction crops; the largest ' +
            'asset on the median page is a headline, which is how it should read.',
            'The budget is enforced, not aspirational: CI fails any PR that pushes a page over it, ' +
            'with the size diff printed in the check. Volunteers adding content cannot accidentally ' +
            'break the audience the site exists for.',
          ],
        },
        {
          kicker: '02 — Motion',
          title: 'Urgency without decoration',
          paragraphs: [
            'A justice campaign earns attention with what it says, so motion works as punctuation, ' +
            'never as furniture. Reveals are scroll-driven and CSS-only where the browser allows; the ' +
            'single GSAP timeline on the homepage animates one thing — the campaign\'s counter of ' +
            'signatures — because a number climbing is the argument. Everything honours ' +
            'prefers-reduced-motion by replacing movement with opacity, not by removing information.',
            'The visual temperature does the emotional work instead: a warm ember palette on ' +
            'near-black, sampled from protest photography at dusk, that survives both AMOLED phones ' +
            'and newsprint reproduction.',
          ],
          figure: { label: 'Motion spec — reveal grammar and the one permitted timeline' },
        },
        {
          kicker: '03 — Languages',
          title: 'Eleven languages, one layout',
          paragraphs: [
            'The grid is direction-agnostic: logical properties everywhere (no left/right, only ' +
            'start/end), type scales defined per-script so Arabic and Devanagari sit on the same ' +
            'visual rhythm as Latin, and every component tested against the longest German compound ' +
            'and the shortest Tagalog verb the translators could find. RTL is not a mirrored ' +
            'afterthought — it is the same stylesheet.',
            'Translators work in Decap CMS against a locked content model: fields, not freeform ' +
            'pages. A missing translation falls back to English with a visible marker rather than a ' +
            'broken layout, so partial launches are shippable — which is how eleven languages went ' +
            'live in six months on volunteer time.',
          ],
          figure: { label: 'i18n system — one grid across Latin, Arabic, and Devanagari' },
        },
        {
          kicker: '04 — Actions',
          title: 'The toolkit is the product',
          paragraphs: [
            'The pages exist to move people to act, so the action surfaces got the engineering ' +
            'attention: petition forms that submit over flaky connections (queued retry, optimistic ' +
            'confirmation), share cards generated per-campaign and per-language at build time, and a ' +
            'press kit that downloads as one file. Organisers embed any campaign block on their own ' +
            'org\'s site with a copy-paste snippet — the coalition\'s reach is its member sites, not ' +
            'its domain.',
          ],
        },
      ],
      outcome: {
        paragraphs: [
          'Dummy numbers, real shape: the platform carried three coordinated global actions in its ' +
          'first year without an engineer on call — the CI budget, the locked content model, and the ' +
          'static architecture held. The site loads where its audience lives, which was the entire brief.',
        ],
        metrics: [
          { value: '11', label: 'languages at launch', note: 'incl. RTL — one stylesheet, no forks' },
          { value: '148KB', label: 'median page transfer', note: 'budget enforced in CI' },
          { value: '100', label: 'Lighthouse performance', note: 'on throttled Moto G4 profile' },
          { value: '40+', label: 'countries of traffic', note: 'majority on mobile connections' },
        ],
      },
      images: [],
    }
  }
];

export const ORBIT_PROJECTS = PROJECTS.filter(p => p.heroInOrbit);
export const ALL_PROJECTS = PROJECTS;
