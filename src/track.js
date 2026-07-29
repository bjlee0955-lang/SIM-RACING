import * as THREE from 'three';

// "Ardennes Circuit" — 오리지널 트랙.
// 실제 서킷의 이름/브랜딩은 사용하지 않되, 고저차가 있는 숲길 레이아웃 컨셉으로 설계.
// 컨트롤 포인트: (x, y=고도, z)
const CONTROL_POINTS = [
  [0, 0, 0],
  [40, 1, -60],
  [90, 3, -140],
  [110, 6, -230],
  [70, 10, -300],      // 상승 헤어핀
  [-10, 14, -330],
  [-90, 12, -300],
  [-140, 8, -220],
  [-150, 4, -120],
  [-110, 2, -40],
  [-60, 1, 10],
  [-20, 0, 20],
];

export function buildTrackCurve() {
  const points = CONTROL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  return curve;
}

const TRACK_WIDTH = 14;

export function buildTrackMeshes(curve) {
  const group = new THREE.Group();
  const segments = 400;
  const pts = curve.getSpacedPoints(segments);
  const frames = curve.computeFrenetFrames(segments, true);

  // 도로 지오메트리 (리본 형태)
  const roadVerts = [];
  const roadUVs = [];
  const roadIndices = [];
  const leftEdge = [];
  const rightEdge = [];

  for (let i = 0; i <= segments; i++) {
    const p = pts[i];
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    // 도로는 대략 수평이어야 하므로 world-up 기준 좌우 벡터 계산
    const tangent = frames.tangents[i];
    const worldUp = new THREE.Vector3(0, 1, 0);
    let side = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
    if (side.lengthSq() < 0.001) side = binormal;

    const left = p.clone().add(side.clone().multiplyScalar(TRACK_WIDTH / 2));
    const right = p.clone().add(side.clone().multiplyScalar(-TRACK_WIDTH / 2));
    leftEdge.push(left);
    rightEdge.push(right);

    roadVerts.push(left.x, left.y, left.z);
    roadVerts.push(right.x, right.y, right.z);
    roadUVs.push(0, i / 8);
    roadUVs.push(1, i / 8);

    if (i < segments) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      roadIndices.push(a, b, c, b, d, c);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVerts, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();

  const asphaltTex = makeAsphaltTexture();
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    roughness: 0.95,
    metalness: 0.02,
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // 커브(레드/화이트 킬로 지지) - 도로 가장자리 라인
  const curbGroup = buildCurbs(leftEdge, rightEdge);
  group.add(curbGroup);

  // 잔디/지형 베이스
  const ground = buildGround();
  group.add(ground);

  // 결승선 스트라이프 & 스타트/피니시 게이트
  const finishLine = buildFinishLine(leftEdge[0], rightEdge[0], curve.getTangentAt(0));
  group.add(finishLine);

  // 트랙 사이드 배리어(레이싱 라인 이탈 방지 시각 요소 + 충돌 대상)
  const barriers = buildBarriers(leftEdge, rightEdge);
  group.add(barriers);

  // 나무들 (숲길 컨셉)
  const trees = buildTrees(curve, segments);
  group.add(trees);

  return { group, leftEdge, rightEdge, segments };
}

function makeAsphaltTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const g = 30 + Math.random() * 30;
    ctx.fillStyle = `rgba(${g},${g},${g + 4},${0.15 + Math.random() * 0.2})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // 중앙선 점선
  ctx.strokeStyle = 'rgba(230,220,200,0.55)';
  ctx.lineWidth = 4;
  ctx.setLineDash([14, 14]);
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 60);
  return tex;
}

function buildCurbs(leftEdge, rightEdge) {
  const group = new THREE.Group();
  const curbMatRed = new THREE.MeshStandardMaterial({ color: 0xcc2b2b, roughness: 0.8 });
  const curbMatWhite = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.8 });

  [leftEdge, rightEdge].forEach((edge) => {
    for (let i = 0; i < edge.length - 1; i += 1) {
      const p0 = edge[i];
      const p1 = edge[i + 1];
      const dir = new THREE.Vector3().subVectors(p1, p0);
      const len = dir.length();
      if (len < 0.001) continue;
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const geo = new THREE.BoxGeometry(1.1, 0.12, len);
      const mat = i % 2 === 0 ? curbMatRed : curbMatWhite;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(mid);
      mesh.position.y += 0.06;
      mesh.lookAt(p1.x, mesh.position.y, p1.z);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  });
  return group;
}

function buildGround() {
  const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c3b24';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) {
    const g = 30 + Math.random() * 40;
    ctx.fillStyle = `rgba(${g},${70 + g},${g},0.4)`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.05;
  mesh.receiveShadow = true;
  return mesh;
}

function buildFinishLine(left, right, tangent) {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const cs = 8;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#fff' : '#111';
      ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(14, 3);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  const mid = left.clone().add(right).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.position.y += 0.02;
  const angle = Math.atan2(tangent.x, tangent.z);
  mesh.rotation.z = angle;
  group.add(mesh);
  return group;
}

function buildBarriers(leftEdge, rightEdge) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd6482e, roughness: 0.6 });
  [leftEdge, rightEdge].forEach((edge, side) => {
    const offsetDir = side === 0 ? 1 : -1;
    for (let i = 0; i < edge.length - 1; i += 3) {
      const p0 = edge[i];
      const p1 = edge[Math.min(i + 3, edge.length - 1)];
      const dir = new THREE.Vector3().subVectors(p1, p0);
      const len = dir.length();
      if (len < 0.001) continue;
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(offsetDir * 1.2);
      const geo = new THREE.BoxGeometry(0.5, 0.9, len * 1.02);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(mid).add(perp);
      mesh.position.y += 0.45;
      mesh.lookAt(p1.x + perp.x, mesh.position.y, p1.z + perp.z);
      mesh.userData.isBarrier = true;
      group.add(mesh);
    }
  });
  return group;
}

function buildTrees(curve, segments) {
  const group = new THREE.Group();
  const geo = new THREE.ConeGeometry(2.2, 7, 6);
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 2, 6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1f4d2e, roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3423, roughness: 1 });
  const instMesh = new THREE.InstancedMesh(geo, mat, 260);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, 260);
  const dummy = new THREE.Object3D();
  const trunkDummy = new THREE.Object3D();

  const pts = curve.getSpacedPoints(segments);
  let idx = 0;
  for (let i = 0; i < segments && idx < 260; i += 2) {
    const p = pts[i];
    const tangent = curve.getTangentAt(i / segments);
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    for (const dir of [1, -1]) {
      if (idx >= 260) break;
      const dist = 12 + Math.random() * 30;
      const jitter = (Math.random() - 0.5) * 10;
      const pos = p.clone()
        .add(side.clone().multiplyScalar(dir * dist))
        .add(tangent.clone().multiplyScalar(jitter));
      const scale = 0.7 + Math.random() * 0.8;
      dummy.position.set(pos.x, pos.y + 3.5 * scale, pos.z);
      dummy.scale.setScalar(scale);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.updateMatrix();
      instMesh.setMatrixAt(idx, dummy.matrix);

      trunkDummy.position.set(pos.x, pos.y + 1 * scale, pos.z);
      trunkDummy.scale.setScalar(scale);
      trunkDummy.updateMatrix();
      trunkMesh.setMatrixAt(idx, trunkDummy.matrix);
      idx++;
    }
  }
  instMesh.count = idx;
  trunkMesh.count = idx;
  instMesh.castShadow = true;
  group.add(instMesh, trunkMesh);
  return group;
}

export function getTrackWidth() { return TRACK_WIDTH; }
