// Animates the two logo circles with a sine-wave opacity pulse.
// Period: 4s. Circles are out of phase by π.
// Circle 1 oscillates [0.7, 1.0]; Circle 2 oscillates [0.3, 0.55].
// Uses rAF — no GSAP.

export function initLogo() {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const c1 = document.getElementById('logo-c1');
  const c2 = document.getElementById('logo-c2');

  if (!c1 || !c2) return;

  if (prefersReduced) {
    c1.style.strokeOpacity = '0.85';
    c2.style.strokeOpacity = '0.45';
    return;
  }

  let rafId;
  const PERIOD = 4000; // ms

  function tick(timestamp) {
    const t = (timestamp % PERIOD) / PERIOD; // 0 → 1
    const angle = t * Math.PI * 2;

    // [0.7, 1.0] range
    const op1 = 0.85 + Math.sin(angle) * 0.15;
    // [0.3, 0.55] range — π out of phase
    const op2 = 0.425 + Math.sin(angle + Math.PI) * 0.125;

    c1.style.strokeOpacity = op1.toFixed(3);
    c2.style.strokeOpacity = op2.toFixed(3);

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return function destroy() {
    cancelAnimationFrame(rafId);
  };
}
