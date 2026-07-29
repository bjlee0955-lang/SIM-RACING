import * as THREE from 'three';
import { Track } from './track.js';
import { CAR_ROSTER, AI_NAMES } from './cars.js';
import { buildCarMesh, Vehicle } from './vehicle.js';
import { AIDriver } from './ai.js';
import { InputManager, setupTouchControls } from './input.js';

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
let scene, camera, renderer, clock;
let track, trackMesh;
let entities = []; // { vehicle, mesh, wheels, ai? }
let playerEntity = null;
let inputMgr;
let camMode = 'chase'; // 'chase' | 'cockpit'
let session = 'menu';  // 'qualy' | 'race' | 'results'
let raceLaps = 5;
let selectedCarId = CAR_ROSTER[0].id;
let animId = null;
let sunLight;

const els = {}; // cached DOM refs, populated on init

function $(id) { return document.getElementById(id); }

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  cacheEls();
  initScene();
  buildMenus();
  wireMenuEvents();
  showScreen('mainMenu');
  $('loadingScreen').style.display = 'none';
  startRenderLoop();
});

function cacheEls() {
  ['mainMenu','howToScreen','carSelectScreen','calibrateScreen','hud','touchControls',
   'lightsOverlay','resultOverlay','toast','carList','wheelPreviewCal','lightRow','lightsText',
   'resultTable','resultTitle','sessionLabel','lapCur','lapOf','posVal','posTotal','lapTimeVal',
   'bestLapVal','speedVal','gearVal','fuelBar','fuelPct','tireBar','tirePct'
  ].forEach(id => els[id] = $(id));
}

// ---------------------------------------------------------------------------
// Three.js scene setup
// ---------------------------------------------------------------------------
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc7ea);
  scene.fog = new THREE.Fog(0x8fc7ea, 220, 900);

  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('canvas-wrap').appendChild(renderer.domElement);

  // Lighting: hemisphere + directional sun with shadows
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x33421f, 0.7);
  scene.add(hemi);

  sunLight = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sunLight.position.set(180, 260, 120);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -260;
  sunLight.shadow.camera.right = 260;
  sunLight.shadow.camera.top = 260;
  sunLight.shadow.camera.bottom = -260;
  sunLight.shadow.camera.far = 700;
  sunLight.shadow.bias = -0.0008;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // simple sky sphere for a nicer horizon than flat fog color
  const skyGeo = new THREE.SphereGeometry(1500, 24, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x8fc7ea, side: THREE.BackSide,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Track
  track = new Track();
  trackMesh = track.buildMesh();
  scene.add(trackMesh);

  // scattered trees / grandstands for scenery depth
  addScenery();

  clock = new THREE.Clock();
  inputMgr = new InputManager();
  setupTouchControls(inputMgr);

  window.addEventListener('resize', onResize);
}

function addScenery() {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.85 });
  const treeGeoTrunk = new THREE.CylinderGeometry(0.25, 0.3, 2.2, 6);
  const treeGeoLeaf = new THREE.SphereGeometry(1.6, 8, 6);

  const scatter = new THREE.Group();
  const n = track.points.length;
  for (let i = 0; i < n; i += 26) {
    const p = track.points[i];
    const tan = track.tangents[i];
    const normal = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    for (const side of [1, -1]) {
      if (Math.random() > 0.55) continue;
      const dist = 22 + Math.random() * 30;
      const pos = p.clone().addScaledVector(normal, side * dist);
      const trunk = new THREE.Mesh(treeGeoTrunk, trunkMat);
      trunk.position.copy(pos).setY(1.1);
      trunk.castShadow = true;
      const leaf = new THREE.Mesh(treeGeoLeaf, leafMat);
      leaf.position.copy(pos).setY(2.6);
      leaf.scale.setScalar(0.8 + Math.random() * 0.5);
      leaf.castShadow = true;
      scatter.add(trunk, leaf);
    }
  }
  scene.add(scatter);

  // grandstand near start/finish
  const standGeo = new THREE.BoxGeometry(26, 6, 5);
  const standMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.7 });
  const stand = new THREE.Mesh(standGeo, standMat);
  stand.position.set(-24, 3, 10);
  stand.castShadow = true; stand.receiveShadow = true;
  scene.add(stand);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------------------------------------------------------------------------
