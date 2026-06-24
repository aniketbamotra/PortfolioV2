// Three.js orbit scene — self-contained.
// One renderer, one scene, one camera. Initialised once, never recreated.
// Exports: initOrbit(canvas), goToProject(idx), getActiveIndex(), prevProject(), nextProject(), destroy()

import * as THREE from 'three';
import { ORBIT_PROJECTS } from '../data/projects.js';

const ORBIT_RADIUS = 4.6;
const CARD_W = 2.6;
const CARD_H = 1.625;
const LERP_ROTATION = 0.06;
const LERP_CAMERA = 0.04;
const LERP_CARD_OPACITY = 0.08;
const SCROLL_SENSITIVITY = 0.0004;
const SCROLL_DAMPING = 0.85;
const STEP = (Math.PI * 2) / ORBIT_PROJECTS.length; // arc between adjacent cards

let renderer, scene, camera, orbitGroup;
let cards = [];
let activeIndex = 0;
let targetRotation = 0;
let currentRotation = 0;
let scrollAcc = 0;
let isActive = true;
let rafId;
let prefersReduced = false;
let stepCount = 0; // cumulative steps taken; never reset, so wraparound is always ±1 step

const _handlers = {};
let _canvas = null;

const mouse = new THREE.Vector2(0, 0);
const cameraTarget = new THREE.Vector3(0, 0, 7);
const clock = new THREE.Clock();

let elCounter, elTitle, elDesc, elTags, elCTAPrimary;
let elBBProject, elBBRole, elBBYear;
let elIndicators;

function _stepToIndex(s) {
  const n = ORBIT_PROJECTS.length;
  return (((-s) % n) + n) % n;
}

function _updateActiveProject(idx) {
  activeIndex = idx;
  _updateHUD(idx);
  if (prefersReduced && orbitGroup) {
    currentRotation = targetRotation;
    orbitGroup.rotation.y = currentRotation;
    renderer?.render(scene, camera);
  }
}

