import * as THREE from 'three';
import { CARS, TIRES, FUEL_OPTIONS } from './cars.js';
import { buildTrackCurve, buildTrackMeshes, getTrackWidth } from './track.js';
import { Vehicle, formatTime } from './vehicle.js';
import { AIController } from './ai.js';
import { InputManager } from './input.js';

// ===================== 상태 =====================
const state = {
  selectedCar: CARS[0].id,
  selectedTrack: 'ardennes',
  selectedFuel: FUEL_OPTIONS[1],
  selectedTire: TIRES[1].id,
  mode: null,          // 'qualifying' | 'race'
  cameraMode: 'chase', // 'cockpit' | 'chase'
  running: false,
};

const TOTAL_LAPS = 5;
const QUALI_SECONDS = 5 * 60;

// ===================== THREE 기본 셋업 =====================
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fbfe0);
scene.fog = new THREE.Fog(0x8fbfe0, 120, 420);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1000);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// 조명
const hemi = new THREE.HemisphereLight(0xffffff, 0x223311, 0.65);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2e0, 1.4);
sun.position.set(120, 180, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -220;
sun.shadow.camera.right = 220;
sun.shadow.camera.top = 220;
sun.shadow.camera.bottom = -220;
sun.shadow.camera.far = 500;
scene.add(sun);

// 트랙
const curve = buildTrackCurve();
const { group: trackGroup, leftEdge, rightEdge } = buildTrackMeshes(curve);
scene.add(trackGroup);
const trackHalfWidth = getTrackWidth() / 2;

// ===================== 차량 메쉬 =====================
function buildCarMesh(carSpec) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: carSpec.color, roughness: 0.35, metalness: 0.55 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.1, metalness: 0.2 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.2), bodyMat);
  body.position.y = 0.42;
  body.castShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 1.8), glassMat);
  cabin.position.set(0, 0.72, -0.1);
  cabin.castShadow = true;
  group.add(cabin);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.5), bodyMat);
  wing.position.set(0, 0.85, -1.9);
  group.add(wing);

  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 16);
  const wheelPositions = [
    [0.95, 0.34, 1.3], [-0.95, 0.34, 1.3],
    [0.95, 0.34, -1.3], [-0.95, 0.34, -1.3],
  ];
  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    wheel.castShadow = true;
    group.add(wheel);
  }

  return group;
}

// ===================== 게임 객체 =====================
let playerVehicle = null;
let aiVehicles = [];
let aiControllers = [];
let allVehicles = [];
const input = new InputManager();

let sessionTimeLeft = QUALI_SECONDS;
let raceFinishedOrder = [];
let clock = new THREE.Clock();

function clearVehicles() {
  for (const v of allVehicles) {
    if (v.mesh) scene.remove(v.mesh);
  }
  playerVehicle = null;
  aiVehicles = [];
  aiControllers = [];
  allVehicles = [];
}

function setupSession(mode) {
  clearVehicles();
  state.mode = mode;
  state.running = true;
  raceFinishedOrder = [];

  const playerCarSpec = CARS.find((c) => c.id === state.selectedCar);
  const tireSpec = TIRES.find((t) => t.id === state.selectedTire);

  const playerMesh = buildCarMesh(playerCarSpec);
  scene.add(playerMesh);
  playerVehicle = new Vehicle({
    car: playerCarSpec,
    tire: tireSpec,
    fuelLiters: state.selectedFuel,
    curve,
    isPlayer: true,
    mesh: playerMesh,
  });
  allVehicles.push(playerVehicle);

  // AI 2대 (다른 차량 스펙 활용, 성능 랜덤 소폭 변형)
  const otherCars = CARS.filter((c) => c.id !== state.selectedCar);
  const aiCount = 2;
  for (let i = 0; i < aiCount; i++) {
    const spec = otherCars[i % otherCars.length];
    const mesh = buildCarMesh(spec);
    scene.add(mesh);
    const v = new Vehicle({
      car: spec,
      tire: TIRES[Math.floor(Math.random() * TIRES.length)],
      fuelLiters: FUEL_OPTIONS[1],
      curve,
      isPlayer: false,
      mesh,
    });
    v.u = ((i + 1) * 0.015) % 1; // 살짝 다른 출발 위치
    aiVehicles.push(v);
    allVehicles.push(v);
    aiControllers.push(new AIController(v, { aggression: 0.5 + i * 0.2 }));
  }

  sessionTimeLeft = QUALI_SECONDS;

  document.getElementById('menu').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('sessionTimerBox').classList.toggle('hidden', mode !== 'qualifying');
  document.getElementById('lapTotal').textContent = mode === 'race' ? TOTAL_LAPS : '—';

  clock.getDelta();
  showToast(mode === 'qualifying' ? 'QUALIFYING START' : 'RACE START');
}