// Menu building
// ---------------------------------------------------------------------------
function buildMenus() {
  els.carList.innerHTML = '';
  CAR_ROSTER.forEach((car, i) => {
    const div = document.createElement('div');
    div.className = 'car-item' + (car.id === selectedCarId ? ' selected' : '');
    div.dataset.carId = car.id;
    div.innerHTML = `
      <div class="car-swatch" style="background:#${car.color.toString(16).padStart(6,'0')}"></div>
      <div class="car-info">
        <div class="car-name">${car.name}</div>
        <div class="car-stats">
          <span>⚡ ${car.power}hp</span>
          <span>🏁 ${car.topSpeed}km/h</span>
          <span>🛞 grip ${car.grip.toFixed(2)}</span>
        </div>
      </div>`;
    div.addEventListener('click', () => {
      selectedCarId = car.id;
      [...els.carList.children].forEach(c => c.classList.remove('selected'));
      div.classList.add('selected');
    });
    els.carList.appendChild(div);
  });

  // wheel preview animation for calibration screen
}

function wireMenuEvents() {
  $('toCarSelectBtn').onclick = () => showScreen('carSelectScreen');
  $('howToBtn').onclick = () => showScreen('howToScreen');
  $('backFromHowTo').onclick = () => showScreen('mainMenu');
  $('backFromCarSelect').onclick = () => showScreen('mainMenu');
  $('toCalibrateBtn').onclick = () => showScreen('calibrateScreen');
  $('permBtn').onclick = async () => {
    const ok = await inputMgr.requestPermissionAndStart();
    if (ok) {
      toast('센서 연결됨. 편하게 잡은 자세에서 다시 눌러 보정하세요.');
      startCalibrationLoop();
      setTimeout(() => { inputMgr.calibrate(); startRace(); }, 1200);
    } else {
      toast('센서 권한이 거부되었습니다. 터치 조작으로 진행합니다.');
      startRace();
    }
  };
  $('skipSensorBtn').onclick = () => startRace();

  $('camToggleBtn').onclick = () => {
    camMode = camMode === 'chase' ? 'cockpit' : 'chase';
  };
  $('pauseBtn').onclick = () => togglePause();
  $('resultNextBtn').onclick = () => onResultNext();
}

function showScreen(id) {
  ['mainMenu','howToScreen','carSelectScreen','calibrateScreen'].forEach(s => {
    els[s].classList.toggle('hidden', s !== id);
  });
}