function _updateHUD(index) {
  const proj = ORBIT_PROJECTS[index];
  if (!proj) return;

  if (elCounter) {
    elCounter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(ORBIT_PROJECTS.length).padStart(2, '0')}`;
  }
  if (elTitle) elTitle.textContent = proj.title;
  if (elDesc) elDesc.textContent = proj.shortDesc;
  if (elTags) {
    elTags.innerHTML = proj.tags
      .map(tag => `<span class="pm-tag">${tag}</span>`)
      .join('');
  }
  if (elCTAPrimary) {
    if (proj.hasCaseStudy) {
      elCTAPrimary.textContent = 'View Case Study';
      elCTAPrimary.removeAttribute('disabled');
    } else if (proj.liveUrl) {
      elCTAPrimary.textContent = 'View Live';
      elCTAPrimary.removeAttribute('disabled');
    } else {
      elCTAPrimary.textContent = 'Case Study Soon';
      elCTAPrimary.setAttribute('disabled', 'true');
    }
  }

  if (elBBProject) elBBProject.textContent = proj.title;
  if (elBBRole) elBBRole.textContent = proj.role;
  if (elBBYear) elBBYear.textContent = proj.year;

  if (elIndicators) {
    elIndicators.querySelectorAll('.pi').forEach((el, i) => {
      el.classList.toggle('active', i === index);
    });
  }
}

function _buildIndicators() {
  if (!elIndicators) return;
  elIndicators.innerHTML = '';
  ORBIT_PROJECTS.forEach((proj, i) => {
    const el = document.createElement('div');
    el.className = 'pi' + (i === 0 ? ' active' : '');
    el.dataset.index = String(i);
    // label left of line in DOM so it appears to the left in the flex row
    el.innerHTML = `<span class="pi-label">${proj.title}</span><span class="pi-line"></span>`;
    el.addEventListener('click', () => goToProject(i));
    elIndicators.appendChild(el);
  });
}

function _createCard(proj, index) {
  const n = ORBIT_PROJECTS.length;
  const angle = (index / n) * Math.PI * 2;

  const geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const mat = new THREE.MeshBasicMaterial({
    color: proj.orbitColor ?? 0x0d0d0d,
    transparent: true,
    opacity: index === 0 ? 0.88 : 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // Accent top edge
  const edgeGeo = new THREE.PlaneGeometry(CARD_W, 0.04);
  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0xc8d44e,
    transparent: true,
    opacity: index === 0 ? 0.9 : 0.25,
  });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.position.y = CARD_H / 2 + 0.02;

  // Border outline
  const borderPoints = [
    new THREE.Vector3(-CARD_W / 2, -CARD_H / 2, 0.001),
    new THREE.Vector3( CARD_W / 2, -CARD_H / 2, 0.001),
    new THREE.Vector3( CARD_W / 2,  CARD_H / 2, 0.001),
    new THREE.Vector3(-CARD_W / 2,  CARD_H / 2, 0.001),
    new THREE.Vector3(-CARD_W / 2, -CARD_H / 2, 0.001),
  ];
  const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints);
  const borderMat = new THREE.LineBasicMaterial({
    color: 0x2a2a22,
    transparent: true,
    opacity: 0.6,
  });
  const border = new THREE.Line(borderGeo, borderMat);

  const group = new THREE.Group();
  group.add(mesh, edge, border);

  group.position.x = Math.sin(angle) * ORBIT_RADIUS;
  group.position.z = Math.cos(angle) * ORBIT_RADIUS;
  group.position.y = Math.sin(angle * 2.5) * 0.4;

  return { group, mesh, edge, edgeMat, mat, borderMat,
    targetOpacity: index === 0 ? 0.88 : 0.35,
    currentOpacity: index === 0 ? 0.88 : 0.35,
  };
}

export function initOrbit(canvas) {
  prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  elCounter    = document.getElementById('pm-counter');
  elTitle      = document.getElementById('pm-title');
  elDesc       = document.getElementById('pm-desc');
  elTags       = document.getElementById('pm-tags');
  elCTAPrimary = document.getElementById('pm-cta-primary');
  elBBProject  = document.getElementById('bb-project');
  elBBRole     = document.getElementById('bb-role');
  elBBYear     = document.getElementById('bb-year');
  elIndicators = document.getElementById('proj-indicators');

  // Canvas fills 100vw × 100vh — window dimensions are always correct here,
  // even before CSS layout is computed (avoids the 0×0 setSize race).
  const W = window.innerWidth;
  const H = window.innerHeight;

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias:             true,
    alpha:                 false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x080808, 1);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080808, 0.012);

  camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
  camera.position.set(0, 0, 10);

  const ambientLight = new THREE.AmbientLight(0x111108, 1);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xc8d44e, 0.3);
  dirLight.position.set(2, 4, 3);
  scene.add(dirLight);

  orbitGroup = new THREE.Group();
  scene.add(orbitGroup);

  cards = ORBIT_PROJECTS.map((proj, i) => {
    const card = _createCard(proj, i);
    orbitGroup.add(card.group);
    return card;
  });

  _buildIndicators();
  _updateHUD(0);

  // ── Event listeners ──────────────────────────────────────

  _canvas = canvas;

  _handlers.wheel = (e) => {
    if (!isActive || prefersReduced) return;
    scrollAcc -= e.deltaY * SCROLL_SENSITIVITY;
  };
  _handlers.mousemove = (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  };
  _handlers.resize = () => {
    const w = _canvas.clientWidth || window.innerWidth;
    const h = _canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  _handlers.keydown = (e) => {
    if (!isActive) return;
    if (e.key === 'ArrowLeft')  prevProject();
    if (e.key === 'ArrowRight') nextProject();
  };

  _canvas.addEventListener('wheel',    _handlers.wheel,     { passive: false });
  window.addEventListener('mousemove', _handlers.mousemove);
  window.addEventListener('resize',    _handlers.resize);
  window.addEventListener('keydown',   _handlers.keydown);

  // ── Render loop ───────────────────────────────────────────

  function _findActiveIndex() {
    let minAngle = Infinity;
    let found = 0;
    const n = ORBIT_PROJECTS.length;
    for (let i = 0; i < n; i++) {
      const baseAngle = (i / n) * Math.PI * 2;
      let diff = (baseAngle + currentRotation) % (Math.PI * 2);
      if (diff < 0) diff += Math.PI * 2;
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < minAngle) { minAngle = diff; found = i; }
    }
    return found;
  }

  function render() {
    rafId = requestAnimationFrame(render);
    if (!isActive) return;

    const t = clock.getElapsedTime();

    if (!prefersReduced) {
      targetRotation  += scrollAcc;
      scrollAcc       *= SCROLL_DAMPING;
      currentRotation += (targetRotation - currentRotation) * LERP_ROTATION;
      orbitGroup.rotation.y = currentRotation;
      orbitGroup.position.y = Math.sin(t * 0.3) * 0.05;

      cameraTarget.x = mouse.x * 0.25;
      cameraTarget.y = mouse.y * 0.12;
      camera.position.x += (cameraTarget.x - camera.position.x) * LERP_CAMERA;
      camera.position.y += (cameraTarget.y - camera.position.y) * LERP_CAMERA;
    }
    camera.lookAt(0, 0, 0);

    const newActive = _findActiveIndex();
    if (newActive !== activeIndex) {
      activeIndex = newActive;
      _updateHUD(activeIndex);
      // Sync stepCount so subsequent arrow/indicator navigation starts from the right position.
      // Pick the winding number that keeps stepCount closest to its current value.
      const n = ORBIT_PROJECTS.length;
      const k = Math.round((targetRotation + newActive * STEP) / (n * STEP));
      stepCount = -newActive + k * n;
    }

    cards.forEach((card, i) => {
      card.group.lookAt(camera.position);
      const isActiveCard = i === activeIndex;
      card.targetOpacity   = isActiveCard ? 0.88 : 0.35;
      card.currentOpacity += (card.targetOpacity - card.currentOpacity) * LERP_CARD_OPACITY;
      card.mat.opacity     = card.currentOpacity;
      card.edgeMat.opacity = isActiveCard ? 0.85 : 0.15;
    });

    renderer.render(scene, camera);
  }

  requestAnimationFrame(() => {
    _handlers.resize();
    render();
  });

  return destroy;
}

export function goToProject(targetIdx) {
  const n = ORBIT_PROJECTS.length;
  if (targetIdx < 0 || targetIdx >= n) return;
  const currentIdx = _stepToIndex(stepCount);
  let delta = targetIdx - currentIdx;
  // Take the shortest arc around the ring
  if (delta > n / 2) delta -= n;
  if (delta < -n / 2) delta += n;
  stepCount -= delta;
  targetRotation = stepCount * STEP;
  _updateActiveProject(targetIdx);
}

export function prevProject() {
  stepCount++;
  targetRotation = stepCount * STEP;
  _updateActiveProject(_stepToIndex(stepCount));
}

export function nextProject() {
  stepCount--;
  targetRotation = stepCount * STEP;
  _updateActiveProject(_stepToIndex(stepCount));
}

export function getActiveIndex() { return activeIndex; }

export function setPaused(paused) {
  isActive = !paused;
}

export function destroy() {
  cancelAnimationFrame(rafId);

  _canvas?.removeEventListener('wheel',    _handlers.wheel);
  window.removeEventListener('mousemove', _handlers.mousemove);
  window.removeEventListener('resize',    _handlers.resize);
  window.removeEventListener('keydown',   _handlers.keydown);

  scene?.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
  cards = [];

  renderer?.dispose();
  renderer = null;
  scene = null;
  camera = null;
  orbitGroup = null;
  _canvas = null;
}
