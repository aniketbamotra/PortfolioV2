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
    shortDesc: 'Design and frontend for an open-source API testing platform — placeholder copy.',
    longDesc: 'Dummy copy: product design and frontend engineering for Keploy, an open-source API testing platform. Real case-study text to follow.',
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
    atmo: { base: '#111111', fog: '#f2ddc2', glow: '#e8913f', smoke: '#b25325' },
    shaderType: 'token-grid',
    coverImage: '/assets/projects/keploy.png',
    caseStudy: {
      layout: 'dls',
      challenge: '',
      process: '',
      outcome: '',
      images: [],
    }
  },
  {
    id: 'gemx',
    title: 'GEMx',
    shortDesc: 'Brand and interactive web experience for a gemstone exchange — placeholder copy.',
    longDesc: 'Dummy copy: identity and interactive marketing site for GEMx, a gemstone trading platform. Real case-study text to follow.',
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
    atmo: { base: '#111111', fog: '#eaeec4', glow: '#40e788', smoke: '#2ea87b' },
    shaderType: 'flow-field',
    coverImage: '/assets/projects/Gemx.png',
    caseStudy: {
      layout: 'brand',
      challenge: '',
      process: '',
      outcome: '',
      images: [],
    }
  },
  {
    id: 'demand-climate-justice',
    title: 'Demand Climate Justice',
    shortDesc: 'Campaign site for a global climate justice movement — placeholder copy.',
    longDesc: 'Dummy copy: design and build for the Global Campaign to Demand Climate Justice. Real case-study text to follow.',
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
    atmo: { base: '#111111', fog: '#eedac4', glow: '#e79140', smoke: '#a8582e' },
    shaderType: 'growth',
    coverImage: '/assets/projects/DCJ.png',
    caseStudy: {
      layout: 'campaign',
      challenge: '',
      process: '',
      outcome: '',
      images: [],
    }
  }
];

export const ORBIT_PROJECTS = PROJECTS.filter(p => p.heroInOrbit);
export const ALL_PROJECTS = PROJECTS;