let calibRAF = null;
function startCalibrationLoop() {
  if (calibRAF) cancelAnimationFrame(calibRAF);
  const wheel = els.wheelPreviewCal;
  function loop() {
    const delta = inputMgr.rawGamma - inputMgr.calibrationGamma;
    const deg = Math.max(-45, Math.min(45, delta * 1.4));
    wheel.style.transform = `rotate(${deg}deg)`;
    calibRAF = requestAnimationFrame(loop);
  }
  loop();
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------------------
// Race setup
// ---------------------------------------------------------------------------
function startRace() {
  els.calibrateScreen.classList.add('hidden');
  setupEntities();
  session = 'qualy';
  raceLaps = 1;
  els.sessionLabel.textContent = '퀄리파잉';
  els.lapOf.textContent = '/1';
  els.hud.classList.add('active');
  els.touchControls.style.display = 'block';
  runStartSequence(() => { /* qualy starts free-run, no lights hold needed but keep consistent */ });
}

function setupEntities() {
  // clear previous
  entities.forEach(e => scene.remove(e.mesh));
  entities = [];

  const playerSpec = CAR_ROSTER.find(c => c.id === selectedCarId) || CAR_ROSTER[0];
  const gridSpecs = [playerSpec, ...shuffle(CAR_ROSTER.filter(c => c !== playerSpec)).slice(0, 3), ...shuffle(CAR_ROSTER).slice(0, 4)];
  // Ensure 8 total cars
  while (gridSpecs.length < 8) gridSpecs.push(CAR_ROSTER[gridSpecs.length % CAR_ROSTER.length]);

  gridSpecs.slice(0, 8).forEach((spec, i) => {
    const isPlayer = i === 0;
    const vehicle = new Vehicle(spec, isPlayer);
    vehicle.s = -i * 8; // starting grid stagger behind line
    vehicle.n = (i % 2 === 0 ? -1 : 1) * 2.3;
    const { group, wheels } = buildCarMesh(spec);
    scene.add(group);
    const entity = { vehicle, mesh: group, wheels, spec, name: isPlayer ? '플레이어' : AI_NAMES[i % AI_NAMES.length] };
    if (!isPlayer) entity.ai = new AIDriver(vehicle, track, 0.9 + Math.random() * 0.16);
    entities.push(entity);
    if (isPlayer) playerEntity = entity;
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Start lights sequence
// ---------------------------------------------------------------------------
function runStartSequence(onGo) {
  $('resultOverlay').classList.remove('active');
  const overlay = $('lightsOverlay');
  const row = els.lightRow;
  row.innerHTML = '';
  const dots = [];
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('div');
    d.className = 'lightDot';
    row.appendChild(d);
    dots.push(d);
  }
  overlay.classList.add('active');
  els.lightsText.textContent = '준비하세요';

  // freeze player controls during sequence
  raceState.locked = true;

  let i = 0;
  const iv = setInterval(() => {
    if (i < 5) { dots[i].classList.add('on'); i++; }
    else {
      clearInterval(iv);
      setTimeout(() => {
        dots.forEach(d => d.classList.remove('on'));
        els.lightsText.textContent = 'GO!';
        overlay.classList.remove('active');
        raceState.locked = false;
        onGo && onGo();
      }, 400 + Math.random() * 700);
    }
  }, 500);
}

const raceState = { locked: false, paused: false, running: false, resultsShown: false };

function togglePause() {
  raceState.paused = !raceState.paused;
  toast(raceState.paused ? '일시정지' : '재개');
}

// ---------------------------------------------------------------------------
// Session transitions
// ---------------------------------------------------------------------------
function endQualy() {
  session = 'results-qualy';
  // sort by best lap (player uses current lapTime as their qualy attempt if no lap completed)
  const ranked = [...entities].sort((a, b) => qualyKey(a) - qualyKey(b));
  showResults('퀄리파잉 결과', ranked, (row, i) => {
    const t = row.vehicle.bestLap;
    return `${i + 1}. ${row.name} — ${t ? fmtTime(t) : '기록 없음'}`;
  }, () => {
    $('resultOverlay').classList.remove('active');
    // set grid order for race based on qualy result
    startRaceSession(ranked);
  });
}

function qualyKey(e) {
  return e.vehicle.bestLap ?? Infinity;
}

function startRaceSession(gridOrder) {
  raceState.resultsShown = false;
  session = 'race';
  raceLaps = 5;
  els.sessionLabel.textContent = '레이스';
  els.lapOf.textContent = '/5';

  // reposition according to grid order, reset lap/fuel/tires
  gridOrder.forEach((e, i) => {
    e.vehicle.s = -i * 8;
    e.vehicle.n = (i % 2 === 0 ? -1 : 1) * 2.3;
    e.vehicle.lap = 1;
    e.vehicle.lapTime = 0;
    e.vehicle.raceTime = 0;
    e.vehicle.finished = false;
    e.vehicle.fuel = e.spec.fuelCapacity;
    e.vehicle.tireWear = 0;
    e.vehicle.speed = 0;
  });

  runStartSequence();
}

function endRace() {
  session = 'results-race';
  const ranked = [...entities].sort((a, b) => {
    if (a.vehicle.lap !== b.vehicle.lap) return b.vehicle.lap - a.vehicle.lap;
    return a.vehicle.raceTime - b.vehicle.raceTime;
  });
  showResults('레이스 결과', ranked, (row, i) => {
    return `${i + 1}. ${row.name} — 최고랩 ${row.vehicle.bestLap ? fmtTime(row.vehicle.bestLap) : '-'}`;
  }, () => {
    showScreen('mainMenu');
    els.hud.classList.remove('active');
    els.touchControls.style.display = 'none';
    $('resultOverlay').classList.remove('active');
    session = 'menu';
  }, true);
}

function showResults(title, ranked, rowFmt, onNext, isFinal = false) {
  els.resultTitle.textContent = title;
  const table = els.resultTable;
  table.innerHTML = '';
  ranked.forEach((row, i) => {
    const tr = document.createElement('tr');
    if (row.vehicle.isPlayer) tr.classList.add('you');
    tr.innerHTML = `<td>${rowFmt(row, i)}</td>`;
    table.appendChild(tr);
  });
  $('resultNextBtn').textContent = isFinal ? '메인 메뉴로' : '레이스 시작';
  $('resultOverlay').classList.add('active');
  onResultNext = onNext;
}
let onResultNext = () => {};

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function startRenderLoop() {
  function frame() {
    animId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (session === 'qualy' || session === 'race') {
      if (!raceState.paused && !raceState.locked) updateRace(dt);
    }
    updateCamera(dt);
    renderer.render(scene, camera);
  }
  frame();
}

function updateRace(dt) {
  // Player input -> vehicle controls
  if (playerEntity) {
    const v = playerEntity.vehicle;
    v.steer = inputMgr.steer;
    v.throttle = inputMgr.throttle;
    v.brake = inputMgr.brake;
  }

  // AI updates
  entities.forEach(e => { if (e.ai) e.ai.update(dt); });

  // Physics updates
  entities.forEach(e => e.vehicle.update(dt, track));

  // Collision resolution (simple circular proximity in s/n space)
  resolveCollisions();

  // Lap crossing detection: when s wraps past track.length going forward
  entities.forEach(e => {
    const v = e.vehicle;
    const prevLapDist = v._prevS ?? v.s;
    if (v.s >= track.length && prevLapDist < track.length) {
      v.s -= track.length;
      handleLapComplete(e);
    }
    v._prevS = v.s;
  });

  // Position mesh from s/n
  entities.forEach(e => placeVehicleMesh(e));

  updateHUD();
}

function handleLapComplete(entity) {
  const v = entity.vehicle;
  v.crossFinishLine();
  if (entity.vehicle.isPlayer) toast(`랩 ${v.lap - 1} 완료 — ${fmtTime(v.lastLapTime)}`);

  if (session === 'qualy') {
    // qualy: single flying lap; end after player completes 1 lap
    if (entity.vehicle.isPlayer && v.lap > raceLaps) {
      endQualy();
    }
  } else if (session === 'race') {
    if (v.lap > raceLaps && !v.finished) {
      v.finished = true;
    }
    if (entity.vehicle.isPlayer && v.finished) {
      // wait a beat then show results once all AI effectively done or immediately
      setTimeout(() => { if (session === 'race') endRace(); }, 600);
    }
  }
}

function resolveCollisions() {
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i].vehicle, b = entities[j].vehicle;
      let ds = a.s - b.s;
      // account for wrap
      if (ds > track.length / 2) ds -= track.length;
      if (ds < -track.length / 2) ds += track.length;
      const dn = a.n - b.n;
      const distS = Math.abs(ds), distN = Math.abs(dn);
      if (distS < 4.2 && distN < 2.1) {
        // push apart laterally, transfer some speed loss
        const push = (2.1 - distN) * 0.5 + 0.02;
        const dir = dn >= 0 ? 1 : -1;
        a.n += dir * push;
        b.n -= dir * push;
        const relSpeed = Math.abs(a.speed - b.speed);
        a.speed -= Math.min(a.speed, relSpeed * 0.15 + 0.6);
        b.speed -= Math.min(b.speed, relSpeed * 0.15 + 0.6);
        if (a.isPlayer || b.isPlayer) toast('충돌!');
      }
    }
  }
}