// ===================== HUD =====================
const el = {
  lapNow: document.getElementById('lapNow'),
  lapTotal: document.getElementById('lapTotal'),
  posNow: document.getElementById('posNow'),
  curTime: document.getElementById('curTime'),
  bestTime: document.getElementById('bestTime'),
  sessionTimer: document.getElementById('sessionTimer'),
  fuelBar: document.getElementById('fuelBar'),
  fuelPct: document.getElementById('fuelPct'),
  tireBar: document.getElementById('tireBar'),
  tirePct: document.getElementById('tirePct'),
  gearNum: document.getElementById('gearNum'),
  speedNum: document.getElementById('speedNum'),
  rpmFill: document.getElementById('rpmFill'),
};

function updateHud() {
  if (!playerVehicle) return;
  el.lapNow.textContent = Math.min(playerVehicle.lap, TOTAL_LAPS);
  el.curTime.textContent = formatTime(playerVehicle.lapTime);
  el.bestTime.textContent = formatTime(playerVehicle.bestLap);

  const fuelPct = Math.round(playerVehicle.fuelPercent * 100);
  el.fuelBar.style.width = fuelPct + '%';
  el.fuelPct.textContent = fuelPct + '%';
  if (fuelPct < 15) el.fuelBar.style.filter = 'saturate(2) hue-rotate(-20deg)';

  const tirePct = Math.round(playerVehicle.tireHealthPercent * 100);
  el.tireBar.style.width = tirePct + '%';
  el.tirePct.textContent = tirePct + '%';

  el.gearNum.textContent = playerVehicle.gear;
  el.speedNum.textContent = Math.round(playerVehicle.speed);
  el.rpmFill.style.width = Math.min(100, (playerVehicle.rpm / 8000) * 100) + '%';

  // 순위 계산 (총 이동거리 + 랩 기준)
  const ranked = [...allVehicles].sort((a, b) => {
    const scoreA = a.lap * 100000 + a.lapDistance;
    const scoreB = b.lap * 100000 + b.lapDistance;
    return scoreB - scoreA;
  });
  const pos = ranked.indexOf(playerVehicle) + 1;
  el.posNow.textContent = pos;

  if (state.mode === 'qualifying') {
    const m = Math.floor(sessionTimeLeft / 60);
    const s = Math.floor(sessionTimeLeft % 60);
    el.sessionTimer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}

function drawMinimap() {
  const cvs = document.getElementById('minimap');
  const ctx = cvs.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 110;
  if (cvs.width !== size * dpr) {
    cvs.width = size * dpr;
    cvs.height = size * dpr;
    ctx.scale(dpr, dpr);
  }
  ctx.clearRect(0, 0, size, size);

  const pts = curve.getSpacedPoints(120);
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const pad = 10;
  const scaleX = (size - pad * 2) / (maxX - minX);
  const scaleZ = (size - pad * 2) / (maxZ - minZ);
  const s = Math.min(scaleX, scaleZ);

  const toXY = (p) => [
    pad + (p.x - minX) * s,
    pad + (p.z - minZ) * s,
  ];

  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = toXY(p);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();

  for (const v of allVehicles) {
    const p = curve.getPointAt(v.u);
    const [x, y] = toXY(p);
    ctx.fillStyle = v.isPlayer ? '#ff5a2e' : '#2ee6a6';
    ctx.beginPath();
    ctx.arc(x, y, v.isPlayer ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function showToast(msg, duration = 1800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

// ===================== 카메라 =====================
function updateCamera(dt) {
  if (!playerVehicle) return;
  const { position, yaw } = playerVehicle.getWorldTransform(trackHalfWidth);

  if (state.cameraMode === 'cockpit') {
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const camPos = position.clone().add(new THREE.Vector3(0, 0.95, 0)).add(forward.clone().multiplyScalar(0.2));
    camera.position.lerp(camPos, 1 - Math.pow(0.001, dt));
    const lookAt = position.clone().add(forward.clone().multiplyScalar(10)).add(new THREE.Vector3(0, 0.9, 0));
    camera.lookAt(lookAt);
  } else {
    const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const camPos = position.clone()
      .add(back.clone().multiplyScalar(7.5))
      .add(new THREE.Vector3(0, 3.2, 0));
    camera.position.lerp(camPos, 1 - Math.pow(0.0008, dt));
    const lookAt = position.clone().add(new THREE.Vector3(0, 1, 0));
    camera.lookAt(lookAt);
  }
}

// ===================== 충돌 처리 (간단 근접 기반) =====================
function handleCollisions(dt) {
  for (let i = 0; i < allVehicles.length; i++) {
    for (let j = i + 1; j < allVehicles.length; j++) {
      const a = allVehicles[i], b = allVehicles[j];
      if (a.collisionCooldown > 0 || b.collisionCooldown > 0) continue;
      const du = Math.abs(a.u - b.u);
      const closeAlongTrack = du < 0.006 || du > 0.994;
      if (!closeAlongTrack) continue;
      const lateralDist = Math.abs(a.lateralOffset - b.lateralOffset);
      if (lateralDist < 1.6) {
        // 충격량 계산(단순화): 상대 속도차 기반 감속 + 밀어내기
        const relSpeed = Math.abs(a.speedMs - b.speedMs);
        const impact = Math.min(1, relSpeed / 20 + 0.15);
        a.speedMs *= (1 - impact * 0.35);
        b.speedMs *= (1 - impact * 0.35);
        const push = (a.lateralOffset < b.lateralOffset) ? -1 : 1;
        a.lateralOffset += push * 0.6;
        b.lateralOffset -= push * 0.6;
        a.collisionCooldown = 0.5;
        b.collisionCooldown = 0.5;
        if (a.isPlayer || b.isPlayer) showToast('CONTACT!', 700);
      }
    }
  }
}

// ===================== 세션 종료 처리 =====================
function checkSessionEnd(dt) {
  if (state.mode === 'qualifying') {
    sessionTimeLeft -= dt;
    if (sessionTimeLeft <= 0) {
      sessionTimeLeft = 0;
      endQualifying();
    }
  } else if (state.mode === 'race') {
    for (const v of allVehicles) {
      if (!v.finished && v.lap > TOTAL_LAPS) {
        v.finished = true;
        raceFinishedOrder.push(v);
      }
    }
    if (playerVehicle.finished && aiVehicles.every((v) => v.finished)) {
      endRace();
    } else if (playerVehicle.finished) {
      // 플레이어 완주 후에도 결과는 바로 보여줌 (AI는 배경에서 계속 진행 X, 간단화를 위해 즉시 종료)
      endRace();
    }
  }
}

function endQualifying() {
  state.running = false;
  const ranked = [...allVehicles].sort((a, b) => {
    const ba = a.bestLap ?? Infinity, bb = b.bestLap ?? Infinity;
    return ba - bb;
  });
  showResult('퀄리파잉 결과', ranked, (v) => formatTime(v.bestLap));
}

function endRace() {
  state.running = false;
  const ranked = [...allVehicles].sort((a, b) => {
    const da = a.lap * 100000 + a.lapDistance;
    const db = b.lap * 100000 + b.lapDistance;
    return db - da;
  });
  showResult('레이스 결과', ranked, (v) => `Lap ${Math.min(v.lap - 1, TOTAL_LAPS)}`);
}

function showResult(title, ranked, metricFn) {
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('resultTitle').textContent = title;
  const body = document.getElementById('resultBody');
  body.innerHTML = '';
  ranked.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'result-row' + (v.isPlayer ? ' me' : '');
    const name = v.isPlayer ? `${v.car.name} (YOU)` : v.car.name;
    row.innerHTML = `<span class="pos">P${i + 1}</span><span>${name}</span><span>${metricFn(v)}</span>`;
    body.appendChild(row);
  });
  document.getElementById('resultScreen').classList.remove('hidden');
}

// ===================== 메인 루프 =====================
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());

  if (state.running && playerVehicle) {
    playerVehicle.throttle = input.throttle;
    playerVehicle.brakeInput = input.brake;
    playerVehicle.steer = input.steer;
    playerVehicle.update(dt, trackHalfWidth);

    for (let i = 0; i < aiVehicles.length; i++) {
      aiControllers[i].update(dt, allVehicles);
      aiVehicles[i].update(dt, trackHalfWidth);
    }

    handleCollisions(dt);

    for (const v of allVehicles) {
      const { position, yaw } = v.getWorldTransform(trackHalfWidth);
      v.mesh.position.copy(position);
      v.mesh.rotation.y = yaw;
    }

    updateCamera(dt);
    updateHud();
    drawMinimap();
    checkSessionEnd(dt);
  }

  renderer.render(scene, camera);
}
tick();

// ===================== UI 바인딩 =====================
function buildChipRow(containerId, items, getKey, getLabel, getSub, onSelect, selectedKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach((item) => {
    const key = getKey(item);
    const chip = document.createElement('div');
    chip.className = 'chip' + (key === selectedKey ? ' active' : '');
    chip.innerHTML = `${getLabel(item)}${getSub ? `<small>${getSub(item)}</small>` : ''}`;
    chip.addEventListener('click', () => {
      [...container.children].forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      onSelect(key);
    });
    container.appendChild(chip);
  });
}

buildChipRow('carSelect', CARS, (c) => c.id, (c) => c.name, (c) => c.desc, (k) => state.selectedCar = k, state.selectedCar);
buildChipRow('trackSelect', [{ id: 'ardennes', name: 'Ardennes Circuit', desc: '고저차 · 숲길' }], (t) => t.id, (t) => t.name, (t) => t.desc, (k) => state.selectedTrack = k, state.selectedTrack);
buildChipRow('fuelSelect', FUEL_OPTIONS, (f) => f, (f) => f + 'L', null, (k) => state.selectedFuel = k, state.selectedFuel);
buildChipRow('tireSelect', TIRES, (t) => t.id, (t) => t.name, null, (k) => state.selectedTire = k, state.selectedTire);

document.getElementById('btnQualifying').addEventListener('click', () => setupSession('qualifying'));
document.getElementById('btnRace').addEventListener('click', () => setupSession('race'));
document.getElementById('btnBackToMenu').addEventListener('click', () => {
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
});
document.getElementById('btnCamera').addEventListener('click', () => {
  state.cameraMode = state.cameraMode === 'chase' ? 'cockpit' : 'chase';
});
document.getElementById('sensSlider').addEventListener('input', (e) => {
  input.sensitivity = parseFloat(e.target.value);
});
document.getElementById('btnCalibrate').addEventListener('click', () => {
  input.calibrate();
  showToast('자이로 캘리브레이션 완료', 1200);
});
document.getElementById('btnGyroEnable').addEventListener('click', async () => {
  const granted = await input.requestPermission();
  showToast(granted ? '자이로 권한 허용됨' : '자이로 권한 거부됨', 1400);
});
