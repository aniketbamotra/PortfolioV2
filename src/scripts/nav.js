// Page navigation — curtain fade, view swap, active state sync.
// All internal navigation goes through goto(viewId). Never use location.href.

let currentView = 'home';

// Notified by three-orbit.js to pause/resume the rAF loop.
let _orbitPauseCallback = null;

export function registerOrbitCallbacks(pauseFn) {
  _orbitPauseCallback = pauseFn;
}

export function goto(viewId) {
  if (viewId === currentView) return;

  const curtain = document.getElementById('curtain');
  if (!curtain) return;

  // 1. Fade curtain in
  curtain.classList.add('visible');
  curtain.classList.remove('fading-in');

  setTimeout(() => {
    // 2. Swap views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const next = document.getElementById(viewId);
    if (next) next.classList.add('active');

    currentView = viewId;
    _updateActiveLink(viewId);

    // Notify orbit to pause or resume
    if (_orbitPauseCallback) {
      _orbitPauseCallback(viewId !== 'home');
    }

    // 3. Fade curtain out
    curtain.classList.remove('visible');
    curtain.classList.add('fading-in');

    setTimeout(() => {
      curtain.classList.remove('fading-in');
    }, 400);

  }, 280);
}

function _updateActiveLink(viewId) {
  document.querySelectorAll('.nav-link').forEach(link => {
    const target = link.dataset.view;
    link.classList.toggle('active', target === viewId);
  });
}

export function initNav() {
  // Bind nav links and the logo (all elements with data-view attribute)
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => {
      const viewId = el.dataset.view;
      if (viewId) goto(viewId);
    });
  });

  // Set initial active state based on default view
  _updateActiveLink(currentView);
}