function placeVehicleMesh(entity) {
  const v = entity.vehicle;
  const { pos, tan } = track.getFrameAtDistance(v.s);
  const normal = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
  const worldPos = pos.clone().addScaledVector(normal, v.n);
  worldPos.y = 0.05;
  entity.mesh.position.copy(worldPos);

  const trackYaw = Math.atan2(tan.x, tan.z);
  entity.mesh.rotation.y = trackYaw + v.heading;

  // spin wheels for visual feedback
  const wheelSpin = v.speed * 0.6;
  entity.wheels.forEach((w, idx) => {
    w.rotation.x += wheelSpin * 0.1;
    if (idx < 2) {
      // front wheels reflect steering
      w.rotation.y = v.steer * 0.35;
    }
  });
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const camTmp = new THREE.Vector3();
function updateCamera(dt) {
  if (!playerEntity) {
    camera.position.set(0, 60, 100);
    camera.lookAt(0, 0, 0);
    return;
  }
  const mesh = playerEntity.mesh;
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);

  if (camMode === 'chase') {
    const camOffset = forward.clone().multiplyScalar(-9).add(new THREE.Vector3(0, 4.2, 0));
    camTmp.copy(mesh.position).add(camOffset);
    camera.position.lerp(camTmp, 1 - Math.pow(0.001, dt));
    const lookAt = mesh.position.clone().add(forward.clone().multiplyScalar(6)).add(new THREE.Vector3(0, 1, 0));
    camera.lookAt(lookAt);
  } else {
    // cockpit view
    const camOffset = forward.clone().multiplyScalar(0.2).add(new THREE.Vector3(0, 1.15, 0));
    camTmp.copy(mesh.position).add(camOffset);
    camera.position.lerp(camTmp, 1 - Math.pow(0.0001, dt));
    const lookAt = mesh.position.clone().add(forward.clone().multiplyScalar(20)).add(new THREE.Vector3(0, 1.1, 0));
    camera.lookAt(lookAt);
  }

  // keep sun following roughly overhead of player for consistent shadow density
  sunLight.position.set(mesh.position.x + 180, 260, mesh.position.z + 120);
  sunLight.target.position.copy(mesh.position);
  sunLight.target.updateMatrixWorld();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHUD() {
  if (!playerEntity) return;
  const v = playerEntity.vehicle;
  window.__debug = { s: v.s, n: v.n, lap: v.lap, speed: v.speed, fuel: v.fuel, tireWear: v.tireWear, trackLength: track.length, session };

  els.lapCur.textContent = Math.min(v.lap, raceLaps);
  els.speedVal.textContent = Math.round(v.speed * 3.6);
  els.gearVal.textContent = v.speed < 0.3 ? 'N' : v.gear;
  els.lapTimeVal.textContent = fmtTime(v.lapTime);
  els.bestLapVal.textContent = v.bestLap ? fmtTime(v.bestLap) : '--:--.--';

  els.fuelBar.style.width = `${Math.round(v.fuelPct * 100)}%`;
  els.fuelPct.textContent = `${Math.round(v.fuelPct * 100)}%`;

  const tirePct = Math.round(v.tireGripPct * 100);
  els.tireBar.style.width = `${tirePct}%`;
  els.tirePct.textContent = `${tirePct}%`;
  els.tireBar.classList.toggle('warn', tirePct < 45);

  // position among all entities by lap+s progress
  const ranked = [...entities].sort((a, b) => {
    if (a.vehicle.lap !== b.vehicle.lap) return b.vehicle.lap - a.vehicle.lap;
    return b.vehicle.s - a.vehicle.s;
  });
  const pos = ranked.findIndex(e => e.vehicle.isPlayer) + 1;
  els.posVal.textContent = pos;
  els.posTotal.textContent = entities.length;

  if (v.fuel <= 0.5 && v.fuel > 0) toastOnce('연료 부족 경고!');
  if (v.tireGripPct < 0.15) toastOnce('타이어 마모 심각!');
}

let _toastFlags = {};
function toastOnce(msg) {
  if (_toastFlags[msg]) return;
  _toastFlags[msg] = true;
  toast(msg);
  setTimeout(() => { _toastFlags[msg] = false; }, 15000);
}
